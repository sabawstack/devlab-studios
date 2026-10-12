// src/pickleball-open/tournament/PairStandings.jsx
// Pair standings (spec §6.7): wins, then losses, then point difference, then
// head-to-head, as ranked by the reused rankTournamentStandings.
export default function PairStandings({ rows, highlight = null, compact = false }) {
  if (!rows.length) return <p className="text-sm text-mist">No pairs yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Pair standings</caption>
        <thead className="text-xs text-mist">
          <tr><th className="py-1.5 pr-2">#</th><th className="py-1.5">Pair</th><th className="whitespace-nowrap py-1.5 text-right">W–L</th><th className="py-1.5 text-right"><abbr title="Points won minus points lost" className="no-underline">+/−</abbr></th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.entrantId} className={`border-t border-navy-800 ${row.entrantId === highlight ? 'font-bold text-pickle-neon' : ''}`}>
              <td className="py-1.5 pr-2 font-bold text-pickle-neon">{row.played ? row.rank : '–'}</td>
              <td className="py-1.5 [overflow-wrap:anywhere]">{row.name}</td>
              <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{row.wins}–{row.losses}</td>
              <td className="py-1.5 text-right tabular-nums">{row.pointDifferential > 0 ? `+${row.pointDifferential}` : row.pointDifferential}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && <p className="mt-2 text-xs text-mist">Ranked by wins, then fewest losses, then points won minus points lost, then the game between tied pairs.</p>}
    </div>
  )
}
