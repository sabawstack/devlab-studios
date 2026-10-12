import { useCallback, useMemo, useState } from 'react'
import { MODE_INFO } from '../../lib/pickleball/open/modes/info'
import { deleteSession, downloadResults } from '../lib/api'
import { forgetHostedSession } from '../lib/hostKeys'
import { useCommandQueue } from '../lib/useCommandQueue'
import CaptainsSheet from './CaptainsSheet.jsx'
import CourtCard from './CourtCard.jsx'
import EditMatchDialog from './EditMatchDialog.jsx'
import FairnessPanel from './FairnessPanel.jsx'
import GameOverDialog from './GameOverDialog.jsx'
import ModeSheet from './ModePicker.jsx'
import PlayersPanel from './PlayersPanel.jsx'
import ResultsList from './ResultsList.jsx'
import RulesPanel from './RulesPanel.jsx'
import StandingsTable from './StandingsTable.jsx'
import UndoToast from './UndoToast.jsx'
import ShareSheet from './ShareSheet.jsx'
import { TOURNAMENT_TABS } from '../tournament/tabs'
import TournamentHost from '../tournament/TournamentHost.jsx'
import { Button, Panel } from './ui.jsx'

const countLabel = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

const TABS = [['courts', 'Courts'], ['players', 'Players'], ['results', 'Results']]
const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again."

/** A fetch that never reached the server throws a TypeError whose text means nothing to a host. */
function friendlyError(message) {
  return !message || /failed to fetch|networkerror|load failed|network request failed/i.test(message) ? OFFLINE_MESSAGE : message
}

export default function HostConsole({ code, hostKey, host, status, onHost }) {
  const credentials = useMemo(() => ({ hostKey }), [hostKey])
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onHost)
  const tournament = host.viewer.tournament
  // A tournament opens on its draw until it starts; open play opens on the courts.
  const [tab, setTab] = useState(() => (tournament && tournament.phase !== 'RUNNING' ? 'draw' : 'courts'))
  const tabs = tournament ? TOURNAMENT_TABS : TABS
  const [dialog, setDialog] = useState(null)
  const [undo, setUndo] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionError, setActionError] = useState(null)
  const viewer = host.viewer
  const names = useMemo(() => new Map(host.players.map((p) => [p.id, p.name])), [host.players])
  const nameOf = useCallback((id) => names.get(id) ?? '—', [names])
  const courtLabel = useCallback((id) => host.courts.find((c) => c.id === id)?.label ?? '', [host.courts])
  const playing = useMemo(() => new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : []))), [host.courts])
  const dismissUndo = useCallback(() => setUndo(null), [])

  async function save(match, result) {
    setDialog(null)
    const ok = await send({ type: 'RECORD_RESULT', matchId: match.id, ...result })
    if (ok) setUndo({ matchId: match.id, savedAt: Date.now(), label: `${courtLabel(match.courtId)} saved${result.scoreA === null ? '' : ` ${result.scoreA}–${result.scoreB}`}.` })
  }

  function pickMode(mode) {
    setDialog(null)
    if (mode !== host.settings.mode) send({ type: 'SET_MODE', mode })
  }

  async function download() {
    try {
      const { blob, filename } = await downloadResults(code, hostKey)
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: filename })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : 'Could not download the results. Try again.')
    }
  }

  function endSession() {
    if (!window.confirm('End this session? Courts stop getting new matches. Games in progress can still be saved.')) return
    send({ type: 'END_SESSION' })
  }

  async function remove() {
    if (!window.confirm('Delete this session and all its results now? This cannot be undone.')) return
    try {
      await deleteSession(code, hostKey)
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : 'Could not delete the session. Try again.')
      return
    }
    forgetHostedSession(code)
    window.location.assign('/pickleball')
  }

  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-5 lg:pb-8">
      <header className="relative flex flex-wrap items-center gap-3 py-2">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{viewer.name}</h1>
          <p className="text-xs text-mist">
            {countLabel(host.players.filter((p) => p.status !== 'LEFT').length, 'player')} · {countLabel(host.courts.filter((c) => c.enabled).length, 'court')}
            {status !== 'open' && <span className="ml-2 text-amber-200">· {status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>}
            {pending > 0 && <span className="ml-2 text-amber-200">· Sending {pending}…</span>}
            {viewer.status === 'ENDED' && <span className="ml-2 text-pickle-neon">· Ended</span>}
          </p>
        </div>
        {tournament
          ? <span className="rounded-xl border border-navy-700 px-4 py-2.5 text-sm font-semibold">{tournament.formatLabel}</span>
          : <Button variant="ghost" aria-haspopup="dialog" onClick={() => setDialog({ type: 'mode' })}>Mode: {MODE_INFO[host.settings.mode]?.label ?? 'Paddle stack'}</Button>}
        <Button variant="neon" onClick={() => setDialog({ type: 'share' })}>Share board</Button>
        {/* The menu is placed against the header, not the button: on a phone More wraps to the
            left edge, and a menu anchored to its right side ran off the screen. */}
        <div>
          <Button variant="ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>More</Button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 grid w-56 gap-1 rounded-2xl bg-navy-950 p-2 shadow-elevated">
              <Button variant="ghost" onClick={() => { setMenuOpen(false); setDialog({ type: 'captains' }) }}>Court captains</Button>
              <Button variant="ghost" onClick={() => { setMenuOpen(false); download() }}>Download results (CSV)</Button>
              {viewer.status === 'ACTIVE' && <Button variant="ghost" onClick={() => { setMenuOpen(false); endSession() }}>End session</Button>}
              <Button variant="danger" onClick={() => { setMenuOpen(false); remove() }}>Delete now</Button>
            </div>
          )}
        </div>
      </header>

      {(error || actionError) && (
        <p role="alert" className="my-2 flex items-center justify-between rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">
          {friendlyError(actionError ?? error)}<button type="button" onClick={() => { setActionError(null); clearError() }} className="ml-3 min-h-11 px-3 underline">OK</button>
        </p>
      )}

      {tournament ? (
        <TournamentHost host={host} send={send} tab={tab} nameOf={nameOf} courtLabel={courtLabel}
          onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
          onGameOver={(match) => setDialog({ type: 'gameOver', match })}
          onEditResult={(match) => setDialog({ type: 'editResult', match })} />
      ) : (
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <section className={section('courts')} aria-label="Courts">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {host.courts.map((court) => (
              <CourtCard key={court.id} court={court} nameOf={nameOf} ended={viewer.status === 'ENDED'}
                onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
                onGameOver={(match) => setDialog({ type: 'gameOver', match })}
                onEdit={(match) => setDialog({ type: 'edit', match })} />
            ))}
          </div>
          <Panel className="mt-4">
            <h2 className="font-bold">Waiting</h2>
            {viewer.waiting.length === 0 ? <p className="mt-1 text-sm text-mist">Everyone is on court.</p> : (
              <ol className="mt-2 flex flex-wrap gap-1.5 text-sm">
                {viewer.waiting.map((w, i) => <li key={w.id} className="rounded-full bg-navy-800 px-3 py-1">{i + 1} · {w.name}</li>)}
              </ol>
            )}
          </Panel>
          <div className="mt-4"><FairnessPanel fairness={host.fairness} /></div>
        </section>

        <aside className="grid content-start gap-5">
          <div className={`${section('players')} grid gap-5`}>
            <PlayersPanel players={host.players} waiting={viewer.waiting} playing={playing} showSkill={host.settings.mode === 'BALANCED'} send={send} />
            <RulesPanel rules={host.settings.rules} players={host.players} send={send} />
          </div>
          <div className={section('results')}>
            <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={viewer.standings} /></Panel>
            <Panel className="mt-4"><h2 className="mb-2 text-lg font-bold">Results</h2>
              <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={(match) => setDialog({ type: 'editResult', match })} />
            </Panel>
          </div>
        </aside>
      </div>
      )}

      <nav className={`fixed inset-x-0 bottom-0 z-20 grid ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'} border-t border-navy-800 bg-ink lg:hidden`} aria-label="Sections">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" aria-current={tab === key} onClick={() => setTab(key)}
            className={`min-h-14 text-sm ${tab === key ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{label}</button>
        ))}
      </nav>

      {dialog?.type === 'mode' && <ModeSheet mode={host.settings.mode} onPick={pickMode} onClose={() => setDialog(null)} />}
      {dialog?.type === 'gameOver' && (
        <GameOverDialog title={`${courtLabel(dialog.match.courtId)} · who won?`} match={dialog.match} nameOf={nameOf} settings={host.settings}
          onSave={(result) => save(dialog.match, result)}
          onAbandon={dialog.match.status === 'IN_PROGRESS' ? () => { setDialog(null); send({ type: 'ABANDON_MATCH', matchId: dialog.match.id }) } : null}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editResult' && (
        <GameOverDialog title="Edit result" match={dialog.match} nameOf={nameOf} settings={host.settings} initial={dialog.match}
          onSave={(result) => { setDialog(null); send({ type: 'EDIT_RESULT', matchId: dialog.match.id, ...result }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <EditMatchDialog match={dialog.match} players={host.players} nameOf={nameOf}
          onSave={(slots) => { setDialog(null); send({ type: 'EDIT_PROPOSAL', matchId: dialog.match.id, teamA: [slots[0], slots[1]], teamB: [slots[2], slots[3]] }) }}
          onSkip={() => { setDialog(null); send({ type: 'SKIP_PROPOSAL', matchId: dialog.match.id }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'share' && (
        <ShareSheet code={code} selfCheckIn={host.settings.selfCheckIn} onClose={() => setDialog(null)}
          onToggleCheckIn={() => send({ type: 'SET_SELF_CHECK_IN', enabled: !host.settings.selfCheckIn })} />
      )}
      {dialog?.type === 'captains' && (
        <CaptainsSheet code={code} hostKey={hostKey} courts={host.courts} captains={host.captains} onHost={onHost} onClose={() => setDialog(null)} />
      )}
      {undo && (
        <UndoToast key={undo.savedAt} label={undo.label} savedAt={undo.savedAt} onDismiss={dismissUndo}
          onUndo={() => { setUndo(null); send({ type: 'UNDO_RESULT', matchId: undo.matchId }) }} />
      )}
    </div>
  )
}
