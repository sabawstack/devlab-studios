// Bounded JSON bodies for every open-play route that takes one. The cap is
// enforced while the body streams in, not after it has been buffered: a
// chunked request carries no Content-Length, and request.text() would read all
// of it (Workers accepts ~100 MB) before any size check could run.
import type { z } from 'zod'
import { discardUnreadBody } from '../../../lib/http'
import { jsonResponse } from '../../utils/responses.js'

/** Only DRAIN_UNREAD_BODIES matters here: local dev reads a refused body to its end (see discardUnreadBody). */
export type DrainEnv = { DRAIN_UNREAD_BODIES?: string } | undefined

export type SmallJson = { ok: true; value: unknown } | { ok: false; response: Response }
export type BoundedText = { ok: true; text: string } | { ok: false; tooLarge: true }

/**
 * Byte caps per route, sized from the schemas with margin (see requestBody.test.ts):
 * - command: an ADD_PLAYERS of 128 pasted names at the schema's 200 characters
 *   is ~26 KB in ASCII; 128 names at the 40 characters a roster keeps, in a
 *   3-byte script, is ~16 KB.
 * - sessionCreate: 128 cleaned 40-character names with skill and DUPR ID in a
 *   3-byte script, settings and a 2 KB Turnstile token are ~25 KB.
 * - small: captains (label ≤ 200 chars), check-in (name ≤ 200 chars), and
 *   routes that take no body at all (claim, reopen) or only a time zone.
 */
export const BODY_LIMITS = {
  command: 32 * 1024,
  sessionCreate: 64 * 1024,
  small: 4 * 1024,
} as const

const tooLargeResponse = (): Response => jsonResponse({ error: 'That request is too large.' }, 413)
export const notUnderstood = (): Response => jsonResponse({ error: 'That request was not understood.' }, 400)

/**
 * Reads the body as UTF-8 text, refusing it once more than `maxBytes` have
 * arrived. A declared Content-Length over the cap is refused before reading.
 * An unreadable body (client went away) reads as ''.
 */
export async function readBoundedText(request: Request, maxBytes: number, env?: DrainEnv): Promise<BoundedText> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    if (env?.DRAIN_UNREAD_BODIES) await discardUnreadBody(request, env)
    else await cancelBody(request)
    return { ok: false, tooLarge: true }
  }
  const body = request.body
  if (!body || request.bodyUsed) return { ok: true, text: '' }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await dropRest(reader, env)
        return { ok: false, tooLarge: true }
      }
      chunks.push(value)
    }
  } catch {
    return { ok: true, text: '' }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(bytes) }
}

/** Production stops reading at once; local dev reads to the end, discarding, so the dev proxy stays healthy. */
async function dropRest(reader: ReadableStreamDefaultReader<Uint8Array>, env: DrainEnv): Promise<void> {
  if (!env?.DRAIN_UNREAD_BODIES) {
    await reader.cancel().catch(() => {})
    return
  }
  try {
    while (!(await reader.read()).done) {
      // discard
    }
  } catch {
    // the client went away mid-body
  }
}

async function cancelBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed || request.body.locked) return
  await request.body.cancel().catch(() => {})
}

/**
 * Reads at most `maxBytes` of JSON. An empty, unreadable or non-JSON body is
 * `fallback` (the schema then decides); only an oversized one is refused here.
 */
export async function readSmallJson(request: Request, maxBytes: number, fallback: unknown = null, env?: DrainEnv): Promise<SmallJson> {
  const read = await readBoundedText(request, maxBytes, env)
  if (!read.ok) return { ok: false, response: tooLargeResponse() }
  if (!read.text.trim()) return { ok: true, value: fallback }
  try {
    return { ok: true, value: JSON.parse(read.text) }
  } catch {
    return { ok: true, value: fallback }
  }
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/**
 * A bounded body validated against `schema` in the route, so the Durable
 * Object only ever receives already-parsed data: 413 when too large, 400 (with
 * `message`, or a generic one) when it is not JSON or does not fit the schema.
 */
export async function readValidJson<S extends z.ZodType>(
  request: Request, maxBytes: number, schema: S, options: { message?: (error: z.ZodError) => string; env?: DrainEnv } = {},
): Promise<Parsed<z.infer<S>>> {
  const { message, env } = options
  const body = await readSmallJson(request, maxBytes, null, env)
  if (!body.ok) return body
  if (body.value === null) return { ok: false, response: notUnderstood() }
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) {
    return { ok: false, response: message ? jsonResponse({ error: message(parsed.error) }, 400) : notUnderstood() }
  }
  return { ok: true, data: parsed.data }
}

/**
 * For routes that take no body (claim, reopen): reads off at most `maxBytes`
 * and refuses anything larger, instead of buffering whatever was sent.
 */
export async function refuseLargeBody(request: Request, maxBytes: number = BODY_LIMITS.small, env?: DrainEnv): Promise<Response | null> {
  const read = await readBoundedText(request, maxBytes, env)
  return read.ok ? null : tooLargeResponse()
}

/** The message for the first field Zod refused, found by its issue path; `fallback` when the body as a whole was wrong. */
export function fieldMessage(error: z.ZodError, messages: Readonly<Record<string, string>>, fallback: string): string {
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && messages[field]) return messages[field]
  }
  return fallback
}
