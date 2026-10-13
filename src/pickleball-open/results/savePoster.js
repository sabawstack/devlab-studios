// src/pickleball-open/results/savePoster.js
// How the results poster leaves the device, per platform. Pure apart from the
// navigator/document/URL handed in, so it is unit-tested with fakes.
//
//   desktop, android  a blob: URL clicked through a temporary <a download>. A
//                     data: URL of ~1 MB is refused or ignored by several mobile
//                     browsers; a blob: URL is not. Downloads are navigations,
//                     which the page's CSP (img-src) does not govern.
//   ios               Safari cannot download into Photos; its share sheet with
//                     the file has "Save Image", so Save opens that.
//   in-app            Facebook/Messenger/Instagram/... WebViews drop downloads
//                     silently, so nothing is attempted: the viewer is told how
//                     to get to a real browser or to tap and hold the poster.
//
// navigator.share needs the click's user activation, so every path calls it
// before its first await.

export const TAP_AND_HOLD = 'Tap and hold the poster, then choose Save to Photos (or Add to Photos).'
export const IN_APP_MESSAGE = 'Open this page in your browser (⋯ menu → Open in browser) to save the poster, or tap and hold the poster to save it.'
const DOWNLOAD_FAILED = "Couldn't download the poster here. Right-click the poster and choose Save image as, or on a phone tap and hold it to save it."
const SHARE_FAILED = `Couldn't share the poster. ${TAP_AND_HOLD}`
const SHARE_UNSUPPORTED = `This browser can't share images. ${TAP_AND_HOLD}`
export const REVOKE_AFTER_MS = 60_000

/** @typedef {'ios' | 'android' | 'in-app' | 'desktop'} Platform */
/** @typedef {{ userAgent?: string, maxTouchPoints?: number, share?: Function, canShare?: Function }} NavigatorLike */
/** @typedef {{ status: 'downloaded' | 'shared' | 'cancelled' | 'manual' | 'failed', message: string }} Outcome */

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|TikTok|musical_ly|Snapchat|; wv\)/i

/** @param {NavigatorLike | undefined} nav @returns {Platform} */
export function platformFor(nav) {
  const ua = nav?.userAgent ?? ''
  if (IN_APP.test(ua)) return 'in-app'
  // iPadOS asks for desktop sites with a Mac user agent; only touch tells them apart.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

/** Asked at click time: the answer can change (permissions, a revoked API). */
export function canShareFiles(nav, file) {
  if (typeof nav?.share !== 'function' || typeof nav?.canShare !== 'function') return false
  try {
    return Boolean(nav.canShare({ files: [file] }))
  } catch {
    return false
  }
}

/** @param {Platform} platform */
export function saveLabel(platform) {
  if (platform === 'ios') return 'Save to Photos'
  if (platform === 'android') return 'Download'
  if (platform === 'in-app') return null
  return 'Download PNG'
}

export const isTouchPlatform = (platform) => platform !== 'desktop'

const ok = (status) => ({ status, message: '' })
const isAbort = (err) => err?.name === 'AbortError'

/** Files only: several share targets drop the image when a title or text rides along. */
function shareFile(nav, file, failure) {
  try {
    return Promise.resolve(nav.share({ files: [file] })).then(
      () => ok('shared'),
      (err) => (isAbort(err) ? ok('cancelled') : { status: 'failed', message: failure }),
    )
  } catch (err) {
    return Promise.resolve(isAbort(err) ? ok('cancelled') : { status: 'failed', message: failure })
  }
}

/** @returns {Outcome} */
export function downloadBlob({ blob, filename, doc, url, schedule }) {
  let href = ''
  try {
    href = url.createObjectURL(blob)
    const anchor = doc.createElement('a')
    anchor.href = href
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    doc.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Long enough for a slow device to start reading the file.
    schedule(() => url.revokeObjectURL(href), REVOKE_AFTER_MS)
    return ok('downloaded')
  } catch {
    if (href) {
      try { url.revokeObjectURL(href) } catch { /* already gone */ }
    }
    return { status: 'failed', message: DOWNLOAD_FAILED }
  }
}

/**
 * The Save/Download button.
 * @param {{ platform: Platform, blob: Blob, file: File, filename: string, nav: NavigatorLike, doc: Document, url: typeof URL, schedule?: typeof setTimeout }} args
 * @returns {Promise<Outcome>}
 */
export function savePoster({ platform, blob, file, filename, nav, doc, url, schedule = setTimeout }) {
  if (platform === 'in-app') return Promise.resolve({ status: 'manual', message: IN_APP_MESSAGE })
  if (platform === 'ios') {
    if (!canShareFiles(nav, file)) return Promise.resolve({ status: 'manual', message: TAP_AND_HOLD })
    return shareFile(nav, file, SHARE_FAILED)
  }
  return Promise.resolve(downloadBlob({ blob, filename, doc, url, schedule }))
}

/**
 * The Share button.
 * @param {{ nav: NavigatorLike, file: File }} args
 * @returns {Promise<Outcome>}
 */
export function sharePoster({ nav, file }) {
  if (!canShareFiles(nav, file)) return Promise.resolve({ status: 'failed', message: SHARE_UNSUPPORTED })
  return shareFile(nav, file, SHARE_FAILED)
}
