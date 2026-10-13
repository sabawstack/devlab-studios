import type { APIRoute } from 'astro'
import { getProfileContent } from '../../worker/repositories/content.js'
import { servePublicContent } from '../../lib/publicContent'

export const GET: APIRoute = () => servePublicContent(getProfileContent, null, 'profile-content')
