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
