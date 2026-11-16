// PB-QUEUE-06: the nextUp contract, held against the real reducer.
//
//   Whenever nextUp is non-null, it equals the four the server proposes after
//   ANY live game ends, whichever side wins and by any valid score.
//
// Random sessions in every mode, with keep-together and keep-apart rules, and
// every disturbance the host or the floor produces: breaks and returns, late
// arrivals, leavers, skips, edits, mode changes, abandoned games, undone
// results, courts switched off and on, new rules. At every state reached,
// when nextUp names four, every live game is finished both ways at several
// scores (sudden death, deuce, a blowout) and the proposal compared.
// The run also asserts that nextUp names four some of the time, so the gate
// cannot quietly go dead.
import { describe, expect, it, vi } from 'vitest'

// Deterministic (fixed seeds) but CPU-heavy: about 1.3 s per test locally, and
// once over vitest's 5 s default on a busy CI runner (PR #74, 2026-11-16). The
// budget absorbs a slow runner; it does not hide a hang.
vi.setConfig({ testTimeout: 60_000 })
import { queueOutlook } from './outlook'
import { queueOrder } from './fairness'
import { Clock, createDriver, randomScore, scoresFor, setKey, step, type Driver } from './testing/reducerSim'
import { computeStandings } from './standings'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import type { OpenSessionState, PairRule, Side, StackingMode } from './types'

const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

/** Every live game, finished both ways at several scores: the proposal each time. */
function proposalsAfterAnyResult(state: OpenSessionState, minute: number): string[] {
  const out: string[] = []
  for (const m of state.matches.filter((x) => x.status === 'IN_PROGRESS')) {
    for (const winner of ['A', 'B'] as Side[]) {
      for (const score of scoresFor(winner, state.settings.target)) {
        const next = step(state, { type: 'RECORD_RESULT', matchId: m.id, ...score }, minute + 1)
        expect(next, 'a valid result must be accepted').not.toBeNull()
        const fresh = next!.matches.filter((x) => x.status === 'PROPOSED')
        expect(fresh).toHaveLength(1)
        expect(fresh[0].courtId).toBe(m.courtId)
        out.push(setKey([...fresh[0].teamA, ...fresh[0].teamB]))
      }
    }
  }
  return out
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

interface Run { mode: StackingMode; players: number; courts: number; seed: number; steps: number; rules?: PairRule[]; levelScores?: boolean }

function play({ mode, players, courts, seed, steps, rules = [], levelScores = false }: Run): { gated: number; checks: number } {
  const driver = createDriver({ players, courts, mode, seed, rules, skills: true })
  const clock = new Clock(driver.random)
  const arrivals = { n: 0 }
  let gated = 0
  let checks = 0
  for (let n = 0; n < steps; n += 1) {
    // Most called games walk on at once; some wait, so proposed states occur too.
    for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) {
      if (driver.random() < 0.8) driver.run({ type: 'START_MATCH', matchId: m.id }, 0)
    }
    disturb(driver, arrivals)
    clock.track(driver.state, driver.minute)

    const outlook = queueOutlook(driver.state)
    if (outlook.nextUp) {
      gated += 1
      const expected = setKey(outlook.nextUp.map((e) => e.player.id))
      // Sampled at the larger sizes: every live game x 2 sides x 5 scores is up to 160 reducer runs.
      if (courts <= 4 || gated % 4 === 1) {
        for (const actual of proposalsAfterAnyResult(driver.state, driver.minute)) {
          checks += 1
          expect(actual, `${mode} ${players}p/${courts}c seed ${seed} step ${n}`).toBe(expected)
        }
      }
    }

    const next = clock.next(driver.state)
    if (!next) {
      // Nothing playing (everyone on a break, courts off): start what is proposed next round.
      continue
    }
    // Level scores (every game 11-5) make many players tie in the standings, which by standing must survive.
    const score = levelScores ? { winner: (driver.random() < 0.5 ? 'A' : 'B') as Side, scoreA: 0, scoreB: 0 } : randomScore(driver.random)
    if (levelScores) Object.assign(score, score.winner === 'A' ? { scoreA: 11, scoreB: 5 } : { scoreA: 5, scoreB: 11 })
    driver.run({ type: 'RECORD_RESULT', matchId: next.match.id, ...score }, Math.max(0, next.end - driver.minute))
  }
  return { gated, checks }
}

const pairRules = (n: number): PairRule[] => [
  { kind: 'TOGETHER', playerIds: ['p0', 'p1'] },
  { kind: 'APART', playerIds: ['p2', 'p3'] },
  ...(n > 12 ? [{ kind: 'TOGETHER' as const, playerIds: ['p4', 'p5'] as const }, { kind: 'APART' as const, playerIds: ['p6', 'p0'] as const }] : []),
]

describe('nextUp equals the next proposal after any result (real reducer, all modes)', () => {
  for (const mode of MODES) {
    it(`${mode}: one court, several courts, with and without rules`, () => {
      let gated = 0
      let checks = 0
      for (const run of [
        { players: 5, courts: 1, seed: 1 },
        { players: 9, courts: 1, seed: 2 },
        { players: 13, courts: 2, seed: 3 },
        { players: 14, courts: 2, seed: 4, rules: pairRules(14) },
        { players: 24, courts: 3, seed: 5, rules: pairRules(24) },
        { players: 40, courts: 4, seed: 6 },
        { players: 40, courts: 4, seed: 7, rules: pairRules(40) },
      ]) {
        const r = play({ mode, steps: 160, ...run })
        gated += r.gated
        checks += r.checks
      }
      expect(gated, 'the gate must name a four some of the time').toBeGreaterThan(20)
      expect(checks).toBeGreaterThan(200)
    })

    it(`${mode}: sixteen courts and 128 players`, () => {
      const r = play({ mode, players: 128, courts: 16, seed: 8, steps: 70, rules: pairRules(128) })
      expect(r.gated).toBeGreaterThan(0)
      expect(r.checks).toBeGreaterThan(0)
    })
  }
})

describe('by standing with many standings ties', () => {
  // Every game 11-5: players with the same record tie on win rate and points
  // share, so head-to-head (which a finisher joining the tie can switch off)
  // decides their order. nextUp must stay right through that.
  it('nextUp still equals the next proposal', () => {
    let gated = 0
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      gated += play({ mode: 'BY_STANDING', players: 13 + seed % 5, courts: 2 + (seed % 2), seed, steps: 200, levelScores: true }).gated
    }
    expect(gated).toBeGreaterThan(0)
  })
})

// Random play almost never builds a small tie group whose members have all met,
// so the by-standing tie condition is proven by construction instead.
describe('by standing: a finisher joining a standings tie can reorder two waiting players', () => {
  // x and y are 1-1 with the same points share and met once (y won): head-to-head puts y first.
  // f is 1-0 and on court. If f loses 11-5, f is 1-1 too and joins the tie; f never met x or
  // y, so head-to-head no longer applies and the tie goes by name: x before y.
  const players = ['x', 'y', 'f', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11', 'r1', 'r2', 'r3']
    .map((id, i) => player(id, { name: id, position: i }))
  const history = [
    finished('m1', ['y', 'q1'], ['x', 'q2'], 'A', 11, 5, 0),
    finished('m2', ['x', 'q3'], ['q4', 'q5'], 'A', 11, 5, 20),
    finished('m3', ['q6', 'q7'], ['y', 'q8'], 'A', 11, 5, 40),
    finished('m5', ['f', 'q9'], ['q10', 'q11'], 'A', 11, 5, 60),
  ]
  const live = { ...finished('m4', ['f', 'r1'], ['r2', 'r3'], 'A', null, null, 80), status: 'IN_PROGRESS' as const, winner: null, finishedAt: null }
  const order = (matches: typeof history) => computeStandings(players, matches).map((r) => r.playerId).filter((id) => id === 'x' || id === 'y')

  it('head-to-head order before, name order once f joins the tie', () => {
    expect(order(history)).toEqual(['y', 'x'])
    const fLoses = { ...live, status: 'FINISHED' as const, winner: 'B' as const, scoreA: 5, scoreB: 11, finishedAt: at(90) }
    expect(order([...history, fLoses])).toEqual(['x', 'y'])
  })

  it('so nextUp names nobody in by standing while two candidates tie', () => {
    const state = sessionState({
      settings: { mode: 'BY_STANDING', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules: [], announcement: '', endedAt: null },
      courts: [court('c1', 1)],
      // Credited games put x, y and the q players in one games tier (2) and every
      // player on court above it once they finish, so only the tie can stop nextUp.
      players: players.map((p) => {
        if (p.id === 'f') return { ...p, gamesOffset: 1 }
        if (p.id.startsWith('r')) return { ...p, gamesOffset: 2 }
        return { ...p, gamesOffset: p.id.startsWith('q') ? 1 : 0, waitingSince: at(85) }
      }),
      matches: [...history, live],
    })
    expect(queueOrder(state).map((e) => e.player.id)).toEqual(expect.arrayContaining(['x', 'y']))
    expect(queueOutlook(state).nextUp).toBeNull()
    // The same state in paddle stack (no standings) does name a four, so the null is the tie condition.
    expect(queueOutlook({ ...state, settings: { ...state.settings, mode: 'PADDLE_STACK' } }).nextUp).not.toBeNull()
  })
})

describe('nextUp is null whenever the state does not fix the next four', () => {
  it('with a proposed game, a free court, fewer than four waiting, an ended session, and in a tournament', () => {
    const driver = createDriver({ players: 14, courts: 2, mode: 'PADDLE_STACK', seed: 9 })
    // Fresh session: both courts proposed.
    expect(queueOutlook(driver.state).nextUp).toBeNull()
    const [first, second] = driver.state.matches.filter((m) => m.status === 'PROPOSED')
    driver.run({ type: 'START_MATCH', matchId: first.id })
    // One court playing, one proposed.
    expect(queueOutlook(driver.state).nextUp).toBeNull()
    driver.run({ type: 'START_MATCH', matchId: second.id })
    expect(queueOutlook(driver.state).nextUp).not.toBeNull()
    // A third court switched on: free until it is proposed (it is, at once).
    const third: OpenSessionState = { ...driver.state, courts: [...driver.state.courts, { id: 'c9', label: 'Court 9', position: 9, enabled: true }] }
    expect(queueOutlook(third).nextUp).toBeNull()
    // Ended.
    expect(queueOutlook({ ...driver.state, status: 'ENDED' }).nextUp).toBeNull()
    // A tournament never has an open-play next four.
    expect(queueOutlook({ ...driver.state, kind: 'TOURNAMENT' }).nextUp).toBeNull()
    // Fewer than four waiting.
    const few = createDriver({ players: 11, courts: 2, mode: 'PADDLE_STACK', seed: 10 })
    for (const m of few.state.matches.filter((x) => x.status === 'PROPOSED')) few.run({ type: 'START_MATCH', matchId: m.id })
    expect(queueOrder(few.state)).toHaveLength(3)
    expect(queueOutlook(few.state).nextUp).toBeNull()
  })

  it('when a keep-together pair is split between court and queue', () => {
    const driver = createDriver({ players: 14, courts: 2, mode: 'PADDLE_STACK', seed: 12 })
    for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) driver.run({ type: 'START_MATCH', matchId: m.id })
    const onCourt = driver.state.matches.find((m) => m.status === 'IN_PROGRESS')!.teamA[0]
    const waiting = queueOrder(driver.state)[0].player.id
    const ruled: OpenSessionState = { ...driver.state, settings: { ...driver.state.settings, rules: [{ kind: 'TOGETHER', playerIds: [onCourt, waiting] }] } }
    expect(queueOutlook(ruled).nextUp).toBeNull()
  })

  it('when a player now on court could re-enter the pool (equal games)', () => {
    // 9 players, 2 courts: one waits; after the first round the finishers tie the waiter's games.
    const driver = createDriver({ players: 12, courts: 2, mode: 'PADDLE_STACK', seed: 13 })
    for (const m of driver.state.matches.filter((x) => x.status === 'PROPOSED')) driver.run({ type: 'START_MATCH', matchId: m.id })
    // Everyone has 0 games: finishers will have 1, the waiting four have 0, so the tier is 0: fixed.
    expect(queueOutlook(driver.state).nextUp).not.toBeNull()
    // Give the waiting players a game each so they tie what the finishers will have.
    const level: OpenSessionState = {
      ...driver.state,
      players: driver.state.players.map((p) => (queueOrder(driver.state).some((e) => e.player.id === p.id) ? { ...p, gamesOffset: 1 } : p)),
    }
    expect(queueOutlook(level).nextUp).toBeNull()
  })
})

describe('idle: why an enabled court has no game', () => {
  it('too few players, waiting on the host (no four fit the rules), session over', () => {
    const few = createDriver({ players: 3, courts: 1, mode: 'PADDLE_STACK', seed: 14 })
    expect([...queueOutlook(few.state).idle.values()]).toEqual(['TOO_FEW_PLAYERS'])
    const apart = createDriver({
      players: 4, courts: 1, mode: 'PADDLE_STACK', seed: 15,
      rules: [{ kind: 'APART', playerIds: ['p0', 'p1'] }],
    })
    expect([...queueOutlook(apart.state).idle.values()]).toEqual(['WAITING_FOR_HOST'])
    const ended = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 16 })
    ended.run({ type: 'END_SESSION' })
    expect([...queueOutlook(ended.state).idle.values()]).toEqual(['SESSION_OVER'])
  })

  it('courts with a game, and courts that are off, have no idle reason', () => {
    const driver = createDriver({ players: 8, courts: 2, mode: 'PADDLE_STACK', seed: 17 })
    expect(queueOutlook(driver.state).idle.size).toBe(0)
    driver.run({ type: 'SET_COURT_ENABLED', courtId: 'c1', enabled: false })
    expect(queueOutlook(driver.state).idle.has('c1')).toBe(false)
  })
})
