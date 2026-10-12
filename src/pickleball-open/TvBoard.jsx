// TV mode (spec §7, §11): the same allowlisted viewer snapshot as the board,
// in large type, filling a TV-sized screen with 1–16 courts and no scrolling.
// Below lg it is a scrolling single column with a compact header instead.
// The side panel alternates standings and recent results (just standings while
// there are no results). Nothing on this screen is truncated.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatPublicCode } from '../lib/pickleball/open/codes'
import { MODE_INFO } from '../lib/pickleball/open/modes/info'
import { greetingFor } from './lib/greeting'
import { checkInLink, viewerLink } from './lib/hostKeys'
import { PANEL_MS, PANELS, tvColumns, tvRows } from './lib/tvLayout'
import { useNow } from './lib/useNow'
import { useOpenSession } from './lib/useOpenSession'
import FairnessPanel from './components/FairnessPanel.jsx'
import FitList from './components/FitList.jsx'
import QrCode from './components/QrCode.jsx'
import TvCourt from './components/TvCourt.jsx'
import TvMarquee from './components/TvMarquee.jsx'
import { nextGames } from './tournament/bracketLayout'
import ChampionBanner from './tournament/ChampionBanner.jsx'

const STALE_MS = 15_000
const WRAP = '[overflow-wrap:anywhere]'
const H2 = 'text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon'

function subscribeResize(callback) {
  window.addEventListener('resize', callback)
  return () => window.removeEventListener('resize', callback)
}
const viewportWidth = () => window.innerWidth

/** Rotates through the panels that have something to show. */
function usePanel(hasResults) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => i + 1), PANEL_MS)
    return () => clearInterval(timer)
  }, [])
  const panels = hasResults ? PANELS : PANELS.slice(0, 1)
  return panels[index % panels.length]
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function TvNotice({ title, body }) {
  return (
    <main className="grid min-h-screen place-items-center p-8 text-center">
      <div className="max-w-5xl">
        <h1 className="text-[clamp(2rem,5vw,6rem)] font-bold leading-tight">{title}</h1>
        {body && <p className="mt-4 text-[clamp(1.1rem,2.2vw,2.5rem)] text-mist">{body}</p>}
      </div>
    </main>
  )
}

function LiveState({ viewer, live, lastAt }) {
  if (viewer.status !== 'ACTIVE') return <span className="text-mist">ENDED</span>
  if (live) return <span className="inline-flex items-center gap-2"><span className="pb-pulse h-3 w-3 rounded-full bg-pickle-neon" aria-hidden="true" />LIVE</span>
  return <span className="text-amber-200">Offline · showing data from {clock(lastAt)}</span>
}

/** Tournament standings are by pair (spec §6.7); open play's are by player. */
function PairTable({ tournament }) {
  const rows = tournament.standings.filter((row) => row.played > 0).slice(0, 16).map((row) => ({
    key: row.entrantId,
    content: <span className="flex justify-between gap-2"><span className={WRAP}><b className="text-pickle-neon">{row.rank}</b> {row.name}</span><span className="shrink-0 text-mist">{row.wins}–{row.losses}</span></span>,
  }))
  if (rows.length === 0) return <p className="mt-1 text-mist">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

function Standings({ viewer }) {
  if (viewer.tournament) return <PairTable tournament={viewer.tournament} />
  const rows = viewer.standings.filter((row) => row.rank !== null).slice(0, 16).map((row) => ({
    key: row.playerId,
    content: <span className="flex justify-between gap-2"><span className={WRAP}><b className="text-pickle-neon">{row.rank}</b> {row.name}</span><span className="shrink-0 text-mist">{row.wins}–{row.losses}</span></span>,
  }))
  if (rows.length === 0) return <p className="mt-1 text-mist">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

/** A tournament's next games from the draw, in the order courts take them. */
function ComingUp({ tournament }) {
  const rows = nextGames(tournament, 6).map((game) => ({ key: game.id, content: <span className={WRAP}><b>{game.label}</b>: {game.nameA} vs {game.nameB}</span> }))
  return (
    <section aria-label="Coming up" className="flex max-h-[30vh] min-h-0 shrink flex-col">
      <h2 className={H2}>Coming up</h2>
      {rows.length === 0
        ? <p className="mt-1 text-[clamp(1.125rem,1.4vw,1.75rem)] text-mist">Waiting for results</p>
        : <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1.125rem,1.4vw,1.75rem)]" />}
    </section>
  )
}

/** Who walks on next: only as many whole names as the space left allows, so the fairness numbers below always show. */
function UpNext({ viewer }) {
  const rows = viewer.waiting.slice(0, 8).map((w, i) => ({ key: w.id, content: `${i + 1} · ${w.name}` }))
  return (
    <section aria-label="Up next" className="flex max-h-[26vh] min-h-0 shrink flex-col">
      <h2 className={H2}>Up next</h2>
      {rows.length === 0
        ? <p className="mt-1 text-[clamp(1rem,1.3vw,1.75rem)] text-mist">Everyone is on court</p>
        : <FitList rows={rows} className="mt-1 flex flex-wrap gap-2 text-[clamp(1rem,1.3vw,1.75rem)]" rowClassName={`rounded-2xl bg-navy-800 px-3 py-1 ${WRAP}`} />}
    </section>
  )
}

function Results({ viewer }) {
  const rows = viewer.recentResults.slice(0, 8).map((r) => ({
    key: r.matchId,
    content: <span className={WRAP}>{r.courtLabel}: <b>{(r.winner === 'A' ? r.teamA : r.teamB).join(' & ')}</b>{r.scoreA !== null && ` ${Math.max(r.scoreA, r.scoreB)}–${Math.min(r.scoreA, r.scoreB)}`}</span>,
  }))
  return <FitList as="ul" rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.2vw,1.6rem)]" />
}

export default function TvBoard({ code }) {
  const { status, viewer, lastSnapshotAt } = useOpenSession(code, null)
  const now = useNow(5000)
  const [openedAt] = useState(() => Date.now())
  const width = useSyncExternalStore(subscribeResize, viewportWidth, () => 1280)
  const hasResults = Boolean(viewer?.recentResults.length)
  const panel = usePanel(hasResults)

  if (!code || status === 'not-found') {
    return <TvNotice title="This session has ended and its results were deleted." body="Sessions are deleted 7 days after their last change." />
  }
  if (!viewer) {
    return now - openedAt > STALE_MS
      ? <TvNotice title="Can't reach the board" body="Trying again every few seconds." />
      : <TvNotice title="Loading the board…" />
  }

  const live = status === 'open' || (lastSnapshotAt !== null && now - lastSnapshotAt < STALE_MS)
  const ended = viewer.status !== 'ACTIVE'
  const courts = viewer.courts.filter((c) => c.state !== 'OFF')
  const cols = tvColumns(courts.length)
  const rows = tvRows(courts.length)
  const origin = window.location.origin
  // Check-in is refused once a session ends, so the QR then points at the board.
  const checkIn = viewer.settings.selfCheckIn && !ended
  const qrUrl = checkIn ? checkInLink(origin, code) : viewerLink(origin, code)
  const qrLabel = checkIn ? 'QR code for self check-in' : 'QR code for the player board'
  const qrSize = Math.round(Math.min(220, Math.max(120, width * 0.08)))
  const tournament = viewer.tournament
  const modeLabel = tournament ? tournament.formatLabel : MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'
  const champion = tournament?.phase === 'FINISHED' ? tournament.champion : null
  // Before the start there is nothing on court yet: say so instead of showing empty courts.
  const preStart = tournament?.phase === 'SETUP' || tournament?.phase === 'DRAFT'
  // One overlay fills the courts area at a time: the champions (with "Session ended" under them), the end, or the coming draw.
  const overlay = champion ? 'champion' : ended ? 'ended' : preStart ? 'draw' : null
  const grid = { '--tv-cols': cols, '--tv-rows': rows }
  const greeting = greetingFor(new Date(now))
  const announcement = viewer.announcement

  return (
    <main className={`grid grid-cols-1 gap-4 p-4 lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26vw)] lg:gap-[1.2vw] lg:overflow-hidden lg:p-[1.2vw] ${announcement ? 'lg:grid-rows-[minmax(0,1fr)_auto]' : ''}`}>
      {/* Below lg there is no side panel, so the essentials sit in a compact header. */}
      <header className="lg:hidden">
        <p className="text-sm font-bold text-pickle-neon"><LiveState viewer={viewer} live={live} lastAt={lastSnapshotAt} /> · {modeLabel}</p>
        <h1 className={`text-2xl font-bold ${WRAP}`}>{viewer.name}</h1>
        <p className="text-base font-semibold text-pickle-neon">{greeting}</p>
        <p className="whitespace-nowrap text-lg font-bold tracking-[0.05em] text-pickle-neon">{formatPublicCode(code)}</p>
      </header>
      <section
        aria-label="Courts"
        style={grid}
        className="grid min-h-0 grid-cols-1 gap-3 lg:gap-[1vw] lg:[grid-template-columns:repeat(var(--tv-cols),minmax(0,1fr))] lg:[grid-template-rows:repeat(var(--tv-rows),minmax(0,1fr))]"
      >
        {overlay === 'ended' && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(2rem,6vw,7rem)] font-bold lg:col-span-full lg:row-span-full" role="status">Session ended</p>}
        {overlay === 'champion' && (
          <div className="grid place-content-center justify-items-center gap-[1.5vw] text-center lg:col-span-full lg:row-span-full">
            <ChampionBanner champion={champion} tv />
            {ended && <p className="text-[clamp(1.25rem,2.5vw,3rem)] font-bold text-mist">Session ended</p>}
          </div>
        )}
        {overlay === 'draw' && (
          <div className="grid place-content-center rounded-2xl bg-navy-900 p-8 text-center lg:col-span-full lg:row-span-full" data-testid="tv-draw-note">
            <p className="text-[clamp(2rem,5vw,6rem)] font-bold leading-tight">{tournament.phase === 'SETUP' ? 'The draw is coming soon' : 'Draft draw'}</p>
            <p className="mt-[0.5em] text-[clamp(1.25rem,2.5vw,3rem)] text-mist">Pairs and games may still change before the start.</p>
          </div>
        )}
        {!overlay && courts.length === 0 && <p className="grid place-items-center rounded-2xl bg-navy-900 p-8 text-center text-[clamp(1.5rem,3.5vw,4rem)] font-bold text-mist lg:col-span-full lg:row-span-full">No courts are in play right now</p>}
        {!overlay && courts.map((court) => <TvCourt key={court.id} court={court} />)}
      </section>
      <aside className="hidden min-h-0 flex-col gap-[1vw] overflow-hidden lg:flex">
        <header>
          <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] font-bold text-pickle-neon"><LiveState viewer={viewer} live={live} lastAt={lastSnapshotAt} /> · {modeLabel}</p>
          <h1 className={`text-[clamp(1.25rem,1.8vw,2.5rem)] font-bold leading-tight ${WRAP}`}>{viewer.name}</h1>
          <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] font-semibold text-pickle-neon">{greeting}</p>
        </header>
        <div className="flex items-center gap-[1vw]">
          <QrCode url={qrUrl} size={qrSize} label={qrLabel} />
          <div className="min-w-0">
            <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] text-mist">{checkIn ? 'Scan to check in' : ended ? 'Scan for the final standings' : 'Scan to follow on your phone'}</p>
            <p className="whitespace-nowrap text-[clamp(1rem,1.5vw,2.25rem)] font-bold tracking-[0.04em] text-pickle-neon">{formatPublicCode(code)}</p>
          </div>
        </div>
        {!overlay && (tournament ? <ComingUp tournament={tournament} /> : <UpNext viewer={viewer} />)}
        {/* Fairness is about open-play rotation; a tournament's draw decides who plays. */}
        {!tournament && <div className="shrink-0"><FairnessPanel fairness={viewer.fairness} tv /></div>}
        <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} data-testid="tv-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <h2 className={H2}>{panel === 'standings' ? 'Standings' : 'Recent results'}</h2>
          {panel === 'standings' ? <Standings viewer={viewer} /> : <Results viewer={viewer} />}
        </section>
      </aside>
      {announcement && (
        <footer aria-label="Welcome message" className="rounded-2xl bg-navy-900 px-4 py-2 text-xl font-semibold lg:col-span-2 lg:-mt-[0.6vw] lg:px-[1.2vw] lg:py-[0.2vw] lg:text-[clamp(1rem,1.5vw,2.25rem)] lg:leading-tight">
          <TvMarquee text={announcement} />
        </footer>
      )}
    </main>
  )
}
