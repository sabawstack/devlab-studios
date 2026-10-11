// src/pickleball-open/lib/captainKeys.js
// A court captain's key, like the host's, travels only in the URL fragment
// (#cap=…) and is kept in this browser's localStorage so a closed tab does not
// cost the captain their court (spec §3.3). Every access is guarded.
const STORAGE_KEY = 'devlab-pickleball-captain'
const MAX_REMEMBERED = 10

function read() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.filter((e) => e && typeof e.code === 'string' && typeof e.captainKey === 'string') : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED)))
  } catch {
    // storage unavailable: the captain link itself still works
  }
}

export function captainKeyFromHash(hash) {
  const match = /(?:^#|&)cap=([A-Za-z0-9_-]+)(?:&|$)/.exec(hash || '')
  return match ? match[1] : null
}
export function rememberCaptainKey(code, captainKey) {
  write([{ code, captainKey }, ...read().filter((e) => e.code !== code)])
}
export function captainKeyFor(code) {
  return read().find((e) => e.code === code)?.captainKey ?? null
}
export function forgetCaptainKey(code) {
  write(read().filter((e) => e.code !== code))
}
export function captainLink(origin, code, captainKey) {
  return `${origin}/pickleball/s/${code}#cap=${captainKey}`
}
