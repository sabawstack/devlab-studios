// src/pickleball-open/tournament/drawTaps.js
// Tap-to-select for the draw editor (spec §11: "dragging also works by
// tap-to-select, so touch and mouse both work"). Tap one thing, then another
// of the same kind, and the pair of taps becomes one command.
//
// An item is { kind: 'player', id } | { kind: 'pair', id }
//          | { kind: 'slot', fixtureId, side, entrantId }

function same(a, b) {
  if (a.kind !== b.kind) return false
  return a.kind === 'slot' ? a.fixtureId === b.fixtureId && a.side === b.side : a.id === b.id
}

/** The next selection after a tap, and the two items to act on when a second tap completes a choice. */
export function tap(selected, item) {
  if (!selected || selected.kind !== item.kind) return { selected: item, chosen: null }
  if (same(selected, item)) return { selected: null, chosen: null }
  return { selected: null, chosen: [selected, item] }
}

export function isSelected(selected, item) {
  return Boolean(selected) && same(selected, item)
}

/** The command for two chosen items: a draft edit before Start, an opponent swap after it. */
export function commandFor([first, second], phase) {
  if (first.kind === 'player') return { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PLAYERS', playerIds: [first.id, second.id] } }
  if (first.kind === 'pair') return { type: 'EDIT_DRAW', edit: { kind: 'SWAP_PAIRS', entrantIds: [first.id, second.id] } }
  if (phase === 'DRAFT') return { type: 'EDIT_DRAW', edit: { kind: 'SET_OPPONENT', fixtureId: first.fixtureId, side: first.side, entrantId: second.entrantId } }
  return { type: 'SWAP_OPPONENTS', fixtureId: first.fixtureId, side: first.side, otherFixtureId: second.fixtureId, otherSide: second.side }
}
