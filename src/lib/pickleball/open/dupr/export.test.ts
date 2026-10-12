import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { court, finished, player, sessionState } from '../testing/fixtures'
import type { OpenMatch } from '../types'
import { buildDuprExport, DUPR_COLUMNS, listNames, localDate, normalizeTimeZone, skipReason } from './export'

const TEMPLATE = readFileSync(join(process.cwd(), 'tests/fixtures/dupr-import-template.csv'), 'utf8').split(/\r?\n/)[0]

const players = [
  player('a', { name: 'Ana', duprId: 'AAA111', position: 1 }),
  player('b', { name: 'Ben', duprId: 'BBB222', position: 2 }),
  player('c', { name: 'Cy', duprId: 'CCC333', position: 3 }),
  player('d', { name: 'Di', duprId: 'DDD444', position: 4 }),
  player('e', { name: 'Eve', duprId: null, position: 5 }),
  player('f', { name: '=Fay', duprId: 'FFF666', position: 6 }),
]

function stateWith(matches: OpenMatch[], overrides = {}) {
  return sessionState({ name: 'Sunday, "Open"', location: 'Riverside Courts', players, courts: [court('c1', 1), court('c2', 2)], matches, ...overrides })
}

const cellsOf = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, -1).map((c) => c.replace(/,$/, ''))

describe('the DUPR template', () => {
  it('matches the pinned fixture column for column', () => {
    expect(DUPR_COLUMNS.join(',')).toBe(TEMPLATE)
    expect(DUPR_COLUMNS).toHaveLength(27)
  })
})

describe('buildDuprExport', () => {
  it('writes one doubles row per eligible game with only game 1 filled', () => {
    const out = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 0)]), { timeZone: 'UTC' })
    const [header, line, ...rest] = out.csv.split('\r\n')
    expect(header).toBe(TEMPLATE)
    expect(rest).toEqual([])
    const cells = cellsOf(line)
    expect(cells).toHaveLength(27)
    expect(cells).toEqual([
      'D', '"Sunday, ""Open"""', '2026-10-11',
      'Ana', 'AAA111', 'a', 'Ben', 'BBB222', 'b', 'Cy', 'CCC333', 'c', 'Di', 'DDD444', 'd',
      '11', '7', '', '', '', '', '', '', '', '',
      'Riverside Courts', 'SIDEOUT',
    ])
    expect(out.exported).toBe(1)
    expect(out.skipped).toEqual([])
  })

  it('uses RALLY when the host chose rally scoring, and a blank location when none was given', () => {
    const state = stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'B', 9, 11)], {
      location: null, settings: { ...sessionState().settings, scoringStyle: 'RALLY' },
    })
    const cells = cellsOf(buildDuprExport(state, { timeZone: 'UTC' }).csv.split('\r\n')[1])
    expect(cells.slice(15, 17)).toEqual(['9', '11'])
    expect(cells.slice(25)).toEqual(['', 'RALLY'])
  })

  it('dates each game in the host’s time zone', () => {
    const late = { ...finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7), finishedAt: '2026-10-11T23:30:00.000Z' }
    const row = (timeZone: string) => cellsOf(buildDuprExport(stateWith([late]), { timeZone }).csv.split('\r\n')[1])[2]
    expect(row('UTC')).toBe('2026-10-11')
    expect(row('Asia/Manila')).toBe('2026-10-12')
    expect(row('America/Los_Angeles')).toBe('2026-10-11')
    expect(row('Not/AZone')).toBe('2026-10-11')
  })

  it('lists every game it leaves out, numbered like the results CSV, with the reason', () => {
    const matches: OpenMatch[] = [
      finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7, 1),
      finished('m2', ['a', 'e'], ['c', 'd'], 'A', 11, 4, 2, 'c2'),
      finished('m3', ['a', 'b'], ['c', 'd'], 'A', null, null, 3),
      finished('m4', ['a', 'b'], ['c', 'd'], 'A', 5, 3, 4),
      { ...finished('m5', ['a', 'b'], ['c', 'd'], 'A', 11, 2, 5), status: 'ABANDONED' },
    ]
    const out = buildDuprExport(stateWith(matches), { timeZone: 'UTC' })
    expect(out.exported).toBe(1)
    expect(out.skipped).toEqual([
      { game: 2, court: 'Court 2', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no valid DUPR ID.' },
      { game: 3, court: 'Court 1', summary: 'Ana & Ben against Cy & Di', reason: 'No score was saved.' },
      { game: 4, court: 'Court 1', summary: 'Ana & Ben 5–3 Cy & Di', reason: 'DUPR needs one team to reach 6 points.' },
    ])
    expect(out.missingIds).toEqual([{ id: 'e', name: 'Eve' }])
    expect(out.sharedIds).toEqual([])
  })

  it('asks for a DUPR ID only where the score is valid: a tie or a sub-6 game never lists its players', () => {
    const matches: OpenMatch[] = [
      finished('m1', ['a', 'e'], ['c', 'd'], 'A', 10, 10, 1),
      finished('m2', ['a', 'e'], ['c', 'd'], 'A', 5, 3, 2),
    ]
    const out = buildDuprExport(stateWith(matches), { timeZone: 'UTC' })
    expect(out.skipped.map((s) => s.reason)).toEqual(['DUPR does not accept a tie.', 'DUPR needs one team to reach 6 points.'])
    expect(out.missingIds).toEqual([])
  })

  it('treats a malformed stored DUPR ID as missing', () => {
    const odd = players.map((p) => (p.id === 'b' ? { ...p, duprId: 'bb22' } : p))
    const out = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7)], { players: odd }), { timeZone: 'UTC' })
    expect(out.exported).toBe(0)
    expect(out.skipped[0].reason).toBe('Ben has no valid DUPR ID.')
    expect(out.missingIds).toEqual([{ id: 'b', name: 'Ben' }])
  })

  it('lists both players who share a DUPR ID so the host can fix the wrong one', () => {
    const twin = players.map((p) => (p.id === 'c' ? { ...p, duprId: 'AAA111' } : p))
    const out = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7)], { players: twin }), { timeZone: 'UTC' })
    expect(out.skipped[0].reason).toBe('Ana and Cy have the same DUPR ID.')
    expect(out.sharedIds).toEqual([{ id: 'a', name: 'Ana' }, { id: 'c', name: 'Cy' }])
    expect(out.missingIds).toEqual([])
  })

  it('defuses a formula-looking session name and venue', () => {
    const state = stateWith([finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7)], { name: '=HYPERLINK("x")', location: '+Court' })
    const cells = cellsOf(buildDuprExport(state, { timeZone: 'UTC' }).csv.split('\r\n')[1])
    expect(cells[1]).toBe(`"'=HYPERLINK(""x"")"`)
    expect(cells[25]).toBe(`"'+Court"`)
  })

  it('dates a game by when it started when no finish time was saved', () => {
    const game = { ...finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 7), finishedAt: null, startedAt: '2026-10-11T23:30:00.000Z' }
    const cells = cellsOf(buildDuprExport(stateWith([game]), { timeZone: 'Asia/Manila' }).csv.split('\r\n')[1])
    expect(cells[2]).toBe('2026-10-12')
  })

  it('refuses two players with the same DUPR ID and defuses a formula-looking name', () => {
    const twin = { ...players[1], duprId: 'AAA111' }
    const state = stateWith([finished('m1', ['a', 'b'], ['c', 'f'], 'A', 11, 9)], { players: players.map((p) => (p.id === 'b' ? twin : p)) })
    expect(buildDuprExport(state, { timeZone: 'UTC' }).skipped[0].reason).toBe('Ana and Ben have the same DUPR ID.')
    const ok = buildDuprExport(stateWith([finished('m1', ['a', 'b'], ['c', 'f'], 'A', 11, 9)]), { timeZone: 'UTC' })
    expect(cellsOf(ok.csv.split('\r\n')[1])[12]).toBe(`"'=Fay"`)
  })

  it('an empty session is a header and nothing else', () => {
    expect(buildDuprExport(stateWith([]), { timeZone: 'UTC' })).toEqual({ csv: TEMPLATE, exported: 0, skipped: [], missingIds: [], sharedIds: [] })
  })
})

describe('skipReason', () => {
  const find = (id: string) => players.find((p) => p.id === id)
  it('names a tie, more than one missing player, and a player who is not in the session', () => {
    expect(skipReason(finished('m', ['a', 'b'], ['c', 'd'], 'A', 10, 10), find)).toBe('DUPR does not accept a tie.')
    const noIds = (id: string) => (id === 'a' ? players[0] : { ...players[1], id, name: id.toUpperCase(), duprId: null })
    expect(skipReason(finished('m', ['a', 'x'], ['y', 'z'], 'A', 11, 3), noIds)).toBe('X, Y and Z have no valid DUPR ID.')
    expect(skipReason(finished('m', ['a', 'b'], ['c', 'ghost'], 'A', 11, 3), find)).toBe('DUPR needs four players in a doubles game.')
  })
})

describe('helpers', () => {
  it('normalizes a time zone and joins names', () => {
    expect(normalizeTimeZone('Europe/Berlin')).toBe('Europe/Berlin')
    expect(normalizeTimeZone(42)).toBe('UTC')
    expect(normalizeTimeZone('')).toBe('UTC')
    expect(localDate('2026-01-05T12:00:00.000Z', 'UTC')).toBe('2026-01-05')
    expect(listNames(['Ana'])).toBe('Ana')
    expect(listNames(['Ana', 'Ben'])).toBe('Ana and Ben')
    expect(listNames(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy')
  })
})
