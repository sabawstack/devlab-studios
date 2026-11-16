import { useEffect, useRef, useState } from 'react'
import { onSessionExpired, sessionAbandoned, sessionRestored } from '../lib/adminApi'
import { Dialog } from '../primitives/Dialog'

/**
 * ADMIN-05: shown over the current screen when the admin session ends while a
 * page is open (expired, revoked, or the password changed elsewhere). It is
 * rendered beside the router, never inside it, so the page underneath keeps
 * its state: signing in again sends the request that was refused, and the
 * edit the admin was making is still on screen.
 */
export default function SessionExpiredDialog({ email: sessionEmail, onSignedOut }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(sessionEmail ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef(null)

  useEffect(() => onSessionExpired(() => {
    setPassword('')
    setError('')
    setOpen(true)
  }), [])

  async function signIn(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data.error || 'Unable to sign in.')
        return
      }
      // Someone else signed in: the screen was built for the previous admin.
      if (sessionEmail && data.email && data.email.toLowerCase() !== sessionEmail.toLowerCase()) {
        window.location.reload()
        return
      }
      setOpen(false)
      setPassword('')
      sessionRestored()
    } catch {
      setError('Unable to reach the sign-in service. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function signOut() {
    setOpen(false)
    sessionAbandoned()
    onSignedOut?.()
  }

  return (
    <Dialog
      open={open}
      dismissible={false}
      size="sm"
      title="Sign in again"
      description="Your session ended. Sign in to carry on; what you were working on stays on this page."
      initialFocusRef={passwordRef}
    >
      <form onSubmit={signIn} className="grid gap-3" data-testid="session-expired-form">
        <label className="grid gap-1 text-sm font-semibold" htmlFor="session-expired-email">
          Email
          <input id="session-expired-email" type="email" autoComplete="username" required value={email}
            onChange={(event) => setEmail(event.target.value)} className="rounded-md border px-3 py-2 text-sm font-normal" />
        </label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="session-expired-password">
          Password
          <input id="session-expired-password" ref={passwordRef} type="password" autoComplete="current-password" required value={password}
            onChange={(event) => setPassword(event.target.value)} className="rounded-md border px-3 py-2 text-sm font-normal" />
        </label>
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={signOut} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Sign out</button>
          <button type="submit" disabled={busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
