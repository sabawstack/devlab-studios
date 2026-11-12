import { COMPANY, publicContactEmail } from '../../config/company.js'

/** Keys that hold personal data which never belongs on a public page. */
const PRIVATE_KEY = /phone|mobile|birth|dob\b/i

/**
 * The founder profile as it may be shown publicly (audit PROF-02). Applied on
 * the read path, so personal details stored in the CMS (or in an older D1 row)
 * cannot reach the page: phone numbers and dates of birth are dropped, a
 * personal mailbox becomes the business address, and a street-level location
 * (anything carrying a postal code or house number) becomes city-level.
 */
export function toPublicAbout<T extends Record<string, unknown>>(about: T | null | undefined): Partial<T> {
  if (!about) return {}
  const entries = Object.entries(about).filter(([key]) => !PRIVATE_KEY.test(key))
  const result = Object.fromEntries(entries) as Record<string, unknown>
  if ('email' in about) result.email = publicContactEmail(about.email as string)
  if (typeof about.location === 'string' && /\d/.test(about.location)) result.location = COMPANY.locationLabel
  return result as Partial<T>
}
