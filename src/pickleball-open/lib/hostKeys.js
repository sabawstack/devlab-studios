// The host key lives in this browser's localStorage so closing the tab never
// costs the host their session (spec §3.3). Every access is guarded: storage
// can be missing or throw (private mode, blocked site data).
const STORAGE_KEY = 'devlab-pickleball-hosted'
const MAX_REMEMBERED = 10

function read() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value)
      ? value.filter((entry) => entry && typeof entry.code === 'string' && typeof entry.hostKey === 'string')
      : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED)))
  } catch {
    // storage unavailable: the host link itself still works
  }
}

export function rememberHostedSession({ code, hostKey, name }) {
  write([{ code, hostKey, name, savedAt: new Date().toISOString() }, ...read().filter((entry) => entry.code !== code)])
}
export function hostKeyFor(code) {
  return read().find((entry) => entry.code === code)?.hostKey ?? null
}
export function hostedSessions() {
  return read()
}
export function forgetHostedSession(code) {
  write(read().filter((entry) => entry.code !== code))
}
export function hostKeyFromHash(hash) {
  const match = /(?:^#|&)host=([A-Za-z0-9_-]+)(?:&|$)/.exec(hash || '')
  return match ? match[1] : null
}
export function hostLink(origin, code, hostKey) {
  return `${origin}/pickleball/s/${code}#host=${hostKey}`
}
export function viewerLink(origin, code) {
  return `${origin}/pickleball/s/${code}`
}
export function checkInLink(origin, code) {
  return `${origin}/pickleball/s/${code}/check-in`
}
