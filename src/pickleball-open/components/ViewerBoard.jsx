// src/pickleball-open/components/ViewerBoard.jsx
import { useState } from 'react'
import { MODE_INFO } from '../../lib/pickleball/open/modes/info'
import { readMe, writeMe } from '../lib/me'
import { myStatus } from '../lib/myStatus'
import StandingsTable from './StandingsTable.jsx'
import { Panel, TeamNames } from './ui.jsx'


const COURT_STATE = { PLAYING: 'Playing', UP_NEXT: 'Walk on now', WAITING_FOR_PLAYERS: 'Waiting for players', OFF: 'Off' }

function MeBanner({ status }) {
  const text = {
    PLAYING: `You're playing on ${status.court}`,
    UP_NEXT: `You're up on ${status.court}: walk on`,
    WAITING: `You're #${status.place} in line`,
    BREAK: "You're on a break",
  }[status.kind]
  if (!text) return null
  return <p className="rounded-2xl bg-pickle-neon px-4 py-3 text-lg font-bold text-ink" role="status">{text}</p>
}

export default function ViewerBoard({ viewer, status, invalidHostLink, revokedCaptainLink = false }) {
  const [me, setMe] = useState(() => readMe(viewer.code))
  const [tab, setTab] = useState('courts')
  const mine = myStatus(viewer, me)
  const myName = viewer.roster.find((p) => p.id === me)?.name
  const expires = new Date(viewer.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const courtCount = viewer.courts.filter((c) => c.state !== 'OFF').length
  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <main className="mx-auto grid max-w-[1500px] gap-4 px-3 pb-10 pt-4 sm:px-5">
      {revokedCaptainLink && <p role="alert" className="rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">This captain link was turned off by the host. You're seeing the player board.</p>}
      {invalidHostLink && <p role="alert" className="rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">That host link isn't valid for this session. You're seeing the player board.</p>}
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <p className="flex items-center gap-2 text-xs font-bold text-pickle-neon">
            <span className={`h-2 w-2 rounded-full bg-pickle-neon ${viewer.status === 'ACTIVE' ? 'pb-pulse' : ''}`} aria-hidden="true" />
            {viewer.status === 'ACTIVE' ? 'LIVE' : 'ENDED'}{status !== 'open' && <span className="text-amber-200"> · reconnecting</span>}
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">{viewer.name}</h1>
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {courtCount} court{courtCount === 1 ? '' : 's'} · {MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}</p>
          {viewer.settings.selfCheckIn && viewer.status === 'ACTIVE' && (
            <a href={`/pickleball/s/${viewer.code}/check-in`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-pickle-neon underline underline-offset-4">Not on the list? Check in</a>
          )}
        </div>
        <label className="grid gap-1 text-xs text-mist">I'm…
          <select value={me} onChange={(e) => { setMe(e.target.value); writeMe(viewer.code, e.target.value) }}
            className="min-h-11 rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white">
            <option value="">Pick your name</option>
            {viewer.roster.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </header>

      <MeBanner status={mine} />

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-navy-900 p-1 lg:hidden" role="tablist" aria-label="Board sections">
        {[['courts', 'Courts'], ['standings', 'Standings'], ['results', 'Results']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`min-h-11 rounded-lg text-sm ${tab === key ? 'bg-pickle-neon font-bold text-ink' : 'text-mist'}`}>{label}</button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className={section('courts')} aria-label="Courts">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {viewer.courts.map((court) => (
              <article key={`${court.id}-${court.teamA.join()}`} className={`pb-flip rounded-2xl p-4 ${court.state === 'UP_NEXT' ? 'border-2 border-pickle-neon' : 'bg-navy-900'}`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="text-2xl font-bold text-pickle-neon">{court.label}</h2>
                  <span className={`text-xs ${court.state === 'UP_NEXT' ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{COURT_STATE[court.state]}</span>
                </div>
                {court.teamA.length > 0 && (
                  <div className="mt-2 grid gap-1 text-[15px]">
                    <TeamNames side="A" names={court.teamA} emphasis={myName ? [myName] : []} />
                    <TeamNames side="B" names={court.teamB} emphasis={myName ? [myName] : []} />
                  </div>
                )}
              </article>
            ))}
          </div>
          <Panel className="mt-4">
            <h2 className="font-bold">Waiting</h2>
            <ol className="mt-2 flex flex-wrap gap-1.5 text-sm">
              {viewer.waiting.map((w, i) => <li key={w.id} className={`rounded-full px-3 py-1 ${w.id === me ? 'bg-pickle-neon font-bold text-ink' : 'bg-navy-800'}`}>{i + 1} · {w.name}</li>)}
              {viewer.onBreak.map((p) => <li key={p.id} className="rounded-full bg-navy-900 px-3 py-1 text-mist">{p.name} · break</li>)}
            </ol>
          </Panel>
        </section>
        <aside className="grid content-start gap-4">
          <Panel className={section('standings')}><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={viewer.standings} highlightId={me} /></Panel>
          <Panel className={section('results')}>
            <h2 className="mb-2 text-lg font-bold">Recent results</h2>
            {viewer.recentResults.length === 0 ? <p className="text-sm text-mist">No results yet.</p> : (
              <ul className="grid gap-1.5 text-sm">
                {viewer.recentResults.map((r) => (
                  <li key={r.matchId}>{r.courtLabel}: <b>{(r.winner === 'A' ? r.teamA : r.teamB).join(' · ')}</b> beat {(r.winner === 'A' ? r.teamB : r.teamA).join(' · ')}{r.scoreA !== null && ` ${Math.max(r.scoreA, r.scoreB)}–${Math.min(r.scoreA, r.scoreB)}`}</li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
      <footer className="grid gap-3 pt-2 text-center">
        <p className="text-xs text-mist">Results are deleted from the live service 7 days after the last change to this session ({expires}). No sign-up; this phone only remembers which name you picked.</p>
        <a href="/pickleball/new" className="mx-auto inline-flex min-h-11 items-center rounded-xl border border-navy-700 px-5 hover:bg-navy-900">Run your own games, free</a>
      </footer>
    </main>
  )
}
