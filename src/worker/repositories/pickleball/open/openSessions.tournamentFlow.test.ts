import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, loadOpenSession, persistDiff, purgeExpiredOpenSessions } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { diffState } from '../../../../lib/pickleball/open/diff'
import { applyCommand, finalizeCommand } from '../../../../lib/pickleball/open/reducer'
import type { OpenCommand } from '../../../../lib/schemas/pickleball/open/commands'
import { DEFAULT_SETTINGS, type OpenSessionState } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = [
  'migrations/pickleball/0016_open_sessions.sql',
  'migrations/pickleball/0017_open_captains.sql',
  'migrations/pickleball/0018_open_tournaments.sql',
]
const NOW = '2026-10-11T10:00:00.000Z'
const NAMES = ['Ana', 'Ben', 'Cy', 'Di', 'Eva', 'Fin', 'Gus', 'Hal']

let n = 0
const ctx = (minute: number) => ({ now: new Date(Date.parse(NOW) + minute * 60_000).toISOString(), newId: () => `id-${(n += 1)}`, random: () => 0 })

function cup(code = 'CUPCU23456'): OpenSessionState {
  return buildInitialState({
    name: 'Cup', hostDisplayName: 'Mo', location: null, courtCount: 2, settings: DEFAULT_SETTINGS, kind: 'TOURNAMENT', tournamentFormat: 'POOL_TO_BRACKET',
    players: NAMES.map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

function step(state: OpenSessionState, command: OpenCommand, minute: number): OpenSessionState {
  const c = ctx(minute)
  const result = applyCommand(state, command, c)
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, c)
}

describe('tournament rows in D1 (0018)', () => {
  it('a tournament session round-trips in setup, and open play still loads with no tournament', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state).toEqual(state)
    const open = { ...cup('OPENO23456'), kind: 'OPEN_PLAY' as const, tournament: null }
    await createOpenSession(d1, open, 'hash')
    expect((await loadOpenSession(d1, 'OPENO23456', NOW))?.state.tournament).toBeNull()
  })

  it('a draft, a regenerated draft and a started tournament each persist as a diff, and reload equals memory', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    let state = cup()
    await createOpenSession(d1, state, 'hash')
    for (const [command, minute] of [
      [{ type: 'GENERATE_DRAW', format: 'POOL_TO_BRACKET', pairing: 'MANUAL', seeding: 'MANUAL' }, 1],
      [{ type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'BALANCED', seeding: 'BY_SKILL' }, 2],
      [{ type: 'START_TOURNAMENT' }, 3],
    ] as const) {
      const next = step(state, command, minute)
      await persistDiff(d1, state, next, null)
      const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
      expect(loaded?.state).toEqual(next)
      // Loaded rows build with the engine's key order: nothing reads as changed.
      const diff = diffState(loaded!.state, next)
      expect([diff.tournamentChanged, diff.upsertEntrants, diff.upsertFixtures, diff.upsertMatches]).toEqual([false, [], [], []])
      state = next
    }
    // The regenerated draft left nothing behind from the first one.
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_tournament_fixtures').get() as { n: number }).n).toBe(3)
    expect(state.matches.filter((m) => m.fixtureId !== null)).toHaveLength(2)
  })

  it('a saved result moves the winner on, in D1 too', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    let state = cup()
    await createOpenSession(d1, state, 'hash')
    for (const [command, minute] of [
      [{ type: 'GENERATE_DRAW', format: 'SINGLE_ELIMINATION', pairing: 'MANUAL', seeding: 'MANUAL' }, 1],
      [{ type: 'START_TOURNAMENT' }, 2],
    ] as const) {
      const next = step(state, command, minute)
      await persistDiff(d1, state, next, null)
      state = next
    }
    const game = state.matches.find((m) => m.status === 'PROPOSED')!
    const next = step(state, { type: 'RECORD_RESULT', matchId: game.id, winner: 'A', scoreA: 11, scoreB: 7 }, 5)
    await persistDiff(d1, state, next, null)
    const loaded = await loadOpenSession(d1, 'CUPCU23456', NOW)
    expect(loaded?.state).toEqual(next)
    expect(loaded?.state.tournament?.fixtures.find((f) => f.id === game.fixtureId)?.status).toBe('FINISHED')
  })

  it('the purge removes every tournament row with its session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = cup()
    await createOpenSession(d1, state, 'hash')
    const next = step(state, { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, 1)
    await persistDiff(d1, state, next, null)
    expect(await purgeExpiredOpenSessions(d1, '2026-10-30T00:00:00.000Z')).toEqual(['CUPCU23456'])
    for (const table of ['open_tournaments', 'open_tournament_entrants', 'open_tournament_fixtures']) {
      expect((raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0)
    }
  })

  it('rejects an unknown format, bracket or fixture status', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = step(cup(), { type: 'GENERATE_DRAW', format: 'ROUND_ROBIN', pairing: 'MANUAL', seeding: 'MANUAL' }, 1)
    await createOpenSession(d1, state, 'hash')
    expect(() => raw.exec("UPDATE open_tournaments SET format = 'LADDER'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET bracket = 'CONSOLATION'")).toThrow(/CHECK/)
    expect(() => raw.exec("UPDATE open_tournament_fixtures SET status = 'LIVE'")).toThrow(/CHECK/)
    // Pairing, seeding and phase are free text, read back through a normalizer.
    raw.exec("UPDATE open_tournaments SET pairing = 'SOMETHING_NEW'")
    expect((await loadOpenSession(d1, 'CUPCU23456', NOW))?.state.tournament?.pairing).toBe('RANDOM')
  })
})
