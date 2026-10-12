// src/pickleball-open/components/CaptainConsole.jsx
// A court captain's screen (spec §3.3, §5.4): one court, start / edit / skip
// its proposal, record, undo or edit its results. Nothing else.
import { useCallback, useMemo, useState } from 'react'
import { useCommandQueue } from '../lib/useCommandQueue'
import CourtCard from './CourtCard.jsx'
import EditMatchDialog from './EditMatchDialog.jsx'
import GameOverDialog from './GameOverDialog.jsx'
import ResultsList from './ResultsList.jsx'
import StandingsTable from './StandingsTable.jsx'
import UndoToast from './UndoToast.jsx'
import { Panel } from './ui.jsx'

export default function CaptainConsole({ code, captainKey, snapshot, status, onSnapshot }) {
  const credentials = useMemo(() => ({ captainKey }), [captainKey])
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onSnapshot)
  const [dialog, setDialog] = useState(null)
  const [undo, setUndo] = useState(null)
  const court = snapshot.court
  const names = useMemo(() => new Map(snapshot.players.map((p) => [p.id, p.name])), [snapshot.players])
  const nameOf = useCallback((id) => names.get(id) ?? '—', [names])
  const courtLabel = useCallback(() => court.label, [court.label])
  const dismissUndo = useCallback(() => setUndo(null), [])
  const ended = snapshot.viewer.status === 'ENDED'

  async function save(match, result) {
    setDialog(null)
    const ok = await send({ type: 'RECORD_RESULT', matchId: match.id, ...result })
    if (ok) setUndo({ matchId: match.id, savedAt: Date.now(), label: `${court.label} saved ${result.scoreA}–${result.scoreB}.` })
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4 px-3 pb-24 pt-3 sm:px-5 lg:max-w-5xl lg:grid-cols-2 lg:items-start">
      <header className="py-2 lg:col-span-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Court captain</p>
        <h1 className="truncate text-2xl font-bold">{snapshot.viewer.name}</h1>
        <p className="text-sm text-mist">
          {snapshot.captain.label}
          {status !== 'open' && <span className="ml-2 text-amber-200">· {status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>}
          {pending > 0 && <span className="ml-2 text-amber-200">· Sending {pending}…</span>}
          {ended && <span className="ml-2 text-pickle-neon">· Ended</span>}
        </p>
      </header>

      {error && (
        <p role="alert" className="flex items-center justify-between rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100 lg:col-span-2">
          {error}<button type="button" onClick={clearError} className="ml-3 min-h-11 px-3 underline">OK</button>
        </p>
      )}

      <div className="grid gap-4">
        <CourtCard court={court} nameOf={nameOf} ended={ended}
          onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
          onGameOver={(match) => setDialog({ type: 'gameOver', match })}
          onEdit={snapshot.viewer.kind === 'TOURNAMENT' ? null : (match) => setDialog({ type: 'edit', match })} />
        <Panel>
          <h2 className="mb-2 text-lg font-bold">Results on {court.label}</h2>
          <ResultsList finished={snapshot.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={(match) => setDialog({ type: 'editResult', match })} />
        </Panel>
      </div>
      <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={snapshot.viewer.standings} /></Panel>
      <p className="text-center text-xs text-mist lg:col-span-2">This link runs {court.label} only. The host can turn it off at any time.</p>

      {dialog?.type === 'gameOver' && (
        <GameOverDialog title={`${court.label} · who won?`} match={dialog.match} nameOf={nameOf} settings={snapshot.settings}
          onSave={(result) => save(dialog.match, result)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editResult' && (
        <GameOverDialog title="Edit result" match={dialog.match} nameOf={nameOf} settings={snapshot.settings} initial={dialog.match}
          onSave={(result) => { setDialog(null); send({ type: 'EDIT_RESULT', matchId: dialog.match.id, ...result }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <EditMatchDialog match={dialog.match} players={snapshot.players} nameOf={nameOf}
          onSave={(slots) => { setDialog(null); send({ type: 'EDIT_PROPOSAL', matchId: dialog.match.id, teamA: [slots[0], slots[1]], teamB: [slots[2], slots[3]] }) }}
          onSkip={() => { setDialog(null); send({ type: 'SKIP_PROPOSAL', matchId: dialog.match.id }) }}
          onClose={() => setDialog(null)} />
      )}
      {undo && (
        <UndoToast key={undo.savedAt} label={undo.label} savedAt={undo.savedAt} onDismiss={dismissUndo}
          onUndo={() => { setUndo(null); send({ type: 'UNDO_RESULT', matchId: undo.matchId }) }} />
      )}
    </div>
  )
}
