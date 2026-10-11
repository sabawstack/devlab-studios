import { describe, expect, it } from 'vitest'
import { diffState } from './diff'
import { court, finished, player, sessionState } from './testing/fixtures'

describe('diffState', () => {
  it('lists only changed rows and deleted matches', () => {
    const prev = sessionState({ players: [player('a'), player('b')], courts: [court('c1', 1)], matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 2)] })
    const next = { ...prev, version: 2, players: [prev.players[0], { ...prev.players[1], name: 'Bea' }], matches: [] }
    const diff = diffState(prev, next)
    expect(diff.sessionChanged).toBe(true)
    expect(diff.upsertPlayers.map((p) => p.name)).toEqual(['Bea'])
    expect(diff.upsertCourts).toEqual([])
    expect(diff.deleteMatchIds).toEqual(['m1'])
  })
})
