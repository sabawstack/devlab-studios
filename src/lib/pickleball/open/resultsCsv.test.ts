import { describe, expect, it } from 'vitest'
import { resultsCsv } from './resultsCsv'
import { finished, player, sessionState } from './testing/fixtures'

describe('resultsCsv', () => {
  it('writes games then standings, quoting and neutralising formula-like names', () => {
    const state = sessionState({
      players: [player('a', { name: '=HYPERLINK("x")' }), player('b', { name: 'Ben, Jr.' }), player('c'), player('d')],
      matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 1)],
    })
    const csv = resultsCsv(state)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Game,Court,Started,Finished,Team A,Team B,Score A,Score B,Winner')
    expect(csv).toContain(`"'=HYPERLINK(""x"") & Ben, Jr."`)
    expect(csv).toContain('Rank,Player,Played,Won,Lost,Win %,+/- per game,Points per game')
    expect(csv).toContain(',11,7,A')
  })
})
