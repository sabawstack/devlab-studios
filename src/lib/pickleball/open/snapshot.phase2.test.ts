import { describe, expect, it } from 'vitest'
import { fairnessSummary } from './fairness'
import { fillProposals } from './propose'
import { hostCourts, toCaptainSnapshot, toHostSnapshot, toViewerSnapshot } from './snapshot'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, type CaptainRecord } from './types'

const captain: CaptainRecord = { id: 'cap1', label: 'Court 1 captain', courtId: 'c1', keyHash: 'secret-hash-value', createdAt: at(0) }

function state() {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, { position: i, skill: 4, duprId: 'AB12C3', waitingSince: at(i) })),
    matches: [
      finished('m0', ['a', 'b'], ['c', 'd'], 'A', 11, 4, 1),
      finished('m1', ['a', 'b'], ['e', 'f'], 'B', 7, 11, 20),
    ],
  })
  return fillProposals(base, { now: at(40), newId: () => 'p1' })
}

describe('fairnessSummary', () => {
  it('reports the games spread and repeated partnerships', () => {
    const summary = fairnessSummary(state())
    expect(summary.sitOutSpread).toBe(1) // a and b have 2 games, the rest 1
    expect(summary.repeatedPartners).toBe(1) // a + b twice
  })

  it('names the longest-waiting available player', () => {
    const waiting = sessionState({ players: [player('x', { waitingSince: at(5) }), player('y', { waitingSince: at(2), name: 'Yan' })] })
    expect(fairnessSummary(waiting).longestWait).toMatchObject({ playerId: 'y', name: 'Yan', since: at(2), rounds: 0 })
    expect(fairnessSummary(sessionState()).longestWait).toBeNull()
  })

  it('ignores players on break for the spread', () => {
    const s = sessionState({
      players: [player('a'), player('b'), player('c', { status: 'BREAK' })],
      matches: [finished('m', ['a', 'b'], ['x', 'y'], 'A', 11, 3)],
    })
    expect(fairnessSummary(s).sitOutSpread).toBe(0)
  })
})

describe('Phase 2 snapshots', () => {
  it('the viewer gets fairness and the check-in switch, and still no secrets, skills, rules or captains', () => {
    const viewer = toViewerSnapshot({ ...state(), settings: { ...DEFAULT_SETTINGS, rules: [{ kind: 'APART', playerIds: ['a', 'b'] }] } })
    expect(viewer.settings).toEqual({ target: 11, mode: 'PADDLE_STACK', selfCheckIn: true })
    expect(viewer.fairness.repeatedPartners).toBe(1)
    const json = JSON.stringify(viewer)
    for (const banned of ['AB12C3', 'skill', 'captain', 'rules', 'hash']) expect(json).not.toContain(banned)
  })

  it('the host sees captains without their key hash, and why a court is empty', () => {
    const blocked = sessionState({
      settings: { ...DEFAULT_SETTINGS, rules: [{ kind: 'APART', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }] },
      players: ['a', 'b', 'c', 'd'].map((id) => player(id)),
    })
    const host = toHostSnapshot(blocked, [captain])
    expect(host.captains).toEqual([{ id: 'cap1', label: 'Court 1 captain', courtId: 'c1', courtLabel: 'Court 1', createdAt: at(0) }])
    expect(JSON.stringify(host)).not.toContain('secret-hash-value')
    expect(host.courts[0].blocked).toMatch(/keep-together and keep-apart/)
    expect(host.players[0]).toMatchObject({ waitingSince: blocked.players[0].waitingSince, skill: null })
  })

  it('a captain sees their court, players without skills or DUPR IDs, and only their court’s results', () => {
    const snap = toCaptainSnapshot(state(), captain)
    expect(snap.captain).toEqual({ id: 'cap1', label: 'Court 1 captain', courtId: 'c1' })
    expect(snap.court.id).toBe('c1')
    expect(snap.finished.every((m) => m.courtId === 'c1')).toBe(true)
    const json = JSON.stringify(snap)
    for (const banned of ['AB12C3', 'skill', 'duprId', 'secret-hash-value', 'rules']) expect(json).not.toContain(banned)
  })

  it('a captain snapshot carries exactly the allowlisted match keys: no recordedBy on the court or in results', () => {
    const base = state()
    const s = { ...base, matches: base.matches.map((m) => (m.status === 'FINISHED' ? { ...m, recordedBy: 'Host' } : m)) }
    const snap = toCaptainSnapshot(s, captain)
    const matchKeys = ['courtId', 'finishedAt', 'id', 'proposedAt', 'scoreA', 'scoreB', 'seq', 'startedAt', 'status', 'teamA', 'teamB', 'winner']
    expect(snap.court.match).not.toBeNull()
    expect(Object.keys(snap.court.match ?? {}).sort()).toEqual(matchKeys)
    expect(Object.keys(snap.court).sort()).toEqual(['blocked', 'enabled', 'id', 'label', 'match', 'position'])
    expect(snap.finished.length).toBeGreaterThan(0)
    for (const m of snap.finished) expect(Object.keys(m).sort()).toEqual(matchKeys)
    expect(JSON.stringify(snap)).not.toContain('recordedBy')
    // the host still sees who saved it
    expect(toHostSnapshot(s).finished[0].recordedBy).toBe('Host')
  })

  it('precomputed viewer and courts yield the same host and captain snapshots', () => {
    const s = state()
    const parts = { viewer: toViewerSnapshot(s), courts: hostCourts(s) }
    expect(toHostSnapshot(s, [captain], parts)).toEqual(toHostSnapshot(s, [captain]))
    expect(toCaptainSnapshot(s, captain, parts)).toEqual(toCaptainSnapshot(s, captain))
    const elsewhere = { ...captain, courtId: 'gone' }
    expect(toCaptainSnapshot(s, elsewhere, parts)).toEqual(toCaptainSnapshot(s, elsewhere))
  })
})
