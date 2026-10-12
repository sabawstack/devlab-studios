import { describe, expect, it } from 'vitest'
import { commandFor, isSelected, tap } from './drawTaps'

const ana = { kind: 'player', id: 'ana' }
const ben = { kind: 'player', id: 'ben' }
const pairOne = { kind: 'pair', id: 'e1' }
const slotA = { kind: 'slot', fixtureId: 'f1', side: 'B', entrantId: 'e2' }
const slotB = { kind: 'slot', fixtureId: 'f2', side: 'A', entrantId: 'e3' }

describe('tap to select', () => {
  it('selects, then a second tap of the same kind chooses both', () => {
    const first = tap(null, ana)
    expect(first).toEqual({ selected: ana, chosen: null })
    expect(isSelected(first.selected, ana)).toBe(true)
    expect(tap(first.selected, ben)).toEqual({ selected: null, chosen: [ana, ben] })
  })

  it('tapping the selection again clears it; a different kind starts over', () => {
    expect(tap(ana, { kind: 'player', id: 'ana' })).toEqual({ selected: null, chosen: null })
    expect(tap(ana, pairOne)).toEqual({ selected: pairOne, chosen: null })
    expect(tap(slotA, { ...slotA, entrantId: 'other' })).toEqual({ selected: null, chosen: null })
  })
})

describe('commandFor', () => {
  it('turns two taps into the draft edit or the running swap', () => {
    expect(commandFor([ana, ben], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: ['ana', 'ben'] } })
    expect(commandFor([pairOne, { kind: 'pair', id: 'e2' }], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SWAP_PAIRS', entrantIds: ['e1', 'e2'] } })
    expect(commandFor([slotA, slotB], 'DRAFT')).toEqual({ type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: 'f1', side: 'B', entrantId: 'e3' } })
    expect(commandFor([slotA, slotB], 'RUNNING')).toEqual({ type: 'SWAP_OPPONENTS', fixtureId: 'f1', side: 'B', otherFixtureId: 'f2', otherSide: 'A' })
  })
})
