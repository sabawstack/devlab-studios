import { describe, expect, it } from 'vitest'
import { cleanAnnouncement, defaultAnnouncement } from './announcement'
import { LIMITS } from './types'

describe('defaultAnnouncement', () => {
  it('welcomes players by session name, worded for open play or a tournament', () => {
    expect(defaultAnnouncement('OPEN_PLAY', 'Sunday Open Play'))
      .toBe('Welcome to Sunday Open Play! Check the board for your court, play fair and have fun.')
    expect(defaultAnnouncement('TOURNAMENT', 'Club Cup'))
      .toBe('Welcome to Club Cup! Check the board for your next game, and good luck!')
  })

  it('trims the name, and drops it when there is none', () => {
    expect(defaultAnnouncement('OPEN_PLAY', '  Friday  ')).toBe('Welcome to Friday! Check the board for your court, play fair and have fun.')
    expect(defaultAnnouncement('TOURNAMENT', '   ')).toBe('Welcome! Check the board for your next game, and good luck!')
  })

  it('shortens the name part, never the rest, when the message would pass 140 characters', () => {
    for (const kind of ['OPEN_PLAY', 'TOURNAMENT'] as const) {
      const message = defaultAnnouncement(kind, 'Very Long Name '.repeat(10))
      expect(message.length).toBeLessThanOrEqual(LIMITS.maxAnnouncementLength)
      expect(message).toMatch(/^Welcome to Very Long Name .*…! Check the board/)
      expect(message.endsWith(kind === 'OPEN_PLAY' ? 'play fair and have fun.' : 'and good luck!')).toBe(true)
    }
  })

  it('never splits an emoji when it shortens the name', () => {
    const message = defaultAnnouncement('OPEN_PLAY', '🏓'.repeat(60))
    expect(message.length).toBeLessThanOrEqual(LIMITS.maxAnnouncementLength)
    expect(message).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

describe('cleanAnnouncement', () => {
  it('trims, keeps emoji, and turns line breaks and tabs into single spaces', () => {
    expect(cleanAnnouncement('  Hello\n\nall\tof you 👋🏽  ')).toBe('Hello all of you 👋🏽')
    expect(cleanAnnouncement('Family 👨‍👩‍👧 night')).toBe('Family 👨‍👩‍👧 night')
  })

  it('drops invisible control characters', () => {
    expect(cleanAnnouncement('Hi\u0000 \u202Ethere\u200B')).toBe('Hi there')
  })

  it('an empty or blank message means no message', () => {
    expect(cleanAnnouncement('')).toBe('')
    expect(cleanAnnouncement('   \n ')).toBe('')
  })

  it('caps the length at 140 without splitting an emoji', () => {
    expect(cleanAnnouncement('a'.repeat(200))).toHaveLength(140)
    const capped = cleanAnnouncement(`${'a'.repeat(139)}🏓`)
    expect(capped).toBe('a'.repeat(139))
  })
})
