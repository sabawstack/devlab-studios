// src/pickleball-open/tournament/DraftEditor.jsx
// Spec §6.4: the draft is freely editable by tap-to-select. Every edit goes to
// the server, which re-checks the whole draw (drawEdits.ts) and refuses a
// broken one with the reason (shown by the console's error banner).
import { useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import BracketView from './BracketView.jsx'
import { commandFor, isSelected, tap } from './drawTaps'

function Tappable({ item, selected, onTap, label, children, className = '' }) {
  const chosen = isSelected(selected, item)
  return (
    <button type="button" aria-pressed={chosen} aria-label={label} onClick={() => onTap(item)}
      className={`min-h-11 rounded-lg px-2 text-left ${chosen ? 'bg-pickle-neon font-bold text-ink' : 'bg-navy-800 hover:bg-navy-700'} ${className}`}>
      {children}
    </button>
  )
}

export default function DraftEditor({ tournament, nameOf, send }) {
  const [selected, setSelected] = useState(null)
  const pools = tournament.pools.map((p) => p.label)
  const movingPair = selected?.kind === 'pair' && pools.length > 0 ? tournament.pairs.find((p) => p.id === selected.id) : null

  function onTap(item) {
    const next = tap(selected, item)
    setSelected(next.selected)
    if (next.chosen) send(commandFor(next.chosen, tournament.phase))
  }

  function move(poolLabel) {
    setSelected(null)
    send({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: movingPair.id, poolLabel } })
  }

  function start() {
    if (!window.confirm('Start the tournament? The draw locks: after this you can only substitute a player, or swap opponents between games that have not started.')) return
    send({ type: 'START_TOURNAMENT' })
  }

  const loose = tournament.unpaired
  return (
    <div className="grid gap-4">
      <Panel className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Draft draw · {tournament.formatLabel}</h2>
            <p className="text-sm text-mist">Tap one, then another, to swap: two players, two pairs’ seeds, or two pairs in the games below.</p>
          </div>
          <Button variant="neon" onClick={start} disabled={loose.length > 0}>Start tournament</Button>
        </div>
        {loose.length > 0 && (
          <div role="status" className="grid gap-2 rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">
            <p>{loose.map((p) => p.name).join(', ')} {loose.length === 1 ? 'has' : 'have'} no partner. Tap them, then a player in a pair, to swap them in, or put them on a break to keep them as a substitute.</p>
            <div className="flex flex-wrap gap-2">
              {loose.map((p) => (
                <Tappable key={p.id} item={{ kind: 'player', id: p.id }} selected={selected} onTap={onTap} label={`Select ${p.name}`}>{p.name}</Tappable>
              ))}
            </div>
          </div>
        )}
        <ol className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]" aria-label="Pairs in seed order">
          {tournament.pairs.map((pair) => (
            <li key={pair.id} className="flex items-center gap-1.5 rounded-xl bg-navy-900 p-1.5">
              <Tappable item={{ kind: 'pair', id: pair.id }} selected={selected} onTap={onTap} label={`Seed ${pair.seed}: ${pair.name}`} className="w-11 shrink-0 text-center font-bold">
                {pair.seed}
              </Tappable>
              {pair.playerIds.map((id) => (
                <Tappable key={id} item={{ kind: 'player', id }} selected={selected} onTap={onTap} label={`Select ${nameOf(id)}`} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {nameOf(id)}
                </Tappable>
              ))}
              {pair.poolLabel && <span className="shrink-0 px-1 text-xs text-mist">Pool {pair.poolLabel}</span>}
            </li>
          ))}
        </ol>
        {movingPair && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Move ${movingPair.name}`}>
            <span className="text-sm text-mist">Move {movingPair.name} to</span>
            {pools.filter((label) => label !== movingPair.poolLabel).map((label) => (
              <Button key={label} variant="ghost" onClick={() => move(label)}>Pool {label}</Button>
            ))}
          </div>
        )}
      </Panel>
      <BracketView tournament={tournament} onSlot={onTap} selected={selected} />
    </div>
  )
}
