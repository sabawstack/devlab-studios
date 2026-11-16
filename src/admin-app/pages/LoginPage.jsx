import { useState } from 'react'
import { brandingAssets } from '../../config/branding'
import devlabStudiosLogo from '../../assets/devlabstudios-logo-only.png'
import { Eye, EyeOff } from '../../components/icons/icons'
import EnvironmentBadge from '../components/EnvironmentBadge'
import { currentEnvironment } from '../lib/environment'

/**
 * DevLab Workspace sign-in (ADMIN-01): stone canvas, one white card, the logo,
 * the workspace name, which deployment this is, and the form. Nothing is
 * fetched before the form can be used.
 */
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [status, setStatus] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const environment = currentEnvironment(null)

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)
    setStatus('')

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setStatus(data.error || 'Unable to sign in.')
        return
      }

      onLogin(data)
    } catch {
      setStatus('Unable to reach the admin login API.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="admin-canvas flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="admin-workspace w-full max-w-sm rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-surface)] p-8" aria-labelledby="login-title">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src={brandingAssets.logoOnlyUrl}
              alt=""
              className="h-9 w-9 object-contain"
              width="36"
              height="36"
              onError={(event) => {
                event.currentTarget.onerror = null
                event.currentTarget.src = devlabStudiosLogo.src
              }}
            />
            <span className="text-base font-semibold">DevLab Workspace</span>
          </div>
          <EnvironmentBadge environment={environment} />
        </div>

        <h1 id="login-title" className="mt-8 text-2xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--ws-ink-2)]">Content, inquiries, Lead CRM and the mailbox.</p>

        <label className="mt-6 block text-sm font-semibold" htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-md border px-3 py-2 text-sm"
          required
        />

          <label className="mt-4 block text-sm font-semibold" htmlFor="admin-password">Password</label>
          <div className="relative mt-2">
            <input
              id="admin-password"
              /*
               * Toggling `type` rather than overlaying a second field keeps a
               * single input, so the browser's saved credential, autofill, and
               * the form's `required` validation all continue to work.
               */
              type={isPasswordVisible ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border py-2 pl-3 pr-11 text-sm"
              required
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              /*
               * `aria-pressed` + a label that states the ACTION is what makes
               * this usable without sight: the icon alone communicates nothing,
               * and a label naming the current state ("password shown") reads
               * as a status rather than a control.
               */
              aria-pressed={isPasswordVisible}
              aria-controls="admin-password"
              aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
              title={isPasswordVisible ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-[var(--ws-ink-2)] transition hover:text-[var(--ws-ink)]"
            >
              {isPasswordVisible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>

        {status ? <p role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{status}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-6 w-full rounded-md bg-[var(--ws-action)] px-4 py-2.5 text-sm font-semibold text-[var(--ws-action-ink)] transition hover:bg-[var(--ws-action-hover)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

export default LoginPage
