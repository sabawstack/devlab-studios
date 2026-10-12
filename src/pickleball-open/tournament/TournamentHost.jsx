// src/pickleball-open/tournament/TournamentHost.jsx
// The host console's tournament area (spec §6): setup and draft editor before
// Start; then courts, the live draw (with opponent swaps by tap-to-select),
// substitutions and standings. The console around it
// keeps the header, the Game over dialog, undo, results and the menu. Once the
// tournament is over, the final results (resultsScreen) replace the courts.
import { useState } from 'react'
import { Button, Panel } from '../components/ui.jsx'
import CourtCard from '../components/CourtCard.jsx'
import PlayersPanel from '../components/PlayersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import BracketView from './BracketView.jsx'
import ChampionAnnouncer from './ChampionAnnouncer.jsx'
import DraftEditor from './DraftEditor.jsx'
import { commandFor, tap } from './drawTaps'
import PairStandings from './PairStandings.jsx'
import SubstituteSheet from './SubstituteSheet.jsx'
import { pairsOnCourt } from './substituteCandidates'
import TournamentSetup from './TournamentSetup.jsx'

/** A selected slot stays selected only while its game can still be swapped. */
function stillSwappable(tournament, item) {
  if (!item || item.kind !== 'slot') return Boolean(item)
  const fixture = tournament.fixtures.find((f) => f.id === item.fixtureId)
  const entrantId = fixture && (item.side === 'A' ? fixture.entrantAId : fixture.entrantBId)
  const placed = fixture && (item.side === 'A' ? fixture.placedA : fixture.placedB)
  return Boolean(fixture) && placed && (fixture.status === 'PENDING' || fixture.status === 'READY') && !fixture.court?.live && entrantId === item.entrantId
}

export default function TournamentHost({ host, resultsScreen = null, send, error, onClearError, tab, onTab, nameOf, courtLabel, onStart, onGameOver, onEditResult }) {
  const t = host.viewer.tournament
  const [pickedSlot, setSelected] = useState(null)
  const selected = stillSwappable(t, pickedSlot) ? pickedSlot : null
  const [subbing, setSubbing] = useState(false)
  // Bumped after each Generate so the draft editor brings its heading into view.
  const [draftFocus, setDraftFocus] = useState(0)
  const ended = host.viewer.status === 'ENDED'
  const running = t.phase === 'RUNNING' || t.phase === 'FINISHED'
  const playing = new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : [])))
  const activeCount = host.players.filter((p) => p.status === 'ACTIVE').length
  // Phones show one tab at a time; from lg every section is on screen (spec §11).
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  function onSlot(item) {
    const next = tap(selected, item)
    setSelected(next.selected)
    if (next.chosen) {
      send(commandFor(next.chosen, t.phase)).then((ok) => { if (!ok) setSelected(null) })
    }
  }

  function openSubstitute() {
    onClearError?.()
    setSubbing(true)
  }

  // Stays open until the server accepts, so a refusal keeps its reason and the picks in the sheet.
  async function substitute(edit) {
    // A retry must not leave the previous refusal on screen once it succeeds.
    onClearError?.()
    const ok = await send({ type: 'SUBSTITUTE_PLAYER', ...edit })
    setSelected(null)
    if (ok) setSubbing(false)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-5">
        <ChampionAnnouncer champion={t.champion} />
        {resultsScreen ? (
          <section className={`${section('courts')} grid content-start gap-4`} aria-label="Final results">
            {resultsScreen}
            {/* A game still on court when the host ended the session can still be saved. */}
            {host.courts.some((c) => c.match?.status === 'IN_PROGRESS') && (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
                {host.courts.filter((c) => c.match?.status === 'IN_PROGRESS').map((court) => (
                  <CourtCard key={court.id} court={court} nameOf={nameOf} ended onStart={onStart} onGameOver={onGameOver} onEdit={null} />
                ))}
              </div>
            )}
          </section>
        ) : running ? (
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
                  {t.phase === 'RUNNING' && <p className="text-sm text-mist">To swap opponents, tap a pair the draw placed in a game that has not started, then one in another game of the same round. Pairs that got there by a result move only when that result changes.</p>}
                </div>
                {t.phase === 'RUNNING' && <Button variant="ghost" onClick={openSubstitute}>Substitute a player</Button>}
              </div>
              <BracketView tournament={t} onSlot={t.phase === 'RUNNING' ? onSlot : null} selected={selected} />
            </div>
          ) : (
            <div className="grid gap-5">
              <TournamentSetup tournament={t} activeCount={activeCount} send={send} onGenerated={() => setDraftFocus((n) => n + 1)} />
              {/* Keyed by the draw's pairs, so a new Generate starts with nothing selected. */}
              {t.phase === 'DRAFT' && (
                <DraftEditor key={t.pairs.map((p) => p.id).sort().join()} tournament={t} nameOf={nameOf} send={send}
                  focusToken={draftFocus} onStarted={() => onTab?.('courts')} />
              )}
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

      {subbing && <SubstituteSheet tournament={t} players={host.players} onCourtIds={pairsOnCourt(t, playing)} error={error} onSubstitute={substitute} onClose={() => setSubbing(false)} />}
    </div>
  )
}
