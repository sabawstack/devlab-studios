import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { checkInSchema } from '../../../lib/schemas/pickleball/open/checkIn'
import { commandEnvelopeSchema } from '../../../lib/schemas/pickleball/open/commands'
import { createCaptainSchema } from '../../../lib/schemas/pickleball/open/captains'
import { createSessionSchema } from '../../../lib/schemas/pickleball/open/createSession'
import { BODY_LIMITS, readBoundedText, readSmallJson, readValidJson, refuseLargeBody } from './requestBody'

const URL_ = 'https://www.devlabstudios.com/api/x'
const bytes = (text: string) => new TextEncoder().encode(text).byteLength

/** A chunked request: no Content-Length, the body arrives in `chunks` pieces. */
function chunked(text: string, chunks = 4): Request {
  const data = new TextEncoder().encode(text)
  const size = Math.ceil(data.byteLength / chunks)
  let pulled = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled * size >= data.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(data.slice(pulled * size, (pulled + 1) * size))
      pulled += 1
    },
  })
  return new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
}

const plain = (text: string, headers: Record<string, string> = {}) => new Request(URL_, { method: 'POST', body: text, headers })

describe('readBoundedText', () => {
  it('reads a body at exactly the cap', async () => {
    const result = await readBoundedText(chunked('x'.repeat(100)), 100)
    expect(result).toEqual({ ok: true, text: 'x'.repeat(100) })
  })

  it('refuses a chunked body (no Content-Length) one byte over the cap', async () => {
    expect(await readBoundedText(chunked('x'.repeat(101)), 100)).toEqual({ ok: false, tooLarge: true })
  })

  it('stops reading once over the cap instead of buffering the rest', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024))
      },
    })
    const request = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect(await readBoundedText(request, 4096)).toEqual({ ok: false, tooLarge: true })
    expect(pulls).toBeLessThan(10)
  })

  it('refuses a declared Content-Length over the cap without reading', async () => {
    const request = plain('{}', { 'content-length': '999999' })
    expect(await readBoundedText(request, 100)).toEqual({ ok: false, tooLarge: true })
  })

  it('counts bytes, not characters', async () => {
    expect((await readBoundedText(chunked('é'.repeat(60)), 100)).ok).toBe(false)
    expect((await readBoundedText(chunked('é'.repeat(50)), 100)).ok).toBe(true)
  })

  it('in local dev (DRAIN_UNREAD_BODIES) reads a refused body to its end', async () => {
    let done = false
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) {
          done = true
          controller.close()
          return
        }
        sent += 1
        controller.enqueue(new Uint8Array(64))
      },
    })
    const request = new Request(URL_, { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect(await readBoundedText(request, 100, { DRAIN_UNREAD_BODIES: '1' })).toEqual({ ok: false, tooLarge: true })
    expect(done).toBe(true)
  })
})

describe('readSmallJson', () => {
  it('413s an oversized body with a generic message', async () => {
    const result = await readSmallJson(chunked(JSON.stringify({ a: 'x'.repeat(5000) })), 4096)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.response.status).toBe(413)
    expect(await result.response.json()).toEqual({ error: 'That request is too large.' })
  })

  it('treats empty and non-JSON bodies as the fallback', async () => {
    expect(await readSmallJson(plain(''), 100, {})).toEqual({ ok: true, value: {} })
    expect(await readSmallJson(plain('not json'), 100, null)).toEqual({ ok: true, value: null })
  })
})

describe('readValidJson', () => {
  const schema = z.object({ name: z.string().max(10) })

  it('returns only the parsed data, with unknown keys stripped', async () => {
    const result = await readValidJson(plain(JSON.stringify({ name: 'Ana', extra: 'x'.repeat(100) })), 4096, schema)
    expect(result).toEqual({ ok: true, data: { name: 'Ana' } })
  })

  it('400s a body that is not JSON or does not fit the schema', async () => {
    for (const body of ['nope', '', JSON.stringify({ name: 'x'.repeat(11) })]) {
      const result = await readValidJson(plain(body), 4096, schema)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(400)
    }
  })

  it('uses the given message for a schema failure', async () => {
    const result = await readValidJson(plain('{}'), 4096, schema, { message: () => 'Check your details and try again.' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(await result.response.json()).toEqual({ error: 'Check your details and try again.' })
  })

  it('413s before validating', async () => {
    const result = await readValidJson(chunked('x'.repeat(5000)), 4096, schema)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(413)
  })
})

describe('refuseLargeBody', () => {
  it('lets an empty or small body through and refuses a large one', async () => {
    expect(await refuseLargeBody(plain(''))).toBeNull()
    expect(await refuseLargeBody(plain('{}'))).toBeNull()
    expect((await refuseLargeBody(chunked('x'.repeat(BODY_LIMITS.small + 1))))?.status).toBe(413)
  })
})

// The caps must fit every legitimate body. These build the largest one each
// route can be sent, check it is valid, and check it is under the cap.
describe('BODY_LIMITS fit the largest legitimate body', () => {
  const threeByte = (n: number) => '漢'.repeat(n)

  it('command: ADD_PLAYERS of 128 names at the schema maximum (ASCII) and at 40 chars in a 3-byte script', () => {
    for (const name of ['x'.repeat(200), threeByte(40)]) {
      const body = JSON.stringify({ idempotencyKey: 'k'.repeat(64), command: { type: 'ADD_PLAYERS', names: Array(128).fill(name) } })
      expect(commandEnvelopeSchema.safeParse(JSON.parse(body)).success).toBe(true)
      expect(bytes(body)).toBeLessThan(BODY_LIMITS.command)
    }
  })

  it('sessionCreate: 128 cleaned 40-char names in a 3-byte script, skill, DUPR ID, settings and a 2 KB token', () => {
    const body = JSON.stringify({
      name: threeByte(60), hostDisplayName: threeByte(40), location: threeByte(120), courtCount: 16,
      settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, announcement: threeByte(140) },
      players: Array.from({ length: 128 }, () => ({ name: threeByte(40), skill: 4.5, duprId: 'ABC123' })),
      kind: 'TOURNAMENT', tournament: { format: 'DOUBLE_ELIMINATION' },
      turnstileToken: 't'.repeat(2048),
    })
    expect(createSessionSchema.safeParse(JSON.parse(body)).success).toBe(true)
    // With margin: at least 2x the largest real body.
    expect(bytes(body) * 2).toBeLessThan(BODY_LIMITS.sessionCreate)
  })

  it('small: a check-in and a captain link at their schema maxima', () => {
    const checkIn = JSON.stringify({ name: threeByte(200), skill: 5, duprId: 'x'.repeat(20) })
    const captain = JSON.stringify({ courtId: 'c'.repeat(64), label: threeByte(200) })
    expect(checkInSchema.safeParse(JSON.parse(checkIn)).success).toBe(true)
    expect(createCaptainSchema.safeParse(JSON.parse(captain)).success).toBe(true)
    expect(bytes(checkIn)).toBeLessThan(BODY_LIMITS.small)
    expect(bytes(captain)).toBeLessThan(BODY_LIMITS.small)
  })
})
