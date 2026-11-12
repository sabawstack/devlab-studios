import { getSiteSetting } from '../worker/repositories/content.js'
import { findRedirect } from '../worker/repositories/redirects.js'

type Database = Parameters<typeof getSiteSetting>[0]

/**
 * D1 reads made by the middleware on public page requests.
 *
 * Both fail open. They are optional extras around a page that can render on
 * its own (pages fall back to static content when D1 is unavailable), so a D1
 * error here must not take every gated page down with it: maintenance mode
 * reads as "off" and the 404 redirect lookup as "no redirect". The error is
 * still logged so it shows up in Workers logs.
 */
export async function readMaintenanceMode(db: Database | undefined): Promise<boolean> {
  if (!db) return false
  try {
    return Boolean(await getSiteSetting(db, 'maintenance_mode', false))
  } catch (error) {
    console.error('maintenance_mode read failed; serving the page', error)
    return false
  }
}

export async function findRedirectSafely(db: Database | undefined, path: string) {
  if (!db) return null
  try {
    return await findRedirect(db, path)
  } catch (error) {
    console.error('redirect lookup failed; serving the 404', error)
    return null
  }
}
