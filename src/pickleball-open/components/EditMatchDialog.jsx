import { useState } from 'react'
import { Button, Sheet } from './ui.jsx'

export default function EditMatchDialog({ match, players, nameOf, onSave, onSkip, onClose }) {
  const [slots, setSlots] = useState([...match.teamA, ...match.teamB])
  const [selected, setSelected] = useState(null)
  const available = players.filter((p) => p.status === 'ACTIVE' && (!p.busy || slots.includes(p.id)) && !slots.includes(p.id))
    .sort((a, b) => b.satOut - a.satOut || a.games - b.games)

  function tapSlot(index) {
    if (selected === null) return setSelected(index)
    if (selected === index) return setSelected(null)
    const next = [...slots]
    ;[next[selected], next[index]] = [next[index], next[selected]]
    setSlots(next)
    setSelected(null)
  }

  function replaceWith(playerId) {
    if (selected === null) return
    setSlots(slots.map((id, i) => (i === selected ? playerId : id)))
    setSelected(null)
  }

  const slotButton = (index) => (
    <button key={index} type="button" onClick={() => tapSlot(index)} aria-pressed={selected === index}
      className={`min-h-12 rounded-xl px-3 text-left ${selected === index ? 'border-2 border-pickle-neon bg-white font-bold text-ink' : 'bg-navy-800'}`}>
      {nameOf(slots[index])}{selected === index ? ' · replace…' : ''}
    </button>
  )

  return (
    <Sheet title="Edit before start" onClose={onClose}>
      <p className="text-sm text-mist">Tap a player, then tap someone waiting to put them in, or tap a second player to swap teams. A player you swap out keeps their place in line.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="grid gap-2"><p className="text-xs font-bold text-pickle-neon">TEAM A</p>{slotButton(0)}{slotButton(1)}</div>
        <div className="grid gap-2"><p className="text-xs font-bold text-pickle-teamb">TEAM B</p>{slotButton(2)}{slotButton(3)}</div>
      </div>
      {selected !== null && (
        <div className="mt-4 grid gap-1.5">
          <p className="text-sm text-mist">Put in instead of {nameOf(slots[selected])}</p>
          {available.length === 0 && <p className="text-sm text-mist">Nobody else is free right now.</p>}
          {available.map((p) => (
            <button key={p.id} type="button" onClick={() => replaceWith(p.id)} className="flex min-h-11 items-center justify-between rounded-xl border border-navy-700 px-3 hover:border-pickle-neon">
              <span>{p.name}</span><span className="text-xs text-mist">{p.games} games · sat out {p.satOut}</span>
            </button>
          ))}
        </div>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onSkip}>Suggest another four</Button>
        <Button variant="neon" onClick={() => onSave(slots)}>Save</Button>
      </div>
    </Sheet>
  )
}
