// src/pickleball-open/tournament/SubstituteSheet.jsx
// Spec §6.5: after Start a player in a pair can be substituted while that pair
// is not on court. Results stay with the pair. The sheet stays open until the
// server accepts the change; a refusal shows its reason here and keeps the picks.
import { useState } from 'react'
import { Button, Sheet } from '../components/ui.jsx'
import { substituteCandidates } from './substituteCandidates'

const field = 'min-h-11 w-full rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon'

export default function SubstituteSheet({ tournament, players, onCourtIds, error, onSubstitute, onClose }) {
  const [pairId, setPairId] = useState(() => (tournament.pairs.find((p) => !onCourtIds.has(p.id)) ?? tournament.pairs[0])?.id ?? '')
  const pair = tournament.pairs.find((p) => p.id === pairId)
  const [outId, setOutId] = useState('')
  const [inId, setInId] = useState('')
  const [busy, setBusy] = useState(false)
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  const bench = substituteCandidates(tournament, players)
  const pairOnCourt = Boolean(pair) && onCourtIds.has(pair.id)

  async function submit() {
    setBusy(true)
    try {
      await onSubstitute({ entrantId: pair.id, outPlayerId: outId, inPlayerId: inId })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Substitute a player" onClose={onClose}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm text-mist">Pair
          <select className={field} value={pairId} onChange={(e) => { setPairId(e.target.value); setOutId('') }}>
            {tournament.pairs.map((p) => <option key={p.id} value={p.id} disabled={onCourtIds.has(p.id)}>{p.name}{onCourtIds.has(p.id) ? ' (on court)' : ''}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-mist">Player coming off
          <select className={field} value={outId} onChange={(e) => setOutId(e.target.value)}>
            <option value="">Pick one</option>
            {pair?.playerIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
          </select>
        </label>
        {bench.length > 0 ? (
          <label className="grid gap-1 text-sm text-mist">Substitute
            <select className={field} value={inId} onChange={(e) => setInId(e.target.value)}>
              <option value="">Pick one</option>
              {bench.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'BREAK' ? ' (on a break)' : ''}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-sm text-amber-200">Everyone is in a pair. Add the substitute on the Players tab first.</p>
        )}
        {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
        <p className="text-sm text-mist">The pair keeps its results and its place in the draw. A pair on court can be changed after its game.</p>
        <Button variant="neon" disabled={busy || !pair || pairOnCourt || !outId || !inId} onClick={submit}>Substitute</Button>
      </div>
    </Sheet>
  )
}
