// src/pickleball-open/tournament/TournamentHost.jsx
// The host console's tournament area (spec §6): setup and draft editor before
// Start; then courts, the live draw (with opponent swaps by tap-to-select),
// substitutions and standings. The console around it
// keeps the header, the Game over dialog, undo, results and the menu.
import { useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import CourtCard from '../components/CourtCard.jsx'
import PlayersPanel from '../components/PlayersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import BracketView from './BracketView.jsx'
import ChampionBanner from './ChampionBanner.jsx'
import DraftEditor from './DraftEditor.jsx'
import { commandFor, tap } from './drawTaps'
import PairStandings from './PairStandings.jsx'
import SubstituteSheet from './SubstituteSheet.jsx'
import TournamentSetup from './TournamentSetup.jsx'

export default function TournamentHost({ host, send, tab, nameOf, courtLabel, onStart, onGameOver, onEditResult }) {
  const t = host.viewer.tournament
  const [selected, setSelected] = useState(null)
  const [subbing, setSubbing] = useState(false)
  const ended = host.viewer.status === 'ENDED'
  const running = t.phase === 'RUNNING' || t.phase === 'FINISHED'
  const playing = new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : [])))
  const activeCount = host.players.filter((p) => p.status === 'ACTIVE').length
  // Phones show one tab at a time; from lg every section is on screen (spec §11).
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  function onSlot(item) {
    const next = tap(selected, item)
    setSelected(next.selected)
    if (next.chosen) send(commandFor(next.chosen, t.phase))
  }

  async function substitute(edit) {
    setSubbing(false)
    await send({ type: 'SUBSTITUTE_PLAYER', ...edit })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-5">
        <ChampionBanner champion={t.champion} />
        {running ? (
          <section className={section('courts')} aria-label="Courts">
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
              {host.courts.map((court) => (
                <CourtCard key={court.id} court={court} nameOf={nameOf} ended={ended} onStart={onStart} onGameOver={onGameOver} onEdit={null} />
              ))}
            </div>
          </section>
        ) : (
          tab === 'courts' && <p className="text-mist lg:hidden">Courts fill once you start the tournament.</p>
        )}
        <section className={section('draw')} aria-label="Draw">
          {running ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{t.formatLabel}</h2>
                  {t.phase === 'RUNNING' && <p className="text-sm text-mist">To swap opponents, tap a pair in a game that has not started, then a pair in another game of the same round.</p>}
                </div>
                {t.phase === 'RUNNING' && <Button variant="ghost" onClick={() => setSubbing(true)}>Substitute a player</Button>}
              </div>
              <BracketView tournament={t} onSlot={t.phase === 'RUNNING' ? onSlot : null} selected={selected} />
            </div>
          ) : (
            <div className="grid gap-5">
              <TournamentSetup tournament={t} activeCount={activeCount} send={send} />
              {t.phase === 'DRAFT' && <DraftEditor tournament={t} nameOf={nameOf} send={send} />}
            </div>
          )}
        </section>
      </div>

      <aside className="grid content-start gap-5">
        <div className={section('players')}>
          <PlayersPanel players={host.players} waiting={[]} playing={playing} showSkill send={send} />
        </div>
        <div className={`${section('results')} grid gap-4`}>
          <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} /></Panel>
          <Panel><h2 className="mb-2 text-lg font-bold">Results</h2>
            <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={onEditResult} />
          </Panel>
        </div>
      </aside>

      {subbing && <SubstituteSheet tournament={t} players={host.players} onSubstitute={substitute} onClose={() => setSubbing(false)} />}
    </div>
  )
}
