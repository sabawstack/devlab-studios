// src/pickleball-open/lib/api.js
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function parse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error || 'Something went wrong. Try again.', response.status)
  return body
}

const base = (code) => `/api/pickleball/open/s/${code}`

/** Headers for whichever key this screen holds: the host's or a court captain's. */
export function authHeaders({ hostKey = null, captainKey = null } = {}) {
  return { ...(hostKey ? { 'X-Host-Key': hostKey } : {}), ...(captainKey ? { 'X-Captain-Key': captainKey } : {}) }
}

export async function createSession(input) {
  return parse(await fetch('/api/pickleball/open/sessions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }))
}
export async function fetchViewer(code) {
  return parse(await fetch(`${base(code)}/state`))
}
export async function fetchHost(code, hostKey) {
  return parse(await fetch(`${base(code)}/host`, { headers: authHeaders({ hostKey }) }))
}
export async function fetchCaptain(code, captainKey) {
  return parse(await fetch(`${base(code)}/captain`, { headers: authHeaders({ captainKey }) }))
}
export async function postCommand(code, credentials, envelope) {
  return parse(await fetch(`${base(code)}/commands`, { method: 'POST', headers: { ...JSON_HEADERS, ...authHeaders(credentials) }, body: JSON.stringify(envelope) }))
}
export async function createCaptainLink(code, hostKey, body) {
  return parse(await fetch(`${base(code)}/captains`, { method: 'POST', headers: { ...JSON_HEADERS, ...authHeaders({ hostKey }) }, body: JSON.stringify(body) }))
}
export async function revokeCaptainLink(code, hostKey, captainId) {
  return parse(await fetch(`${base(code)}/captains/${encodeURIComponent(captainId)}`, { method: 'DELETE', headers: authHeaders({ hostKey }) }))
}
export async function downloadResults(code, hostKey) {
  const response = await fetch(`${base(code)}/results.csv`, { headers: authHeaders({ hostKey }) })
  if (!response.ok) throw new ApiError('Could not download results.', response.status)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'results.csv'
  return { blob: await response.blob(), filename }
}
export async function deleteSession(code, hostKey) {
  return parse(await fetch(`${base(code)}/session`, { method: 'DELETE', headers: authHeaders({ hostKey }) }))
}
export async function checkIn(code, body) {
  return parse(await fetch(`${base(code)}/check-in`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }))
}
