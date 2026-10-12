// src/pickleball-open/tournament/BracketView.jsx
// The draw: pools side by side on wide screens and stacked on phones, then the
// bracket round by round (spec §6.7, §11). Read-only unless onSlot is given:
// then each placed pair is a button for the tap-to-select editor.
import { drawSections } from './bracketLayout'
import { isSelected } from './drawTaps'
import PairStandings from './PairStandings.jsx'

function Side({ fixture, side, onSlot, selected, highlight }) {
  const entrantId = side === 'A' ? fixture.entrantAId : fixture.entrantBId
  const name = side === 'A' ? fixture.nameA : fixture.nameB
  const waiting = side === 'A' ? fixture.waitingA : fixture.waitingB
  const score = side === 'A' ? fixture.scoreA : fixture.scoreB
  const won = fixture.winner === side
  const item = { kind: 'slot', fixtureId: fixture.id, side, entrantId }
  const text = (
    <>
      <span className={`min-w-0 flex-1 [overflow-wrap:anywhere] ${name ? '' : 'italic text-mist'} ${won ? 'font-bold text-pickle-neon' : ''} ${highlight === entrantId && entrantId ? 'underline decoration-pickle-neon decoration-2 underline-offset-4' : ''}`}>
        {name ?? waiting ?? 'Bye'}
      </span>
      {score !== null && <span className={`shrink-0 tabular-nums ${won ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{score}</span>}
    </>
  )
  if (onSlot && entrantId) {
    const chosen = isSelected(selected, item)
    return (
      <button type="button" aria-pressed={chosen} onClick={() => onSlot(item)}
        className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left ${chosen ? 'bg-pickle-neon font-bold text-ink' : 'hover:bg-navy-800'}`}>
        {text}
      </button>
    )
  }
  return <div className="flex min-h-9 items-center gap-2 px-2">{text}</div>
}

export function GameCard({ fixture, onSlot, selected, highlight }) {
  const state = fixture.court ? `${fixture.court.label} · ${fixture.court.live ? 'playing' : 'up next'}` : null
  return (
    <article className={`rounded-xl p-2 text-[15px] ${fixture.court?.live ? 'border border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid="draw-game" aria-label={fixture.label}>
      <p className="flex justify-between gap-2 px-2 text-xs text-mist"><span>{fixture.label}</span>{state && <span className="font-bold text-pickle-neon">{state}</span>}</p>
      <Side fixture={fixture} side="A" onSlot={onSlot} selected={selected} highlight={highlight} />
      <Side fixture={fixture} side="B" onSlot={onSlot} selected={selected} highlight={highlight} />
    </article>
  )
}

function Rounds({ section, onSlot, selected, highlight }) {
  // A bracket reads left to right on wide screens; rounds stack on a phone.
  const layout = section.kind === 'bracket'
    ? 'grid gap-3 md:grid-flow-col md:auto-cols-[minmax(13rem,1fr)] md:overflow-x-auto md:pb-2'
    : 'grid gap-3'
  // A round robin's games sit side by side within a round on wide screens.
  const games = section.kind === 'rounds' ? 'grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),1fr))]' : 'grid gap-2'
  return (
    <div className={layout}>
      {section.rounds.map((round) => (
        <div key={round.round} className="grid content-start gap-2">
          <h4 className="text-xs font-bold uppercase tracking-[0.1em] text-mist">{round.title}</h4>
          <div className={games}>
            {round.games.map((game) => <GameCard key={game.id} fixture={game} onSlot={onSlot} selected={selected} highlight={highlight} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function BracketView({ tournament, onSlot = null, selected = null, highlight = null }) {
  const sections = drawSections(tournament)
  const pools = sections.filter((s) => s.kind === 'pool')
  const rest = sections.filter((s) => s.kind !== 'pool')
  const poolTable = (label) => tournament.pools.find((p) => p.label === label)?.standings ?? []
  return (
    <div className="grid gap-5" data-testid="draw">
      {pools.length > 0 && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,20rem),1fr))]">
          {pools.map((section) => (
            <section key={section.key} aria-label={section.title} className="grid content-start gap-3 rounded-2xl border border-navy-800 p-3">
              <h3 className="text-lg font-bold text-pickle-neon">{section.title}</h3>
              <PairStandings rows={poolTable(section.label)} highlight={highlight} compact />
              <Rounds section={section} onSlot={onSlot} selected={selected} highlight={highlight} />
            </section>
          ))}
        </div>
      )}
      {rest.map((section) => (
        <section key={section.key} aria-label={section.title} className="grid gap-3">
          <h3 className="text-lg font-bold">{section.title}</h3>
          <Rounds section={section} onSlot={onSlot} selected={selected} highlight={highlight} />
        </section>
      ))}
    </div>
  )
}
