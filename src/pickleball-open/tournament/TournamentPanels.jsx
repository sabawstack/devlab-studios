// src/pickleball-open/tournament/TournamentPanels.jsx
// The public board for a tournament (spec §7): courts and what is coming up,
// the draw (pools and bracket), and pair standings. Built only from the
// allowlisted viewer snapshot.
import { Panel } from '../components/ui.jsx'
import BracketView, { GameCard } from './BracketView.jsx'
import { nextGames } from './bracketLayout'
import ChampionBanner from './ChampionBanner.jsx'
import PairStandings from './PairStandings.jsx'

export default function TournamentPanels({ viewer, courtsGrid, me, section }) {
  const t = viewer.tournament
  const myPair = t.pairs.find((p) => p.playerIds.includes(me))?.id ?? null
  const coming = nextGames(t)
  const finished = t.phase === 'FINISHED'
  // Once finished a phone's Courts tab has no courts, so the final standings show there too (every tab but Draw).
  const standingsClass = finished ? `${section('draw').startsWith('hidden') ? 'block' : 'hidden'} lg:block` : section('standings')
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="grid content-start gap-5">
        <ChampionBanner champion={t.champion} />
        {t.phase === 'SETUP' && <p className="text-mist">The host is setting up the draw.</p>}
        {t.phase === 'DRAFT' && <p className="rounded-xl bg-navy-900 px-4 py-3 text-mist">Draft draw: the host may still change pairs and games before the start.</p>}
        {/* Once there are champions the courts are idle: the banner and standings say it all. */}
        {!finished && (
          <section className={section('courts')} aria-label="Courts">
            {courtsGrid}
            {coming.length > 0 && (
              // Bordered rather than a filled panel, so the game cards inside stand out from it.
              <div className="mt-4 rounded-2xl border border-navy-800 p-3">
                <h2 className="mb-2 font-bold">Coming up</h2>
                <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr))]">
                  {coming.map((game) => <GameCard key={game.id} fixture={game} highlight={myPair} />)}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
      <aside className={`${standingsClass} grid content-start gap-4`}>
        <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><PairStandings rows={t.standings} highlight={myPair} /></Panel>
      </aside>
      {/* The draw takes the full width on wide screens, so a bracket's rounds fit side by side. */}
      <section className={`${section('draw')} lg:col-span-full`} aria-label="Draw">
        <BracketView tournament={t} highlight={myPair} />
      </section>
    </div>
  )
}
