import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminApi, adminFetch, onSessionExpired, sessionAbandoned, sessionRestored } from './adminApi'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('adminApi', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // CRM-01: the suppression route needs { reason } in a DELETE body; the
  // client used to drop it, so removing a suppression always answered 400.
  it('delete sends an optional JSON body', async () => {
    await adminApi.delete('/api/admin/lead-crm/suppression?id=s1', { reason: 'Added by mistake' })
    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/admin/lead-crm/suppression?id=s1')
    expect(options.method).toBe('DELETE')
    expect(options.body).toBe(JSON.stringify({ reason: 'Added by mistake' }))
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(options.credentials).toBe('include')
  })

  it('delete without a body sends no body and no JSON header (every other caller)', async () => {
    await adminApi.delete('/api/admin/digests/d1')
    const [, options] = fetchMock.mock.calls[0]
    expect(options.method).toBe('DELETE')
    expect(options.body).toBeUndefined()
    expect(options.headers).toBeUndefined()
  })

  it('a failed request throws with the server message, status and field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Give a reason.', field: 'reason' }, 400))
    await expect(adminApi.delete('/x', {})).rejects.toMatchObject({ message: 'Give a reason.', status: 400, field: 'reason' })
  })
})

// ADMIN-05: a session that ends while a page is open.
describe('adminApi when the session ends mid-page', () => {
  let fetchMock
  let stop
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    vi.unstubAllGlobals()
  })

  it('pauses on a 401, tells the listener once, and retries after sign-in', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'Admin login is required.' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'Admin login is required.' }, 401))
      .mockImplementation(async () => jsonResponse({ saved: true }))
    const expired = vi.fn()
    stop = onSessionExpired(expired)
    const first = adminApi.put('/api/admin/content/seo', { title: 'Kept' })
    const second = adminApi.get('/api/admin/leads')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(expired).toHaveBeenCalledTimes(1)
    sessionRestored()
    await expect(first).resolves.toEqual({ saved: true })
    await expect(second).resolves.toEqual({ saved: true })
    // The retried PUT carries the same body.
    expect(fetchMock.mock.calls[2][1].body).toBe(JSON.stringify({ title: 'Kept' }))
  })

  it('signing out instead fails the paused request with a 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Admin login is required.' }, 401))
    stop = onSessionExpired(() => {})
    const pending = adminApi.get('/api/admin/leads')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    sessionAbandoned()
    await expect(pending).rejects.toMatchObject({ status: 401 })
  })

  it('a wrong password at /api/admin/login is not treated as an expired session', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Invalid email or password.' }, 401))
    const expired = vi.fn()
    stop = onSessionExpired(expired)
    const response = await adminFetch('/api/admin/login', { method: 'POST' })
    expect(response.status).toBe(401)
    expect(expired).not.toHaveBeenCalled()
  })

  it('without a listener a 401 is returned as before', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Admin login is required.' }, 401))
    await expect(adminApi.get('/api/admin/leads')).rejects.toMatchObject({ status: 401 })
  })
})

