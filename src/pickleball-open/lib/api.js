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

export async function createSession(input) {
  return parse(await fetch('/api/pickleball/open/sessions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }))
}
export async function fetchViewer(code) {
  return parse(await fetch(`${base(code)}/state`))
}
export async function fetchHost(code, hostKey) {
  return parse(await fetch(`${base(code)}/host`, { headers: { 'X-Host-Key': hostKey } }))
}
export async function postCommand(code, hostKey, envelope) {
  return parse(await fetch(`${base(code)}/commands`, { method: 'POST', headers: { ...JSON_HEADERS, 'X-Host-Key': hostKey }, body: JSON.stringify(envelope) }))
}
export async function downloadResults(code, hostKey) {
  const response = await fetch(`${base(code)}/results.csv`, { headers: { 'X-Host-Key': hostKey } })
  if (!response.ok) throw new ApiError('Could not download results.', response.status)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'results.csv'
  return { blob: await response.blob(), filename }
}
export async function deleteSession(code, hostKey) {
  return parse(await fetch(`${base(code)}/session`, { method: 'DELETE', headers: { 'X-Host-Key': hostKey } }))
}
