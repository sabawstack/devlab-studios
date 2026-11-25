import { describe, expect, it } from 'vitest'
import { courtIdle } from './outlook'
import { createDriver } from './testing/reducerSim'

describe('courtIdle: why an enabled court has no game', () => {
  it('too few players, waiting on the host (no four fit the rules), session over', () => {
    const few = createDriver({ players: 3, courts: 1, mode: 'PADDLE_STACK', seed: 14 })
    expect([...courtIdle(few.state).values()]).toEqual(['TOO_FEW_PLAYERS'])
    const apart = createDriver({
      players: 4, courts: 1, mode: 'PADDLE_STACK', seed: 15,
      rules: [{ kind: 'APART', playerIds: ['p0', 'p1'] }],
    })
    expect([...courtIdle(apart.state).values()]).toEqual(['WAITING_FOR_HOST'])
    const ended = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 16 })
    ended.run({ type: 'END_SESSION' })
    expect([...courtIdle(ended.state).values()]).toEqual(['SESSION_OVER'])
  })

  it('courts with a game, and courts that are off, have no idle reason', () => {
    const driver = createDriver({ players: 8, courts: 2, mode: 'PADDLE_STACK', seed: 17 })
    expect(courtIdle(driver.state).size).toBe(0)
    driver.run({ type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false })
    expect(courtIdle(driver.state).has('c1')).toBe(false)
  })
})
