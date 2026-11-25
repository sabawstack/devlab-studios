// TV mode (spec §7, §11): the same allowlisted viewer snapshot as the board,
// in large type, filling a TV-sized screen with 1–16 courts and no scrolling.
// Below lg it is a scrolling single column with a compact header instead.
// The side panel alternates standings and recent results (just standings while
// there are no results). Nothing on this screen is truncated. Once the session
// ends (or a tournament's last game is in) the final results fill the courts area.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatPublicCode } from '../lib/pickleball/open/codes'
import { MODE_INFO } from '../lib/pickleball/open/modes/info'
import { showsFinalResults } from '../lib/pickleball/open/results'
import { greetingFor } from './lib/greeting'
import { checkInLink, viewerLink } from './lib/hostKeys'
import { PANEL_MS, PANELS, tvColumns, tvRows } from './lib/tvLayout'
import { useNow } from './lib/useNow'
import { useOpenSession } from './lib/useOpenSession'
import { isFresh, REALTIME } from './lib/realtimeConfig'
import FairnessPanel from './components/FairnessPanel.jsx'
import FitList from './components/FitList.jsx'
import QrCode from './components/QrCode.jsx'
import TvCourt from './components/TvCourt.jsx'
import TvMarquee from './components/TvMarquee.jsx'
import { nextGames } from './tournament/bracketLayout'
import { HELD_LABEL, NEXT_FOUR_NOTE, nextFourLabel, QUEUE_RULE, WAITING, waitingNote } from './lib/queueVocabulary'
import ResultsScreen from './components/results/ResultsScreen.jsx'
import ChampionAnnouncer from './tournament/ChampionAnnouncer.jsx'

const WRAP = '[overflow-wrap:anywhere]'
const H2 = 'text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pb-play'

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
        {body && <p className="mt-4 text-[clamp(1.1rem,2.2vw,2.5rem)] text-pb-ink-2">{body}</p>}
      </div>
    </main>
  )
}

function LiveState({ viewer, live, lastAt }) {
  if (viewer.status !== 'ACTIVE') return <span className="text-pb-ink-2">ENDED</span>
  if (showsFinalResults(viewer)) return <span className="text-pb-ink-2">FINISHED</span>
  if (live) return <span className="inline-flex items-center gap-2"><span className="pb-pulse h-3 w-3 rounded-full bg-pb-play" aria-hidden="true" />LIVE</span>
  return <span className="text-amber-200">Offline · showing data from {clock(lastAt)}</span>
}

/** Tournament standings are by pair (spec §6.7); open play's are by player. */
function PairTable({ tournament }) {
  const rows = tournament.standings.filter((row) => row.played > 0).slice(0, 16).map((row) => ({
    key: row.entrantId,
    content: <span className="flex justify-between gap-2"><span className={WRAP}><b className="text-pb-play">{row.rank}</b> {row.name}</span><span className="shrink-0 text-pb-ink-2">{row.wins}–{row.losses}</span></span>,
  }))
  if (rows.length === 0) return <p className="mt-1 text-pb-ink-2">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

function Standings({ viewer }) {
  if (viewer.tournament) return <PairTable tournament={viewer.tournament} />
  const rows = viewer.standings.filter((row) => row.rank !== null).slice(0, 16).map((row) => ({
    key: row.playerId,
    content: <span className="flex justify-between gap-2"><span className={WRAP}><b className="text-pb-play">{row.rank}</b> {row.name}</span><span className="shrink-0 text-pb-ink-2">{row.wins}–{row.losses}</span></span>,
  }))
  if (rows.length === 0) return <p className="mt-1 text-pb-ink-2">No games finished yet</p>
  return <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]" />
}

/** A tournament's next games, in the server's order (tournament.comingUp), with why a game waits. */
function ComingUp({ tournament }) {
  const rows = nextGames(tournament, 6).map((game) => ({
    key: game.id,
    content: <span className={WRAP}><b>{game.label}</b>: {game.nameA} vs {game.nameB}{game.held && <span className="text-pb-ink-2"> · {HELD_LABEL[game.held]}</span>}</span>,
  }))
  return (
    <section aria-label="Coming up" className="flex max-h-[30vh] min-h-0 shrink flex-col">
      <h2 className={H2}>Coming up</h2>
      {rows.length === 0
        ? <p className="mt-1 text-[clamp(1.125rem,1.4vw,1.75rem)] text-pb-ink-2">Waiting for results</p>
        : <FitList rows={rows} className="mt-1 grid gap-1 text-[clamp(1.125rem,1.4vw,1.75rem)]" />}
    </section>
  )
}

const more = (n) => <span className="text-[clamp(0.9rem,1.1vw,1.5rem)] text-pb-ink-2">and {n} more on the player board</span>

/**
 * The open-play queue on the TV (PB-QUEUE-04): the four on deck with their
 * court and teams (PB-QUEUE-09), then everyone waiting, unnumbered. Confirmed calls stay on
 * the court tiles. Rows that do not fit are counted, never dropped silently.
 */
function TvQueue({ viewer }) {
  const note = waitingNote(viewer)
  const chip = `rounded-2xl bg-pb-raised px-3 py-1 ${WRAP}`
  const waiting = viewer.waiting.map((w) => ({ key: w.id, content: w.name }))
  return (
    <>
      {viewer.nextUp && (
        <section aria-label="Next four" data-testid="tv-next-four" className="shrink-0">
          <h2 className={H2}>{nextFourLabel(viewer.nextUp.court)}</h2>
          <ul className="mt-1 flex flex-wrap items-center gap-2 text-[clamp(1rem,1.3vw,1.75rem)]">
            {[viewer.nextUp.teamA, viewer.nextUp.teamB].map((team, i) => (
              <li key={i} className={`rounded-2xl border-2 border-dashed border-pb-play px-3 py-1 ${WRAP}`}>{team.join(' & ')}</li>
            ))}
          </ul>
          <p className="text-[clamp(0.8rem,0.9vw,1.25rem)] text-pb-ink-2">{NEXT_FOUR_NOTE}</p>
        </section>
      )}
      <section aria-label="Waiting" data-testid="tv-waiting" className="flex max-h-[26vh] min-h-0 shrink flex-col">
        <h2 className={H2}>{WAITING} ({viewer.waiting.length})</h2>
        <p className="text-[clamp(0.8rem,0.9vw,1.25rem)] text-pb-ink-2">{QUEUE_RULE}</p>
        {waiting.length === 0
          ? <p className="mt-1 text-[clamp(1rem,1.3vw,1.75rem)] text-pb-ink-2">{viewer.nextUp ? 'Nobody else is waiting' : 'Everyone is on court'}</p>
          : <FitList rows={waiting} className="mt-1 flex flex-wrap gap-2 text-[clamp(1rem,1.3vw,1.75rem)]" rowClassName={chip} more={more} />}
        {note && <p className="shrink-0 text-[clamp(0.9rem,1.1vw,1.5rem)] font-semibold">{note}</p>}
      </section>
    </>
  )
}

/** Below lg the side panel is hidden, so the queue follows the courts in a plain scrolling list (PB-QUEUE-04). */
function CompactQueue({ viewer }) {
  const note = waitingNote(viewer)
  return (
    <section aria-label="Queue" data-testid="tv-compact-queue" className="grid gap-3 rounded-2xl bg-pb-surface p-4 text-lg lg:hidden">
      {viewer.nextUp && (
        <div>
          <h2 className="font-bold text-pb-play">{nextFourLabel(viewer.nextUp.court)}</h2>
          <p className={WRAP}>{viewer.nextUp.teamA.join(' & ')} <span className="text-pb-ink-2">vs</span> {viewer.nextUp.teamB.join(' & ')}</p>
          <p className="text-sm text-pb-ink-2">{NEXT_FOUR_NOTE}</p>
        </div>
      )}
      <div>
        <h2 className="font-bold text-pb-play">{WAITING} ({viewer.waiting.length})</h2>
        <p className="text-sm text-pb-ink-2">{QUEUE_RULE}</p>
        <ul className="mt-1 flex flex-wrap gap-2">
          {viewer.waiting.map((w) => <li key={w.id} className={`rounded-2xl bg-pb-raised px-3 py-1 ${WRAP}`}>{w.name}</li>)}
        </ul>
        {note && <p className="mt-1 font-semibold">{note}</p>}
      </div>
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
  const { status, viewer, lastSnapshotAt, lastContactAt } = useOpenSession(code, null)
  const now = useNow(5000)
  const [openedAt] = useState(() => Date.now())
  const width = useSyncExternalStore(subscribeResize, viewportWidth, () => 1280)
  const hasResults = Boolean(viewer?.recentResults.length)
  const panel = usePanel(hasResults)

  if (!code || status === 'not-found') {
    return <TvNotice title="This session has ended and its results were deleted." body="Sessions are deleted 7 days after their last change." />
  }
  if (!viewer) {
    return now - openedAt > REALTIME.staleMs
      ? <TvNotice title="Can't reach the board" body="Trying again every few seconds." />
      : <TvNotice title="Loading the board…" />
  }

  // PB-REALTIME-01: live means recent server contact, not an open socket.
  const live = isFresh(lastContactAt, now)
  // A finished tournament shows its final standings before the host ends it: treat it as over.
  const final = showsFinalResults(viewer)
  const courts = viewer.courts.filter((c) => c.state !== 'OFF')
  const cols = tvColumns(courts.length)
  const rows = tvRows(courts.length)
  const origin = window.location.origin
  // Once the final standings show, check-in is over, so the QR points at the board.
  const checkIn = viewer.settings.selfCheckIn && !final
  const qrUrl = checkIn ? checkInLink(origin, code) : viewerLink(origin, code)
  const qrLabel = checkIn ? 'QR code for self check-in' : 'QR code for the player board'
  const qrSize = Math.round(Math.min(220, Math.max(120, width * 0.08)))
  const tournament = viewer.tournament
  const modeLabel = tournament ? tournament.formatLabel : MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'
  // Before the start there is nothing on court yet: say so instead of showing empty courts.
  const preStart = tournament?.phase === 'SETUP' || tournament?.phase === 'DRAFT'
  // One overlay fills the courts area at a time: the final results, or the coming draw.
  const overlay = final ? 'results' : preStart ? 'draw' : null
  const grid = { '--tv-cols': cols, '--tv-rows': rows }
  // The results' "Thanks for playing" header replaces the greeting and the welcome line.
  const results = overlay === 'results'
  const greeting = results ? null : greetingFor(new Date(now))
  const announcement = results ? '' : viewer.announcement

  return (
    <main className={`pb-fit grid grid-cols-1 gap-4 p-4 lg:h-screen lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26vw)] lg:gap-[1.2vw] lg:overflow-hidden lg:p-[1.2vw] ${announcement ? 'lg:grid-rows-[minmax(0,1fr)_auto]' : ''}`}>
      {/* Below lg there is no side panel, so the essentials sit in a compact header. */}
      <header className="lg:hidden">
        <p className="text-sm font-bold text-pb-play"><LiveState viewer={viewer} live={live} lastAt={lastSnapshotAt} /> · {modeLabel}</p>
        <h1 className={`text-2xl font-bold ${WRAP}`}>{viewer.name}</h1>
        {greeting && <p className="text-base font-semibold text-pb-play">{greeting}</p>}
        <p className="whitespace-nowrap text-lg font-bold tracking-[0.05em] text-pb-play">{formatPublicCode(code)}</p>
      </header>
      <section
        aria-label="Courts"
        style={grid}
        className="grid min-h-0 grid-cols-1 gap-3 lg:gap-[1vw] lg:[grid-template-columns:repeat(var(--tv-cols),minmax(0,1fr))] lg:[grid-template-rows:repeat(var(--tv-rows),minmax(0,1fr))]"
      >
        {overlay === 'results' && <ResultsScreen viewer={viewer} tv />}
        {overlay === 'draw' && (
          <div className="grid place-content-center rounded-2xl bg-pb-surface p-8 text-center lg:col-span-full lg:row-span-full" data-testid="tv-draw-note">
            <p className="text-[clamp(2rem,5vw,6rem)] font-bold leading-tight">{tournament.phase === 'SETUP' ? 'The draw is coming soon' : 'Draft draw'}</p>
            <p className="mt-[0.5em] text-[clamp(1.25rem,2.5vw,3rem)] text-pb-ink-2">Pairs and games may still change before the start.</p>
          </div>
        )}
        {!overlay && courts.length === 0 && <p className="grid place-items-center rounded-2xl bg-pb-surface p-8 text-center text-[clamp(1.5rem,3.5vw,4rem)] font-bold text-pb-ink-2 lg:col-span-full lg:row-span-full">No courts are in play right now</p>}
        {!overlay && courts.map((court) => <TvCourt key={court.id} court={court} fresh={live} next={viewer.nextUp?.courtId === court.id ? viewer.nextUp : null} />)}
      </section>
      {!overlay && !tournament && <CompactQueue viewer={viewer} />}
      <aside className="hidden min-h-0 flex-col gap-[1vw] overflow-hidden lg:flex">
        <header>
          <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] font-bold text-pb-play"><LiveState viewer={viewer} live={live} lastAt={lastSnapshotAt} /> · {modeLabel}</p>
          <h1 className={`text-[clamp(1.25rem,1.8vw,2.5rem)] font-bold leading-tight ${WRAP}`}>{viewer.name}</h1>
          {greeting && <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] font-semibold text-pb-play">{greeting}</p>}
        </header>
        <div className="flex items-center gap-[1vw]">
          <div data-testid="tv-qr" data-url={qrUrl} className="shrink-0"><QrCode url={qrUrl} size={qrSize} label={qrLabel} /></div>
          <div className="min-w-0">
            <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] text-pb-ink-2">{checkIn ? 'Scan to check in' : final ? 'Scan for the final standings' : 'Scan to follow on your phone'}</p>
            <p className="whitespace-nowrap text-[clamp(1rem,1.5vw,2.25rem)] font-bold tracking-[0.04em] text-pb-play">{formatPublicCode(code)}</p>
          </div>
        </div>
        {!overlay && (tournament ? <ComingUp tournament={tournament} /> : <TvQueue viewer={viewer} />)}
        {/* Fairness is about open-play rotation; a tournament's draw decides who plays. The final results already rank everyone. */}
        {!tournament && overlay !== 'results' && <div className="shrink-0"><FairnessPanel fairness={viewer.fairness} tv /></div>}
        {overlay !== 'results' && (
          <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} data-testid="tv-panel" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <h2 className={H2}>{panel === 'standings' ? 'Standings' : 'Recent results'}</h2>
            {panel === 'standings' ? <Standings viewer={viewer} /> : <Results viewer={viewer} />}
          </section>
        )}
      </aside>
      {/* Outside the side panel, which phones hide: a hidden live region is never announced. */}
      {tournament && <ChampionAnnouncer champion={tournament.champion} />}
      {announcement && (
        <footer aria-label="Welcome message" className="rounded-2xl bg-pb-surface px-4 py-2 text-xl font-semibold lg:col-span-2 lg:-mt-[0.6vw] lg:px-[1.2vw] lg:py-[0.2vw] lg:text-[clamp(1rem,1.5vw,2.25rem)] lg:leading-tight">
          <TvMarquee text={announcement} />
        </footer>
      )}
    </main>
  )
}
