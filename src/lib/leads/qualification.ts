import {
  isBusinessInquiry,
  isEmploymentInquiry,
  isProductInquiry,
  type InquiryType,
  type QualificationResult,
} from '../schemas/inquiry'

/**
 * Deterministic, explainable inquiry qualification.
 *
 * Pure function, no I/O, no AI. Every point awarded carries a human-readable
 * reason that is stored alongside the result, so an admin looking at a
 * "priority" lead can always see exactly which signals produced it. AI may
 * later summarize free text for a human to read, but it must never be what
 * decides routing -- that is this file's job, and it is testable.
 *
 * Nothing here is ever shown to the visitor.
 */

export interface QualificationSignals {
  inquiryType: InquiryType
  email: string
  message: string
  company: string
  website: string
  currentWorkflow: string
  desiredOutcome: string
  currentTools: string
  teamSize: string
  timeline: string
  budgetRange: string
  volume: string
}

export interface QualificationReason {
  code: string
  label: string
  points: number
}

export interface Qualification {
  result: QualificationResult
  score: number
  reasons: QualificationReason[]
  /** Which internal queue the inquiry belongs to. Drives notification wording, not permissions. */
  route: 'business' | 'employment' | 'partnership' | 'product' | 'general'
  /** True when a human must look before any automated follow-up is appropriate. */
  requiresHumanReview: boolean
}

/**
 * Free-mailbox providers. A business inquiry from one of these is perfectly
 * legitimate (plenty of small operators use Gmail) -- it just does not earn
 * the extra "verifiable business domain" signal.
 */
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'mail.com',
  'gmx.com',
  'zoho.com',
  'yandex.com',
])

const TIMELINE_POINTS: Record<string, number> = {
  immediate: 30,
  within_month: 25,
  one_to_three_months: 15,
  exploring: 5,
}

const BUDGET_POINTS: Record<string, number> = {
  '15k_plus': 25,
  '5k_15k': 20,
  '2k_5k': 12,
  not_sure: 8,
  under_2k: 5,
}

const TEAM_SIZE_POINTS: Record<string, number> = {
  '200_plus': 8,
  '51_200': 8,
  '11_50': 8,
  '2_10': 5,
  solo: 2,
}

/**
 * Tier boundaries, calibrated against the point table above rather than
 * chosen round numbers. A realistic maximum is ~131, so:
 *
 *   priority (85+)  urgency AND budget AND a specific, detailed problem
 *   standard (55+)  a real project with most of the picture filled in
 *   nurture  (25+)  genuine interest, early stage
 *   review   (<25)  not enough signal to route without a person reading it
 *
 * Raising priority from an earlier 70 was deliberate: at 70 a routine
 * "within a month, $2-5k" inquiry reached the top tier, which makes the tier
 * meaningless for the inquiries it exists to surface.
 */
const PRIORITY_THRESHOLD = 85
const STANDARD_THRESHOLD = 55
const NURTURE_THRESHOLD = 25
/** Below this, there is not enough written context to route automatically. */
const MIN_MESSAGE_LENGTH_FOR_AUTO_ROUTING = 40

function emailDomain(email: string): string {
  return String(email || '').split('@')[1]?.toLowerCase().trim() || ''
}

function isBusinessDomain(email: string): boolean {
  const domain = emailDomain(email)
  return Boolean(domain) && !FREE_EMAIL_DOMAINS.has(domain)
}

export function qualifyInquiry(signals: QualificationSignals): Qualification {
  const reasons: QualificationReason[] = []
  const add = (code: string, label: string, points: number) => {
    if (points !== 0) reasons.push({ code, label, points })
  }

  if (isEmploymentInquiry(signals.inquiryType)) {
    return {
      result: 'unscored',
      score: 0,
      reasons: [
        {
          code: 'employment_route',
          label: 'Employment or collaboration inquiry -- routed to Stephen directly, not business-qualified.',
          points: 0,
        },
      ],
      route: 'employment',
      requiresHumanReview: true,
    }
  }

  if (isProductInquiry(signals.inquiryType)) {
    return {
      result: 'unscored',
      score: 0,
      reasons: [
        {
          code: 'product_route',
          label: 'Product interest or support -- read by a person, not business-qualified.',
          points: 0,
        },
      ],
      route: 'product',
      requiresHumanReview: true,
    }
  }

  if (!isBusinessInquiry(signals.inquiryType)) {
    const route = signals.inquiryType === 'partnership' ? 'partnership' : 'general'
    return {
      result: 'unscored',
      score: 0,
      reasons: [
        {
          code: `${route}_route`,
          label:
            route === 'partnership'
              ? 'Partnership inquiry -- reviewed by a human before any follow-up.'
              : 'General inquiry -- reviewed by a human before any follow-up.',
          points: 0,
        },
      ],
      route,
      requiresHumanReview: true,
    }
  }

  const message = String(signals.message || '').trim()

  const timelinePoints = TIMELINE_POINTS[signals.timeline] ?? 0
  add('timeline', `Timeline: ${signals.timeline || 'not provided'}`, timelinePoints)

  const budgetPoints = BUDGET_POINTS[signals.budgetRange] ?? 0
  add('budget', `Budget range: ${signals.budgetRange || 'not provided'}`, budgetPoints)

  if (message.length >= 200) add('problem_detail', 'Detailed problem description provided.', 15)
  else if (message.length >= 80) add('problem_detail', 'Moderately detailed problem description provided.', 8)

  if (signals.currentWorkflow.trim()) add('current_workflow', 'Current process or tools described.', 10)
  if (signals.desiredOutcome.trim()) add('desired_outcome', 'Desired result described.', 10)
  if (signals.currentTools.trim()) add('current_tools', 'Existing tool stack listed.', 8)
  if (signals.company.trim()) add('company', 'Company or organization provided.', 5)
  if (signals.website.trim()) add('website', 'Website provided.', 5)
  if (signals.volume.trim()) add('volume', 'Lead or workflow volume provided.', 5)

  const teamPoints = TEAM_SIZE_POINTS[signals.teamSize] ?? 0
  add('team_size', `Team size: ${signals.teamSize || 'not provided'}`, teamPoints)

  if (isBusinessDomain(signals.email)) add('business_domain', 'Submitted from a business email domain.', 10)

  if (signals.inquiryType === 'workflow_audit') {
    add('entry_offer', 'Workflow systems audit -- a defined entry engagement.', 10)
  }

  const score = reasons.reduce((total, reason) => total + reason.points, 0)

  // Not enough written context to route confidently, regardless of score:
  // a human reads it first. Deliberately checked AFTER scoring so the
  // reasons list still explains what was and was not present.
  if (message.length < MIN_MESSAGE_LENGTH_FOR_AUTO_ROUTING) {
    reasons.push({
      code: 'insufficient_context',
      label: 'Problem description is too short to route automatically -- flagged for human review.',
      points: 0,
    })
    return { result: 'review', score, reasons, route: 'business', requiresHumanReview: true }
  }

  let result: QualificationResult = 'review'
  if (score >= PRIORITY_THRESHOLD) result = 'priority'
  else if (score >= STANDARD_THRESHOLD) result = 'standard'
  else if (score >= NURTURE_THRESHOLD) result = 'nurture'

  return {
    result,
    score,
    reasons,
    route: 'business',
    requiresHumanReview: result === 'review',
  }
}
