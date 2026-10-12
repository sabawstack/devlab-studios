import { describe, expect, it } from 'vitest'
import { pairsOnCourt, substituteCandidates } from './substituteCandidates'

const tournament = { pairs: [{ id: 'e1', playerIds: ['a', 'b'] }, { id: 'e2', playerIds: ['c', 'd'] }] }
const player = (id, name, status = 'ACTIVE') => ({ id, name, status })

describe('substituteCandidates', () => {
  it('lists players on a break first even when they sort last, then the rest by name, and skips pairs and leavers', () => {
    const players = [player('a', 'Ana'), player('b', 'Ben'), player('c', 'Cy'), player('d', 'Di'),
      player('z', 'Zed'), player('q', 'Quin', 'BREAK'), player('m', 'Max'), player('l', 'Lu', 'LEFT'), player('k', 'Kai')]
    expect(substituteCandidates(tournament, players).map((p) => p.name)).toEqual(['Quin', 'Kai', 'Max', 'Zed'])
  })
})

describe('pairsOnCourt', () => {
  it('marks a pair when any of its players is in a game in progress', () => {
    expect([...pairsOnCourt(tournament, new Set(['d', 'x']))]).toEqual(['e2'])
    expect(pairsOnCourt(tournament, new Set()).size).toBe(0)
  })
})
