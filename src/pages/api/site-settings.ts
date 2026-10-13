import type { APIRoute } from 'astro'
import { getSiteSettingsContent } from '../../worker/repositories/content.js'
import { servePublicContent } from '../../lib/publicContent'

export const GET: APIRoute = () => servePublicContent(getSiteSettingsContent, null, 'site-settings')
