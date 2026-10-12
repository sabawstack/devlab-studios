// src/lib/pickleball/open/tournament/drawEdits.ts
// Draft edits are unrestricted (spec §6.4); running edits are the two the
// spec allows after Start (§6.5). Every edit is applied to a copy and then
// re-checked by drawViolation, so an edit that breaks the draw is refused
// with the reason and nothing changes.
import type { OpenMatch, OpenPlayer } from '../types'
import { poolFixtures } from './draw'
import { drawViolation } from './drawRules'
import { pairName } from './labels'
import { sortEntrants, sortFixtures } from './order'
import type { DraftEdit, EditResult, RunningEdit, TournamentEntrant, TournamentFixture, TournamentState } from './types'

const refuse = (reason: string): EditResult => ({ ok: false, reason })

function checked(before: TournamentState, after: TournamentState, players: readonly OpenPlayer[]): EditResult {
  const reason = drawViolation(before, after, players)
  return reason ? refuse(reason) : { ok: true, tournament: after }
}

/** READY once both sides are known, PENDING while one waits. Started, finished and bye games keep their status. */
function restatus(f: TournamentFixture): TournamentFixture {
  if (f.status === 'IN_PROGRESS' || f.status === 'FINISHED' || f.status === 'BYE') return f
  return { ...f, status: f.entrantAId && f.entrantBId ? 'READY' : 'PENDING' }
}

function withPlayers(t: TournamentState, entrantId: string, playerIds: readonly [string, string]): TournamentState {
  return { ...t, entrants: t.entrants.map((e) => (e.id === entrantId ? { ...e, playerIds } : e)) }
}

function swapPlayers(t: TournamentState, [p, q]: readonly [string, string], players: readonly OpenPlayer[]): EditResult {
  const owner = (id: string) => t.entrants.find((e) => e.playerIds.includes(id))
  const ep = owner(p)
  const eq = owner(q)
  if (p === q) return refuse('Pick two different players.')
  if (!ep && !eq) return refuse('Neither player is in a pair.')
  if (ep && ep === eq) return refuse('They are already partners.')
  // Swapping with someone in no pair brings them in: they must be here to play.
  const incoming = ep && eq ? null : players.find((x) => x.id === (ep ? q : p))
  if (incoming && incoming.status !== 'ACTIVE') return refuse(`${incoming.name} is not checked in. Bring them back first.`)
  const replace = (e: TournamentEntrant, out: string, into: string) =>
    [e.playerIds[0] === out ? into : e.playerIds[0], e.playerIds[1] === out ? into : e.playerIds[1]] as const
  let next = t
  if (ep) next = withPlayers(next, ep.id, replace(ep, p, q))
  if (eq) next = withPlayers(next, eq.id, replace(eq, q, p))
  return checked(t, next, players)
}

function relabel(id: string | null, a: string, b: string): string | null {
  return id === a ? b : id === b ? a : id
}

function swapPairs(t: TournamentState, [a, b]: readonly [string, string], players: readonly OpenPlayer[]): EditResult {
  const ea = t.entrants.find((e) => e.id === a)
  const eb = t.entrants.find((e) => e.id === b)
  if (!ea || !eb) return refuse('Pair not found.')
  if (a === b) return refuse('Pick two different pairs.')
  // The two pairs trade places: seed, pool and every slot they hold.
  const next: TournamentState = {
    ...t,
    entrants: sortEntrants(t.entrants.map((e) => (e.id === a ? { ...e, seed: eb.seed, poolLabel: eb.poolLabel } : e.id === b ? { ...e, seed: ea.seed, poolLabel: ea.poolLabel } : e))),
    fixtures: t.fixtures.map((f) => ({ ...f, entrantAId: relabel(f.entrantAId, a, b), entrantBId: relabel(f.entrantBId, a, b) })),
  }
  return checked(t, next, players)
}

function movePair(t: TournamentState, entrantId: string, poolLabel: string, players: readonly OpenPlayer[], newId: () => string): EditResult {
  if (t.format !== 'POOL_TO_BRACKET') return refuse('Only a draw with pools has pools to move between.')
  const entrant = t.entrants.find((e) => e.id === entrantId)
  if (!entrant) return refuse('Pair not found.')
  const labels = new Set(t.entrants.map((e) => e.poolLabel))
  if (!labels.has(poolLabel)) return refuse(`There is no Pool ${poolLabel} in this draw.`)
  if (entrant.poolLabel === poolLabel) return refuse(`${pairName(entrant, players)} is already in Pool ${poolLabel}.`)
  const from = entrant.poolLabel as string
  const entrants = t.entrants.map((e) => (e.id === entrantId ? { ...e, poolLabel } : e))
  const rebuilt = [from, poolLabel].flatMap((label) => poolFixtures(label, entrants.filter((e) => e.poolLabel === label), newId))
  const kept = t.fixtures.filter((f) => !(f.bracket === 'POOL' && (f.poolLabel === from || f.poolLabel === poolLabel)))
  return checked(t, { ...t, entrants, fixtures: sortFixtures([...kept, ...rebuilt]) }, players)
}

function sideOf(f: TournamentFixture, side: 'A' | 'B'): string | null {
  return side === 'A' ? f.entrantAId : f.entrantBId
}
function sourceOf(f: TournamentFixture, side: 'A' | 'B'): string | null {
  return side === 'A' ? f.sourceA : f.sourceB
}
function setSide(f: TournamentFixture, side: 'A' | 'B', entrantId: string | null): TournamentFixture {
  return side === 'A' ? { ...f, entrantAId: entrantId } : { ...f, entrantBId: entrantId }
}

/**
 * Put `entrantId` on one side of a fixture. Where that pair already has a
 * slot in the same round of the same group (a round robin round, a pool
 * round) or a placed slot in the same bracket, the displaced pair takes it,
 * so it is a swap. Otherwise it is a plain replacement, which drawViolation
 * then judges (it usually leaves someone playing twice, or never).
 */
function setOpponent(t: TournamentState, edit: Extract<DraftEdit, { kind: 'SET_OPPONENT' }>, players: readonly OpenPlayer[]): EditResult {
  const fixture = t.fixtures.find((f) => f.id === edit.fixtureId)
  if (!fixture) return refuse('Game not found.')
  if (!t.entrants.some((e) => e.id === edit.entrantId)) return refuse('Pair not found.')
  if (sourceOf(fixture, edit.side) !== null) return refuse('That slot is filled by an earlier result, not by the draw.')
  const displaced = sideOf(fixture, edit.side)
  if (displaced === edit.entrantId) return { ok: true, tournament: t }
  if (sideOf(fixture, edit.side === 'A' ? 'B' : 'A') === edit.entrantId) return refuse('A pair cannot play itself.')
  const roundRobin = fixture.bracket === 'POOL' || t.format === 'ROUND_ROBIN'
  const other = t.fixtures.flatMap((f) => (['A', 'B'] as const).map((side) => ({ f, side })))
    .find(({ f, side }) => f.id !== fixture.id && sideOf(f, side) === edit.entrantId && sourceOf(f, side) === null
      && f.bracket === fixture.bracket && f.poolLabel === fixture.poolLabel && (!roundRobin || f.roundNumber === fixture.roundNumber))
  const fixtures = t.fixtures.map((f) => {
    if (f.id === fixture.id) return restatus(setSide(f, edit.side, edit.entrantId))
    if (other && f.id === other.f.id) return restatus(setSide(f, other.side, displaced))
    return f
  })
  return checked(t, { ...t, fixtures }, players)
}

export function applyDraftEdit(t: TournamentState, edit: DraftEdit, players: readonly OpenPlayer[], newId: () => string): EditResult {
  if (t.phase === 'SETUP') return refuse('Generate the draw first.')
  if (t.phase !== 'DRAFT') return refuse('The draw is locked once the tournament starts. You can still substitute a player or swap opponents in a game that has not started.')
  switch (edit.kind) {
    case 'SWAP_PLAYERS':
      return swapPlayers(t, edit.playerIds, players)
    case 'SWAP_PAIRS':
      return swapPairs(t, edit.entrantIds, players)
    case 'MOVE_PAIR':
      return movePair(t, edit.entrantId, edit.poolLabel, players, newId)
    case 'SET_OPPONENT':
      return setOpponent(t, edit, players)
  }
}

function onCourt(t: TournamentState, entrantId: string, matches: readonly OpenMatch[]): boolean {
  const fixtures = new Set(t.fixtures.filter((f) => f.entrantAId === entrantId || f.entrantBId === entrantId).map((f) => f.id))
  return matches.some((m) => m.status === 'IN_PROGRESS' && m.fixtureId !== null && fixtures.has(m.fixtureId))
}

function substitute(t: TournamentState, edit: Extract<RunningEdit, { kind: 'SUBSTITUTE' }>, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  const entrant = t.entrants.find((e) => e.id === edit.entrantId)
  if (!entrant) return refuse('Pair not found.')
  if (!entrant.playerIds.includes(edit.outPlayerId)) return refuse('That player is not in this pair.')
  const incoming = players.find((p) => p.id === edit.inPlayerId)
  if (!incoming) return refuse('Player not found.')
  if (incoming.id === edit.outPlayerId) return refuse('Pick a different player.')
  if (incoming.status === 'LEFT') return refuse(`${incoming.name} has left the session.`)
  const taken = t.entrants.find((e) => e.playerIds.includes(incoming.id))
  if (taken) return refuse(`${incoming.name} already plays in ${pairName(taken, players)}.`)
  if (onCourt(t, entrant.id, matches)) return refuse(`${pairName(entrant, players)} are on court. Substitute after their game.`)
  const playerIds = [
    entrant.playerIds[0] === edit.outPlayerId ? incoming.id : entrant.playerIds[0],
    entrant.playerIds[1] === edit.outPlayerId ? incoming.id : entrant.playerIds[1],
  ] as const
  return checked(t, withPlayers(t, entrant.id, playerIds), players)
}

function swapOpponents(t: TournamentState, edit: Extract<RunningEdit, { kind: 'SWAP_OPPONENTS' }>, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  const f = t.fixtures.find((x) => x.id === edit.fixtureId)
  const g = t.fixtures.find((x) => x.id === edit.otherFixtureId)
  if (!f || !g) return refuse('Game not found.')
  if (f.id === g.id) return refuse('Pick two different games.')
  if (f.bracket !== g.bracket || f.poolLabel !== g.poolLabel || f.roundNumber !== g.roundNumber) {
    return refuse('Opponents can only be swapped between games in the same round of the same pool or bracket.')
  }
  const started = (x: TournamentFixture) => x.status === 'IN_PROGRESS' || x.status === 'FINISHED'
    || matches.some((m) => m.fixtureId === x.id && m.status === 'IN_PROGRESS')
  if (started(f) || started(g)) return refuse('One of those games has already started.')
  const a = sideOf(f, edit.side)
  const b = sideOf(g, edit.otherSide)
  if (!a || !b) return refuse('That slot is still waiting for an earlier result.')
  const fixtures = t.fixtures.map((x) => {
    if (x.id === f.id) return restatus(setSide(x, edit.side, b))
    if (x.id === g.id) return restatus(setSide(x, edit.otherSide, a))
    return x
  })
  return checked(t, { ...t, fixtures }, players)
}

export function applyRunningEdit(t: TournamentState, edit: RunningEdit, players: readonly OpenPlayer[], matches: readonly OpenMatch[]): EditResult {
  if (t.phase === 'FINISHED') return refuse('The tournament is over.')
  if (t.phase !== 'RUNNING') return refuse('Start the tournament first. Until then, edit the draft draw instead.')
  return edit.kind === 'SUBSTITUTE' ? substitute(t, edit, players, matches) : swapOpponents(t, edit, players, matches)
}
