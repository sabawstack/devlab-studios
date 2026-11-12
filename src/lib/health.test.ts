import { describe, expect, it } from 'vitest'
import { checkHealth } from './health'

const okDb = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database
const badDb = { prepare: () => ({ first: async () => { throw new Error('D1_ERROR: internal') } }) } as unknown as D1Database
const limiter = (check: () => Promise<unknown>) => ({
  idFromName: () => 'id',
  get: () => ({ check }),
}) as unknown as Env['RATE_LIMITER']

const healthy = {
  DB: okDb,
  PICKLEBALL_DB: okDb,
  MEDIA_BUCKET: {} as R2Bucket,
  RATE_LIMITER: limiter(async () => ({ limited: false, retryAfterSeconds: 0 })),
} as unknown as Env

describe('checkHealth (OPS-03)', () => {
  it('is ok when every dependency answers', async () => {
    const result = await checkHealth(healthy)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ ok: true, hasDb: true, hasMediaBucket: true, checks: { db: 'ok', pickleballDb: 'ok', mediaBucket: 'ok', rateLimiter: 'ok' } })
  })

  it('reports degraded (503) when a database read fails, without the error text', async () => {
    const result = await checkHealth({ ...healthy, DB: badDb } as Env)
    expect(result.status).toBe(503)
    expect(result.body.ok).toBe(false)
    expect(result.body.checks.db).toBe('error')
    expect(JSON.stringify(result.body)).not.toMatch(/D1_ERROR|internal/)
  })

  it('reports a missing binding as missing', async () => {
    const result = await checkHealth({ ...healthy, PICKLEBALL_DB: undefined } as unknown as Env)
    expect(result.status).toBe(503)
    expect(result.body.checks.pickleballDb).toBe('missing')
  })

  it('reports a Durable Object that does not answer', async () => {
    const result = await checkHealth({ ...healthy, RATE_LIMITER: limiter(async () => { throw new Error('no') }) } as Env)
    expect(result.body.checks.rateLimiter).toBe('error')
    expect(result.status).toBe(503)
  })
})
