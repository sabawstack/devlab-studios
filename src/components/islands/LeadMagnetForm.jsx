import { useEffect, useId, useState } from 'react'
import PrimaryButton from '../PrimaryButton'
import { useTurnstile, VERIFICATION_MESSAGES } from './useTurnstile'
import { collectAttribution, initAttribution, track } from '../../lib/analytics'
import { CONSENT_TEXT, CONSENT_TEXT_VERSION, PRIVACY_POLICY_VERSION } from '../../config/consent'
import { AlertCircle, Check, Loader2, Send, ShieldCheck } from '../icons/icons'

/**
 * Minimal-friction capture for a lead magnet: name, email, consent.
 *
 * Deliberately not a shortened copy of InquiryForm — a resource request is a
 * different commitment from a project inquiry, and asking a qualification
 * question here would just cost the signup. It posts to /api/lead-magnet,
 * which runs the same persist-then-deliver pipeline.
 */
function LeadMagnetForm({ siteKey = '', offerId, offerTitle, ctaLabel = 'Send me the checklist', formId = 'lead-magnet-form' }) {
  const [isHydrated, setIsHydrated] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', consentGranted: false })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const turnstile = useTurnstile(siteKey)
  const baseId = useId()
  const fieldId = (name) => `${baseId}-${name}`

  useEffect(() => {
    setIsHydrated(true)
    initAttribution()
    track('lead_magnet_view', { offer_id: offerId, form_id: formId })
  }, [offerId, formId])

  function handleChange(event) {
    const { name, value, type, checked } = event.target
    setForm((previous) => ({ ...previous, [name]: type === 'checkbox' ? checked : value }))
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  function validate() {
    const next = {}
    if (!form.fullName.trim()) next.fullName = 'Full name is required.'
    if (!form.email.trim()) next.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.'
    if (!form.consentGranted) next.consentGranted = 'Please confirm you agree before submitting.'
    return next
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validation = validate()
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      track('form_validation_error', { form_id: formId, offer_id: offerId, field: Object.keys(validation)[0] })
      return
    }

    if (!turnstile.token) {
      setStatus({ type: 'error', message: VERIFICATION_MESSAGES[turnstile.state] || VERIFICATION_MESSAGES.error })
      return
    }

    setIsSubmitting(true)
    setStatus(null)

    try {
      const response = await fetch('/api/lead-magnet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          offerId,
          attribution: collectAttribution({ formId, offerId }),
          consent: {
            granted: form.consentGranted,
            consentTextVersion: CONSENT_TEXT_VERSION,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          },
          turnstileToken: turnstile.token,
        }),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        setStatus({ type: 'error', message: body.error || 'We could not send that. Please try again.' })
        track('inquiry_failure', { form_id: formId, offer_id: offerId, reason: body.code || String(response.status) })
        turnstile.reset()
        return
      }

      // Only counted once the server confirmed the record was written.
      if (body.persisted) track('lead_magnet_submit', { form_id: formId, offer_id: offerId })

      setStatus({ type: 'success', message: 'Saved. Check your inbox — the checklist is on its way.' })
      setForm({ fullName: '', email: '', consentGranted: false })
      turnstile.reset()
    } catch {
      setStatus({ type: 'error', message: 'We could not reach the server. Please try again.' })
      track('inquiry_failure', { form_id: formId, offer_id: offerId, reason: 'network' })
      turnstile.reset()
    } finally {
      setIsSubmitting(false)
    }
  }

  const fieldClass = 'form-control min-h-12 w-full px-4 py-3 placeholder:text-slate-500'

  return (
    <form onSubmit={handleSubmit} noValidate className="form-surface space-y-4 p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-brand-ink" htmlFor={fieldId('fullName')}>
            Full name
          </label>
          <input
            id={fieldId('fullName')}
            name="fullName"
            type="text"
            autoComplete="name"
            value={form.fullName}
            onChange={handleChange}
            disabled={!isHydrated || isSubmitting}
            className={fieldClass}
            placeholder="Your name"
            aria-invalid={errors.fullName ? 'true' : undefined}
            aria-describedby={errors.fullName ? `${fieldId('fullName')}-error` : undefined}
          />
          {errors.fullName ? (
            <p id={`${fieldId('fullName')}-error`} className="text-sm text-rose-700">
              {errors.fullName}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-brand-ink" htmlFor={fieldId('email')}>
            Work email
          </label>
          <input
            id={fieldId('email')}
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={handleChange}
            disabled={!isHydrated || isSubmitting}
            className={fieldClass}
            placeholder="name@company.com"
            aria-invalid={errors.email ? 'true' : undefined}
            aria-describedby={errors.email ? `${fieldId('email')}-error` : undefined}
          />
          {errors.email ? (
            <p id={`${fieldId('email')}-error`} className="text-sm text-rose-700">
              {errors.email}
            </p>
          ) : null}
        </div>
      </div>

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
          <a href="/privacy" className="font-semibold text-brand-teal">
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

      <div className="turnstile-shell">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink">
          <ShieldCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" />
          Secure verification
        </div>
        <div ref={turnstile.containerRef} />
        <p className="mt-2 text-xs text-slate-600" aria-live="polite">
          {VERIFICATION_MESSAGES[turnstile.state]}
        </p>
      </div>

      <PrimaryButton type="submit" disabled={!isHydrated || isSubmitting || !siteKey || !turnstile.token} className="px-6">
        {isSubmitting ? (
          <>
            <span>Sending…</span>
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          </>
        ) : (
          <>
            <span>{ctaLabel}</span>
            <Send size={16} aria-hidden="true" />
          </>
        )}
      </PrimaryButton>

      <p className="text-xs text-slate-600">
        One email with {offerTitle}. No drip sequence.
      </p>

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
  )
}

export default LeadMagnetForm
