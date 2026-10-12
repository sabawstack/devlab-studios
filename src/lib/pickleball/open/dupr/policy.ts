// Who may export a session to DUPR, and how often (spec §9.2, §9.6). Pure.

/** Exports are limited to 5 per session in any 24 hours. */
export const DUPR_EXPORT_LIMIT = 5
export const DUPR_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The session's claim as one host sees it: nobody has claimed it, they have,
 * or another account has (which is also what a signed-out host sees for a
 * claimed session: they must sign in with that account).
 */
export type ClaimState = 'UNCLAIMED' | 'MINE' | 'OTHER'

export function claimStateFor(sessionHostId: string | null, signedInHostId: string | null): ClaimState {
  if (!sessionHostId) return 'UNCLAIMED'
  return sessionHostId === signedInHostId ? 'MINE' : 'OTHER'
}

/** The start of the window that counts toward the limit. */
export function exportWindowStart(now: string): string {
  return new Date(Date.parse(now) - DUPR_EXPORT_WINDOW_MS).toISOString()
}

/** How many exports are left, given when the ones in the window were sent. */
export function exportsLeft(sentAt: readonly string[]): number {
  return Math.max(0, DUPR_EXPORT_LIMIT - sentAt.length)
}

/** Whole hours until the oldest counted export leaves the window (at least 1). */
export function hoursUntilNextExport(sentAt: readonly string[], now: string): number {
  const oldest = sentAt.reduce((min, at) => (at < min ? at : min), sentAt[0] ?? now)
  return Math.max(1, Math.ceil((Date.parse(oldest) + DUPR_EXPORT_WINDOW_MS - Date.parse(now)) / 3_600_000))
}

/** Whole seconds until the oldest counted export leaves the window (at least 1): the 429's Retry-After. */
export function secondsUntilNextExport(sentAt: readonly string[], now: string): number {
  const oldest = sentAt.reduce((min, at) => (at < min ? at : min), sentAt[0] ?? now)
  return Math.max(1, Math.ceil((Date.parse(oldest) + DUPR_EXPORT_WINDOW_MS - Date.parse(now)) / 1000))
}

/** When the oldest counted export leaves the window, once none are left; otherwise null. */
export function nextExportAt(sentAt: readonly string[]): string | null {
  if (exportsLeft(sentAt) > 0) return null
  const oldest = sentAt.reduce((min, at) => (at < min ? at : min), sentAt[0])
  return new Date(Date.parse(oldest) + DUPR_EXPORT_WINDOW_MS).toISOString()
}

export function limitMessage(sentAt: readonly string[], now: string): string {
  const hours = hoursUntilNextExport(sentAt, now)
  return `A session can be sent to DUPR ${DUPR_EXPORT_LIMIT} times a day. Try again in about ${hours} hour${hours === 1 ? '' : 's'}.`
}
