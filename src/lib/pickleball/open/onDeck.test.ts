// PB-QUEUE-09: the next four go on deck, with a court and teams, while every
// court plays, so they can get ready (the PickleQ-style flow the owner asked for).
import { describe, expect, it } from 'vitest'
import { queueOrder } from './fairness'
import { isOnDeck, onDeckMatch } from './propose'
import { createDriver, ids } from './testing/reducerSim'
import type { OpenMatch, OpenSessionState } from './types'

const live = (state: OpenSessionState, courtId: string) => state.matches.find((m) => m.courtId === courtId && m.status === 'IN_PROGRESS')
const called = (state: OpenSessionState) => state.matches.filter((m) => m.status === 'PROPOSED' && !isOnDeck(state, m))
const startCalls = (driver: ReturnType<typeof createDriver>) => {
  for (const m of called(driver.state)) driver.run({ type: 'START_MATCH', matchId: m.id })
}

describe('one court, eight players (the board in the bug report)', () => {
  it('puts the four waiting on deck for Court 1 as soon as the first game starts', () => {
    const driver = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 1 })
    expect(onDeckMatch(driver.state)).toBeNull() // the first call is not started yet
    startCalls(driver)
    const deck = onDeckMatch(driver.state)!
    expect(deck).not.toBeNull()
    expect(deck.courtId).toBe('c0')
    const playing = new Set(ids(live(driver.state, 'c0')!))
    expect(ids(deck).some((id) => playing.has(id))).toBe(false)
    expect(queueOrder(driver.state)).toHaveLength(0) // all four left waiting are on deck
  })

  it('cannot start or be scored while the court is still playing', () => {
    const driver = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 2 })
    startCalls(driver)
    const deck = onDeckMatch(driver.state)!
    expect(driver.run({ type: 'START_MATCH', matchId: deck.id })).toBe(false)
    expect(driver.run({ type: 'RECORD_RESULT', matchId: deck.id, winner: 'A', scoreA: 11, scoreB: 4 })).toBe(false)
  })

  it('calls the deck when the game ends, and the finishers go on deck behind them', () => {
    const driver = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 3 })
    startCalls(driver)
    const first = live(driver.state, 'c0')!
    const deck = onDeckMatch(driver.state)!
    driver.run({ type: 'RECORD_RESULT', matchId: first.id, winner: 'A', scoreA: 11, scoreB: 6 })
    const call = driver.state.matches.find((m) => m.id === deck.id)!
    expect(call.status).toBe('PROPOSED')
    expect(isOnDeck(driver.state, call)).toBe(false) // now "walk on now"
    expect(onDeckMatch(driver.state)).toBeNull() // nobody on deck until the call starts
    driver.run({ type: 'START_MATCH', matchId: call.id })
    expect(new Set(ids(onDeckMatch(driver.state)!))).toEqual(new Set(ids(first)))
  })

  it('a player on deck who takes a break is replaced, and the deck re-forms', () => {
    const driver = createDriver({ players: 9, courts: 1, mode: 'PADDLE_STACK', seed: 4 })
    startCalls(driver)
    const deck = onDeckMatch(driver.state)!
    const resting = deck.teamA[0]
    driver.run({ type: 'SET_PLAYER_STATUS', playerId: resting, status: 'BREAK' })
    const next = onDeckMatch(driver.state)!
    expect(next).not.toBeNull()
    expect(ids(next)).not.toContain(resting)
  })
})

describe('several courts', () => {
  function twoCourtsPlaying() {
    const driver = createDriver({ players: 12, courts: 2, mode: 'PADDLE_STACK', seed: 5 })
    const [a, b] = called(driver.state).sort((x, y) => x.courtId.localeCompare(y.courtId))
    driver.run({ type: 'START_MATCH', matchId: a.id }) // c0 starts first
    driver.run({ type: 'START_MATCH', matchId: b.id })
    return driver
  }

  it('holds one game on deck, behind the court whose game started first', () => {
    const driver = twoCourtsPlaying()
    const decks = driver.state.matches.filter((m) => isOnDeck(driver.state, m))
    expect(decks).toHaveLength(1)
    expect(decks[0].courtId).toBe('c0')
  })

  it('moves the deck to another court that frees first, so its four never wait longer', () => {
    const driver = twoCourtsPlaying()
    const deck = onDeckMatch(driver.state)!
    driver.run({ type: 'RECORD_RESULT', matchId: live(driver.state, 'c1')!.id, winner: 'B', scoreA: 7, scoreB: 11 })
    const call = driver.state.matches.find((m) => m.id === deck.id) as OpenMatch
    expect(call.courtId).toBe('c1')
    expect(isOnDeck(driver.state, call)).toBe(false)
  })

  it('a court switched on takes the deck at once', () => {
    const driver = createDriver({ players: 12, courts: 3, mode: 'PADDLE_STACK', seed: 6 })
    driver.run({ type: 'SET_COURT_ENABLED', courtId: 'c2', enabled: false })
    startCalls(driver)
    const deck = onDeckMatch(driver.state)!
    driver.run({ type: 'SET_COURT_ENABLED', courtId: 'c2', enabled: true })
    const call = driver.state.matches.find((m) => m.id === deck.id)!
    expect(call.courtId).toBe('c2')
    expect(isOnDeck(driver.state, call)).toBe(false)
  })

  it('nobody goes on deck while a court is free or has a call not yet started', () => {
    const driver = createDriver({ players: 16, courts: 2, mode: 'PADDLE_STACK', seed: 7 })
    expect(onDeckMatch(driver.state)).toBeNull()
    const [a] = called(driver.state)
    driver.run({ type: 'START_MATCH', matchId: a.id })
    // One court playing, the other called: the playing court can hold a deck.
    expect(onDeckMatch(driver.state)?.courtId).toBe(a.courtId)
  })
})

describe('never on deck', () => {
  it('with fewer than four waiting, or after the session ends', () => {
    const few = createDriver({ players: 7, courts: 1, mode: 'PADDLE_STACK', seed: 8 })
    startCalls(few)
    expect(onDeckMatch(few.state)).toBeNull()
    const ended = createDriver({ players: 8, courts: 1, mode: 'PADDLE_STACK', seed: 9 })
    startCalls(ended)
    expect(onDeckMatch(ended.state)).not.toBeNull()
    ended.run({ type: 'END_SESSION' })
    expect(onDeckMatch(ended.state)).toBeNull()
  })
})
