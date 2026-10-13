// src/pickleball-open/results/savePoster.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  IN_APP_MESSAGE, REVOKE_AFTER_MS, TAP_AND_HOLD, canShareFiles, isTouchPlatform, platformFor, saveLabel, savePoster, sharePoster,
} from './savePoster'

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  fbAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.43.108;]',
  fbIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.37.109;FBBV/612345678;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]',
  messengerAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/460.0.0.36.109;]',
  messengerIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LightSpeed [FBAN/MessengerLiteForiOS;FBAV/460.0.0.43.104;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/0]',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A.240605.024; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36 Instagram 337.0.0.35.102 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 613123456)',
  instagramIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone15,2; iOS 17_5; en_US; en; scale=3.00; 1179x2556; 612345678)',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68',
}

describe('platformFor', () => {
  it.each([
    ['iPhone Safari', UA.iphoneSafari, 5, 'ios'],
    ['iPhone Chrome', UA.iphoneChrome, 5, 'ios'],
    ['iPad asking for the desktop site', UA.ipadDesktop, 5, 'ios'],
    ['macOS Safari', UA.macSafari, 0, 'desktop'],
    ['Android Chrome', UA.androidChrome, 5, 'android'],
    ['Samsung Internet', UA.samsung, 5, 'android'],
    ['Facebook on Android', UA.fbAndroid, 5, 'in-app'],
    ['Facebook on iPhone', UA.fbIos, 5, 'in-app'],
    ['Messenger on Android', UA.messengerAndroid, 5, 'in-app'],
    ['Messenger on iPhone', UA.messengerIos, 5, 'in-app'],
    ['Instagram on Android', UA.instagramAndroid, 5, 'in-app'],
    ['Instagram on iPhone', UA.instagramIos, 5, 'in-app'],
    ['Windows Edge', UA.windowsEdge, 0, 'desktop'],
    ['Windows Edge on a touch laptop', UA.windowsEdge, 10, 'desktop'],
  ])('%s → %s', (_name, userAgent, maxTouchPoints, expected) => {
    expect(platformFor({ userAgent, maxTouchPoints })).toBe(expected)
  })

  it('treats a missing navigator as desktop', () => {
    expect(platformFor(undefined)).toBe('desktop')
  })
})

describe('labels', () => {
  it('names the button for what it does on each platform', () => {
    expect(saveLabel('desktop')).toBe('Download PNG')
    expect(saveLabel('android')).toBe('Download')
    expect(saveLabel('ios')).toBe('Save to Photos')
    expect(saveLabel('in-app')).toBeNull()
  })
  it('only phones and in-app browsers get the tap-and-hold hint', () => {
    expect(isTouchPlatform('desktop')).toBe(false)
    expect(['ios', 'android', 'in-app'].every(isTouchPlatform)).toBe(true)
  })
})

const file = { name: 'cup-results.png', type: 'image/png' }
const blob = { size: 1000, type: 'image/png' }

function fakeDom() {
  const anchors = []
  const doc = {
    body: { appendChild: vi.fn((a) => { a.attached = true }) },
    createElement: vi.fn(() => {
      const a = { click: vi.fn(), remove: vi.fn(function remove() { this.attached = false }), style: {} }
      anchors.push(a)
      return a
    }),
  }
  const url = { createObjectURL: vi.fn(() => 'blob:https://x/1'), revokeObjectURL: vi.fn() }
  const schedule = vi.fn()
  return { anchors, doc, url, schedule }
}

const sharingNav = (share = vi.fn(() => Promise.resolve())) => ({ share, canShare: vi.fn((data) => Array.isArray(data?.files)) })

describe('savePoster', () => {
  it.each(['desktop', 'android'])('%s downloads through a blob: anchor with the filename, then revokes it', async (platform) => {
    const { anchors, doc, url, schedule } = fakeDom()
    const nav = sharingNav()
    const out = await savePoster({ platform, blob, file, filename: 'cup-results.png', nav, doc, url, schedule })
    expect(out).toEqual({ status: 'downloaded', message: '' })
    expect(url.createObjectURL).toHaveBeenCalledWith(blob)
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ href: 'blob:https://x/1', download: 'cup-results.png', attached: false })
    expect(anchors[0].click).toHaveBeenCalledOnce()
    expect(nav.share).not.toHaveBeenCalled()
    expect(url.revokeObjectURL).not.toHaveBeenCalled()
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), REVOKE_AFTER_MS)
    schedule.mock.calls[0][0]()
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:https://x/1')
  })

  it('a download that throws says what to do instead', async () => {
    const { doc, url, schedule } = fakeDom()
    doc.body.appendChild = () => { throw new Error('blocked') }
    const out = await savePoster({ platform: 'desktop', blob, file, filename: 'a.png', nav: {}, doc, url, schedule })
    expect(out.status).toBe('failed')
    expect(out.message).toMatch(/Save image as.*tap and hold/)
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:https://x/1')
  })

  it('iOS opens the share sheet with the file only', async () => {
    const { doc, url, schedule } = fakeDom()
    const nav = sharingNav()
    const out = await savePoster({ platform: 'ios', blob, file, filename: 'a.png', nav, doc, url, schedule })
    expect(out.status).toBe('shared')
    expect(nav.share).toHaveBeenCalledWith({ files: [file] })
    expect(Object.keys(nav.share.mock.calls[0][0])).toEqual(['files'])
    expect(doc.createElement).not.toHaveBeenCalled()
  })

  it('iOS without file sharing explains tap and hold', async () => {
    const { doc, url } = fakeDom()
    const out = await savePoster({ platform: 'ios', blob, file, filename: 'a.png', nav: { userAgent: UA.iphoneSafari }, doc, url })
    expect(out).toEqual({ status: 'manual', message: TAP_AND_HOLD })
    expect(doc.createElement).not.toHaveBeenCalled()
  })

  it('iOS: closing the sheet is silent, a failed share falls back to tap and hold', async () => {
    const { doc, url } = fakeDom()
    const abort = sharingNav(vi.fn(() => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))))
    expect(await savePoster({ platform: 'ios', blob, file, filename: 'a.png', nav: abort, doc, url })).toEqual({ status: 'cancelled', message: '' })
    const denied = sharingNav(vi.fn(() => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) }))
    const out = await savePoster({ platform: 'ios', blob, file, filename: 'a.png', nav: denied, doc, url })
    expect(out.status).toBe('failed')
    expect(out.message).toContain(TAP_AND_HOLD)
  })

  it('in-app browsers attempt nothing and say how to get out', async () => {
    const { doc, url } = fakeDom()
    const nav = sharingNav()
    const out = await savePoster({ platform: 'in-app', blob, file, filename: 'a.png', nav, doc, url })
    expect(out).toEqual({ status: 'manual', message: IN_APP_MESSAGE })
    expect(url.createObjectURL).not.toHaveBeenCalled()
    expect(nav.share).not.toHaveBeenCalled()
  })
})

describe('sharePoster and canShareFiles', () => {
  it('shares the file only', async () => {
    const nav = sharingNav()
    expect(await sharePoster({ nav, file })).toEqual({ status: 'shared', message: '' })
    expect(nav.share).toHaveBeenCalledWith({ files: [file] })
  })
  it('explains when files cannot be shared and never calls share', async () => {
    const nav = { share: vi.fn(), canShare: () => false }
    const out = await sharePoster({ nav, file })
    expect(out.status).toBe('failed')
    expect(out.message).toContain(TAP_AND_HOLD)
    expect(nav.share).not.toHaveBeenCalled()
  })
  it('needs both share and canShare, and survives a canShare that throws', () => {
    expect(canShareFiles({ share: () => {} }, file)).toBe(false)
    expect(canShareFiles({ canShare: () => true }, file)).toBe(false)
    expect(canShareFiles({ share: () => {}, canShare: () => { throw new TypeError('x') } }, file)).toBe(false)
    expect(canShareFiles(sharingNav(), file)).toBe(true)
  })
})
