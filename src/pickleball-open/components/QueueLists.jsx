// src/pickleball-open/components/QueueLists.jsx
// The queue as the player board shows it (PB-QUEUE-03), in the shared
// vocabulary: confirmed calls with their courts, the four on deck with their
// court and teams (PB-QUEUE-09), then everyone waiting, unnumbered, with the
// rule in words. Nothing here orders anyone: every list is the server's, as sent.
// No animation on any of it: a moving chip would suggest an order that is
// not promised (PB-QUEUE-07).
import { NEXT_FOUR_NOTE, nextFourLabel, ON_BREAK, QUEUE_RULE, upNextLabel, WAITING, waitingNote } from '../lib/queueVocabulary'
import { Panel, TeamNames } from './ui.jsx'

function Chip({ name, mine, muted = false, suffix = null }) {
  return (
    <li className={`rounded-full px-3 py-1 [overflow-wrap:anywhere] ${mine ? 'bg-pb-play font-bold text-pb-canvas' : muted ? 'bg-pb-surface text-pb-ink-2' : 'bg-pb-raised'}`}>
      {name}{mine && <span className="sr-only"> (you)</span>}{mine && <span aria-hidden="true"> · you</span>}{suffix}
    </li>
  )
}

/** Courts with a confirmed call: who walks on where. */
export function ConfirmedCalls({ viewer, myName, fresh = true }) {
  const calls = viewer.courts.filter((c) => c.state === 'UP_NEXT')
  if (calls.length === 0) return null
  return (
    <section aria-label="Called next" className="grid gap-2" data-testid="confirmed-calls">
      {calls.map((court) => (
        <div key={court.id} className="rounded-2xl border-2 border-pb-play bg-pb-canvas p-3">
          <p className="font-bold text-pb-play">{upNextLabel(court.label, { fresh })}</p>
          <div className="mt-1 grid gap-1 text-[15px]">
            <TeamNames side="A" names={court.teamA} emphasis={myName ? [myName] : []} />
            <TeamNames side="B" names={court.teamB} emphasis={myName ? [myName] : []} />
          </div>
        </div>
      ))}
    </section>
  )
}

/** The four on deck: their court and teams are set while that court still plays, so they can get ready. */
export function NextFour({ viewer, myName, fresh = true }) {
  const deck = viewer.nextUp
  if (!deck) return null
  return (
    <section aria-label="Next four" data-testid="next-four" className="rounded-2xl border-2 border-dashed border-pb-play bg-pb-canvas p-3">
      <p className="font-bold text-pb-play">{nextFourLabel(deck.court, { fresh })}</p>
      <div className="mt-1 grid gap-1 text-[15px]">
        <TeamNames side="A" names={deck.teamA} emphasis={myName ? [myName] : []} />
        <TeamNames side="B" names={deck.teamB} emphasis={myName ? [myName] : []} />
      </div>
      <p className="mt-2 text-xs text-pb-ink-2">{NEXT_FOUR_NOTE}</p>
    </section>
  )
}

/** Everyone waiting, in the server's priority order but never numbered, and who is on a break. */
export function WaitingList({ viewer, me }) {
  const note = waitingNote(viewer)
  return (
    <Panel as="section" aria-label="Waiting" data-testid="waiting-list">
      <h2 className="font-bold">{WAITING} ({viewer.waiting.length})</h2>
      <p className="mt-1 text-xs text-pb-ink-2">{QUEUE_RULE}</p>
      {viewer.waiting.length + viewer.onBreak.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-sm">
          {viewer.waiting.map((w) => <Chip key={w.id} name={w.name} mine={w.id === me} />)}
          {viewer.onBreak.map((p) => <Chip key={p.id} name={p.name} mine={p.id === me} muted suffix={<span> · {ON_BREAK.toLowerCase()}</span>} />)}
        </ul>
      )}
      {viewer.waiting.length === 0 && <p className="mt-2 text-sm text-pb-ink-2">{viewer.nextUp ? 'Nobody else is waiting.' : 'Nobody is waiting.'}</p>}
      {note && <p className="mt-2 text-sm font-semibold">{note}</p>}
    </Panel>
  )
}
