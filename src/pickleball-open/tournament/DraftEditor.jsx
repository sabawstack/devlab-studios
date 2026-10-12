// src/pickleball-open/tournament/DraftEditor.jsx
// Spec §6.4: the draft is freely editable by tap-to-select. Every edit goes to
// the server, which re-checks the whole draw (drawEdits.ts) and refuses a
// broken one with the reason (shown by the console's sticky error banner).
import { useEffect, useRef, useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import BracketView from './BracketView.jsx'
import { commandFor, isSelected, tap } from './drawTaps'

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon'

function Tappable({ item, selected, onTap, label, children, className = '' }) {
  const chosen = isSelected(selected, item)
  return (
    <button type="button" aria-pressed={chosen} aria-label={label} onClick={() => onTap(item)}
      className={`min-h-11 rounded-lg px-2 text-left ${FOCUS} ${chosen ? 'bg-pickle-neon font-bold text-ink' : 'bg-navy-800 hover:bg-navy-700'} ${className}`}>
      {children}
    </button>
  )
}

/** The selection, or null once the draw no longer has it (a regenerated or edited draft). */
function stillThere(selected, tournament) {
  if (!selected) return null
  if (selected.kind === 'pair') return tournament.pairs.some((p) => p.id === selected.id) ? selected : null
  if (selected.kind === 'player') {
    const placed = tournament.pairs.some((p) => p.playerIds.includes(selected.id)) || tournament.unpaired.some((p) => p.id === selected.id)
    return placed ? selected : null
  }
  const fixture = tournament.fixtures.find((f) => f.id === selected.fixtureId)
  const entrantId = fixture ? (selected.side === 'A' ? fixture.entrantAId : fixture.entrantBId) : null
  return entrantId === selected.entrantId ? selected : null
}

/** "Selected: Ana — tap another player to swap." */
function selectionHint(selected, tournament, nameOf, hasPools) {
  if (selected.kind === 'player') return `Selected: ${nameOf(selected.id)} — tap another player to swap.`
  if (selected.kind === 'pair') {
    const pair = tournament.pairs.find((p) => p.id === selected.id)
    return `Selected: seed ${pair.seed}, ${pair.name} — tap another seed to swap${hasPools ? ', or move the pair to another pool' : ''}.`
  }
  const fixture = tournament.fixtures.find((f) => f.id === selected.fixtureId)
  const name = selected.side === 'A' ? fixture.nameA : fixture.nameB
  return `Selected: ${name} in ${fixture.label} — tap a pair in another game to swap.`
}

export default function DraftEditor({ tournament, nameOf, send, focusToken = 0, onStarted }) {
  const [picked, setPicked] = useState(null)
  const heading = useRef(null)
  const selected = stillThere(picked, tournament)
  const pools = tournament.pools.map((p) => p.label)
  const movingPair = selected?.kind === 'pair' && pools.length > 0 ? tournament.pairs.find((p) => p.id === selected.id) : null

  // After Generate, take the host to the draft (on a phone it sits below the setup).
  useEffect(() => {
    if (!focusToken || !heading.current) return
    heading.current.focus({ preventScroll: true })
    heading.current.scrollIntoView({ block: 'start' })
  }, [focusToken])

  function onTap(item) {
    const next = tap(selected, item)
    setPicked(next.selected)
    if (next.chosen) send(commandFor(next.chosen, tournament.phase))
  }

  function move(poolLabel) {
    setPicked(null)
    send({ type: 'EDIT_DRAW', edit: { kind: 'MOVE_PAIR', entrantId: movingPair.id, poolLabel } })
  }

  async function start() {
    if (!window.confirm('Start the tournament? The draw locks: after this you can only substitute a player, or swap opponents between games that have not started.')) return
    if (await send({ type: 'START_TOURNAMENT' })) onStarted?.()
  }

  const loose = tournament.unpaired
  return (
    <div className="grid gap-4">
      <Panel className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 ref={heading} tabIndex={-1} id="draft-heading" className="scroll-mt-20 text-lg font-bold focus:outline-none">Draft draw · {tournament.formatLabel}</h2>
            <p className="text-sm text-mist">
              Tap one, then another, to swap: two players, two pairs’ seeds, or two pairs in the games below.
              {pools.length > 0 && ' Tap a seed to move that pair to another pool.'}
            </p>
          </div>
          <Button variant="neon" onClick={start} disabled={loose.length > 0} aria-describedby={loose.length > 0 ? 'no-partner-notice' : undefined}>Start tournament</Button>
        </div>
        {loose.length > 0 && (
          <div role="status" className="grid gap-2 rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">
            <p id="no-partner-notice">{loose.map((p) => p.name).join(', ')} {loose.length === 1 ? 'has' : 'have'} no partner. Tap them, then a player in a pair, to swap them in, or put them on a break to keep them as a substitute.</p>
            <div className="flex flex-wrap gap-2">
              {loose.map((p) => (
                <Tappable key={p.id} item={{ kind: 'player', id: p.id }} selected={selected} onTap={onTap} label={`Select ${p.name}`}>{p.name}</Tappable>
              ))}
            </div>
          </div>
        )}
        <p aria-live="polite" className={`min-h-5 text-sm ${selected ? 'font-semibold text-pickle-neon' : 'text-mist'}`}>
          {selected ? selectionHint(selected, tournament, nameOf, pools.length > 0) : 'Nothing selected.'}
        </p>
        <ol className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]" aria-label="Pairs in seed order">
          {tournament.pairs.map((pair) => (
            <li key={pair.id} className="grid gap-1.5 rounded-xl bg-navy-900 p-1.5">
              <div className="flex items-center gap-1.5">
                <Tappable item={{ kind: 'pair', id: pair.id }} selected={selected} onTap={onTap} label={`Seed ${pair.seed}: ${pair.name}`} className="w-11 shrink-0 text-center font-bold">
                  {pair.seed}
                </Tappable>
                {pair.playerIds.map((id) => (
                  <Tappable key={id} item={{ kind: 'player', id }} selected={selected} onTap={onTap} label={`Select ${nameOf(id)}`} className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {nameOf(id)}
                  </Tappable>
                ))}
                {pair.poolLabel && <span className="shrink-0 px-1 text-xs text-mist">Pool {pair.poolLabel}</span>}
              </div>
              {movingPair?.id === pair.id && (
                <div className="flex flex-wrap items-center gap-2 px-1 pb-1" role="group" aria-label={`Move ${pair.name}`}>
                  <span className="text-sm text-mist">Move to</span>
                  {pools.filter((label) => label !== pair.poolLabel).map((label) => (
                    <Button key={label} variant="ghost" className="!px-3" onClick={() => move(label)}>Pool {label}</Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </Panel>
      <BracketView tournament={tournament} onSlot={onTap} selected={selected} />
    </div>
  )
}
