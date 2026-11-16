import { describe, expect, it } from 'vitest'
import { courtStateLabel, IDLE_LABEL, upNextLabel, waitingNote } from './queueVocabulary'

const court = (state, idle = null) => ({ state, idle, teamA: [], teamB: [] })
const board = (courts, extra = {}) => ({ status: 'ACTIVE', kind: 'OPEN_PLAY', courts, waiting: [{ id: 'w', name: 'W' }], nextUp: null, ...extra })

describe('queue vocabulary (PB-QUEUE-01)', () => {
  it('"Up next" is a confirmed call and says walk on only when fresh', () => {
    expect(courtStateLabel(court('UP_NEXT'))).toBe('Up next · walk on now')
    expect(courtStateLabel(court('UP_NEXT'), { fresh: false })).toBe('Up next')
    expect(upNextLabel('Court 4')).toBe('Up next · Court 4 · walk on now')
  })

  it('an empty court says why, from the server reason', () => {
    expect(courtStateLabel(court('WAITING_FOR_PLAYERS', 'WAITING_FOR_HOST'))).toBe('Waiting for the host')
    expect(courtStateLabel(court('WAITING_FOR_PLAYERS', 'PLAYER_ON_BREAK'))).toBe('Waiting for a player on a break')
    // An older server without idle still reads sensibly.
    expect(courtStateLabel(court('WAITING_FOR_PLAYERS'))).toBe('Waiting for players')
    for (const label of Object.values(IDLE_LABEL)) expect(label).not.toMatch(/rule|keep/i)
  })

  it('says the next four are decided when a game ends only when every court is playing and none is named', () => {
    expect(waitingNote(board([court('PLAYING'), court('PLAYING'), court('OFF')]))).toBe('The next four are decided when a game ends.')
    expect(waitingNote(board([court('PLAYING'), court('UP_NEXT')]))).toBeNull()
    expect(waitingNote(board([court('PLAYING')], { nextUp: { players: [] } }))).toBeNull()
    expect(waitingNote(board([court('PLAYING')], { waiting: [] }))).toBeNull()
    expect(waitingNote(board([court('PLAYING')], { kind: 'TOURNAMENT' }))).toBeNull()
  })
})
