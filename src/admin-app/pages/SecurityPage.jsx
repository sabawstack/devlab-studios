import { useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { Eye, EyeOff, ShieldCheck } from '../../components/icons/icons'
import AdminLoginsPanel from '../components/AdminLoginsPanel'

const MIN_PASSWORD_LENGTH = 12

const EMPTY_FORM = { currentPassword: '', newPassword: '', confirmPassword: '' }

/**
 * One reveal toggle per field rather than a single shared one: revealing the
 * password you are typing should not also reveal the one you are replacing.
 */
function PasswordField({ id, label, value, onChange, autoComplete, hint, error, disabled }) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold text-slate-800" htmlFor={id}>
        {label}
      </label>
      {hint ? (
        <p className="text-xs text-slate-500" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <div className="relative">
        <input
          id={id}
          /* Toggling `type` on one input keeps autofill and validation working. */
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          className="w-full rounded-md border border-slate-300 py-2 pl-3 pr-11 text-sm outline-none focus:border-brand-teal disabled:bg-slate-50"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={[error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-pressed={isVisible}
          aria-controls={id}
          aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-slate-500 transition hover:text-brand-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal"
        >
          {isVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SecurityPage() {
  const [form, setForm] = useState(EMPTY_FORM)
  const [status, setStatus] = useState(null)
  const [fieldError, setFieldError] = useState({})
  const [isSaving, setIsSaving] = useState(false)

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
    if (fieldError[field]) setFieldError((current) => ({ ...current, [field]: undefined }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus(null)
    setFieldError({})

    // Mirrors the server rules so the obvious mistakes do not cost a round
    // trip. The server re-checks all of them; this is never the authority.
    if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
      setFieldError({ newPassword: `Use at least ${MIN_PASSWORD_LENGTH} characters.` })
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setFieldError({ confirmPassword: 'The new passwords do not match.' })
      return
    }

    setIsSaving(true)
    try {
      await adminApi.post('/api/admin/password', form)
      setForm(EMPTY_FORM)
      setStatus({
        tone: 'ok',
        message: 'Password changed. Sessions on your other devices have been signed out; this one stays active.',
      })
    } catch (error) {
      if (error.field) setFieldError({ [error.field]: error.message })
      setStatus({ tone: 'error', message: error.message || 'Could not change the password. Please try again.' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Security</h1>
        <p className="mt-1 text-sm text-slate-500">Change the password you use to sign in to this CMS.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <PasswordField
          id="current-password"
          label="Current password"
          value={form.currentPassword}
          onChange={(value) => update('currentPassword', value)}
          autoComplete="current-password"
          error={fieldError.currentPassword}
          disabled={isSaving}
        />
        <PasswordField
          id="new-password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          value={form.newPassword}
          onChange={(value) => update('newPassword', value)}
          autoComplete="new-password"
          error={fieldError.newPassword}
          disabled={isSaving}
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={form.confirmPassword}
          onChange={(value) => update('confirmPassword', value)}
          autoComplete="new-password"
          error={fieldError.confirmPassword}
          disabled={isSaving}
        />

        <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-teal" aria-hidden="true" />
          <span>
            Changing your password signs out every other device immediately. If you are changing it because it may have
            leaked, that is what stops a session someone else already holds.
          </span>
        </p>

        <button
          type="submit"
          disabled={isSaving || !form.currentPassword || !form.newPassword || !form.confirmPassword}
          className="rounded-md bg-brand-teal px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-orange disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Changing…' : 'Change password'}
        </button>

        {status ? (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-sm ${status.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
          >
            {status.message}
          </p>
        ) : null}
      </form>

      <AdminLoginsPanel minPasswordLength={MIN_PASSWORD_LENGTH} />
    </div>
  )
}

export default SecurityPage
