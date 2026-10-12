// The signed-in host's account controls, shared by the DUPR sheet and My
// sessions: news opt-in (never ticked for them), sign out, and "Delete my
// account" (spec §3.2).
import { useState } from 'react'
import { ApiError, deleteAccount, signOut, updateMe } from '../lib/api'
import { Button } from '../components/ui.jsx'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)

export default function HostAccount({ host, onChanged, showMySessions = true }) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(action, fallback) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure, fallback))
      // The sign-in is already gone: let the parent reload and show sign-in again.
      if (failure instanceof ApiError && failure.status === 401) onChanged(null)
    } finally {
      setBusy(false)
    }
  }

  const toggleNews = () => run(async () => onChanged((await updateMe({ marketingOptIn: !host.marketingOptIn })).host), 'Could not save that. Try again.')
  const leave = () => run(async () => {
    await signOut()
    onChanged(null)
  }, 'Could not sign out. Try again.')
  const remove = () => {
    if (!window.confirm('Delete your account? Your sessions keep running on your original host links but are no longer linked to you, and their DUPR export needs a new sign-in. Any other phone you opened a session on from My sessions loses host access.')) return
    run(async () => {
      await deleteAccount()
      onChanged(null)
    }, 'Could not delete the account. Try again.')
  }

  return (
    <section aria-label="Your account" className="mt-5 grid gap-3 border-t border-navy-800 pt-4 text-sm">
      <p className="text-mist">Signed in as <span className="break-all font-semibold text-white">{host.email}</span>. We keep your Google account ID, name and email, your DUPR Club ID and your news choice until you delete your account.</p>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={host.marketingOptIn} disabled={busy} onChange={toggleNews} className="h-5 w-5" />
        Email me occasional Devlab Pickleball news
      </label>
      {error && <p role="alert" className="text-rose-200">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {showMySessions && <a href="/pickleball/my-sessions" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold text-pickle-neon underline">My sessions</a>}
        <Button variant="ghost" disabled={busy} onClick={leave}>Sign out</Button>
        <Button variant="danger" disabled={busy} onClick={remove}>Delete my account</Button>
      </div>
    </section>
  )
}
