export default function StandingsTable({ rows, highlightId = null, compact = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Standings</caption>
        <thead className="text-xs text-mist">
          <tr><th className="py-2 pr-2">#</th><th className="py-2">Player</th><th className="py-2 text-right">W–L</th><th className="py-2 text-right">Win %</th>{!compact && <th className="py-2 text-right">+/− per game</th>}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.playerId} className={`border-t border-navy-800 ${row.playerId === highlightId ? 'font-bold text-pickle-neon' : ''}`}>
              <td className="py-2 pr-2 font-bold text-pickle-neon">{row.rank ?? '–'}</td>
              <td className="py-2">{row.name}{row.played === 0 && <span className="text-mist"> · no games yet</span>}</td>
              <td className="py-2 text-right">{row.wins}–{row.losses}</td>
              <td className="py-2 text-right">{row.winRate === null ? '–' : Math.round(row.winRate * 100)}</td>
              {!compact && <td className="py-2 text-right">{row.avgDiff === null ? '–' : `${row.avgDiff > 0 ? '+' : ''}${row.avgDiff.toFixed(1)}`}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mist">Ranked by win %, then point difference per game, then points per game, then head-to-head. Just for today.</p>
    </div>
  )
}
