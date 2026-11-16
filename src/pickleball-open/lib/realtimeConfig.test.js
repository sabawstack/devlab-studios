import { describe, expect, it } from 'vitest'
import { isFresh, REALTIME } from './realtimeConfig'

describe('freshness (PB-REALTIME-01)', () => {
  it('is based on the last server contact, never on the socket state', () => {
    expect(isFresh(null, 1000)).toBe(false)
    expect(isFresh(1000, 1000 + REALTIME.staleMs - 1)).toBe(true)
    expect(isFresh(1000, 1000 + REALTIME.staleMs)).toBe(false)
  })

  it('a quiet session stays live: the heartbeat (plus its reply window) lands well inside the stale window', () => {
    expect(REALTIME.heartbeatMs + REALTIME.replyTimeoutMs).toBeLessThan(REALTIME.staleMs)
    expect(REALTIME.pollMs).toBeLessThan(REALTIME.staleMs)
  })
})
