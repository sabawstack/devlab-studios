import { afterEach, describe, expect, it, vi } from 'vitest'
import { HEARTBEAT_PING, HEARTBEAT_PONG } from '../../../lib/pickleball/open/realtime'
import { enableHeartbeat } from './heartbeat'

describe('enableHeartbeat (PB-REALTIME-01)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registers ping/pong as the runtime auto-response, so a ping never wakes the Durable Object', () => {
    class Pair {
      constructor(public request: string, public response: string) {}
    }
    vi.stubGlobal('WebSocketRequestResponsePair', Pair)
    const setWebSocketAutoResponse = vi.fn()
    expect(enableHeartbeat({ setWebSocketAutoResponse } as unknown as DurableObjectState)).toBe(true)
    const pair = setWebSocketAutoResponse.mock.calls[0][0] as Pair
    expect(pair).toBeInstanceOf(Pair)
    expect([pair.request, pair.response]).toEqual([HEARTBEAT_PING, HEARTBEAT_PONG])
  })

  it('is a no-op outside the Workers runtime (unit tests, old runtimes)', () => {
    expect(enableHeartbeat({} as unknown as DurableObjectState)).toBe(false)
  })
})
