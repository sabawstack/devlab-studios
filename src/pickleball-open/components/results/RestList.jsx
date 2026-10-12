// src/pickleball-open/components/results/RestList.jsx
// Everyone below the podium, in rank order: place, name, W–L, win %, points won %.
import { winLoss } from '../../../lib/pickleball/open/results'

const pct = (value) => (value === null ? '–' : Math.round(value * 100))

export default function RestList({ rest, highlightIds = [], pairs = false }) {
  if (rest.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[15px]">
        <caption className="sr-only">Everyone else, in rank order</caption>
        <thead className="text-xs text-mist">
          <tr>
            <th className="py-2 pr-2">#</th>
            <th className="py-2">{pairs ? 'Pair' : 'Player'}</th>
            <th className="whitespace-nowrap py-2 text-right">W–L</th>
            <th className="py-2 pl-2 text-right">Win %</th>
            <th className="py-2 pl-2 text-right"><abbr title="Share of all points won in games with a score" className="no-underline">Pts won %</abbr></th>
          </tr>
        </thead>
        <tbody>
          {rest.map((entry) => (
            <tr key={entry.id} className={`border-t border-navy-800 ${highlightIds.includes(entry.id) ? 'font-bold text-pickle-neon' : ''}`}>
              <td className="py-2 pr-2 font-bold text-pickle-neon tabular-nums">{entry.place}</td>
              <td className="py-2 [overflow-wrap:anywhere]">{entry.name}</td>
              <td className="whitespace-nowrap py-2 text-right tabular-nums">{winLoss(entry)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">{pct(entry.winRate)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">{pct(entry.pointsPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
