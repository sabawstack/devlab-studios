import { useState } from 'react'
import { minutesSince, useNow } from '../lib/useNow'
import { Button } from './ui.jsx'

const STATUS_LABEL = { ACTIVE: 'Waiting', BREAK: 'On break', LEFT: 'Left' }
const SKILLS = [1, 2, 3, 4, 5]

/** Each row shows games, rounds sat out and the current wait (spec §5.5); skill is editable where it is used (balanced teams, tournament pairs and seeds). */
export default function PlayersPanel({ players, waiting, playing, showSkill = false, send }) {
  const [names, setNames] = useState('')
  const now = useNow()
  const order = new Map(waiting.map((w, index) => [w.id, index + 1]))

  async function add(event) {
    event.preventDefault()
    const list = names.split(/[\n,]/).map((n) => n.trim()).filter(Boolean)
    if (list.length && (await send({ type: 'ADD_PLAYERS', names: list }))) setNames('')
  }

  function setSkill(player, value) {
    send({ type: 'SET_PLAYER_SKILL', playerId: player.id, skill: value === '' ? null : Number(value) })
  }

  return (
    <section aria-labelledby="players-heading" className="grid gap-3">
      <h2 id="players-heading" className="text-lg font-bold">Players ({players.filter((p) => p.status !== 'LEFT').length})</h2>
      <form onSubmit={add} className="flex gap-2">
        <label className="sr-only" htmlFor="add-players">Add players</label>
        <input id="add-players" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Add late arrivals (comma-separated)"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-navy-700 bg-navy-900 px-3 text-white placeholder:text-mist/70" />
        <Button type="submit" variant="neon">Add</Button>
      </form>
      <ul className="grid gap-1.5">
        {players.filter((p) => p.status !== 'LEFT').map((p) => {
          const onCourt = playing.has(p.id)
          const waitingNow = p.status === 'ACTIVE' && !p.busy
          return (
            <li key={p.id} className="grid gap-1 rounded-xl bg-navy-900 px-3 py-2 text-[15px]">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 flex-1 basis-28 break-words">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
                {showSkill && (
                  <select aria-label={`Skill for ${p.name}`} value={p.skill === null ? '' : String(p.skill)} onChange={(e) => setSkill(p, e.target.value)}
                    className="min-h-11 rounded-lg border border-navy-700 bg-navy-950 px-2 text-sm text-white">
                    <option value="">Skill –</option>
                    {p.skill !== null && !SKILLS.includes(p.skill) && <option value={String(p.skill)}>{p.skill}</option>}
                    {SKILLS.map((s) => <option key={s} value={String(s)}>Skill {s}</option>)}
                  </select>
                )}
                {p.status === 'ACTIVE' && !onCourt && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'BREAK' })}>Break</Button>}
                {p.status === 'BREAK' && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'ACTIVE' })}>Back in</Button>}
                {!onCourt && <Button variant="quiet" className="!min-h-11 !px-2 text-sm text-mist" aria-label={`${p.name} left`} onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'LEFT' })}>Left</Button>}
              </div>
              <span className="text-xs text-mist">
                {onCourt ? 'on court' : p.busy ? 'up next' : STATUS_LABEL[p.status]} · {p.games} game{p.games === 1 ? '' : 's'} · sat out {p.satOut}
                {waitingNow ? ` · ${minutesSince(p.waitingSince, now)} min` : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
