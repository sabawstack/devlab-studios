import { Button } from './ui.jsx'

export default function ResultsList({ finished, nameOf, courtLabel, onEdit }) {
  if (!finished.length) return <p className="text-sm text-mist">No results yet.</p>
  return (
    <ul className="grid gap-1.5">
      {finished.map((m) => (
        <li key={m.id} className="flex items-center gap-3 rounded-xl bg-navy-900 px-3 py-2 text-sm">
          <span className="w-16 text-xs text-mist">{courtLabel(m.courtId)}</span>
          <span className="flex-1">
            <span className={m.winner === 'A' ? 'font-bold' : ''}>{m.teamA.map(nameOf).join(' · ')}</span>
            <span className="text-mist"> vs </span>
            <span className={m.winner === 'B' ? 'font-bold' : ''}>{m.teamB.map(nameOf).join(' · ')}</span>
          </span>
          <span className="font-bold">{m.scoreA === null ? `${m.winner} won` : `${m.scoreA}–${m.scoreB}`}</span>
          <Button variant="quiet" className="!min-h-9 !px-2" onClick={() => onEdit(m)}>Edit</Button>
        </li>
      ))}
    </ul>
  )
}
