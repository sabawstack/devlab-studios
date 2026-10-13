import { describe, expect, it } from 'vitest'
import {
  durationText, finalResults, finishLine, ordinal, nextTvPodiumFit, podiumDisplayOrder, podiumStepColumns, previewMeta, recordWithPoints, shareText, showsFinalResults, summaryText,
  TV_PODIUM_FIT, tvRestColumns,
} from './results'
import { toViewerSnapshot } from './snapshot'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import { makeCtx, playOut, run, tournamentSession } from './testing/tournament'
import type { TournamentFormat } from './tournament/types'
import type { OpenMatch, OpenSessionState } from './types'

const URL = 'https://www.devlabstudios.com/pickleball/s/ABCDE23456'

function openPlay(names: string[], matches: OpenMatch[], overrides: Partial<OpenSessionState> = {}): OpenSessionState {
  return sessionState({
    name: 'Sunday Open Play',
    courts: [court('c1', 1)],
    players: names.map((id, i) => player(id, { position: i })),
    matches,
    ...overrides,
  })
}

const ended = (state: OpenSessionState, minute = 120): OpenSessionState => ({
  ...state, status: 'ENDED', settings: { ...state.settings, endedAt: at(minute) },
})

const names = (step: { entries: Array<{ name: string }> } | undefined) => step?.entries.map((e) => e.name)

// A beats everyone; B second; C third; D, E, F after; G never plays.
function clearOrder(): OpenSessionState {
  return openPlay(['A', 'B', 'C', 'D', 'E', 'F', 'G'], [
    finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 2, 0),
    finished('m2', ['A', 'C'], ['B', 'E'], 'A', 11, 4, 15),
    finished('m3', ['A', 'D'], ['E', 'F'], 'A', 11, 6, 30),
    finished('m4', ['B', 'C'], ['D', 'F'], 'A', 11, 8, 45),
  ])
}

describe('showsFinalResults', () => {
  it('is true once an open-play session has ended', () => {
    expect(showsFinalResults(toViewerSnapshot(clearOrder()))).toBe(false)
    expect(showsFinalResults(toViewerSnapshot(ended(clearOrder())))).toBe(true)
  })

  it('is true for a tournament that has ended or finished its games', () => {
    const ctx = makeCtx()
    let state = run(tournamentSession(8, 2, 'ROUND_ROBIN'), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
    expect(showsFinalResults(toViewerSnapshot(state))).toBe(false)
    state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    expect(showsFinalResults(toViewerSnapshot(state))).toBe(false)
    expect(showsFinalResults(toViewerSnapshot(playOut(state, ctx)))).toBe(true)
    expect(showsFinalResults(toViewerSnapshot({ ...state, status: 'ENDED' }))).toBe(true)
  })
})

describe('finalResults: open play', () => {
  it('puts the top three on the podium in place order and everyone else in the list', () => {
    const results = finalResults(toViewerSnapshot(ended(clearOrder())))
    expect(results.podium.map((s) => s.place)).toEqual([1, 2, 3])
    expect(results.podium.map((s) => s.medal)).toEqual(['🥇', '🥈', '🥉'])
    expect(names(results.podium[0])).toEqual(['A'])
    expect(results.podium[0].entries[0]).toMatchObject({ wins: 3, losses: 0, winRate: 1 })
    expect(names(results.podium[1])).toEqual(['B'])
    expect(names(results.podium[2])).toEqual(['C'])
    // F (0–2) won a bigger share of points than E (0–2), so F is 5th.
    expect(results.rest.map((e) => [e.place, e.name])).toEqual([[4, 'D'], [5, 'F'], [6, 'E']])
    expect(results.rest[0]).toHaveProperty('pointsPct')
  })

  it('lists players with no games as did not play, never ranked', () => {
    const results = finalResults(toViewerSnapshot(ended(clearOrder())))
    expect(results.didntPlay).toEqual(['G'])
    expect([...results.podium.flatMap((s) => s.entries), ...results.rest].map((e) => e.name)).not.toContain('G')
  })

  it('ties share a place (1, 2, 2, 4) and stand on the same step', () => {
    // A 2-0. D and X both 2-1 with the same points share and never on opposite sides: level 2nd.
    // B and C both 1-1, never opposed: level 4th. Y lost every game.
    const state = openPlay(['A', 'B', 'C', 'D', 'X', 'Y'], [
      finished('m1', ['A', 'B'], ['X', 'Y'], 'A', 11, 5, 0),
      finished('m2', ['A', 'C'], ['D', 'Y'], 'A', 11, 5, 15),
      finished('m3', ['D', 'X'], ['B', 'Y'], 'A', 11, 5, 30),
      finished('m4', ['D', 'X'], ['C', 'Y'], 'A', 11, 5, 45),
    ])
    const results = finalResults(toViewerSnapshot(ended(state)))
    expect(results.podium.map((s) => [s.place, names(s)])).toEqual([[1, ['A']], [2, ['D', 'X']]])
    expect(results.rest.map((e) => [e.place, e.name])).toEqual([[4, 'B'], [4, 'C'], [6, 'Y']])
  })

  it('two tied for 3rd both stand on the 3rd step: four people on the podium', () => {
    // All of A, B, C, D win every game. B has the best points share, then A; C and D are level (never opposed).
    const state = openPlay(['A', 'B', 'C', 'D', 'E', 'F', 'G'], [
      finished('m1', ['A', 'B'], ['E', 'F'], 'A', 11, 1, 0),
      finished('m2', ['A', 'C'], ['E', 'G'], 'A', 11, 5, 10),
      finished('m3', ['A', 'D'], ['F', 'G'], 'A', 11, 5, 20),
    ])
    const results = finalResults(toViewerSnapshot(ended(state)))
    expect(results.podium.map((s) => [s.place, names(s)])).toEqual([[1, ['B']], [2, ['A']], [3, ['C', 'D']]])
    expect(results.podium.flatMap((s) => s.entries)).toHaveLength(4)
    expect(results.rest.map((e) => [e.place, e.name])).toEqual([[5, 'G'], [6, 'E'], [6, 'F']])
  })

  it('a session that ended with no games has an empty podium and everyone under did not play', () => {
    const results = finalResults(toViewerSnapshot(ended(openPlay(['A', 'B'], []))))
    expect(results.podium).toEqual([])
    expect(results.rest).toEqual([])
    expect(results.didntPlay).toEqual(['A', 'B'])
    expect(results.games).toBe(0)
    expect(results.durationMs).toBeNull()
  })

  it('summary: players who played, saved games, first start to the end', () => {
    const results = finalResults(toViewerSnapshot(ended(clearOrder(), 120)))
    expect(results).toMatchObject({ players: 6, games: 4, durationMs: 120 * 60_000 })
    expect(summaryText(results)).toBe('6 players · 4 games · 2 h')
  })

  it('omits the duration when the end time is unknown (sessions ended before it was stored)', () => {
    const results = finalResults(toViewerSnapshot({ ...clearOrder(), status: 'ENDED' }))
    expect(results.durationMs).toBeNull()
    expect(summaryText(results)).toBe('6 players · 4 games')
  })
})

describe('podiumDisplayOrder', () => {
  it('stands 2nd, 1st, 3rd from left to right', () => {
    const results = finalResults(toViewerSnapshot(ended(clearOrder())))
    expect(podiumDisplayOrder(results.podium).map((s) => s.place)).toEqual([2, 1, 3])
  })

  it('keeps whatever steps exist in that order (a tie for 1st leaves no 2nd step)', () => {
    const steps = [1, 3].map((place) => ({ place, medal: '', entries: [] }))
    expect(podiumDisplayOrder(steps as never).map((s) => s.place)).toEqual([1, 3])
  })
})

describe('durationText and summaryText', () => {
  it('reads minutes, then hours and minutes', () => {
    expect(durationText(45 * 60_000)).toBe('45 min')
    expect(durationText(20_000)).toBe('1 min')
    expect(durationText(60 * 60_000)).toBe('1 h')
    expect(durationText(135 * 60_000)).toBe('2 h 15 min')
    expect(durationText(null)).toBeNull()
    expect(durationText(-5)).toBeNull()
  })

  it('uses the singular for one', () => {
    expect(summaryText({ players: 1, games: 1, durationMs: 30 * 60_000 })).toBe('1 player · 1 game · 30 min')
  })
})

describe('shareText', () => {
  it('names the session, the podium with W–L and the board link', () => {
    const results = finalResults(toViewerSnapshot(ended(clearOrder())))
    expect(shareText(results, URL)).toBe(
      `🏆 Sunday Open Play — final standings\n🥇 A (3–0)  🥈 B (2–1)  🥉 C (2–1)\nFull results: ${URL}`,
    )
  })

  it('joins a shared place and omits missing places', () => {
    const state = openPlay(['A', 'B', 'C', 'D'], [finished('m1', ['A', 'B'], ['C', 'D'], 'A', 11, 4, 0)])
    const results = finalResults(toViewerSnapshot(ended(state)))
    expect(shareText(results, URL)).toBe(`🏆 Sunday Open Play — final standings\n🥇 A (1–0), B (1–0)  🥉 C (0–1), D (0–1)\nFull results: ${URL}`)
  })

  it('has no podium line when nobody played', () => {
    const results = finalResults(toViewerSnapshot(ended(openPlay(['A'], []))))
    expect(shareText(results, URL)).toBe(`🏆 Sunday Open Play — final standings\nFull results: ${URL}`)
  })
})

describe('previewMeta (link preview tags)', () => {
  it('an ended session previews its final standings', () => {
    expect(previewMeta(toViewerSnapshot(ended(clearOrder())))).toEqual({
      title: 'Final standings · Sunday Open Play', description: '🥇 A · 🥈 B · 🥉 C',
    })
  })

  it('an active session previews the live board', () => {
    expect(previewMeta(toViewerSnapshot(clearOrder()))).toEqual({
      title: 'Sunday Open Play · live board', description: 'Live courts, queue and standings. No app needed.',
    })
  })

  it('an ended session with no games still has a description', () => {
    expect(previewMeta(toViewerSnapshot(ended(openPlay(['A'], []))))).toEqual({
      title: 'Final standings · Sunday Open Play', description: 'No games were saved in this session.',
    })
  })
})

describe('TV layout helpers', () => {
  it('tvRestColumns adds columns as the list grows, up to four', () => {
    expect([0, 6, 8, 9, 16, 17, 36, 37, 120].map(tvRestColumns)).toEqual([1, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('podiumStepColumns lays a shared place side by side (two by two for four, three across beyond)', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(podiumStepColumns)).toEqual([1, 2, 3, 2, 3, 3, 3])
  })

  it('nextTvPodiumFit shrinks only while overflowing, down to the floor, then lifts the cap', () => {
    const start = { scale: 1, capped: true }
    expect(nextTvPodiumFit(start, false)).toBe(start)
    expect(nextTvPodiumFit(start, true)).toEqual({ scale: 0.95, capped: true })
    expect(nextTvPodiumFit({ scale: 0.8, capped: true }, true)).toEqual({ scale: 0.75, capped: true })
    expect(nextTvPodiumFit({ scale: 0.75, capped: true }, true)).toEqual({ scale: 0.75, capped: false })
    const settled = { scale: 0.75, capped: false }
    expect(nextTvPodiumFit(settled, true)).toBe(settled)
    expect(TV_PODIUM_FIT.min).toBe(0.75)
  })
})

// ── Tournaments ─────────────────────────────────────────────────────────────

function playedTournament(format: TournamentFormat, players: number) {
  const ctx = makeCtx()
  let state = tournamentSession(players, 2, format)
  state = run(state, { type: 'GENERATE_DRAW', format, pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
  state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
  return playOut(state, ctx)
}

/** The pair name of an entrant, built from the state the way the board does. */
function pairNameOf(state: OpenSessionState, entrantId: string | null): string {
  const entrant = state.tournament!.entrants.find((e) => e.id === entrantId)!
  return entrant.playerIds.map((id) => state.players.find((p) => p.id === id)!.name).join(' & ')
}

function finalOf(state: OpenSessionState) {
  const main = state.tournament!.fixtures.filter((f) => f.bracket === 'MAIN')
  const last = Math.max(...main.map((f) => f.roundNumber))
  return main.find((f) => f.roundNumber === last)!
}

const loserOf = (f: { entrantAId: string | null; entrantBId: string | null; winnerEntrantId: string | null }) =>
  (f.winnerEntrantId === f.entrantAId ? f.entrantBId : f.entrantAId)

describe('finalResults: tournaments', () => {
  it('round robin: the top three pairs by standings, shown as "Ana & Ben"', () => {
    const state = playedTournament('ROUND_ROBIN', 8)
    const viewer = toViewerSnapshot(state)
    const results = finalResults(viewer)
    const table = viewer.tournament!.standings
    expect(results.podium.map((s) => s.place)).toEqual([1, 2, 3])
    expect(results.podium.map((s) => names(s))).toEqual([[table[0].name], [table[1].name], [table[2].name]])
    expect(results.podium[0].entries[0].name).toMatch(/ & /)
    expect(results.rest.map((e) => [e.place, e.name])).toEqual([[4, table[3].name]])
    expect(results.players).toBe(8)
    expect(results.games).toBe(6)
    expect(results.champion).toBe(table[0].name)
  })

  it('single elimination: final winner 1st, final loser 2nd, the two losing semi-finalists share 3rd', () => {
    const state = playedTournament('SINGLE_ELIMINATION', 8)
    const final = finalOf(state)
    const semis = state.tournament!.fixtures.filter((f) => f.bracket === 'MAIN' && f.roundNumber === final.roundNumber - 1)
    const results = finalResults(toViewerSnapshot(state))
    expect(names(results.podium[0])).toEqual([pairNameOf(state, final.winnerEntrantId)])
    expect(names(results.podium[1])).toEqual([pairNameOf(state, loserOf(final))])
    expect(names(results.podium[2])?.sort()).toEqual(semis.map((f) => pairNameOf(state, loserOf(f))).sort())
    expect(results.podium[2].place).toBe(3)
    expect(results.rest).toEqual([])
  })

  it('single elimination with more pairs: the rest follow from 5th in standings order', () => {
    const state = playedTournament('SINGLE_ELIMINATION', 16)
    const results = finalResults(toViewerSnapshot(state))
    expect(results.podium.flatMap((s) => s.entries)).toHaveLength(4)
    expect(results.rest.map((e) => e.place)).toEqual([5, 6, 7, 8])
  })

  it('double elimination: grand final winner and loser, then one 3rd (the losers final loser)', () => {
    const state = playedTournament('DOUBLE_ELIMINATION', 8)
    const final = finalOf(state)
    const losers = state.tournament!.fixtures.filter((f) => f.bracket === 'LOSERS')
    const losersFinal = losers.find((f) => f.roundNumber === Math.max(...losers.map((x) => x.roundNumber)))!
    const results = finalResults(toViewerSnapshot(state))
    expect(names(results.podium[0])).toEqual([pairNameOf(state, final.winnerEntrantId)])
    expect(names(results.podium[1])).toEqual([pairNameOf(state, loserOf(final))])
    expect(names(results.podium[2])).toEqual([pairNameOf(state, loserOf(losersFinal))])
    expect(results.rest.map((e) => e.place)).toEqual([4])
  })

  it('pools to bracket: the final decides 1st and 2nd, standings the 3rd', () => {
    const state = playedTournament('POOL_TO_BRACKET', 16)
    const final = finalOf(state)
    const viewer = toViewerSnapshot(state)
    const results = finalResults(viewer)
    const top = new Set([final.winnerEntrantId, loserOf(final)])
    const third = viewer.tournament!.standings.find((row) => !top.has(row.entrantId))!
    expect(names(results.podium[0])).toEqual([pairNameOf(state, final.winnerEntrantId)])
    expect(names(results.podium[1])).toEqual([pairNameOf(state, loserOf(final))])
    expect(names(results.podium[2])).toEqual([third.name])
    expect(results.rest.map((e) => e.place)).toEqual([4, 5, 6, 7, 8])
  })

  it('share text and preview use the pairs', () => {
    const state = { ...playedTournament('SINGLE_ELIMINATION', 8), name: 'Saturday Cup' }
    const results = finalResults(toViewerSnapshot(state))
    const text = shareText(results, URL)
    expect(text.split('\n')[0]).toBe('🏆 Saturday Cup — final standings')
    expect(text.split('\n')[1]).toMatch(/^🥇 .+ & .+ \(\d–\d\) {2}🥈 .+ & .+ \(\d–\d\) {2}🥉 .+ & .+ \(\d–\d\), .+ & .+ \(\d–\d\)$/)
    expect(previewMeta(toViewerSnapshot(state)).title).toBe('Final standings · Saturday Cup')
  })

  it('ended before the final: falls back to the standings order', () => {
    const ctx = makeCtx()
    let state = tournamentSession(8, 2, 'SINGLE_ELIMINATION')
    state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
    state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const first = state.matches.find((m) => m.status === 'PROPOSED')!
    state = run(state, { type: 'START_MATCH', matchId: first.id }, ctx(3))
    state = run(state, { type: 'RECORD_RESULT', matchId: first.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctx(4))
    state = run(state, { type: 'END_SESSION' }, ctx(5))
    const viewer = toViewerSnapshot(state)
    const results = finalResults(viewer)
    const played = viewer.tournament!.standings.filter((row) => row.played > 0)
    expect(results.podium.map((s) => names(s))).toEqual([[played[0].name], [played[1].name]])
    expect(results.champion).toBeNull()
    // Pairs with no game saved did not play.
    expect(results.didntPlay).toHaveLength(2)
    expect(results.didntPlay[0]).toMatch(/ & /)
    expect(results.games).toBe(1)
    expect(results.durationMs).toBe(2 * 60_000)
  })

  it('a finished tournament that is still active measures to its last game', () => {
    const state = playedTournament('ROUND_ROBIN', 8)
    const viewer = toViewerSnapshot(state)
    const results = finalResults(viewer)
    expect(results.durationMs).toBe(Date.parse(viewer.games.lastFinishedAt!) - Date.parse(viewer.games.firstStartedAt!))
  })
})

describe('ordinal', () => {
  it('reads 1st, 2nd, 3rd, 4th, 11th–13th, 21st, 102nd', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 102, 111].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '102nd', '111th'])
  })
})

describe('finishLine (the personal banner on an ended board)', () => {
  it('open play: your place of how many were ranked', () => {
    const viewer = toViewerSnapshot(ended(clearOrder()))
    expect(finishLine(viewer, 'D')).toBe('Hi D! You finished 4th of 6 🎉')
    expect(finishLine(viewer, 'A')).toBe('Hi A! You finished 1st of 6 🎉')
  })

  it('open play: a shared place says tied, and uses the first name only', () => {
    const state = openPlay(['Ana Lopez', 'Ben', 'Cy', 'Di'], [finished('m1', ['Ana Lopez', 'Ben'], ['Cy', 'Di'], 'A', 11, 4, 0)])
    const named = { ...state, players: state.players.map((p) => ({ ...p, name: p.id })) }
    const viewer = toViewerSnapshot(ended(named))
    expect(finishLine(viewer, 'Ana Lopez')).toBe('Hi Ana! You tied for 1st of 4 🎉')
    expect(finishLine(viewer, 'Cy')).toBe('Hi Cy! You tied for 3rd of 4 🎉')
  })

  it('open play: a player with no games is thanked for coming; nobody picked is null', () => {
    const viewer = toViewerSnapshot(ended(clearOrder()))
    expect(finishLine(viewer, 'G')).toBe('Hi G! Thanks for coming 👋')
    expect(finishLine(viewer, '')).toBeNull()
    expect(finishLine(viewer, 'nobody')).toBeNull()
  })

  it('tournaments: the champions are told they won; others where their pair finished', () => {
    const state = playedTournament('SINGLE_ELIMINATION', 8)
    const viewer = toViewerSnapshot(state)
    const results = finalResults(viewer)
    const pairOf = (entrantId: string) => viewer.tournament!.pairs.find((p) => p.id === entrantId)!
    const winner = pairOf(results.podium[0].entries[0].id).playerIds[0]
    const runnerUp = pairOf(results.podium[1].entries[0].id).playerIds[1]
    const third = pairOf(results.podium[2].entries[0].id).playerIds[0]
    const first = (id: string) => viewer.roster.find((p) => p.id === id)!.name.split(' ')[0]
    expect(finishLine(viewer, winner)).toBe(`Hi ${first(winner)}! Your pair won the tournament! 🏆`)
    expect(finishLine(viewer, runnerUp)).toBe(`Hi ${first(runnerUp)}! Your pair finished 2nd`)
    expect(finishLine(viewer, third)).toBe(`Hi ${first(third)}! Your pair tied for 3rd`)
  })

  it('tournaments ended early: 1st place is a finish, not a win', () => {
    const ctx = makeCtx()
    let state = tournamentSession(8, 2, 'SINGLE_ELIMINATION')
    state = run(state, { type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, ctx(1))
    state = run(state, { type: 'START_TOURNAMENT' }, ctx(2))
    const game = state.matches.find((m) => m.status === 'PROPOSED')!
    state = run(state, { type: 'RECORD_RESULT', matchId: game.id, winner: 'A', scoreA: 11, scoreB: 3 }, ctx(3))
    state = run(state, { type: 'END_SESSION' }, ctx(4))
    const viewer = toViewerSnapshot(state)
    const winnerId = state.tournament!.entrants.find((e) => e.id === finalResults(viewer).podium[0].entries[0].id)!.playerIds[0]
    expect(finishLine(viewer, winnerId)).toMatch(/Your pair finished 1st$/)
    const benched = state.tournament!.entrants.find((e) => finalResults(viewer).didntPlay.includes(viewer.tournament!.pairs.find((p) => p.id === e.id)!.name))!.playerIds[0]
    expect(finishLine(viewer, benched)).toMatch(/Thanks for coming 👋$/)
  })
})

describe('recordWithPoints', () => {
  it('shows the record and the rounded share of points won, or just the record when unscored', () => {
    expect(recordWithPoints({ wins: 4, losses: 2, pointsPct: 0.534 })).toBe('4–2 · 53% pts')
    expect(recordWithPoints({ wins: 4, losses: 2, pointsPct: null })).toBe('4–2')
  })
})
