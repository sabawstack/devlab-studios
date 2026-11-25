// src/pickleball-open/components/StatusCard.jsx
// The player board's first thing on a phone (PB-QUEUE-02): one full-width card
// saying where "I" am, in the shared vocabulary. Before a name is picked it is
// a "Who are you?" prompt instead. A polite live region announces each change
// of status once (PB-QUEUE-07); the card's words carry the status, colour only
// repeats it.
import { useId } from 'react'
import { writeMe } from '../lib/me'
import { statusText } from '../lib/myStatus'

const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const TONE = {
  UP_NEXT: 'bg-pb-play text-pb-canvas',
  PLAYING: 'border-2 border-pb-play bg-pb-surface text-white',
  NEXT_FOUR: 'border-2 border-dashed border-pb-play bg-pb-surface text-white',
}

/** A short line under the status, where one helps. */
function note(kind) {
  if (kind === 'WAITING') return 'Your name moves to a court when you are called. The board updates by itself.'
  if (kind === 'NEXT_FOUR') return 'You play when the game on that court ends. If another court opens first, you go there instead.'
  if (kind === 'BREAK') return 'Tell the host when you are back.'
  return null
}

export function NamePicker({ viewer, me, onPick, className = '', label = 'Who are you?' }) {
  const id = useId()
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-bold">{label}</label>
      <select id={id} value={me} onChange={(e) => { onPick(e.target.value); writeMe(viewer.code, e.target.value) }}
        className="mt-1 min-h-12 w-full max-w-sm rounded-xl border border-pb-rule bg-pb-sunken px-3 text-base text-white">
        <option value="">Pick your name</option>
        {viewer.roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  )
}

export default function StatusCard({ viewer, me, onPick, status, fresh, lastSnapshotAt }) {
  const myName = viewer.roster.find((p) => p.id === me)?.name
  if (!myName) {
    return (
      <section aria-label="Your status" data-testid="status-card" data-kind="PICK" className="rounded-2xl border-2 border-pb-play bg-pb-surface p-4">
        <NamePicker viewer={viewer} me="" onPick={onPick} label="Who are you?" />
        <p className="mt-2 text-sm text-pb-ink-2">Pick your name to see whether you are playing, called next or waiting. Only this phone remembers it.</p>
      </section>
    )
  }
  const lastKnown = !fresh && lastSnapshotAt ? clock(lastSnapshotAt) : !fresh ? 'earlier' : null
  const text = statusText(status, myName, { fresh, lastKnown })
  const line = note(status.kind)
  return (
    <section aria-label="Your status" data-testid="status-card" data-kind={status.kind}
      className={`rounded-2xl p-4 ${fresh ? TONE[status.kind] ?? 'bg-pb-surface text-white' : 'bg-pb-surface text-white'}`}>
      {/* Announced once per change: the text only changes when the status does. */}
      <p role="status" aria-live="polite" className="text-lg font-bold [overflow-wrap:anywhere] sm:text-xl">{text ?? `Hi ${myName.split(/\s+/)[0]}. You're not in a game right now.`}</p>
      {line && fresh && <p className={`mt-1 text-sm ${status.kind === 'UP_NEXT' ? 'text-pb-canvas/80' : 'text-pb-ink-2'}`}>{line}</p>}
      <details key={me} className="mt-2 text-sm">
        <summary className={`inline-flex min-h-11 cursor-pointer items-center ${status.kind === 'UP_NEXT' && fresh ? 'text-pb-canvas' : 'text-pb-ink-2'}`}>Not {myName}?</summary>
        <NamePicker viewer={viewer} me={me} onPick={onPick} label="Pick your name" className="pt-1" />
      </details>
    </section>
  )
}
