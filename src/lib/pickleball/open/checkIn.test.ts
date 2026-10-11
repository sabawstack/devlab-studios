import { describe, expect, it } from 'vitest'
import { applyCheckIn } from './checkIn'
import { at, finished, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, LIMITS } from './types'

const ctx = { now: at(30), newId: () => 'new-player' }

describe('applyCheckIn', () => {
  it('adds a player level with whoever has played least, with their skill and DUPR ID', () => {
    const state = sessionState({
      players: [player('a', { position: 1 }), player('b', { position: 2 })],
      matches: [finished('m1', ['a', 'x'], ['y', 'z'], 'A', 11, 3)],
    })
    const result = applyCheckIn(state, { name: '  2. Ana 🎾 ', skill: 4, duprId: 'ab12c3' }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'new-player', name: 'Ana', alreadyCheckedIn: false })
    if (!result.ok) return
    expect(result.state.players.at(-1)).toMatchObject({ name: 'Ana', skill: 4, duprId: 'AB12C3', gamesOffset: 0, position: 3, status: 'ACTIVE' })
  })

  it('a second check-in under the same name (any case) changes nothing', () => {
    const state = sessionState({ players: [player('a', { name: 'Ana' })] })
    const result = applyCheckIn(state, { name: 'ANA', skill: null, duprId: null }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'a', name: 'Ana', alreadyCheckedIn: true })
    expect(result.ok && result.state).toBe(state)
  })

  it('brings a player back from a break without touching their details', () => {
    const state = sessionState({ players: [player('a', { name: 'Ana', status: 'BREAK', skill: 2 })] })
    const result = applyCheckIn(state, { name: 'ana', skill: 5, duprId: null }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'a', alreadyCheckedIn: false })
    expect(result.ok && result.state.players[0]).toMatchObject({ status: 'ACTIVE', skill: 2, waitingSince: at(30) })
  })

  it('does not undo a host removal: a player who left stays off the list', () => {
    const state = sessionState({ players: [player('a', { name: 'Ana', status: 'LEFT' })] })
    expect(applyCheckIn(state, { name: 'ana', skill: null, duprId: null }, ctx)).toEqual({
      ok: false, status: 409, error: 'The host took this name off the list. Ask the host to add you back.',
    })
  })

  it('lets a returning break player in even when the session is at the player cap', () => {
    const players = Array.from({ length: LIMITS.maxPlayers }, (_, i) => player(`p${i}`, i === 0 ? { name: 'Ana', status: 'BREAK' } : {}))
    const result = applyCheckIn(sessionState({ players }), { name: 'Ana', skill: null, duprId: null }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'p0', alreadyCheckedIn: false })
  })

  it('refuses when check-in is off, the session ended, the name is empty, or values are out of range', () => {
    const base = sessionState()
    expect(applyCheckIn({ ...base, settings: { ...DEFAULT_SETTINGS, selfCheckIn: false } }, { name: 'Ana', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 403 })
    expect(applyCheckIn({ ...base, status: 'ENDED' }, { name: 'Ana', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 409 })
    expect(applyCheckIn(base, { name: '🎾 ', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400, error: 'Enter your name.' })
    expect(applyCheckIn(base, { name: 'Ana', skill: 6, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400 })
    expect(applyCheckIn(base, { name: 'Ana', skill: 2.5, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400 })
    expect(applyCheckIn(base, { name: 'Ana', skill: null, duprId: 'ABC' }, ctx)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a new name once the session is full', () => {
    const full = sessionState({ players: Array.from({ length: LIMITS.maxPlayers }, (_, i) => player(`p${i}`)) })
    expect(applyCheckIn(full, { name: 'Late', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 409, error: 'This session is full.' })
  })
})
