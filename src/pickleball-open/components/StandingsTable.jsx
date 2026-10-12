export default function StandingsTable({ rows, highlightId = null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Standings</caption>
        <thead className="text-xs text-mist">
          <tr><th className="py-2 pr-2">#</th><th className="py-2">Player</th><th className="py-2 text-right">W–L</th><th className="py-2 text-right">Win %</th><th className="py-2 text-right"><abbr title="Share of all points won in games with a score" className="no-underline">Pts won %</abbr></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId} className={`border-t border-navy-800 ${row.playerId === highlightId ? 'font-bold text-pickle-neon' : ''}`}>
              {/* The shared place (1, 2, 2, 4), as on the podium: players level on every tiebreak are not split by name. */}
              <td className="py-2 pr-2 font-bold text-pickle-neon">{row.place ?? '–'}</td>
              <td className="py-2">{row.name}{row.played === 0 && <span className="text-mist"> · no games yet</span>}</td>
              <td className="py-2 text-right">{row.wins}–{row.losses}</td>
              <td className="py-2 text-right">{row.winRate === null ? '–' : Math.round(row.winRate * 100)}</td>
              <td className="py-2 text-right">{row.pointsPct === null ? '–' : Math.round(row.pointsPct * 100)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mist">Ranked by win %, then the share of points won (games with a score only), then head-to-head. Just for today.</p>
    </div>
  )
}
