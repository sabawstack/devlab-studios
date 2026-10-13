import type { APIRoute } from 'astro'
import { getResourcesContent } from '../../worker/repositories/content.js'
import { servePublicContent } from '../../lib/publicContent'

export const GET: APIRoute = () => servePublicContent(getResourcesContent, null, 'articles')
