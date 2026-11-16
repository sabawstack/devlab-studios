// Pure selection of "which fixture should an operator start next". No DB, no
// DO, no clock, no randomness -- see task-3-brief.md. Deterministic so two
// operators looking at the same fixture list see the same proposal.

export interface FixtureRow {
  id: string
  roundNumber: number
  position: number
  entrantAId: string | null
  entrantBId: string | null
  status: 'PENDING' | 'READY' | 'IN_PROGRESS' | 'FINISHED' | 'BYE'
}

export function nextPlayableFixture(fixtures: FixtureRow[], entrantsInPlay: string[]): FixtureRow | null {
  const busy = new Set(entrantsInPlay)

  const playable = fixtures.filter((fixture) => {
    if (fixture.status !== 'READY') return false
    if (fixture.entrantAId && busy.has(fixture.entrantAId)) return false
    if (fixture.entrantBId && busy.has(fixture.entrantBId)) return false
    return true
  })

  if (playable.length === 0) return null

  const sorted = [...playable].sort(playOrder)

  return sorted[0]
}

/** The order free courts take ready games in: earliest round first, then draw position. Shared with "Coming up". */
export function playOrder(a: Pick<FixtureRow, 'roundNumber' | 'position'>, b: Pick<FixtureRow, 'roundNumber' | 'position'>): number {
  if (a.roundNumber !== b.roundNumber) return a.roundNumber - b.roundNumber
  return a.position - b.position
}
