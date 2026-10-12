import { describe, expect, it } from 'vitest'
import { boardSignInNotice, duprStep, exportSummary, nextExportLine, readSignInResult, sentMessage, signInHref, SIGN_IN_MESSAGES } from './duprSteps'

const host = { email: 'mo@example.com', displayName: 'Mo', duprClubId: null, marketingOptIn: false }

describe('readSignInResult', () => {
  it('reads only the outcomes the server sends', () => {
    expect(readSignInResult('?signin=ok')).toBe('ok')
    expect(readSignInResult('?x=1&signin=unverified')).toBe('unverified')
    expect(readSignInResult('?signin=<script>')).toBeNull()
    expect(readSignInResult('')).toBeNull()
    for (const value of ['cancelled', 'unverified', 'failed', 'busy', 'unavailable']) expect(SIGN_IN_MESSAGES[value]).toBeTruthy()
  })
})

describe('signInHref', () => {
  it('carries the return path, and the opt-in only when ticked', () => {
    expect(signInHref('/pickleball/s/ABCDE23456', false)).toBe('/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fs%2FABCDE23456')
    expect(signInHref('/pickleball/my-sessions', true)).toBe('/api/pickleball/open/host/sign-in?return=%2Fpickleball%2Fmy-sessions&optIn=1')
  })
})

describe('duprStep', () => {
  it('walks sign in → link → Club ID → ready, and stops at someone else’s session', () => {
    expect(duprStep(null)).toBe('LOADING')
    expect(duprStep({ host: null, claim: 'UNCLAIMED' })).toBe('SIGN_IN')
    expect(duprStep({ host: null, claim: 'OTHER' })).toBe('SIGN_IN')
    expect(duprStep({ host, claim: 'OTHER' })).toBe('OTHER')
    expect(duprStep({ host, claim: 'UNCLAIMED' })).toBe('CLAIM')
    expect(duprStep({ host, claim: 'MINE' })).toBe('CLUB_ID')
    expect(duprStep({ host: { ...host, duprClubId: '12345' }, claim: 'MINE' })).toBe('READY')
  })
})

describe('messages', () => {
  it('summarises the export and the send', () => {
    expect(exportSummary({ exported: 0, skipped: [] })).toBe('No game can go to DUPR yet. Every game with a valid score (no tie, a team reached 6) and four different DUPR IDs goes in.')
    expect(exportSummary({ exported: 1, skipped: [] })).toBe('1 game can go to DUPR.')
    expect(exportSummary({ exported: 3, skipped: [{}, {}] })).toBe('3 games can go to DUPR; 2 games left out.')
    expect(sentMessage({ delivery: 'SENT', to: 'mo@example.com', exported: 3 })).toBe('Sent to mo@example.com: 3 games. Upload the file in DUPR.')
    expect(sentMessage({ delivery: 'SUPPRESSED', to: 'mo@example.com', exported: 1 })).toBe('Test environment: nothing was emailed. 1 game would have gone to mo@example.com.')
  })
})

describe('nextExportLine', () => {
  it('names the time the next export frees up, in the device’s zone, only when none are left', () => {
    expect(nextExportLine({ exportsLeft: 1, nextExportAt: null }, 'UTC')).toBeNull()
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: null }, 'UTC')).toBeNull()
    const now = new Date('2026-10-12T09:00:00.000Z')
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: '2026-10-12T14:30:00.000Z' }, 'UTC', now)).toBe('Next export available at 14:30.')
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: '2026-10-12T14:30:00.000Z' }, 'Asia/Manila', now)).toBe('Next export available at 22:30.')
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: 'not a date' }, 'UTC', now)).toBeNull()
  })

  it('says tomorrow when the next export falls on a later date where the device is', () => {
    const now = new Date('2026-10-12T20:00:00.000Z')
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: '2026-10-13T08:15:00.000Z' }, 'UTC', now)).toBe('Next export available tomorrow at 08:15.')
    // 04:00 in Manila is already the 13th; 16:15 the same day there is not tomorrow.
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: '2026-10-13T08:15:00.000Z' }, 'Asia/Manila', now)).toBe('Next export available at 16:15.')
    // In Los Angeles it is still the 12th at 13:00; 01:15 on the 13th is tomorrow.
    expect(nextExportLine({ exportsLeft: 0, nextExportAt: '2026-10-13T08:15:00.000Z' }, 'America/Los_Angeles', now)).toBe('Next export available tomorrow at 01:15.')
  })
})

describe('boardSignInNotice', () => {
  it('tells a browser without the host key to open the host link', () => {
    expect(boardSignInNotice(null)).toBeNull()
    expect(boardSignInNotice('ok')).toBe('Signed in. Open your host link to continue.')
    expect(boardSignInNotice('cancelled')).toBe(SIGN_IN_MESSAGES.cancelled)
  })
})
