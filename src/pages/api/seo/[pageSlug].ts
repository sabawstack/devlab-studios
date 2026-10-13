import type { APIRoute } from 'astro'
import { getSeoMetadata } from '../../../worker/repositories/content.js'
import { getEnv } from '../../../lib/env'
import { publicContentFailure, publicJson } from '../../../lib/publicContent'

export const GET: APIRoute = async ({ params }) => {
  const env = getEnv()

  if (!env.DB) {
    return publicJson({ data: null, source: 'static-fallback', configured: false })
  }

  try {
    const data = await getSeoMetadata(env.DB, params.pageSlug as string)
    return publicJson({ data, source: data ? 'd1' : 'static-fallback', configured: Boolean(data) })
  } catch (error) {
    return publicContentFailure(null, 'seo', error)
  }
}
