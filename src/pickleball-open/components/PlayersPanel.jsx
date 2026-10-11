import { useState } from 'react'
import { Button } from './ui.jsx'

const STATUS_LABEL = { ACTIVE: 'Waiting', BREAK: 'On break', LEFT: 'Left' }

export default function PlayersPanel({ players, waiting, playing, send }) {
  const [names, setNames] = useState('')
  const order = new Map(waiting.map((w, index) => [w.id, index + 1]))

  async function add(event) {
    event.preventDefault()
    const list = names.split(/[\n,]/).map((n) => n.trim()).filter(Boolean)
    if (list.length && (await send({ type: 'ADD_PLAYERS', names: list }))) setNames('')
  }

  return (
    <section aria-labelledby="players-heading" className="grid gap-3">
      <h2 id="players-heading" className="text-lg font-bold">Players ({players.filter((p) => p.status !== 'LEFT').length})</h2>
      <form onSubmit={add} className="flex gap-2">
        <label className="sr-only" htmlFor="add-players">Add players</label>
        <input id="add-players" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Add late arrivals (comma-separated)"
          className="min-h-11 flex-1 rounded-xl border border-navy-700 bg-navy-900 px-3 text-white placeholder:text-mist/70" />
        <Button type="submit" variant="neon">Add</Button>
      </form>
      <ul className="grid gap-1.5">
        {players.filter((p) => p.status !== 'LEFT').map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-xl bg-navy-900 px-3 py-2 text-[15px]">
            <span className="flex-1">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
            <span className="text-xs text-mist">{playing.has(p.id) ? 'on court' : p.busy ? 'up next' : STATUS_LABEL[p.status]} · {p.games} games</span>
            {p.status === 'ACTIVE' && !playing.has(p.id) && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'BREAK' })}>Break</Button>}
            {p.status === 'BREAK' && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'ACTIVE' })}>Back in</Button>}
            {!playing.has(p.id) && <Button variant="quiet" className="!min-h-11 !px-2 text-sm text-mist" aria-label={`${p.name} left`} onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'LEFT' })}>Left</Button>}
          </li>
        ))}
      </ul>
    </section>
  )
}
