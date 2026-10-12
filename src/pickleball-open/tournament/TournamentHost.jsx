// src/pickleball-open/tournament/TournamentHost.jsx
// The host console's tournament area (spec §6): setup and draft editor before
// Start; then courts, the live draw and standings. The console around it
// keeps the header, the Game over dialog, undo, results and the menu.
import { Panel } from '../components/ui.jsx'
import CourtCard from '../components/CourtCard.jsx'
import PlayersPanel from '../components/PlayersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import BracketView from './BracketView.jsx'
import DraftEditor from './DraftEditor.jsx'
import PairStandings from './PairStandings.jsx'
import TournamentSetup from './TournamentSetup.jsx'

export default function TournamentHost({ host, send, tab, nameOf, courtLabel, onStart, onGameOver, onEditResult }) {
  const t = host.viewer.tournament
  const ended = host.viewer.status === 'ENDED'
  const running = t.phase === 'RUNNING' || t.phase === 'FINISHED'
  const playing = new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : [])))
  const activeCount = host.players.filter((p) => p.status === 'ACTIVE').length
  // Phones show one tab at a time; from lg every section is on screen (spec §11).
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-5">
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
              <h2 className="text-lg font-bold">{t.formatLabel}</h2>
              <BracketView tournament={t} />
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
        <div className={section('results')}>
          <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} /></Panel>
          <Panel className="mt-4"><h2 className="mb-2 text-lg font-bold">Results</h2>
            <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={onEditResult} />
          </Panel>
        </div>
      </aside>
    </div>
  )
}
