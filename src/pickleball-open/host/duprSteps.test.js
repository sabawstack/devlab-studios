import { describe, expect, it } from 'vitest'
import { duprStep, exportSummary, readSignInResult, sentMessage, signInHref, SIGN_IN_MESSAGES } from './duprSteps'

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
    expect(exportSummary({ exported: 0, skipped: [] })).toMatch(/^No game can go to DUPR yet/)
    expect(exportSummary({ exported: 1, skipped: [] })).toBe('1 game can go to DUPR.')
    expect(exportSummary({ exported: 3, skipped: [{}, {}] })).toBe('3 games can go to DUPR; 2 games left out.')
    expect(sentMessage({ delivery: 'SENT', to: 'mo@example.com', exported: 3 })).toBe('Sent to mo@example.com: 3 games. Upload the file in DUPR.')
    expect(sentMessage({ delivery: 'SUPPRESSED', to: 'mo@example.com', exported: 1 })).toBe('Test environment: nothing was emailed. 1 game would have gone to mo@example.com.')
  })
})
