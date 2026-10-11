import { describe, expect, it } from 'vitest'
import { cleanName, parseRoster, parseRosterCsv } from './roster'

describe('cleanName', () => {
  it('strips list markers, emoji, control characters and extra spaces', () => {
    expect(cleanName('1. Ana 🔥')).toBe('Ana')
    expect(cleanName('4) Ivan')).toBe('Ivan')
    expect(cleanName('- Fay')).toBe('Fay')
    expect(cleanName('• Gio ✅')).toBe('Gio')
    expect(cleanName('  Mary   Jo \u0007 ')).toBe('Mary Jo')
    expect(cleanName('2Pac')).toBe('2Pac')
  })

  it('strips skin-tone modifiers and flag letters', () => {
    expect(cleanName('Ana 👍🏽')).toBe('Ana')
    expect(cleanName('Ana 🇵🇭')).toBe('Ana')
  })

  it('strips invisible format characters', () => {
    expect(cleanName('Ana​')).toBe('Ana')
    expect(cleanName('Ana‎')).toBe('Ana')
    expect(cleanName('﻿Ana')).toBe('Ana')
  })

  it('turns tabs into spaces rather than joining the words', () => {
    expect(cleanName('A\tB')).toBe('A B')
  })

  it('caps names at 40 characters', () => {
    expect(cleanName('x'.repeat(60))).toHaveLength(40)
  })
})

describe('parseRoster', () => {
  it('parses a messy list copied from Reclub or WhatsApp', () => {
    const text = '1. Ana 🔥\n2. Ben\n3. Carlo, Dina, Eli\n- Fay\nGio ✅\n\nHana\n4) Ivan\nJun, Kat, Leo, Mia, Nico\nben'
    const result = parseRoster(text)
    expect(result.names).toEqual(['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico'])
    expect(result.duplicates).toEqual(['ben'])
  })

  it('skips names already in the session, case-insensitively', () => {
    expect(parseRoster('Ana\nZed', ['ANA'])).toEqual({ names: ['Zed'], duplicates: ['Ana'] })
  })

  it('returns nothing for blank input', () => {
    expect(parseRoster('  \n , \n')).toEqual({ names: [], duplicates: [] })
  })
})

describe('parseRosterCsv', () => {
  it('reads name, skill and DUPR ID, with or without a header row', () => {
    const csv = 'name,skill,dupr\nAna,4.5,ab12c3\n"Ben",3,\nCarlo,,QX7M2K'
    expect(parseRosterCsv(csv).entries).toEqual([
      { name: 'Ana', skill: 4.5, duprId: 'AB12C3' },
      { name: 'Ben', skill: 3, duprId: null },
      { name: 'Carlo', skill: null, duprId: 'QX7M2K' },
    ])
  })

  it('keeps the player but warns about a bad skill or DUPR ID', () => {
    const result = parseRosterCsv('Ana,12,TOOLONG1')
    expect(result.entries).toEqual([{ name: 'Ana', skill: null, duprId: null }])
    expect(result.warnings).toHaveLength(2)
  })

  it('reports duplicates', () => {
    expect(parseRosterCsv('Ana\nana').duplicates).toEqual(['ana'])
  })

  it('treats a leading byte-order mark as part of the header, not a player', () => {
    expect(parseRosterCsv('﻿name,skill\nAna,4').entries).toEqual([{ name: 'Ana', skill: 4, duprId: null }])
  })
})

describe('parseRoster invisible and emoji duplicates', () => {
  it('reports a skin-toned emoji variant as a duplicate', () => {
    expect(parseRoster('Ana\nAna 👍🏽').duplicates).toHaveLength(1)
  })

  it('reports a name differing only by an invisible mark as a duplicate', () => {
    expect(parseRoster('Ana\nAna‎').duplicates).toHaveLength(1)
  })
})
