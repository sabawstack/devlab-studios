// src/pickleball-open/lib/shareResults.js
// "Share results": the phone's share sheet when it has one, else a copy to the
// clipboard. The text already ends with the board link, so the copy is the text.

/**
 * @param {{ title: string, text: string, url?: string }} data  Results pass no `url`: their text already ends with the link.
 * @param {{ share?: (data: object) => Promise<void>, clipboard?: { writeText: (text: string) => Promise<void> } } | undefined} nav
 * @returns {Promise<{ kind: 'shared' | 'cancelled' | 'copied' | 'failed' }>}
 */
export async function shareResults(data, nav = globalThis.navigator) {
  if (typeof nav?.share === 'function') {
    try {
      await nav.share(data)
      return { kind: 'shared' }
    } catch (error) {
      // Closing the sheet is a choice, not a failure; anything else falls back to copying.
      if (error?.name === 'AbortError') return { kind: 'cancelled' }
    }
  }
  try {
    await nav.clipboard.writeText(data.text)
    return { kind: 'copied' }
  } catch {
    return { kind: 'failed' }
  }
}
