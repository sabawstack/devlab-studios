// src/pickleball-open/tournament/SubstituteSheet.jsx
// Spec §6.5: after Start a player in a pair can be substituted while that pair
// is not on court. Results stay with the pair.
import { useState } from 'react'
import { Button, Sheet } from '../components/ui.jsx'

const field = 'min-h-11 w-full rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white'

export default function SubstituteSheet({ tournament, players, onSubstitute, onClose }) {
  const [pairId, setPairId] = useState(tournament.pairs[0]?.id ?? '')
  const pair = tournament.pairs.find((p) => p.id === pairId)
  const [outId, setOutId] = useState('')
  const [inId, setInId] = useState('')
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  const paired = new Set(tournament.pairs.flatMap((p) => p.playerIds))
  const bench = players.filter((p) => p.status !== 'LEFT' && !paired.has(p.id))

  return (
    <Sheet title="Substitute a player" onClose={onClose}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm text-mist">Pair
          <select className={field} value={pairId} onChange={(e) => { setPairId(e.target.value); setOutId('') }}>
            {tournament.pairs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-mist">Player coming off
          <select className={field} value={outId} onChange={(e) => setOutId(e.target.value)}>
            <option value="">Pick one</option>
            {pair?.playerIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-mist">Substitute
          <select className={field} value={inId} onChange={(e) => setInId(e.target.value)}>
            <option value="">Pick one</option>
            {bench.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'BREAK' ? ' (on a break)' : ''}</option>)}
          </select>
        </label>
        {bench.length === 0 && <p className="text-sm text-amber-200">Everyone is in a pair. Add the substitute on the Players tab first.</p>}
        <p className="text-sm text-mist">The pair keeps its results and its place in the draw. A pair on court can be changed after its game.</p>
        <Button variant="primary" disabled={!pair || !outId || !inId} onClick={() => onSubstitute({ entrantId: pair.id, outPlayerId: outId, inPlayerId: inId })}>Substitute</Button>
      </div>
    </Sheet>
  )
}
