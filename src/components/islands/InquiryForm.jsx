import { useEffect, useId, useMemo, useRef, useState } from 'react'
import PrimaryButton from '../PrimaryButton'
import { useTurnstile, VERIFICATION_MESSAGES } from './useTurnstile'
import { collectAttribution, initAttribution, track } from '../../lib/analytics'
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, PRIVACY_POLICY_VERSION } from '../../config/consent'
import {
  BUDGET_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  HIRING_TIMELINE_OPTIONS,
  CONTACT_FORM_INQUIRY_GROUPS,
  INQUIRY_TYPE_LABELS,
  OPTION_LABELS,
  PREFERRED_CONTACT_OPTIONS,
  TEAM_SIZE_OPTIONS,
  TIMELINE_OPTIONS,
  WORK_ARRANGEMENT_OPTIONS,
  inquiryRequestSchema,
  isBusinessInquiry,
  isEmploymentInquiry,
} from '../../lib/schemas/inquiry'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, Send, ShieldCheck } from '../icons/icons'

/**
 * The structured inquiry form.
 *
 * One component covers business, employment, partnership, and general
 * inquiries: the inquiry type selects which fields render, but the state
 * object, validation schema, and submission path stay the same. That is
 * deliberate — a visitor who changes their mind about what they are asking
 * for keeps everything they already typed, and there is exactly one place
 * where a field can drift out of sync with the server.
 *
 * Validation here mirrors the server schema (both import it) but is never
 * authoritative: /api/inquiries re-validates everything.
 */

const EMPTY_FORM = {
  inquiryType: 'business_system',
  fullName: '',
  email: '',
  company: '',
  website: '',
  phone: '',
  message: '',
  currentWorkflow: '',
  desiredOutcome: '',
  currentTools: '',
  teamSize: '',
  timeline: '',
  budgetRange: '',
  volume: '',
  preferredContact: 'email',
  solutionInterest: '',
  roleTitle: '',
  employmentType: '',
  workArrangement: '',
  locationRequirement: '',
  jobPostingUrl: '',
  hiringTimeline: '',
  consentGranted: false,
}

const FIELD_CLASS =
  'form-control min-h-12 w-full px-4 py-3 placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60'

function Field({ id, label, hint, error, required, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-brand-ink" htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-1 text-brand-teal" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-2 text-xs font-normal text-slate-500">(optional)</span>
        )}
      </label>
      {hint ? (
        <p className="text-xs text-slate-600" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-rose-700" id={`${id}-error`}>
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

function SelectOptions({ options, labels, placeholder }) {
  return (
    <>
      <option value="">{placeholder}</option>
      {options.map((value) => (
        <option key={value} value={value}>
          {labels[value] || value}
        </option>
      ))}
    </>
  )
}

/** Maps the Zod issue paths the server returns back onto flat form field names. */
function flattenIssues(issues) {
  const errors = {}
  for (const issue of issues) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path || '')
    const key = path === 'consent.granted' ? 'consentGranted' : path
    if (key && !errors[key]) errors[key] = issue.message
  }
  return errors
}

const STEP_FIELDS = {
  1: ['inquiryType', 'fullName', 'email', 'company', 'message'],
  2: [
    'website',
    'phone',
    'desiredOutcome',
    'currentWorkflow',
    'currentTools',
    'teamSize',
    'timeline',
    'budgetRange',
    'volume',
    'preferredContact',
    'roleTitle',
    'employmentType',
    'workArrangement',
    'locationRequirement',
    'jobPostingUrl',
    'hiringTimeline',
    'consentGranted',
  ],
}

function InquiryForm({
  siteKey = '',
  formId = 'inquiry-form',
  defaultInquiryType = 'business_system',
  lockInquiryType = false,
  context = {},
  heading = 'Tell us about the system you need',
  description = '',
}) {
  const [isHydrated, setIsHydrated] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ ...EMPTY_FORM, inquiryType: defaultInquiryType, solutionInterest: context.solutionId || '' })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  // The widget's container only exists on step 2, so the hook must not try to
  // render before then -- see useTurnstile's `enabled` note.
  const turnstile = useTurnstile(siteKey, step === 2)
  const summaryRef = useRef(null)
  const headingRef = useRef(null)
  const baseId = useId()

  const fieldId = (name) => `${baseId}-${name}`

  const isEmployment = isEmploymentInquiry(form.inquiryType)
  const isBusiness = isBusinessInquiry(form.inquiryType)

  useEffect(() => {
    setIsHydrated(true)
    initAttribution()
  }, [])

  // Errors from a previous step must be announced, and focus has to land on
  // the summary or a keyboard user has no idea anything happened.
  useEffect(() => {
    if (Object.keys(errors).length > 0 && summaryRef.current) {
      summaryRef.current.focus()
    }
  }, [errors])

  const consentPayload = useMemo(
    () => ({
      granted: form.consentGranted,
      consentTextVersion: CONSENT_TEXT_VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
    }),
    [form.consentGranted],
  )

  function buildPayload() {
    return {
      inquiryType: form.inquiryType,
      fullName: form.fullName,
      email: form.email,
      message: form.message,
      company: form.company,
      website: form.website,
      phone: form.phone,
      currentWorkflow: form.currentWorkflow,
      desiredOutcome: form.desiredOutcome,
      currentTools: form.currentTools,
      teamSize: form.teamSize,
      timeline: form.timeline,
      budgetRange: form.budgetRange,
      volume: form.volume,
      preferredContact: form.preferredContact,
      solutionInterest: form.solutionInterest,
      roleTitle: form.roleTitle,
      employmentType: form.employmentType,
      workArrangement: form.workArrangement,
      locationRequirement: form.locationRequirement,
      jobPostingUrl: form.jobPostingUrl,
      hiringTimeline: form.hiringTimeline,
      attribution: collectAttribution({ formId, ...context }),
      consent: consentPayload,
      turnstileToken: turnstile.token,
    }
  }

  function validateAll() {
    const result = inquiryRequestSchema.safeParse({ ...buildPayload(), turnstileToken: '' })
    return result.success ? {} : flattenIssues(result.error.issues)
  }

  function noteStart() {
    if (hasStarted) return
    setHasStarted(true)
    track(isEmployment ? 'employment_form_start' : 'business_form_start', {
      form_id: formId,
      inquiry_type: form.inquiryType,
    })
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target
    noteStart()
    setForm((previous) => ({ ...previous, [name]: type === 'checkbox' ? checked : value }))
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  function reportValidationErrors(nextErrors) {
    setErrors(nextErrors)
    const firstField = Object.keys(nextErrors)[0]
    track('form_validation_error', { form_id: formId, inquiry_type: form.inquiryType, field: firstField || '' })
  }

  function handleContinue() {
    const all = validateAll()
    const stepErrors = Object.fromEntries(
      Object.entries(all).filter(([key]) => STEP_FIELDS[1].includes(key)),
    )

    if (Object.keys(stepErrors).length > 0) {
      reportValidationErrors(stepErrors)
      return
    }

    setErrors({})
    setStep(2)
    track('business_form_step_complete', { form_id: formId, inquiry_type: form.inquiryType, form_step: 1 })
    // Focus the new step's heading so the change is announced rather than
    // silently swapping content under a screen reader's cursor.
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  function handleBack() {
    setStep(1)
    setErrors({})
    window.requestAnimationFrame(() => headingRef.current?.focus())
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validation = validateAll()
    if (Object.keys(validation).length > 0) {
      reportValidationErrors(validation)
      // Send the visitor back to whichever step actually holds the problem.
      if (Object.keys(validation).some((key) => STEP_FIELDS[1].includes(key))) setStep(1)
      return
    }

    if (!turnstile.token) {
      setStatus({ type: 'error', message: VERIFICATION_MESSAGES[turnstile.state] || VERIFICATION_MESSAGES.error })
      return
    }

    setIsSubmitting(true)
    setStatus(null)
    track('inquiry_submit', { form_id: formId, inquiry_type: form.inquiryType, ...analyticsContext(context) })

    try {
      const response = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (body.fields) reportValidationErrors(flattenIssues(
          Object.entries(body.fields).map(([path, message]) => ({ path: [path], message })),
        ))
        setStatus({ type: 'error', message: body.error || 'We could not send that. Please try again.' })
        track('inquiry_failure', { form_id: formId, inquiry_type: form.inquiryType, reason: body.code || String(response.status) })
        turnstile.reset()
        return
      }

      // The conversion is reported here and only here: `persisted` is the
      // server confirming the inquiry is in the database. Delivery happens
      // afterwards and must never be what a conversion depends on.
      if (body.persisted) {
        track('inquiry_persisted', { form_id: formId, inquiry_type: form.inquiryType, ...analyticsContext(context) })
      }

      setStatus({
        type: 'success',
        message: body.duplicate
          ? 'We already have this inquiry — no need to send it again. You will get a reply by email.'
          : 'Your inquiry has been received and saved. You will get a reply by email.',
      })
      setForm({ ...EMPTY_FORM, inquiryType: form.inquiryType })
      setErrors({})
      setStep(1)
      turnstile.reset()
    } catch {
      setStatus({ type: 'error', message: 'We could not reach the server. Please check your connection and try again.' })
      track('inquiry_failure', { form_id: formId, inquiry_type: form.inquiryType, reason: 'network' })
      turnstile.reset()
    } finally {
      setIsSubmitting(false)
    }
  }

  const errorEntries = Object.entries(errors).filter(([, message]) => Boolean(message))
  const describedBy = (name, hint) =>
    [errors[name] ? `${fieldId(name)}-error` : null, hint ? `${fieldId(name)}-hint` : null].filter(Boolean).join(' ') || undefined

  const inputProps = (name, { hint } = {}) => ({
    id: fieldId(name),
    name,
    value: form[name],
    onChange: handleChange,
    disabled: !isHydrated || isSubmitting,
    className: FIELD_CLASS,
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': describedBy(name, hint),
  })

  return (
    <section className="form-surface p-6 sm:p-8">
      <form onSubmit={handleSubmit} noValidate className="contact-form-flow">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-teal">
            Step {step} of 2
          </p>
          <h2 className="text-2xl font-semibold text-brand-ink" tabIndex={-1} ref={headingRef}>
            {step === 1 ? heading : 'A little more context'}
          </h2>
          {step === 1 && description ? <p className="text-sm text-slate-600">{description}</p> : null}
          {step === 2 ? (
            <p className="text-sm text-slate-600">
              These answers shape the recommendation. Skip anything that does not apply.
            </p>
          ) : null}
        </div>

        {/*
          The error summary is the WCAG 3.3.1 mechanism: one list, focusable,
          each item linking to the field it describes.
        */}
        {errorEntries.length > 0 ? (
          <div
            ref={summaryRef}
            tabIndex={-1}
            role="alert"
            className="rounded-2xl border border-rose-300 bg-rose-50 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-800">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              Please fix {errorEntries.length} {errorEntries.length === 1 ? 'field' : 'fields'} before continuing
            </p>
            <ul className="mt-2 space-y-1 text-sm text-rose-800">
              {errorEntries.map(([name, message]) => (
                <li key={name}>
                  <a href={`#${fieldId(name)}`} className="underline underline-offset-2">
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            {!lockInquiryType ? (
              <Field id={fieldId('inquiryType')} label="What would you like to discuss?" required error={errors.inquiryType}>
                <select {...inputProps('inquiryType')}>
                  {CONTACT_FORM_INQUIRY_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.types.map((type) => (
                        <option key={type} value={type}>
                          {INQUIRY_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="inquiryType" value={form.inquiryType} />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fieldId('fullName')} label="Full name" required error={errors.fullName}>
                <input type="text" autoComplete="name" placeholder="Your name" {...inputProps('fullName')} />
              </Field>
              <Field id={fieldId('email')} label={isEmployment ? 'Work email' : 'Work email'} required error={errors.email}>
                <input type="email" autoComplete="email" placeholder="name@company.com" {...inputProps('email')} />
              </Field>
            </div>

            <Field
              id={fieldId('company')}
              label={isEmployment ? 'Company or organization' : 'Company or organization'}
              required={isBusiness || isEmployment}
              error={errors.company}
            >
              <input type="text" autoComplete="organization" placeholder="Company name" {...inputProps('company')} />
            </Field>

            <Field
              id={fieldId('message')}
              label={isEmployment ? 'Message' : 'What needs improvement?'}
              hint={
                isEmployment
                  ? 'The role, the team, and what you are looking for.'
                  : 'The workflow, handoff, or system that is costing time or losing opportunities.'
              }
              required
              error={errors.message}
            >
              <textarea rows={5} {...inputProps('message', { hint: true })} />
            </Field>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fieldId('website')} label="Website" error={errors.website}>
                <input type="url" inputMode="url" placeholder="company.com" {...inputProps('website')} />
              </Field>
              <Field id={fieldId('phone')} label="Phone" error={errors.phone}>
                <input type="tel" autoComplete="tel" placeholder="Optional" {...inputProps('phone')} />
              </Field>
            </div>

            {isEmployment ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={fieldId('roleTitle')} label="Role title" required error={errors.roleTitle}>
                    <input type="text" placeholder="e.g. Backend Engineer" {...inputProps('roleTitle')} />
                  </Field>
                  <Field id={fieldId('employmentType')} label="Employment type" required error={errors.employmentType}>
                    <select {...inputProps('employmentType')}>
                      <SelectOptions options={EMPLOYMENT_TYPE_OPTIONS} labels={OPTION_LABELS.employmentType} placeholder="Select a type" />
                    </select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={fieldId('workArrangement')} label="Work arrangement" error={errors.workArrangement}>
                    <select {...inputProps('workArrangement')}>
                      <SelectOptions options={WORK_ARRANGEMENT_OPTIONS} labels={OPTION_LABELS.workArrangement} placeholder="Select an arrangement" />
                    </select>
                  </Field>
                  <Field id={fieldId('hiringTimeline')} label="Hiring timeline" error={errors.hiringTimeline}>
                    <select {...inputProps('hiringTimeline')}>
                      <SelectOptions options={HIRING_TIMELINE_OPTIONS} labels={OPTION_LABELS.hiringTimeline} placeholder="Select a timeline" />
                    </select>
                  </Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={fieldId('locationRequirement')} label="Location or timezone" error={errors.locationRequirement}>
                    <input type="text" placeholder="e.g. Remote, UTC+8 overlap" {...inputProps('locationRequirement')} />
                  </Field>
                  <Field id={fieldId('jobPostingUrl')} label="Job description or posting URL" error={errors.jobPostingUrl}>
                    <input type="url" inputMode="url" placeholder="Link to the role" {...inputProps('jobPostingUrl')} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field
                  id={fieldId('desiredOutcome')}
                  label="What result are you aiming for?"
                  hint="What should be true once this works — faster response, fewer manual steps, clearer reporting."
                  required={isBusiness}
                  error={errors.desiredOutcome}
                >
                  <textarea rows={3} {...inputProps('desiredOutcome', { hint: true })} />
                </Field>

                <Field
                  id={fieldId('currentWorkflow')}
                  label="How does this work today?"
                  hint="The current process, even if it is mostly manual."
                  error={errors.currentWorkflow}
                >
                  <textarea rows={3} {...inputProps('currentWorkflow', { hint: true })} />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id={fieldId('currentTools')} label="Tools already in use" hint="CRM, forms, sheets, inbox, task system." error={errors.currentTools}>
                    <input type="text" placeholder="e.g. HubSpot, Sheets, Gmail" {...inputProps('currentTools', { hint: true })} />
                  </Field>
                  <Field id={fieldId('volume')} label="Approximate volume" hint="Leads or workflow runs per month." error={errors.volume}>
                    <input type="text" placeholder="e.g. ~200 leads / month" {...inputProps('volume', { hint: true })} />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field id={fieldId('timeline')} label="Timeline" required={isBusiness} error={errors.timeline}>
                    <select {...inputProps('timeline')}>
                      <SelectOptions options={TIMELINE_OPTIONS} labels={OPTION_LABELS.timeline} placeholder="Select a timeline" />
                    </select>
                  </Field>
                  <Field id={fieldId('teamSize')} label="Team size" error={errors.teamSize}>
                    <select {...inputProps('teamSize')}>
                      <SelectOptions options={TEAM_SIZE_OPTIONS} labels={OPTION_LABELS.teamSize} placeholder="Select a size" />
                    </select>
                  </Field>
                  <Field id={fieldId('budgetRange')} label="Budget range" error={errors.budgetRange}>
                    <select {...inputProps('budgetRange')}>
                      <SelectOptions options={BUDGET_OPTIONS} labels={OPTION_LABELS.budgetRange} placeholder="Select a range" />
                    </select>
                  </Field>
                </div>
              </>
            )}

            <Field id={fieldId('preferredContact')} label="Preferred contact method" error={errors.preferredContact}>
              <select {...inputProps('preferredContact')}>
                <SelectOptions options={PREFERRED_CONTACT_OPTIONS} labels={OPTION_LABELS.preferredContact} placeholder="Select a method" />
              </select>
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <input
                  id={fieldId('consentGranted')}
                  name="consentGranted"
                  type="checkbox"
                  checked={form.consentGranted}
                  onChange={handleChange}
                  disabled={!isHydrated || isSubmitting}
                  className="mt-1 h-5 w-5 flex-shrink-0 rounded border-slate-400 text-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal"
                  aria-invalid={errors.consentGranted ? 'true' : undefined}
                  aria-describedby={errors.consentGranted ? `${fieldId('consentGranted')}-error` : undefined}
                />
                <label className="text-sm text-slate-700" htmlFor={fieldId('consentGranted')}>
                  {CONSENT_TEXT}{' '}
                  <a href="/privacy" className="font-semibold text-brand-teal underline-offset-2 hover:underline">
                    Privacy Policy
                  </a>
                  .
                </label>
              </div>
              {errors.consentGranted ? (
                <p id={`${fieldId('consentGranted')}-error`} className="text-sm text-rose-700">
                  {errors.consentGranted}
                </p>
              ) : null}
            </div>

            <div className="turnstile-shell">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
                <ShieldCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" />
                Secure verification
              </div>
              <div ref={turnstile.containerRef} />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-600" aria-live="polite">
                  {VERIFICATION_MESSAGES[turnstile.state]}
                </p>
                {['expired', 'timeout', 'error'].includes(turnstile.state) ? (
                  <button
                    type="button"
                    onClick={turnstile.reset}
                    className="text-xs font-semibold text-brand-teal underline-offset-2 hover:underline"
                  >
                    Retry verification
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {step === 1 ? (
            <PrimaryButton type="button" onClick={handleContinue} disabled={!isHydrated} className="px-6">
              <span>Continue</span>
              <ArrowRight size={16} aria-hidden="true" />
            </PrimaryButton>
          ) : (
            <>
              <PrimaryButton type="button" variant="secondary" onClick={handleBack} disabled={isSubmitting}>
                <ArrowLeft size={16} aria-hidden="true" />
                <span>Back</span>
              </PrimaryButton>
              <PrimaryButton
                type="submit"
                disabled={!isHydrated || isSubmitting || !siteKey || !turnstile.token}
                className="px-6"
              >
                {isSubmitting ? (
                  <>
                    <span>Sending…</span>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <span>{isEmployment ? 'Send to Stephen' : 'Send inquiry'}</span>
                    <Send size={16} aria-hidden="true" />
                  </>
                )}
              </PrimaryButton>
            </>
          )}
        </div>

        {status ? (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${
              status.type === 'success' ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900'
            }`}
          >
            {status.type === 'success' ? (
              <Check size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            )}
            <span>{status.message}</span>
          </div>
        ) : null}
      </form>
    </section>
  )
}

/** Only ids — never anything a visitor typed. */
function analyticsContext(context) {
  return {
    solution_id: context.solutionId || undefined,
    case_study_id: context.caseStudyId || undefined,
    insight_id: context.insightId || undefined,
    offer_id: context.offerId || undefined,
  }
}

export default InquiryForm
