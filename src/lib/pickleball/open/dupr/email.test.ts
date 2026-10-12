import { describe, expect, it } from 'vitest'
import { buildDuprEmail, DUPR_CLICK_PATH, duprFilename } from './email'

const base = { hostName: 'Mo', sessionName: 'Sunday <Open>', date: '2026-10-12', clubId: '987654', exported: 3, skipped: [] }

describe('buildDuprEmail', () => {
  it('says how many games are attached, where to upload them and who may upload', () => {
    const email = buildDuprEmail(base)
    expect(email.subject).toBe('DUPR export: Sunday <Open> (2026-10-12)')
    expect(email.text).toContain('is attached: 3 games.')
    expect(email.text).toContain('Club ID 987654')
    expect(email.text).toContain(DUPR_CLICK_PATH)
    expect(email.text).toContain('Club Director or Organizer')
    expect(email.text).toContain('reply to this email')
    expect(email.text).not.toContain('Left out')
  })

  it('lists every skipped game with its reason, in text and HTML', () => {
    const email = buildDuprEmail({ ...base, exported: 1, skipped: [{ game: 2, court: 'Court 1', summary: 'Ana & Eve 11–4 Cy & Di', reason: 'Eve has no valid DUPR ID.' }] })
    expect(email.text).toContain('is attached: 1 game.')
    expect(email.text).toContain('Left out (1 game):')
    expect(email.text).toContain('- Game 2, Court 1: Ana & Eve 11–4 Cy & Di. Eve has no valid DUPR ID.')
    expect(email.html).toContain('Game 2, Court 1: Ana &amp; Eve 11–4 Cy &amp; Di. Eve has no valid DUPR ID.')
  })

  it('escapes everything the host typed in the HTML', () => {
    const email = buildDuprEmail({ ...base, hostName: '<b>Mo</b>' })
    expect(email.html).toContain('Sunday &lt;Open&gt;')
    expect(email.html).toContain('&lt;b&gt;Mo&lt;/b&gt;')
    expect(email.html).not.toContain('<b>Mo</b>')
  })
})

describe('duprFilename', () => {
  it('slugs the session name', () => {
    expect(duprFilename('Sunday Open Play!', '2026-10-12')).toBe('dupr-sunday-open-play-2026-10-12.csv')
    expect(duprFilename('!!!', '2026-10-12')).toBe('dupr-session-2026-10-12.csv')
  })
})
