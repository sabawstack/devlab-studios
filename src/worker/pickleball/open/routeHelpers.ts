import { normalizePublicCode } from '../../../lib/pickleball/open/codes'
import { jsonResponse } from '../../utils/responses.js'
import type { DoResult } from './OpenSessionDO'

export function openSessionStub(env: Env, code: string) {
  return env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code))
}

export function codeFrom(params: Record<string, string | undefined>): string | null {
  return normalizePublicCode(params.code ?? '')
}

export function hostKeyFrom(request: Request): string | null {
  const key = request.headers.get('X-Host-Key')
  return key && key.length <= 128 ? key : null
}

export function doResponse<T>(result: DoResult<T>): Response {
  return jsonResponse(result.body, result.status)
}

export const notFound = (): Response => jsonResponse({ error: 'Session not found.' }, 404)

/**
 * The only error text an anonymous caller may see. A numeric 4xx `status` on an
 * Error is something our own code set on purpose; everything else (D1, Durable
 * Object RPC, runtime) is logged and replaced with a generic message.
 */
export function openErrorResponse(error: unknown, route: string): Response {
  const status = error instanceof Error ? (error as Error & { status?: unknown }).status : undefined
  if (error instanceof Error && typeof status === 'number' && status >= 400 && status <= 499) {
    return jsonResponse({ error: error.message }, status)
  }
  console.log(JSON.stringify({ event: 'pickleball_open.error', route, error: error instanceof Error ? error.message : 'unknown' }))
  return jsonResponse({ error: 'Something went wrong. Try again.' }, 500)
}
