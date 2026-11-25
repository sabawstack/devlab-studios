// PB-QUEUE-09: the on-deck promise, held against the real reducer.
//
//   Whenever a game is on deck, the next result on ANY court calls exactly
//   that game (same four, same teams) to the court that just freed: the four
//   told to get ready are the four who walk on.
//
// Random sessions in every mode, with keep-together and keep-apart rules, and
// every disturbance the host or the floor produces: breaks and returns, late
// arrivals, leavers, skips, edits, mode changes, abandoned games, undone
// results, courts switched off and on, new rules. At every state reached the
// deck's shape is checked too: at most one, only while no court is free, and
// never missing when a fitting four is waiting.
import { describe, expect, it, vi } from 'vitest'

// Deterministic (fixed seeds) but CPU-heavy; the budget absorbs a slow CI
// runner (PR #74, 2026-11-16). It does not hide a hang.
vi.setConfig({ testTimeout: 60_000 })
import { queueOrder } from './fairness'
import { isOnDeck, onDeckMatch, proposeForCourt } from './propose'
import { Clock, createDriver, randomScore, scoresFor, step, type Driver } from './testing/reducerSim'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import type { OpenSessionState, PairRule, Side, StackingMode } from './types'

const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

/** Every live game, finished both ways (the score cannot matter, so a close and a lopsided one): the deck must be the call on that court each time. */
function checkPromise(state: OpenSessionState, minute: number, label: string): number {
  const deck = onDeckMatch(state)!
  let checks = 0
  for (const m of state.matches.filter((x) => x.status === 'IN_PROGRESS')) {
    for (const winner of ['A', 'B'] as Side[]) {
      for (const score of scoresFor(winner, state.settings.target).slice(0, 2)) {
        const next = step(state, { type: 'RECORD_RESULT', matchId: m.id, ...score }, minute + 1)
        expect(next, 'a valid result must be accepted').not.toBeNull()
        const called = next!.matches.find((x) => x.id === deck.id)
        expect(called, label).toBeDefined()
        expect(called!.status, label).toBe('PROPOSED')
        expect(called!.courtId, label).toBe(m.courtId)
        expect(isOnDeck(next!, called!), label).toBe(false)
        expect([called!.teamA, called!.teamB], label).toEqual([deck.teamA, deck.teamB])
        checks += 1
      }
    }
  }
  return checks
}

/** The deck's shape at any state the reducer leaves behind. */
function checkShape(state: OpenSessionState, label: string): void {
  const decks = state.matches.filter((m) => isOnDeck(state, m))
  expect(decks.length, label).toBeLessThanOrEqual(1)
  const enabled = state.courts.filter((c) => c.enabled)
  const live = state.matches.filter((m) => m.status === 'PROPOSED' || m.status === 'IN_PROGRESS')
  const freeCourt = enabled.some((c) => !live.some((m) => m.courtId === c.id))
  const deck = decks[0]
  if (deck) {
    expect(state.kind, label).toBe('OPEN_PLAY')
    expect(state.status, label).toBe('ACTIVE')
    expect(freeCourt, `${label}: a game on deck while a court is free`).toBe(false)
    const waiting = new Set(queueOrder(state).map((e) => e.player.id))
    for (const id of [...deck.teamA, ...deck.teamB]) expect(waiting.has(id), label).toBe(false)
    return
  }
  const eligible = enabled.some((c) => live.some((m) => m.courtId === c.id && m.status === 'IN_PROGRESS')
    && !live.some((m) => m.courtId === c.id && m.status === 'PROPOSED'))
  if (state.kind === 'OPEN_PLAY' && state.status === 'ACTIVE' && !freeCourt && eligible) {
    expect(proposeForCourt(state), `${label}: a fitting four waits but nobody is on deck`).toBeNull()
  }
}

function pick<T>(random: () => number, items: readonly T[]): T | undefined {
  return items.length ? items[Math.floor(random() * items.length)] : undefined
}

/** One random disturbance, or none; the reducer may refuse it (that is fine). */
function disturb(driver: Driver, arrivals: { n: number }): void {
  const { state, random } = driver
  const roll = random()
  const waiting = queueOrder(state).map((e) => e.player.id)
  const proposed = state.matches.filter((m) => m.status === 'PROPOSED')
  const inProgress = state.matches.filter((m) => m.status === 'IN_PROGRESS')
  const onBreak = state.players.filter((p) => p.status === 'BREAK')
  let command: OpenCommand | null = null
  if (roll < 0.06 && waiting.length) command = { type: 'SET_PLAYER_STATUS', playerId: pick(random, waiting)!, status: 'BREAK' }
  else if (roll < 0.12 && onBreak.length) command = { type: 'SET_PLAYER_STATUS', playerId: pick(random, onBreak)!.id, status: 'ACTIVE' }
  else if (roll < 0.15 && state.players.length < 128) command = { type: 'ADD_PLAYERS', names: [`late${(arrivals.n += 1)}`] }
  else if (roll < 0.17 && waiting.length > 6) command = { type: 'SET_PLAYER_STATUS', playerId: pick(random, waiting)!, status: 'LEFT' }
  else if (roll < 0.21 && proposed.length) command = { type: 'SKIP_PROPOSAL', matchId: pick(random, proposed)!.id }
  else if (roll < 0.24 && proposed.length && waiting.length) {
    const m = pick(random, proposed)!
    command = { type: 'EDIT_PROPOSAL', matchId: m.id, teamA: [pick(random, waiting)!, m.teamA[1]], teamB: [m.teamB[0], m.teamB[1]] }
  } else if (roll < 0.26) command = { type: 'SET_MODE', mode: pick(random, MODES)! }
  else if (roll < 0.28 && inProgress.length) command = { type: 'ABANDON_MATCH', matchId: pick(random, inProgress)!.id }
  else if (roll < 0.31) {
    const last = [...state.matches].filter((m) => m.status === 'FINISHED').sort((a, b) => b.seq - a.seq)[0]
    if (last) command = { type: 'UNDO_RESULT', matchId: last.id }
  } else if (roll < 0.33) {
    const c = pick(random, state.courts)!
    command = { type: 'SET_COURT_ENABLED', courtId: c.id, enabled: !c.enabled }
  } else if (roll < 0.35 && state.players.length > 2) {
    const a = pick(random, state.players)!.id
    const b = pick(random, state.players.filter((p) => p.id !== a))!.id
    command = { type: 'ADD_RULE', rule: { kind: random() < 0.5 ? 'TOGETHER' : 'APART', playerIds: [a, b] } }
  }
  if (command) driver.run(command, 0)
}

interface Run { mode: StackingMode; players: number; courts: number; seed: number; steps: number; rules?: PairRule[] }

function play({ mode, players, courts, seed, steps, rules = [] }: Run): { decks: number; checks: number } {
  const driver = createDriver({ players, courts, mode, seed, rules, skills: true })
  const clock = new Clock(driver.random)
  const arrivals = { n: 0 }
  let decks = 0
  let checks = 0
  for (let n = 0; n < steps; n += 1) {
    const label = `${mode} ${players}p/${courts}c seed ${seed} step ${n}`
    // Most called games walk on at once; some wait, so proposed states occur too. A game on deck is refused.
    for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) {
      if (isOnDeck(driver.state, m)) expect(driver.run({ type: 'START_MATCH', matchId: m.id }, 0), label).toBe(false)
      else if (driver.random() < 0.8) driver.run({ type: 'START_MATCH', matchId: m.id }, 0)
    }
    disturb(driver, arrivals)
    clock.track(driver.state, driver.minute)
    checkShape(driver.state, label)

    if (onDeckMatch(driver.state)) {
      decks += 1
      // Sampled at the larger sizes: every live game x 2 sides x 2 scores is up to 64 reducer runs.
      if (courts <= 4 || decks % 4 === 1) checks += checkPromise(driver.state, driver.minute, label)
    }

    const next = clock.next(driver.state)
    if (!next) continue
    driver.run({ type: 'RECORD_RESULT', matchId: next.match.id, ...randomScore(driver.random) }, Math.max(0, next.end - driver.minute))
  }
  return { decks, checks }
}

const pairRules = (n: number): PairRule[] => [
  { kind: 'TOGETHER', playerIds: ['p0', 'p1'] },
  { kind: 'APART', playerIds: ['p2', 'p3'] },
  ...(n > 12 ? [{ kind: 'TOGETHER' as const, playerIds: ['p4', 'p5'] as const }, { kind: 'APART' as const, playerIds: ['p6', 'p0'] as const }] : []),
]

describe('the four on deck are the four called, after any result (real reducer, all modes)', () => {
  for (const mode of MODES) {
    it(`${mode}: one court, several courts, with and without rules`, () => {
      let decks = 0
      let checks = 0
      for (const run of [
        { players: 5, courts: 1, seed: 1 },
        { players: 8, courts: 1, seed: 2 },
        { players: 9, courts: 1, seed: 3 },
        { players: 13, courts: 2, seed: 4 },
        { players: 14, courts: 2, seed: 5, rules: pairRules(14) },
        { players: 24, courts: 3, seed: 6, rules: pairRules(24) },
        { players: 40, courts: 4, seed: 7 },
        { players: 40, courts: 4, seed: 8, rules: pairRules(40) },
      ]) {
        const r = play({ mode, steps: 160, ...run })
        decks += r.decks
        checks += r.checks
      }
      expect(decks, 'a deck must form most of the time').toBeGreaterThan(200)
      expect(checks).toBeGreaterThan(500)
    })

    it(`${mode}: sixteen courts and 128 players`, () => {
      const r = play({ mode, players: 128, courts: 16, seed: 9, steps: 70, rules: pairRules(128) })
      expect(r.decks).toBeGreaterThan(0)
      expect(r.checks).toBeGreaterThan(0)
    })
  }
})
