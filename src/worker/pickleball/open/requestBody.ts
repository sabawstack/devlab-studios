// Small JSON bodies for the host-account and DUPR routes. The size cap is
// checked on what was actually read, not only on Content-Length, which a
// client can leave out (chunked) or understate.
import type { z } from 'zod'
import { drainRequestBody } from '../../../lib/http'
import { jsonResponse } from '../../utils/responses.js'

export type SmallJson = { ok: true; value: unknown } | { ok: false; response: Response }

const tooLarge = (): SmallJson => ({ ok: false, response: jsonResponse({ error: 'That request is too large.' }, 413) })

/**
 * Reads at most `maxBytes` of JSON. An empty, unreadable or non-JSON body is
 * `fallback` (the schema then decides); only an oversized one is refused here.
 */
export async function readSmallJson(request: Request, maxBytes: number, fallback: unknown = null): Promise<SmallJson> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) {
    await drainRequestBody(request)
    return tooLarge()
  }
  const text = await request.text().catch(() => null)
  if (text !== null && new TextEncoder().encode(text).length > maxBytes) return tooLarge()
  if (!text?.trim()) return { ok: true, value: fallback }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: true, value: fallback }
  }
}

/** The message for the first field Zod refused, found by its issue path; `fallback` when the body as a whole was wrong. */
export function fieldMessage(error: z.ZodError, messages: Readonly<Record<string, string>>, fallback: string): string {
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field === 'string' && messages[field]) return messages[field]
  }
  return fallback
}
