import { z } from 'zod'
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

/**
 * Every number qualification uses, with today's values. An admin can override
 * any of them from the Inquiries screen (site_settings.inquiry_qualification,
 * audit LEAD-04); whatever is not overridden keeps these defaults, and a stored
 * value that fails validation is ignored as a whole.
 *
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
export const DEFAULT_QUALIFICATION_SETTINGS = {
  thresholds: {
    priority: 85,
    standard: 55,
    nurture: 25,
    /** Below this many characters there is not enough written context to route automatically. */
    minMessageLength: 40,
  },
  timelinePoints: {
    immediate: 30,
    within_month: 25,
    one_to_three_months: 15,
    exploring: 5,
  } as Record<string, number>,
  budgetPoints: {
    '15k_plus': 25,
    '5k_15k': 20,
    '2k_5k': 12,
    not_sure: 8,
    under_2k: 5,
  } as Record<string, number>,
  teamSizePoints: {
    '200_plus': 8,
    '51_200': 8,
    '11_50': 8,
    '2_10': 5,
    solo: 2,
  } as Record<string, number>,
  signalPoints: {
    detailedProblem: 15,
    moderateProblem: 8,
    currentWorkflow: 10,
    desiredOutcome: 10,
    currentTools: 8,
    company: 5,
    website: 5,
    volume: 5,
    businessDomain: 10,
    entryOffer: 10,
  },
}

export type QualificationSettings = typeof DEFAULT_QUALIFICATION_SETTINGS

const points = z.number().int().min(0).max(200)
function pointTable(defaults: Record<string, number>) {
  return z.object(Object.fromEntries(Object.keys(defaults).map((key) => [key, points.optional()]))).strict().optional()
}

/** What an admin may store: any subset of the defaults' keys, each a sane integer. */
export const qualificationSettingsOverrideSchema = z.object({
  thresholds: z.object({
    priority: points.optional(),
    standard: points.optional(),
    nurture: points.optional(),
    minMessageLength: z.number().int().min(0).max(5000).optional(),
  }).strict().optional(),
  timelinePoints: pointTable(DEFAULT_QUALIFICATION_SETTINGS.timelinePoints),
  budgetPoints: pointTable(DEFAULT_QUALIFICATION_SETTINGS.budgetPoints),
  teamSizePoints: pointTable(DEFAULT_QUALIFICATION_SETTINGS.teamSizePoints),
  signalPoints: pointTable(DEFAULT_QUALIFICATION_SETTINGS.signalPoints),
}).strict()

export type QualificationSettingsOverride = z.infer<typeof qualificationSettingsOverrideSchema>

/**
 * Defaults with the stored overrides applied. Anything invalid -- a bad shape,
 * or tiers that no longer descend priority > standard > nurture -- falls back
 * to the defaults entirely, so a typo in the admin cannot reshuffle every new
 * inquiry.
 */
export function resolveQualificationSettings(stored: unknown): QualificationSettings {
  const parsed = qualificationSettingsOverrideSchema.safeParse(stored ?? {})
  if (!parsed.success) return DEFAULT_QUALIFICATION_SETTINGS
  const o = parsed.data
  const d = DEFAULT_QUALIFICATION_SETTINGS
  const merged: QualificationSettings = {
    thresholds: { ...d.thresholds, ...definedOnly(o.thresholds) },
    timelinePoints: { ...d.timelinePoints, ...(definedOnly(o.timelinePoints) as Record<string, number>) },
    budgetPoints: { ...d.budgetPoints, ...(definedOnly(o.budgetPoints) as Record<string, number>) },
    teamSizePoints: { ...d.teamSizePoints, ...(definedOnly(o.teamSizePoints) as Record<string, number>) },
    signalPoints: { ...d.signalPoints, ...definedOnly(o.signalPoints) },
  }
  const { priority, standard, nurture } = merged.thresholds
  if (!(priority > standard && standard > nurture)) return DEFAULT_QUALIFICATION_SETTINGS
  return merged
}

function definedOnly<T extends Record<string, unknown>>(value: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined)) as Partial<T>
}

function emailDomain(email: string): string {
  return String(email || '').split('@')[1]?.toLowerCase().trim() || ''
}

function isBusinessDomain(email: string): boolean {
  const domain = emailDomain(email)
  return Boolean(domain) && !FREE_EMAIL_DOMAINS.has(domain)
}

export function qualifyInquiry(
  signals: QualificationSignals,
  settings: QualificationSettings = DEFAULT_QUALIFICATION_SETTINGS,
): Qualification {
  const { thresholds, signalPoints } = settings
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

  const timelinePoints = settings.timelinePoints[signals.timeline] ?? 0
  add('timeline', `Timeline: ${signals.timeline || 'not provided'}`, timelinePoints)

  const budgetPoints = settings.budgetPoints[signals.budgetRange] ?? 0
  add('budget', `Budget range: ${signals.budgetRange || 'not provided'}`, budgetPoints)

  if (message.length >= 200) add('problem_detail', 'Detailed problem description provided.', signalPoints.detailedProblem)
  else if (message.length >= 80) add('problem_detail', 'Moderately detailed problem description provided.', signalPoints.moderateProblem)

  if (signals.currentWorkflow.trim()) add('current_workflow', 'Current process or tools described.', signalPoints.currentWorkflow)
  if (signals.desiredOutcome.trim()) add('desired_outcome', 'Desired result described.', signalPoints.desiredOutcome)
  if (signals.currentTools.trim()) add('current_tools', 'Existing tool stack listed.', signalPoints.currentTools)
  if (signals.company.trim()) add('company', 'Company or organization provided.', signalPoints.company)
  if (signals.website.trim()) add('website', 'Website provided.', signalPoints.website)
  if (signals.volume.trim()) add('volume', 'Lead or workflow volume provided.', signalPoints.volume)

  const teamPoints = settings.teamSizePoints[signals.teamSize] ?? 0
  add('team_size', `Team size: ${signals.teamSize || 'not provided'}`, teamPoints)

  if (isBusinessDomain(signals.email)) add('business_domain', 'Submitted from a business email domain.', signalPoints.businessDomain)

  if (signals.inquiryType === 'workflow_audit') {
    add('entry_offer', 'Workflow systems audit -- a defined entry engagement.', signalPoints.entryOffer)
  }

  const score = reasons.reduce((total, reason) => total + reason.points, 0)

  // Not enough written context to route confidently, regardless of score:
  // a human reads it first. Deliberately checked AFTER scoring so the
  // reasons list still explains what was and was not present.
  if (message.length < thresholds.minMessageLength) {
    reasons.push({
      code: 'insufficient_context',
      label: 'Problem description is too short to route automatically -- flagged for human review.',
      points: 0,
    })
    return { result: 'review', score, reasons, route: 'business', requiresHumanReview: true }
  }

  let result: QualificationResult = 'review'
  if (score >= thresholds.priority) result = 'priority'
  else if (score >= thresholds.standard) result = 'standard'
  else if (score >= thresholds.nurture) result = 'nurture'

  return {
    result,
    score,
    reasons,
    route: 'business',
    requiresHumanReview: result === 'review',
  }
}
