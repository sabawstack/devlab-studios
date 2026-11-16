// src/pickleball-open/components/HostQueuePanel.jsx
// The host's one view of the queue, on the Courts tab (PB-QUEUE-05): who is
// called to which court, the next four when the server has fixed them,
// everyone waiting in priority order with their games and rounds sat out,
// who is on a break, and why any court is empty. Read-only: the order is the
// server's, as sent, and the host acts on courts and players elsewhere.
import { IDLE_LABEL, NEXT_FOUR, NEXT_FOUR_WHEN, ON_BREAK, QUEUE_RULE, UP_NEXT, WAITING, waitingNote } from '../lib/queueVocabulary'
import { Panel } from './ui.jsx'

const plural = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

export default function HostQueuePanel({ host, nameOf }) {
  const viewer = host.viewer
  const players = new Map(host.players.map((p) => [p.id, p]))
  const calls = host.courts.filter((c) => c.enabled && c.match?.status === 'PROPOSED')
  const empty = host.courts.filter((c) => c.enabled && !c.match)
  const idleOf = new Map(viewer.courts.map((c) => [c.id, c.idle]))
  const onBreak = host.players.filter((p) => p.status === 'BREAK')
  const note = waitingNote(viewer)
  return (
    <Panel as="section" aria-label="Queue" data-testid="host-queue" className="grid gap-4">
      <h2 className="text-lg font-bold">Queue</h2>

      {calls.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-pickle-neon">{UP_NEXT}</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {calls.map((c) => (
              <li key={c.id} className="[overflow-wrap:anywhere]"><b>{c.label}</b>: {[...c.match.teamA, ...c.match.teamB].map(nameOf).join(', ')}</li>
            ))}
          </ul>
        </div>
      )}

      {empty.length > 0 && (
        <div>
          <h3 className="text-sm font-bold">Empty courts</h3>
          <ul className="mt-1 grid gap-1 text-sm">
            {/* The host's own reason (it may name the pairing rules); viewers only see the coarse one. */}
            {empty.map((c) => <li key={c.id}><b>{c.label}</b>: {c.blocked ?? IDLE_LABEL[idleOf.get(c.id)] ?? IDLE_LABEL.TOO_FEW_PLAYERS}</li>)}
          </ul>
        </div>
      )}

      {viewer.nextUp && (
        <div data-testid="host-next-four">
          <h3 className="text-sm font-bold">{NEXT_FOUR} <span className="font-normal text-mist">· {NEXT_FOUR_WHEN}</span></h3>
          <p className="mt-1 text-sm [overflow-wrap:anywhere]">{viewer.nextUp.players.map((p) => p.name).join(', ')}</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold">{WAITING} ({viewer.waiting.length})</h3>
        <p className="text-xs text-mist">{QUEUE_RULE} Listed in that order.</p>
        {viewer.waiting.length === 0 ? <p className="mt-1 text-sm text-mist">Everyone is on court.</p> : (
          <ul className="mt-1 grid gap-1 text-sm">
            {viewer.waiting.map((w) => {
              const p = players.get(w.id)
              return (
                <li key={w.id} className="flex flex-wrap justify-between gap-x-3 rounded-lg bg-navy-800 px-3 py-1.5">
                  <span className="[overflow-wrap:anywhere]">{w.name}</span>
                  {p && <span className="text-mist">{plural(p.games, 'game')} · sat out {p.satOut}</span>}
                </li>
              )
            })}
          </ul>
        )}
        {note && <p className="mt-2 text-sm font-semibold">{note}</p>}
      </div>

      {onBreak.length > 0 && (
        <div>
          <h3 className="text-sm font-bold">{ON_BREAK} ({onBreak.length})</h3>
          <p className="mt-1 text-sm text-mist [overflow-wrap:anywhere]">{onBreak.map((p) => p.name).join(', ')}</p>
        </div>
      )}
    </Panel>
  )
}
