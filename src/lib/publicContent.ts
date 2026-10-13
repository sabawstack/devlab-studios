import { getEnv } from './env'

const PUBLIC_CONTENT_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
}

// A failed read must never be cached: a short D1 outage would otherwise be
// served from the edge (stale-while-revalidate) for up to a day.
const PUBLIC_CONTENT_ERROR_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
}

export function publicJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: PUBLIC_CONTENT_CACHE_HEADERS })
}

/**
 * The fallback answer when a public read fails: the same
 * `{ data, source: 'static-fallback', configured: false }` shape the client
 * hooks already handle, with no error text (D1 messages name tables and
 * columns) and `Cache-Control: no-store`. The error is logged server-side.
 */
export function publicContentFailure(emptyValue: unknown, route: string, error: unknown): Response {
  console.error(JSON.stringify({ event: 'public_content.error', route, error: error instanceof Error ? error.message : 'unknown' }))
  return new Response(JSON.stringify({ data: emptyValue, source: 'static-fallback', configured: false }), {
    status: 200,
    headers: PUBLIC_CONTENT_ERROR_HEADERS,
  })
}

/**
 * Shared shape for every public GET endpoint that falls back to
 * `{ data: null, source: 'static-fallback', configured: false }` when D1
 * is unconfigured or the query fails, matching the client hooks' expected
 * contract (src/hooks/use*Content.js).
 */
export async function servePublicContent<T>(
  loader: (db: D1Database) => Promise<T>,
  emptyValue: T,
  route = 'public-content',
): Promise<Response> {
  const env = getEnv()

  if (!env.DB) {
    return publicJson({ data: emptyValue, source: 'static-fallback', configured: false })
  }

  try {
    const data = await loader(env.DB)
    return publicJson({ data, source: 'd1', configured: true })
  } catch (error) {
    return publicContentFailure(emptyValue, route, error)
  }
}
