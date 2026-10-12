import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { diffState } from '../../../../lib/pickleball/open/diff'
import type { TournamentState } from '../../../../lib/pickleball/open/tournament/types'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
]
const NOW = '2026-10-11T10:00:00.000Z'

function cup(code = 'CUPCU23456', kind: OpenSessionState['kind'] = 'TOURNAMENT'): OpenSessionState {
  let n = 0
  return buildInitialState({
    name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind, tournamentFormat: 'SINGLE_ELIMINATION',
    players: ['Ana', 'Ben', 'Cy', 'Di'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

/** A two-pair draft built by hand, in the engine's key order. */
function drafted(state: OpenSessionState, suffix = '1'): OpenSessionState {
  const [a, b, c, d] = state.players.map((p) => p.id)
  const tournament: TournamentState = {
    ...(state.tournament as TournamentState),
    phase: 'DRAFT',
    entrants: [
      { id: `e1-${suffix}`, playerIds: [a, b], seed: 1, poolLabel: null },
      { id: `e2-${suffix}`, playerIds: [c, d], seed: 2, poolLabel: null },
    ],
    fixtures: [{
      id: `f1-${suffix}`, bracket: 'MAIN', poolLabel: null, roundNumber: 1, position: 0, entrantAId: `e1-${suffix}`, entrantBId: `e2-${suffix}`,
      sourceA: null, sourceB: null, winnerEntrantId: null, status: 'READY',
    }],
  }
  return { ...state, tournament, version: state.version + 1 }
}

const count = (raw: ReturnType<typeof createSqliteD1>['raw'], table: string) => (raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('tournament rows in D1 (0018)', () => {
  it('a tournament session round-trips, and open play still loads with no tournament', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = cup()
    expect(state.tournament).toMatchObject({ format: 'SINGLE_ELIMINATION', phase: 'SETUP' })
    await createOpenSession(d1, state, 'hash')
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(state)
    await createOpenSession(d1, cup('OPENO23456', 'OPEN_PLAY'), 'hash')
    expect((await loadOpenSession(d1, 'OPENO23456', NOW))?.state.tournament).toBeNull()
  })

  it('a draft persists as a diff, loads with the same key order, and a new draft replaces it completely', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    const first = drafted(state)
    await persistDiff(d1, state, first, null)
    const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
    expect(loaded?.state).toEqual(first)
    const diff = diffState(loaded!.state, first)
    expect([diff.tournamentChanged, diff.upsertEntrants, diff.upsertFixtures, diff.deleteFixtureIds]).toEqual([false, [], [], []])

    const second = drafted(first, '2')
    await persistDiff(d1, first, second, null)
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(second)
    expect([count(raw, 'open_tournament_entrants'), count(raw, 'open_tournament_fixtures')]).toEqual([2, 1])
  })

  it('a match keeps the fixture it plays', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = drafted(cup())
    await createOpenSession(d1, state, 'hash')
    const match: OpenMatch = {
      id: 'm1', courtId: state.courts[0].id, seq: 1, status: 'PROPOSED', teamA: state.tournament!.entrants[0].playerIds,
      teamB: state.tournament!.entrants[1].playerIds, scoreA: null, scoreB: null, winner: null, proposedAt: NOW,
      startedAt: null, finishedAt: null, recordedBy: null, fixtureId: 'f1-1',
    }
    const next = { ...state, matches: [match] }
    await persistDiff(d1, state, next, null)
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.matches).toEqual([match])
  })

  it('the purge removes every tournament row with its session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    await createOpenSession(d1, drafted(cup()), 'hash')
    expect(await purgeExpiredOpenSessions(d1, '2026-10-30T00:00:00.000Z')).toEqual(['CUPCU23456'])
    for (const table of ['open_tournaments', 'open_tournament_entrants', 'open_tournament_fixtures']) expect(count(raw, table), table).toBe(0)
  })

  it('rejects an unknown format, bracket or fixture status; reads unknown pairing text as the default', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    await createOpenSession(d1, drafted(cup()), 'hash')
    expect(() => raw.exec("UPDATE open_tournaments SET format = 'LADDER'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET bracket = 'CONSOLATION'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET status = 'LIVE'")).toThrow(/CHECK/)
    raw.exec("UPDATE open_tournaments SET pairing = 'SOMETHING_NEW', phase = 'LATER'")
    const loaded = (await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.tournament
    expect([loaded?.pairing, loaded?.phase]).toEqual(['RANDOM', 'SETUP'])
  })
})
