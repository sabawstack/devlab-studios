import { describe, it, expect } from 'vitest'
import { qualifyInquiry } from './qualification'

/**
 * Qualification must stay deterministic and explainable. These tests exist so
 * a future change cannot quietly make routing depend on something that is not
 * written down, and so every tier boundary has a named example.
 */

function signals(overrides = {}) {
  return {
    inquiryType: 'business_system',
    email: 'dana@acme.co',
    message: 'Inquiries land in a shared inbox and follow-up depends on someone remembering to check it.',
    company: 'Acme Co',
    website: 'https://acme.co',
    currentWorkflow: '',
    desiredOutcome: '',
    currentTools: '',
    teamSize: '',
    timeline: '',
    budgetRange: '',
    volume: '',
    ...overrides,
  }
}

describe('qualifyInquiry — non-business routes', () => {
  it('never business-scores an employment inquiry', () => {
    const result = qualifyInquiry(signals({ inquiryType: 'employment_opportunity' }))
    expect(result.result).toBe('unscored')
    expect(result.score).toBe(0)
    expect(result.route).toBe('employment')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('never business-scores a contract collaboration inquiry', () => {
    const result = qualifyInquiry(signals({ inquiryType: 'contract_collaboration' }))
    expect(result.route).toBe('employment')
    expect(result.result).toBe('unscored')
  })

  it('routes a partnership to a human without scoring it', () => {
    const result = qualifyInquiry(signals({ inquiryType: 'partnership' }))
    expect(result.route).toBe('partnership')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('routes a general inquiry to a human without scoring it', () => {
    const result = qualifyInquiry(signals({ inquiryType: 'general' }))
    expect(result.route).toBe('general')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('always attaches a reason, even when the score is zero', () => {
    const result = qualifyInquiry(signals({ inquiryType: 'general' }))
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.reasons[0].label).toBeTruthy()
  })
})

describe('qualifyInquiry — business tiers', () => {
  it('tiers a complete, urgent, well-funded inquiry as priority', () => {
    const result = qualifyInquiry(
      signals({
        timeline: 'immediate',
        budgetRange: '15k_plus',
        message: 'x'.repeat(220),
        currentWorkflow: 'Everything runs through a shared inbox and a spreadsheet.',
        desiredOutcome: 'One system that captures, routes, and tracks every inquiry.',
        currentTools: 'HubSpot, Google Sheets, Gmail',
        teamSize: '11_50',
        volume: '~200 leads / month',
      }),
    )
    expect(result.result).toBe('priority')
    expect(result.score).toBeGreaterThanOrEqual(85)
  })

  it('tiers a moderately complete inquiry as standard', () => {
    const result = qualifyInquiry(
      signals({
        timeline: 'within_month',
        budgetRange: '2k_5k',
        message: 'x'.repeat(100),
        desiredOutcome: 'Faster first response.',
      }),
    )
    expect(result.result).toBe('standard')
    expect(result.score).toBeGreaterThanOrEqual(55)
    expect(result.score).toBeLessThan(85)
  })

  it('tiers an early-stage but specific inquiry as nurture', () => {
    const result = qualifyInquiry(
      signals({
        timeline: 'exploring',
        budgetRange: 'not_sure',
        website: '',
        desiredOutcome: 'Stop re-typing the same customer details into three tools.',
        message: 'We are still scoping this, but the duplicate data entry between our form and the CRM is the pain.',
      }),
    )
    expect(result.result).toBe('nurture')
    expect(result.score).toBeGreaterThanOrEqual(25)
    expect(result.score).toBeLessThan(55)
  })

  it('sends an inquiry with almost no usable signal to review rather than nurture', () => {
    const result = qualifyInquiry(
      signals({
        timeline: 'exploring',
        budgetRange: '',
        email: 'someone@gmail.com',
        website: '',
        company: '',
        message: 'We might want to automate something at some point this year, not sure what yet.',
      }),
    )
    expect(result.result).toBe('review')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('sends a too-short description to human review regardless of other signals', () => {
    const result = qualifyInquiry(
      signals({ message: 'call me', timeline: 'immediate', budgetRange: '15k_plus' }),
    )
    expect(result.result).toBe('review')
    expect(result.requiresHumanReview).toBe(true)
    expect(result.reasons.some((reason) => reason.code === 'insufficient_context')).toBe(true)
  })
})

describe('qualifyInquiry — explainability', () => {
  it('records a reason for every point it awards, summing to the score', () => {
    const result = qualifyInquiry(signals({ timeline: 'immediate', budgetRange: '5k_15k' }))
    const total = result.reasons.reduce((sum, reason) => sum + reason.points, 0)
    expect(total).toBe(result.score)
  })

  it('credits a business email domain but not a free mailbox', () => {
    const business = qualifyInquiry(signals({ timeline: 'within_month' }))
    const free = qualifyInquiry(signals({ timeline: 'within_month', email: 'dana@gmail.com' }))
    expect(business.reasons.some((reason) => reason.code === 'business_domain')).toBe(true)
    expect(free.reasons.some((reason) => reason.code === 'business_domain')).toBe(false)
    expect(business.score).toBeGreaterThan(free.score)
  })

  it('is a pure function — the same input always produces the same result', () => {
    const input = signals({ timeline: 'immediate', budgetRange: '5k_15k' })
    expect(qualifyInquiry(input)).toEqual(qualifyInquiry(input))
  })

  it('credits the workflow audit as a defined entry engagement', () => {
    const audit = qualifyInquiry(signals({ inquiryType: 'workflow_audit', timeline: 'within_month' }))
    expect(audit.reasons.some((reason) => reason.code === 'entry_offer')).toBe(true)
  })
})

// LEAD-04: thresholds and weights are admin-editable, today's values the default.
describe('qualification settings', () => {
  it('defaults reproduce the built-in behaviour exactly', async () => {
    const { DEFAULT_QUALIFICATION_SETTINGS, resolveQualificationSettings } = await import('./qualification')
    expect(resolveQualificationSettings(undefined)).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(resolveQualificationSettings({})).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(DEFAULT_QUALIFICATION_SETTINGS.thresholds).toEqual({ priority: 85, standard: 55, nurture: 25, minMessageLength: 40 })
  })

  it('a lowered threshold changes the tier of the same inquiry', async () => {
    const { resolveQualificationSettings } = await import('./qualification')
    const inquiry = signals({ timeline: 'within_month', budgetRange: '2k_5k', desiredOutcome: 'Every inquiry gets an owner.' })
    const before = qualifyInquiry(inquiry)
    expect(before.result).toBe('standard')
    const after = qualifyInquiry(inquiry, resolveQualificationSettings({ thresholds: { priority: before.score } }))
    expect(after.result).toBe('priority')
    expect(after.score).toBe(before.score)
  })

  it('a changed weight changes the score and is explained in the reasons', async () => {
    const { resolveQualificationSettings } = await import('./qualification')
    const inquiry = signals({ timeline: 'immediate' })
    const result = qualifyInquiry(inquiry, resolveQualificationSettings({ timelinePoints: { immediate: 50 } }))
    expect(result.reasons.find((reason) => reason.code === 'timeline').points).toBe(50)
  })

  it('ignores a stored value that is malformed or reorders the tiers', async () => {
    const { DEFAULT_QUALIFICATION_SETTINGS, resolveQualificationSettings } = await import('./qualification')
    expect(resolveQualificationSettings({ thresholds: { priority: 'high' } })).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(resolveQualificationSettings({ thresholds: { standard: 90 } })).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(resolveQualificationSettings({ unknownKey: 1 })).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
    expect(resolveQualificationSettings({ timelinePoints: { someday: 5 } })).toEqual(DEFAULT_QUALIFICATION_SETTINGS)
  })
})
