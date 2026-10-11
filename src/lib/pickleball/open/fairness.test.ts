import { describe, expect, it } from 'vitest'
import { busyPlayerIds, gamesPlayed, pairingHistory, pairKey, queueOrder, roundsSatOut } from './fairness'
import { at, court, finished, player, sessionState } from './testing/fixtures'

describe('fairness', () => {
  it('counts finished games plus the late-arrival offset', () => {
    const matches = [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 3, 1)]
    expect(gamesPlayed(player('A'), matches)).toBe(1)
    expect(gamesPlayed(player('E', { gamesOffset: 2 }), matches)).toBe(2)
  })

  it('treats proposed and in-progress players as busy', () => {
    const proposed = { ...finished('m1', ['A', 'B'], ['C', 'D'], 'A', null, null), status: 'PROPOSED' as const, winner: null }
    expect([...busyPlayerIds([proposed])].sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('counts rounds sat out as started games since becoming available, per enabled court', () => {
    const state = sessionState({
      courts: [court('c1', 1), court('c2', 2), court('c3', 3, false)],
      players: [player('W', { waitingSince: at(0) })],
      matches: [1, 2, 3, 4, 5].map((n) => finished(`m${n}`, ['a', 'b'], ['c', 'd'], 'A', 11, 1, n)),
    })
    expect(roundsSatOut(state.players[0], state)).toBe(2) // 5 started games / 2 enabled courts
  })

  it('orders the queue: forced first, then fewest games, then longest wait', () => {
    const state = sessionState({
      courts: [court('c1', 1)],
      players: [
        player('Fresh', { waitingSince: at(30), position: 1 }),
        player('Veteran', { gamesOffset: 3, waitingSince: at(0), position: 2 }),
        player('Waiting', { gamesOffset: 3, waitingSince: at(0), position: 3 }),
        player('Rested', { waitingSince: at(10), position: 4 }),
      ],
      matches: [12, 13].map((n) => finished(`m${n}`, ['a', 'b'], ['c', 'd'], 'A', 11, 1, n)),
    })
    // Veteran and Waiting have sat out 2 rounds since minute 0 -> forced, oldest first by position tie.
    expect(queueOrder(state).map((e) => e.player.id)).toEqual(['Veteran', 'Waiting', 'Rested', 'Fresh'])
  })

  it('records partners and opponents from in-progress and finished games', () => {
    const history = pairingHistory([finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 2)])
    expect(history.partners.get(pairKey('B', 'A'))).toBe(1)
    expect(history.opponents.get(pairKey('A', 'D'))).toBe(1)
    expect(history.partners.get(pairKey('A', 'C'))).toBeUndefined()
  })
})
