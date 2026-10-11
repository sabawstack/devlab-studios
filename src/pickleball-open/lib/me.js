// "I'm …" on the board, remembered per session on this phone only (spec §7).
// Shared by the board and the check-in page, which sets it for the player.
const ME_KEY = (code) => `devlab-pickleball-me:${code}`

export function readMe(code) {
  try {
    return globalThis.localStorage?.getItem(ME_KEY(code)) ?? ''
  } catch {
    return ''
  }
}

export function writeMe(code, playerId) {
  try {
    globalThis.localStorage?.setItem(ME_KEY(code), playerId)
  } catch {
    // optional convenience: the board still works without it
  }
}
