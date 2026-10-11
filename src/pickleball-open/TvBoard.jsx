// src/pickleball-open/TvBoard.jsx
// TV mode (spec §7, §11): the same allowlisted viewer snapshot as the board,
// in large type, filling any screen with 1–16 courts and no scrolling.
// The side panel alternates standings and recent results.
import { useEffect, useState } from 'react'
import { formatPublicCode } from '../lib/pickleball/open/codes'
import { MODE_INFO } from '../lib/pickleball/open/modes/info'
import { checkInLink, viewerLink } from './lib/hostKeys'
import { PANEL_MS, PANELS, tvColumns, tvRows } from './lib/tvLayout'
import { useOpenSession } from './lib/useOpenSession'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import FairnessPanel from './components/FairnessPanel.jsx'
import QrCode from './components/QrCode.jsx'

const STATE_LABEL = { PLAYING: 'Playing', UP_NEXT: 'Walk on now', WAITING_FOR_PLAYERS: 'Waiting for players' }

function usePanel() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % PANELS.length), PANEL_MS)
    return () => clearInterval(timer)
  }, [])
  return PANELS[index]
}

function TvCourt({ court }) {
  const live = court.state === 'PLAYING'
  return (
    <article className={`flex min-h-0 flex-col justify-center gap-[0.4em] overflow-hidden rounded-[1.25rem] p-[0.6em] ${court.state === 'UP_NEXT' ? 'border-4 border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid="tv-court">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[1.1em] font-bold text-pickle-neon">{court.label}</h2>
        <span className={`shrink-0 text-[0.6em] font-bold uppercase tracking-[0.08em] ${live ? 'text-mist' : 'text-pickle-neon'}`}>{STATE_LABEL[court.state]}</span>
      </div>
      {court.teamA.length > 0 && (
        <div className="grid gap-[0.15em] text-[1em] font-semibold leading-tight">
          <p className="truncate"><span className="mr-[0.3em] inline-block h-[0.55em] w-[0.55em] rounded-full bg-pickle-neon" aria-hidden="true" />{court.teamA.join(' & ')}</p>
          <p className="truncate"><span className="mr-[0.3em] inline-block h-[0.55em] w-[0.55em] rounded-full bg-pickle-teamb" aria-hidden="true" />{court.teamB.join(' & ')}</p>
        </div>
      )}
    </article>
  )
}

export default function TvBoard({ code }) {
  const { status, viewer } = useOpenSession(code, null)
  const panel = usePanel()
  if (!code || status === 'not-found') return <ExpiredNotice />
  if (!viewer) return <p className="grid h-screen place-items-center text-3xl text-mist" role="status">Loading the board…</p>

  const courts = viewer.courts.filter((c) => c.state !== 'OFF')
  const cols = tvColumns(courts.length)
  const rows = tvRows(courts.length)
  // Card type size: wide enough for "Name & Name" in a card, tall enough for 3 lines plus the label.
  const vars = { '--tv-cols': cols, '--tv-rows': rows, '--tv-font': `min(${(5.2 / cols).toFixed(2)}vw, ${(11 / rows).toFixed(2)}vh)` }
  const qrUrl = viewer.settings.selfCheckIn ? checkInLink(window.location.origin, code) : viewerLink(window.location.origin, code)

  return (
    <main className="grid grid-cols-1 gap-4 p-4 md:h-screen md:grid-cols-[minmax(0,1fr)_minmax(18rem,26vw)] md:gap-[1.2vw] md:overflow-hidden md:p-[1.2vw]" style={vars}>
      <section aria-label="Courts" className="grid min-h-0 grid-cols-1 gap-3 text-xl leading-[1.2] md:gap-[1vw] md:text-[length:var(--tv-font)] md:[grid-template-columns:repeat(var(--tv-cols),minmax(0,1fr))] md:[grid-template-rows:repeat(var(--tv-rows),minmax(0,1fr))]">
        {courts.map((court) => <TvCourt key={court.id} court={court} />)}
      </section>
      {/* The side panel needs a TV-sized screen; on a phone the regular board is the better view. */}
      <aside className="hidden min-h-0 flex-col gap-[1vw] overflow-hidden md:flex">
        <header>
          <p className="flex items-center gap-2 text-[clamp(0.9rem,1.1vw,1.5rem)] font-bold text-pickle-neon">
            <span className={`h-3 w-3 rounded-full bg-pickle-neon ${viewer.status === 'ACTIVE' ? 'pb-pulse' : ''}`} aria-hidden="true" />
            {viewer.status === 'ACTIVE' ? 'LIVE' : 'ENDED'} · {MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}
            {status !== 'open' && <span className="text-amber-200"> · reconnecting</span>}
          </p>
          <h1 className="truncate text-[clamp(1.5rem,2.2vw,3rem)] font-bold">{viewer.name}</h1>
        </header>
        <div className="flex items-center gap-[1vw]">
          <QrCode url={qrUrl} size={150} label={viewer.settings.selfCheckIn ? 'QR code for self check-in' : 'QR code for the player board'} />
          <div className="min-w-0">
            <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] text-mist">{viewer.settings.selfCheckIn ? 'Scan to check in' : 'Scan to follow on your phone'}</p>
            <p className="text-[clamp(1.25rem,1.8vw,2.5rem)] font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
          </div>
        </div>
        <section aria-label="Up next">
          <h2 className="text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon">Up next</h2>
          <ol className="mt-1 flex flex-wrap gap-2 text-[clamp(1rem,1.3vw,1.75rem)]">
            {viewer.waiting.slice(0, 8).map((w, i) => <li key={w.id} className="rounded-full bg-navy-800 px-3 py-1">{i + 1} · {w.name}</li>)}
            {viewer.waiting.length === 0 && <li className="text-mist">Everyone is on court</li>}
          </ol>
        </section>
        <FairnessPanel fairness={viewer.fairness} tv />
        <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} className="min-h-0 flex-1 overflow-hidden">
          <h2 className="text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon">{panel === 'standings' ? 'Standings' : 'Recent results'}</h2>
          {panel === 'standings' ? (
            <ol className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]">
              {viewer.standings.filter((row) => row.rank !== null).slice(0, 10).map((row) => (
                <li key={row.playerId} className="flex justify-between gap-2"><span className="truncate"><b className="text-pickle-neon">{row.rank}</b> {row.name}</span><span className="shrink-0 text-mist">{row.wins}–{row.losses}</span></li>
              ))}
            </ol>
          ) : (
            <ul className="mt-1 grid gap-1 text-[clamp(1rem,1.2vw,1.6rem)]">
              {viewer.recentResults.slice(0, 6).map((r) => (
                <li key={r.matchId} className="truncate">{r.courtLabel}: <b>{(r.winner === 'A' ? r.teamA : r.teamB).join(' & ')}</b>{r.scoreA !== null && ` ${Math.max(r.scoreA, r.scoreB)}–${Math.min(r.scoreA, r.scoreB)}`}</li>
              ))}
              {viewer.recentResults.length === 0 && <li className="text-mist">No results yet</li>}
            </ul>
          )}
        </section>
      </aside>
    </main>
  )
}
