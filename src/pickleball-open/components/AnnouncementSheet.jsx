// src/pickleball-open/components/AnnouncementSheet.jsx
// The host's welcome message: a small preview on the console, and the sheet
// that edits or clears it (SET_ANNOUNCEMENT, host only).
import { useState } from 'react'
import { LIMITS } from '../../lib/pickleball/open/types'
import { Button, Sheet } from './ui.jsx'

const MAX = LIMITS.maxAnnouncementLength
const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'

/** The message as players see it, with an Edit button. */
export function WelcomePreview({ announcement, onEdit }) {
  return (
    <section aria-label="Welcome message" className="mb-3 flex items-center gap-3 rounded-2xl bg-navy-900 px-4 py-2" data-testid="welcome-preview">
      <p className="min-w-0 flex-1 text-sm">
        <span className="text-mist">Welcome message: </span>
        {announcement ? <span className="[overflow-wrap:anywhere]">{announcement}</span> : <span className="text-mist">none (players see only the greeting)</span>}
      </p>
      <Button variant="ghost" className="shrink-0" onClick={onEdit}>Edit</Button>
    </section>
  )
}

/**
 * Stays open until the server takes the change: `onSave` resolves true on success,
 * false when it was refused, and `error` (the refusal) is shown here, in the sheet.
 */
export default function AnnouncementSheet({ initial, onSave, onClose, error = null }) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const length = text.trim().length
  const over = length > MAX

  async function save(next) {
    setBusy(true)
    const ok = await onSave(next)
    // On success the console closes the sheet; on a refusal it stays for another try.
    if (!ok) setBusy(false)
  }

  return (
    <Sheet title="Edit welcome message" onClose={onClose}>
      <label className="grid gap-1.5 text-sm text-mist">Shown under the session name on every phone, the check-in page and the TV
        <textarea rows={3} className={field} value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. Welcome! Courts close at 9." />
      </label>
      <p className={`mt-1 text-right text-xs ${over ? 'font-bold text-rose-200' : 'text-mist'}`} aria-live="polite" data-testid="announcement-count">{length}/{MAX}</p>
      {over && <p role="alert" className="mt-1 text-sm text-rose-200">Keep it to {MAX} characters.</p>}
      {error && !busy && <p role="alert" className="mt-2 rounded-xl bg-rose-500/15 px-4 py-3 text-sm text-rose-100" data-testid="announcement-error">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="neon" className="flex-1" disabled={over || busy} onClick={() => save(text)}>{busy ? 'Saving…' : 'Save'}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => save('')}>Clear message</Button>
      </div>
    </Sheet>
  )
}
