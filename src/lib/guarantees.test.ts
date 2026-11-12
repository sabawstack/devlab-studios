import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard tests for guarantees in the audit's Section L that are enforced by
 * which helper a route calls (TEST-01). Each fails if a route stops calling
 * the fail-closed helper, so the regression is caught before it ships rather
 * than found in a review. The helpers' own behaviour is tested beside them
 * (rateLimit.test.js, lead-engine/outbox/auth.test.js).
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return /\.(ts|js)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

const read = (path: string) => readFileSync(path, 'utf8')

describe('anonymous open-play writes fail closed without a working rate limiter', () => {
  it('session creation uses the strict limiter and answers 503 when it is unavailable', () => {
    const source = read('src/pages/api/pickleball/open/sessions.ts')
    expect(source).toMatch(/checkRateLimitStrict\(env, 'open-create'/)
    expect(source).toMatch(/if \(rate\.unavailable\)/)
  })

  it('self check-in goes through checkInIpLimited, which uses the strict limiter', () => {
    expect(read('src/pages/api/pickleball/open/s/[code]/check-in.ts')).toMatch(/checkInIpLimited\(/)
    const helper = read('src/worker/pickleball/open/routeHelpers.ts')
    const body = helper.slice(helper.indexOf('export async function checkInIpLimited'))
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/checkRateLimitStrict\(/)
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/rate\.unavailable\) return jsonResponse\([^)]*503\)/)
  })
})

describe('outbox endpoints refuse every request without their bearer token', () => {
  const routes = [
    ...filesUnder('src/pages/api/lead-engine').filter((path) => /outbox/.test(path)),
    ...filesUnder('src/pages/api/mailbox').filter((path) => /outbox/.test(path)),
  ]

  it('finds the outbox routes', () => {
    expect(routes.length).toBeGreaterThanOrEqual(7)
  })

  it.each(routes)('%s authorizes before it reads or writes anything', (path) => {
    const source = read(path)
    const handlers = [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)]
    expect(handlers.length).toBeGreaterThan(0)
    // One authorization call per handler, each answered before the handler goes on.
    const authCalls = source.match(/authorize(?:Outbox|Bearer)Request\(/g) ?? []
    expect(authCalls.length).toBeGreaterThanOrEqual(handlers.length)
    expect(source).toMatch(/if \(!auth\.ok\) return auth\.response/)
    if (path.includes('mailbox')) expect(source).toMatch(/'MAILBOX_OUTBOX_TOKEN'/)
  })

  it('the lead-engine wrapper checks LEAD_OUTBOX_TOKEN with the same fail-closed check', () => {
    const auth = read('src/lead-engine/outbox/auth.js')
    const wrapper = auth.slice(auth.indexOf('export function authorizeOutboxRequest'))
    expect(wrapper.slice(0, wrapper.indexOf('\n}'))).toMatch(/LEAD_OUTBOX_TOKEN/)
  })
})
