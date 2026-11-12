import type { APIRoute } from 'astro'
import { getEnv } from '../../lib/env'
import { checkHealth } from '../../lib/health'

export const prerender = false

export const GET: APIRoute = async () => {
  const { status, body } = await checkHealth(getEnv())
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
