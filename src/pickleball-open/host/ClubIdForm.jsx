// The host's DUPR Club ID (spec §9.3): entered once, saved on their account.
import { useState } from 'react'
import { updateMe } from '../lib/api'
import { Button } from '../components/ui.jsx'
import { CLUB_ID_INPUT } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)

export default function ClubIdForm({ current, onSaved }) {
  const [value, setValue] = useState(current ?? '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const trimmed = value.trim()

  async function save(event) {
    event.preventDefault()
    if (!CLUB_ID_INPUT.test(trimmed)) {
      setError('A DUPR Club ID is 3 to 20 letters, digits or dashes.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { host } = await updateMe({ duprClubId: trimmed })
      onSaved(host)
    } catch (failure) {
      setError(errorText(failure, 'Could not save the Club ID. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="grid gap-2">
      <label className="grid gap-1 text-sm font-semibold">Your DUPR Club ID
        <input value={value} onChange={(event) => setValue(event.target.value)} maxLength={20} autoComplete="off"
          className="min-h-11 rounded-lg bg-ink px-3 py-2 font-mono text-white" />
      </label>
      <p className="text-xs text-mist">On your club’s page in DUPR. Saved for every session you export.</p>
      {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
      <Button type="submit" disabled={busy || trimmed === (current ?? '')}>{busy ? 'Saving…' : 'Save Club ID'}</Button>
    </form>
  )
}
