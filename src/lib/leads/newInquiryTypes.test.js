import { describe, expect, it } from 'vitest'
import { qualifyInquiry } from './qualification'
import {
  CONTACT_FORM_INQUIRY_TYPES,
  INQUIRY_TYPE_LABELS,
  INQUIRY_TYPES,
  PRODUCT_INQUIRY_TYPES,
  inquiryRequestSchema,
  isBusinessInquiry,
} from '../schemas/inquiry'

// LEAD-02 / BUS-03 / BUS-04: three inquiry types for the recurring Operations
// Care service and the products page.
const base = {
  email: 'dana@example.com', message: 'We would like monitoring and monthly reconciliation for the system you built.',
  company: 'Example Co', website: '', currentWorkflow: '', desiredOutcome: 'Fewer silent failures.',
  currentTools: '', teamSize: '', timeline: 'within_month', budgetRange: '', volume: '',
}

describe('new inquiry types', () => {
  it('exist with labels', () => {
    for (const type of ['operations_care', 'product_interest', 'product_support']) {
      expect(INQUIRY_TYPES).toContain(type)
      expect(INQUIRY_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it('operations_care is a business inquiry and is scored', () => {
    expect(isBusinessInquiry('operations_care')).toBe(true)
    const result = qualifyInquiry({ ...base, inquiryType: 'operations_care' })
    expect(result.route).toBe('business')
    expect(result.result).not.toBe('unscored')
    expect(result.score).toBeGreaterThan(0)
  })

  it.each(['product_interest', 'product_support'])('%s is unscored and routed to a person', (inquiryType) => {
    const result = qualifyInquiry({ ...base, inquiryType })
    expect(result.result).toBe('unscored')
    expect(result.score).toBe(0)
    expect(result.route).toBe('product')
    expect(result.requiresHumanReview).toBe(true)
  })

  it('product types come from the products page, not the contact form select', () => {
    for (const type of PRODUCT_INQUIRY_TYPES) expect(CONTACT_FORM_INQUIRY_TYPES).not.toContain(type)
    expect(CONTACT_FORM_INQUIRY_TYPES).toContain('operations_care')
    expect(CONTACT_FORM_INQUIRY_TYPES).toContain('business_system')
  })

  it('the request schema accepts the new types', () => {
    for (const inquiryType of ['operations_care', 'product_interest', 'product_support']) {
      const parsed = inquiryRequestSchema.safeParse({
        inquiryType,
        fullName: 'Dana Reyes',
        email: 'dana@example.com',
        message: 'A message that is long enough to pass the validation rules for this form.',
        company: 'Example Co',
        desiredOutcome: 'Fewer silent failures.',
        timeline: 'within_month',
        consent: { granted: true, consentTextVersion: '2026-09-17', privacyPolicyVersion: '2026-09-17' },
      })
      expect(parsed.success, `${inquiryType}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
    }
  })
})
