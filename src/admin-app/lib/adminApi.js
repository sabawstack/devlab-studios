// The admin API client. Every admin screen talks to /api/admin/* through
// here (or through adminFetch, for the legacy editors that read the raw
// Response), so the one place that knows a session can end mid-page is here.

/**
 * ADMIN-05: a session that expires or is revoked while a page is open.
 *
 * A 401 from an admin endpoint (other than the login itself, whose 401 means
 * "wrong password") pauses the request and tells the listeners, which show a
 * sign-in dialog over the current screen. Nothing is unmounted, so whatever
 * the admin was editing is still there. Signing in resolves the pause and the
 * request is sent once more; signing out rejects it.
 *
 * With no listener mounted (unit tests, a page outside the admin app) a 401 is
 * returned or thrown as before.
 */
const listeners = new Set()
let pause = null

export class SessionEndedError extends Error {
  constructor() {
    super('Your admin session ended. Sign in again to continue.')
    this.status = 401
  }
}

/** Subscribes to "the session ended"; returns the unsubscribe function. */
export function onSessionExpired(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The admin signed in again: every paused request is sent once more. */
export function sessionRestored() {
  pause?.resolve()
  pause = null
}

/** The admin chose to sign out instead: every paused request fails. */
export function sessionAbandoned() {
  pause?.reject(new SessionEndedError())
  pause = null
}

function waitForSignIn() {
  if (!pause) {
    let resolve
    let reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    pause = { promise, resolve, reject }
    for (const listener of listeners) listener()
  }
  return pause.promise
}

function pathOf(input) {
  const url = typeof input === 'string' ? input : input?.url ?? ''
  try {
    return new URL(url, 'http://admin.local').pathname
  } catch {
    return ''
  }
}

const isSessionGuarded = (input) => {
  const path = pathOf(input)
  return path.startsWith('/api/admin/') && path !== '/api/admin/login'
}

/**
 * `fetch` for the admin API with the session-expiry handling above. Returns
 * the Response exactly as fetch would; only a 401 from a guarded endpoint is
 * held back until the admin signs in again, then retried once. Retrying is
 * safe: a 401 is answered by the auth gate before any handler runs.
 */
export async function adminFetch(input, init) {
  const response = await fetch(input, init)
  if (response.status !== 401 || !isSessionGuarded(input) || listeners.size === 0) return response
  await waitForSignIn()
  return fetch(input, init)
}

async function request(path, options = {}) {
  const response = await adminFetch(path, {
    credentials: 'include',
    headers: options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  })

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await response.json() : null

  if (!response.ok) {
    const message = (data && data.error) || `Request failed with status ${response.status}`
    const error = new Error(message)
    error.status = response.status
    error.issues = data?.issues
    // Lets a form attach the message to the input the server rejected,
    // instead of only showing a page-level banner.
    error.field = data?.field
    throw error
  }

  return data
}

export const adminApi = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // CRM-01: some DELETE routes need a body (the suppression removal reason).
  delete: (path, body) => request(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body: JSON.stringify(body) }),
  // No Content-Type: the browser must set it itself, because a multipart body
  // is unparseable without the boundary parameter that only it knows. Passing
  // `body` as FormData rather than a string is what keeps `request` from
  // adding the JSON header.
  upload: (path, formData) => request(path, { method: 'POST', body: formData, headers: undefined }),
}
