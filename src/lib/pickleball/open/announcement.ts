// src/lib/pickleball/open/announcement.ts
// The welcome message (settings.announcement): plain text the host writes, shown
// under the session name on the board, the check-in page and the TV. Emoji are
// welcome; line breaks and invisible characters are not.
import { LIMITS, type OpenSessionState } from './types'

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g
// Invisible format characters (bidi overrides, zero-width space…), except the
// zero-width joiner that holds multi-person and flag emoji together.
const FORMAT = /(?!\u200D)\p{Cf}/gu
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/

const SUFFIX: Record<OpenSessionState['kind'], string> = {
  OPEN_PLAY: '! Check the board for your court, play fair and have fun.',
  TOURNAMENT: '! Check the board for your next game, and good luck!',
}
const LEAD = 'Welcome to '
const ELLIPSIS = '…'

/** The first `max` UTF-16 units, never ending on half an emoji. */
function safeSlice(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max).replace(HIGH_SURROGATE, '')
}

/** One line of plain text, trimmed and capped at 140 characters; '' means no message. */
export function cleanAnnouncement(raw: string): string {
  const flat = raw.replace(CONTROL, ' ').replace(FORMAT, '').replace(/\s+/g, ' ').trim()
  return safeSlice(flat, LIMITS.maxAnnouncementLength).trimEnd()
}

/** The message a new session starts with, worded for its kind; the name part is shortened to fit 140. */
export function defaultAnnouncement(kind: OpenSessionState['kind'], sessionName: string): string {
  const suffix = SUFFIX[kind]
  const name = cleanAnnouncement(sessionName)
  if (!name) return `Welcome${suffix}`
  const full = `${LEAD}${name}${suffix}`
  if (full.length <= LIMITS.maxAnnouncementLength) return full
  const room = LIMITS.maxAnnouncementLength - LEAD.length - suffix.length - ELLIPSIS.length
  return `${LEAD}${safeSlice(name, room).trimEnd()}${ELLIPSIS}${suffix}`
}
