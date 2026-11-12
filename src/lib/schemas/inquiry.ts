import { z } from 'zod'

/**
 * The single validation authority for every public inquiry submission.
 *
 * One schema file, consumed by four surfaces that must never disagree: the
 * React forms (client-side pre-validation), `/api/inquiries` (the real
 * server-side gate), the repository write path, and the tests. Adding a
 * field means adding it here first.
 */

export const INQUIRY_TYPES = [
  'business_system',
  'software_project',
  'workflow_audit',
  'employment_opportunity',
  'contract_collaboration',
  'partnership',
  'general',
  'operations_care',
  'product_interest',
  'product_support',
] as const
export const inquiryTypeSchema = z.enum(INQUIRY_TYPES)
export type InquiryType = z.infer<typeof inquiryTypeSchema>

/** Inquiry types routed through the business qualification form. */
export const BUSINESS_INQUIRY_TYPES: InquiryType[] = ['business_system', 'software_project', 'workflow_audit', 'operations_care']
/** Interest in, or support for, a DevLab product. Never business-scored; a person reads them. */
export const PRODUCT_INQUIRY_TYPES: InquiryType[] = ['product_interest', 'product_support']
/**
 * The types the contact form's select offers. Product inquiries come from the
 * products page with the product named, so they are not offered here.
 */
export const CONTACT_FORM_INQUIRY_TYPES: InquiryType[] = INQUIRY_TYPES.filter(
  (type) => !PRODUCT_INQUIRY_TYPES.includes(type),
)

export function isProductInquiry(type: InquiryType): boolean {
  return PRODUCT_INQUIRY_TYPES.includes(type)
}
/** Inquiry types routed through the employment form -- deliberately NOT business-qualified. */
export const EMPLOYMENT_INQUIRY_TYPES: InquiryType[] = ['employment_opportunity', 'contract_collaboration']

export function isBusinessInquiry(type: InquiryType): boolean {
  return BUSINESS_INQUIRY_TYPES.includes(type)
}

export function isEmploymentInquiry(type: InquiryType): boolean {
  return EMPLOYMENT_INQUIRY_TYPES.includes(type)
}

export const INQUIRY_TYPE_LABELS: Record<InquiryType, string> = {
  business_system: 'Business system or automation',
  software_project: 'Website or software project',
  workflow_audit: 'Workflow systems audit',
  employment_opportunity: 'Employment opportunity',
  contract_collaboration: 'Contract or technical collaboration',
  partnership: 'Partnership',
  general: 'General inquiry',
  operations_care: 'Operations Care (ongoing monitoring and support)',
  product_interest: 'Product interest',
  product_support: 'Product support',
}

export const PIPELINE_STATUSES = ['new', 'in_review', 'qualified', 'contacted', 'won', 'lost', 'archived'] as const
export const pipelineStatusSchema = z.enum(PIPELINE_STATUSES)
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>

export const QUALIFICATION_RESULTS = ['unscored', 'priority', 'standard', 'nurture', 'review'] as const
export const qualificationResultSchema = z.enum(QUALIFICATION_RESULTS)
export type QualificationResult = z.infer<typeof qualificationResultSchema>

export const TIMELINE_OPTIONS = ['immediate', 'within_month', 'one_to_three_months', 'exploring'] as const
export const TEAM_SIZE_OPTIONS = ['solo', '2_10', '11_50', '51_200', '200_plus'] as const
export const BUDGET_OPTIONS = ['not_sure', 'under_2k', '2k_5k', '5k_15k', '15k_plus'] as const
export const PREFERRED_CONTACT_OPTIONS = ['email', 'phone', 'video_call'] as const
export const EMPLOYMENT_TYPE_OPTIONS = ['full_time', 'part_time', 'contract', 'freelance'] as const
export const WORK_ARRANGEMENT_OPTIONS = ['remote', 'hybrid', 'onsite'] as const
export const HIRING_TIMELINE_OPTIONS = ['immediate', 'within_month', 'one_to_three_months', 'exploring'] as const

/** Visible labels live beside their values so the form and the stored enum cannot drift. */
export const OPTION_LABELS = {
  timeline: {
    immediate: 'As soon as possible',
    within_month: 'Within a month',
    one_to_three_months: 'One to three months',
    exploring: 'Still exploring',
  },
  teamSize: {
    solo: 'Just me',
    '2_10': '2-10 people',
    '11_50': '11-50 people',
    '51_200': '51-200 people',
    '200_plus': '200+ people',
  },
  budgetRange: {
    not_sure: 'Not sure yet',
    under_2k: 'Under $2,000',
    '2k_5k': '$2,000 - $5,000',
    '5k_15k': '$5,000 - $15,000',
    '15k_plus': '$15,000+',
  },
  preferredContact: {
    email: 'Email',
    phone: 'Phone',
    video_call: 'Video call',
  },
  employmentType: {
    full_time: 'Full-time',
    part_time: 'Part-time',
    contract: 'Contract',
    freelance: 'Freelance',
  },
  workArrangement: {
    remote: 'Remote',
    hybrid: 'Hybrid',
    onsite: 'On-site',
  },
  hiringTimeline: {
    immediate: 'Actively hiring now',
    within_month: 'Within a month',
    one_to_three_months: 'One to three months',
    exploring: 'Building a pipeline',
  },
} as const

/** Optional single-select: '' means "not answered" and must survive validation. */
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.union([z.enum(values), z.literal('')]).optional().default('')
}

function boundedText(max: number) {
  return z.string().trim().max(max).optional().default('')
}

/** Accepts a bare domain too -- visitors routinely type "acme.com". Normalized server-side. */
const optionalUrl = z
  .string()
  .trim()
  .max(300)
  .optional()
  .default('')
  .refine((value) => value === '' || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/i.test(value), {
    message: 'Enter a valid website address.',
  })

/**
 * System-captured page/campaign context. Every field is optional and
 * length-capped because it arrives from the browser and is never trusted: an
 * oversized or hostile value is rejected here rather than reaching D1.
 * None of it is asked of the visitor.
 *
 * `anonymousId` is a first-party, non-PII random id generated in the browser
 * -- never an IP, email, or device fingerprint.
 */
export const attributionSchema = z.object({
  entryPage: boundedText(300),
  sourcePage: boundedText(300),
  landingPage: boundedText(300),
  referrer: boundedText(500),
  firstTouchSource: boundedText(120),
  firstTouchMedium: boundedText(120),
  firstTouchCampaign: boundedText(200),
  firstTouchAt: boundedText(40),
  latestTouchSource: boundedText(120),
  latestTouchMedium: boundedText(120),
  latestTouchCampaign: boundedText(200),
  utmSource: boundedText(120),
  utmMedium: boundedText(120),
  utmCampaign: boundedText(200),
  utmTerm: boundedText(200),
  utmContent: boundedText(200),
  formId: boundedText(80),
  offerId: boundedText(80),
  solutionId: boundedText(80),
  caseStudyId: boundedText(80),
  insightId: boundedText(80),
  anonymousId: boundedText(64),
})
export type AttributionInput = z.infer<typeof attributionSchema>

export const consentSchema = z.object({
  granted: z.boolean(),
  consentTextVersion: boundedText(40),
  privacyPolicyVersion: boundedText(40),
})

const baseInquirySchema = z.object({
  inquiryType: inquiryTypeSchema.default('general'),
  fullName: z.string().trim().min(1, 'Full name is required.').max(120),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'),
  message: z.string().trim().min(1, 'A short description is required.').max(5000),
  company: boundedText(160),
  website: optionalUrl,
  phone: boundedText(40),

  // Business qualification
  currentWorkflow: boundedText(2000),
  desiredOutcome: boundedText(2000),
  currentTools: boundedText(500),
  teamSize: optionalEnum(TEAM_SIZE_OPTIONS),
  timeline: optionalEnum(TIMELINE_OPTIONS),
  budgetRange: optionalEnum(BUDGET_OPTIONS),
  volume: boundedText(120),
  preferredContact: optionalEnum(PREFERRED_CONTACT_OPTIONS),
  solutionInterest: boundedText(80),

  // Employment / collaboration
  roleTitle: boundedText(160),
  employmentType: optionalEnum(EMPLOYMENT_TYPE_OPTIONS),
  workArrangement: optionalEnum(WORK_ARRANGEMENT_OPTIONS),
  locationRequirement: boundedText(160),
  jobPostingUrl: optionalUrl,
  hiringTimeline: optionalEnum(HIRING_TIMELINE_OPTIONS),

  // `.default({})` would not typecheck: Zod's default takes the OUTPUT shape,
  // and every attribution field is required post-parse. Parsing an empty object
  // produces exactly that fully-defaulted shape.
  attribution: attributionSchema.optional().default(() => attributionSchema.parse({})),
  consent: consentSchema,
  turnstileToken: z.string().max(2048).optional().default(''),
})

/**
 * Per-type required fields, expressed as a refinement rather than a
 * discriminated union so the client form can keep one state object across an
 * inquiry-type change without losing what the visitor already typed.
 */
export const inquiryRequestSchema = baseInquirySchema.superRefine((value, ctx) => {
  if (!value.consent.granted) {
    ctx.addIssue({ code: 'custom', path: ['consent', 'granted'], message: 'Please confirm you agree before submitting.' })
  }

  if (isBusinessInquiry(value.inquiryType)) {
    if (!value.company.trim()) {
      ctx.addIssue({ code: 'custom', path: ['company'], message: 'Company or organization is required.' })
    }
    if (!value.desiredOutcome.trim()) {
      ctx.addIssue({ code: 'custom', path: ['desiredOutcome'], message: 'Describe the result you are aiming for.' })
    }
    if (!value.timeline) {
      ctx.addIssue({ code: 'custom', path: ['timeline'], message: 'Select a timeline.' })
    }
  }

  if (isEmploymentInquiry(value.inquiryType)) {
    if (!value.company.trim()) {
      ctx.addIssue({ code: 'custom', path: ['company'], message: 'Company or organization is required.' })
    }
    if (!value.roleTitle.trim()) {
      ctx.addIssue({ code: 'custom', path: ['roleTitle'], message: 'Role title is required.' })
    }
    if (!value.employmentType) {
      ctx.addIssue({ code: 'custom', path: ['employmentType'], message: 'Select an employment type.' })
    }
  }
})
export type InquiryRequest = z.infer<typeof inquiryRequestSchema>

/** Minimal-friction lead-magnet capture: name, email, consent. */
export const leadMagnetRequestSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.').max(120),
  email: z
    .string()
    .trim()
    .min(1, 'Email is required.')
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'),
  offerId: z.string().trim().min(1).max(80),
  // `.default({})` would not typecheck: Zod's default takes the OUTPUT shape,
  // and every attribution field is required post-parse. Parsing an empty object
  // produces exactly that fully-defaulted shape.
  attribution: attributionSchema.optional().default(() => attributionSchema.parse({})),
  consent: consentSchema,
  turnstileToken: z.string().max(2048).optional().default(''),
})
export type LeadMagnetRequest = z.infer<typeof leadMagnetRequestSchema>

/** Admin-side mutation of human workflow state only -- never visitor-supplied fields. */
export const leadUpdateSchema = z.object({
  pipelineStatus: pipelineStatusSchema.optional(),
  assignedOwner: z.string().trim().max(160).optional(),
  internalNotes: z.string().trim().max(5000).optional(),
})
export type LeadUpdate = z.infer<typeof leadUpdateSchema>
