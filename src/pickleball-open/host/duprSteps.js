// Pure helpers for the DUPR sheet and My sessions (spec §9). Kept out of the
// component files so they are unit-tested and react-refresh stays happy.

const RESULTS = ['ok', 'cancelled', 'unverified', 'failed', 'busy', 'unavailable']

/** What a ?signin= value on the return from Google says, or null. */
export function readSignInResult(search) {
  const value = new URLSearchParams(search || '').get('signin')
  return RESULTS.includes(value) ? value : null
}

export const SIGN_IN_MESSAGES = {
  ok: null,
  cancelled: 'Sign-in was cancelled. Nothing was changed.',
  unverified: 'That Google account has no verified email address, so the export could not be sent to it. Try another account.',
  failed: 'Sign-in did not finish. Try again.',
  busy: 'Too many sign-in attempts from this network. Try again in a few minutes.',
  unavailable: 'Google sign-in is not available right now. Try again later.',
}

/** The page to send the browser to for Google sign-in, coming back to `returnPath`. */
export function signInHref(returnPath, optIn) {
  const query = new URLSearchParams({ return: returnPath })
  if (optIn) query.set('optIn', '1')
  return `/api/pickleball/open/host/sign-in?${query.toString()}`
}

/**
 * Which step of the DUPR sheet to show for a status from GET …/dupr:
 * SIGN_IN, OTHER (linked to another account), CLAIM, CLUB_ID or READY.
 */
export function duprStep(status) {
  if (!status) return 'LOADING'
  if (!status.host) return 'SIGN_IN'
  if (status.claim === 'OTHER') return 'OTHER'
  if (status.claim === 'UNCLAIMED') return 'CLAIM'
  if (!status.host.duprClubId) return 'CLUB_ID'
  return 'READY'
}

export const DUPR_ID_INPUT = /^[A-Za-z0-9]{6}$/
export const CLUB_ID_INPUT = /^[A-Za-z0-9-]{3,20}$/

const games = (n) => `${n} game${n === 1 ? '' : 's'}`

/** One line for the READY step. */
export function exportSummary(status) {
  if (!status.exported) return 'No game can go to DUPR yet: each needs a score and a DUPR ID for all four players.'
  return `${games(status.exported)} can go to DUPR${status.skipped.length ? `; ${games(status.skipped.length)} left out` : ''}.`
}

/** What to say once the export went out (or, in a test environment, did not). */
export function sentMessage(result) {
  if (result.delivery === 'SUPPRESSED') return `Test environment: nothing was emailed. ${games(result.exported)} would have gone to ${result.to}.`
  return `Sent to ${result.to}: ${games(result.exported)}. Upload the file in DUPR.`
}

/**
 * "Next export available at HH:MM." in the device's zone, once no export is
 * left today; otherwise null. `timeZone` is for tests; the device's by default.
 */
export function nextExportLine(status, timeZone = undefined) {
  if (status.exportsLeft > 0 || !status.nextExportAt) return null
  const at = new Date(status.nextExportAt)
  if (Number.isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(at)
  return `Next export available at ${time}.`
}

/**
 * What the public board says to a browser that came back from Google but holds
 * no host key (site storage blocked or cleared), so the DUPR sheet cannot open.
 */
export function boardSignInNotice(result) {
  if (!result) return null
  return result === 'ok' ? 'Signed in. Open your host link to continue.' : SIGN_IN_MESSAGES[result]
}
