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

export default function AnnouncementSheet({ initial, onSave, onClose }) {
  const [text, setText] = useState(initial)
  const length = text.trim().length
  const over = length > MAX
  return (
    <Sheet title="Edit welcome message" onClose={onClose}>
      <label className="grid gap-1.5 text-sm text-mist">Shown under the session name on every phone, the check-in page and the TV
        <textarea rows={3} className={field} value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. Welcome! Courts close at 9." />
      </label>
      <p className={`mt-1 text-right text-xs ${over ? 'font-bold text-rose-200' : 'text-mist'}`} aria-live="polite" data-testid="announcement-count">{length}/{MAX}</p>
      {over && <p role="alert" className="mt-1 text-sm text-rose-200">Keep it to {MAX} characters.</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button variant="neon" className="flex-1" disabled={over} onClick={() => onSave(text)}>Save</Button>
        <Button variant="ghost" onClick={() => onSave('')}>Clear message</Button>
      </div>
    </Sheet>
  )
}
