import type { APIRoute } from 'astro'
import { getServicesContent } from '../../worker/repositories/content.js'
import { servePublicContent } from '../../lib/publicContent'

export const GET: APIRoute = () => servePublicContent(getServicesContent, null, 'services')
