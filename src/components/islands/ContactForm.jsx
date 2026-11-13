import { useEffect, useMemo, useState } from 'react'
import PrimaryButton from '../PrimaryButton'
import AnimatedIcon from '../icons/AnimatedIcon'
import { ERROR_MESSAGES } from '../../config/errorMessages'
import { useTurnstile, VERIFICATION_MESSAGES as verificationMessages } from './useTurnstile'
import { User, Mail, MessageSquare, Send, Check, AlertCircle, Loader2, ShieldCheck } from '../icons/icons'

const initialForm = { name: '', email: '', subject: '', message: '' }

function ContactForm({ siteKey = '', copy = {} }) {
  const [isHydrated, setIsHydrated] = useState(false)
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const turnstile = useTurnstile(siteKey)
  const config = useMemo(() => ({ apiUrl: import.meta.env.VITE_CONTACT_API_URL || '/api/contact' }), [])

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  const validate = () => {
    const nextErrors = {}
    if (!form.name.trim()) nextErrors.name = 'Full name is required.'
    if (!form.email.trim()) nextErrors.email = 'Email is required.'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) nextErrors.email = 'Enter a valid email.'
    if (!form.subject.trim()) nextErrors.subject = 'Subject is required.'
    if (!form.message.trim()) nextErrors.message = 'Message is required.'
    return nextErrors
  }

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((previous) => ({ ...previous, [name]: value }))
    if (errors[name]) setErrors((previous) => ({ ...previous, [name]: undefined }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const validation = validate()
    if (Object.keys(validation).length > 0) {
      setErrors(validation)
      setStatus({ type: 'error', message: ERROR_MESSAGES.CONTACT_VALIDATION_ERROR.message })
      return
    }

    if (!turnstile.token) {
      setStatus({ type: 'error', message: verificationMessages[turnstile.state] || verificationMessages.error })
      return
    }

    setIsSubmitting(true)
    setStatus(null)

    try {
      const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'devlabstudios-contact-form', turnstileToken: turnstile.token }),
      })
      const responseBody = await response.json().catch(() => ({}))

      if (!response.ok) {
        const messages = {
          verification_expired: 'Verification expired. Please try again.',
          verification_failed: "We couldn't verify the request. Please retry.",
          verification_unavailable: 'Verification is temporarily unavailable. Please try again later.',
        }
        setStatus({ type: 'error', message: messages[responseBody.code] || ERROR_MESSAGES.CONTACT_SEND_ERROR.message })
        turnstile.reset()
        return
      }

      setStatus({ type: 'success', message: 'Message sent successfully. You should receive a confirmation email shortly.' })
      setForm(initialForm)
      setErrors({})
      turnstile.reset()
    } catch (error) {
      setStatus({ type: 'error', message: ERROR_MESSAGES.CONTACT_SEND_ERROR.message })
      turnstile.reset()
      if (import.meta.env.DEV) console.error('[Contact Form Error]', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const fieldClass = 'form-control min-h-12 px-4 py-3 placeholder:text-slate-500'
  const errorProps = (name) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
  })

  return (
    <section className="form-surface p-6 sm:p-8">
      <form className="contact-form-flow" onSubmit={handleSubmit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink" htmlFor="name"><AnimatedIcon icon={User} size={16} color="text-brand-teal" animationType="none" ariaLabel={null} />{copy.nameLabel || 'Full Name'}</label>
            <input id="name" name="name" type="text" value={form.name} onChange={handleChange} className={fieldClass} placeholder={copy.namePlaceholder || 'Your name'} disabled={!isHydrated} {...errorProps('name')} />
            {errors.name ? <p id="name-error" className="text-sm text-rose-700">{errors.name}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink" htmlFor="email"><AnimatedIcon icon={Mail} size={16} color="text-brand-teal" animationType="none" ariaLabel={null} />{copy.emailLabel || 'Email'}</label>
            <input id="email" name="email" type="email" value={form.email} onChange={handleChange} className={fieldClass} placeholder={copy.emailPlaceholder || 'name@email.com'} disabled={!isHydrated} {...errorProps('email')} />
            {errors.email ? <p id="email-error" className="text-sm text-rose-700">{errors.email}</p> : null}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink" htmlFor="subject"><AnimatedIcon icon={MessageSquare} size={16} color="text-brand-teal" animationType="none" ariaLabel={null} />{copy.subjectLabel || 'Subject'}</label>
          <input id="subject" name="subject" type="text" value={form.subject} onChange={handleChange} className={fieldClass} placeholder={copy.subjectPlaceholder || 'Project inquiry, support, collaboration'} disabled={!isHydrated} {...errorProps('subject')} />
          {errors.subject ? <p id="subject-error" className="text-sm text-rose-700">{errors.subject}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-semibold text-brand-ink" htmlFor="message"><AnimatedIcon icon={MessageSquare} size={16} color="text-brand-teal" animationType="none" ariaLabel={null} />{copy.messageLabel || 'Message'}</label>
          <textarea id="message" name="message" rows="5" value={form.message} onChange={handleChange} className={fieldClass} placeholder={copy.messagePlaceholder || 'Share context, goals, timelines, and success criteria.'} disabled={!isHydrated} {...errorProps('message')} />
          {errors.message ? <p id="message-error" className="text-sm text-rose-700">{errors.message}</p> : null}
        </div>

        <div className="turnstile-shell">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-brand-ink"><ShieldCheck className="h-4 w-4 text-brand-teal" aria-hidden="true" />Secure verification</div>
          <div ref={turnstile.containerRef} />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600" aria-live="polite">{verificationMessages[turnstile.state]}</p>
            {['expired', 'timeout', 'error'].includes(turnstile.state) ? <button type="button" onClick={turnstile.reset} className="text-xs font-semibold text-brand-teal">Retry verification</button> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton type="submit" disabled={!isHydrated || isSubmitting || !siteKey || !turnstile.token} className="px-6">
            {isSubmitting ? <><span>Sending…</span><AnimatedIcon icon={Loader2} size={16} color="inherit" animationType="spin" ariaLabel={null} /></> : <><span>{copy.submitLabel || 'Send Message'}</span><AnimatedIcon icon={Send} size={16} color="inherit" animationType="hover-slide" ariaLabel={null} /></>}
          </PrimaryButton>
          <span className="text-sm text-slate-600">{copy.helperText || 'Responses are delivered securely by email.'}</span>
        </div>

        {status ? (
          <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${status.type === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`} role="status" aria-live="polite">
            <AnimatedIcon icon={status.type === 'success' ? Check : AlertCircle} size={18} color="inherit" animationType={status.type === 'success' ? 'pulse' : 'none'} ariaLabel={null} />
            <span>{status.message}</span>
          </div>
        ) : null}
      </form>
    </section>
  )
}

export default ContactForm
