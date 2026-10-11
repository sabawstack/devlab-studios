import { Button, TeamNames } from './ui.jsx'

function minutesSince(iso) {
  return iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : 0
}

export default function CourtCard({ court, nameOf, ended = false, onStart, onGameOver, onEdit }) {
  const match = court.match
  const testId = `court-${court.position}`
  if (!court.enabled) {
    return <article data-testid={testId} className="rounded-2xl border border-navy-800 p-4 text-mist"><h3 className="font-bold text-white">{court.label}</h3><p className="mt-2 text-sm">Off</p></article>
  }
  if (!match) {
    return (
      <article data-testid={testId} className="rounded-2xl border border-dashed border-navy-700 p-4">
        <h3 className="font-bold">{court.label}</h3>
        <p className={`mt-2 text-sm ${court.blocked && !ended ? 'text-amber-200' : 'text-mist'}`} role={court.blocked && !ended ? 'status' : undefined}>
          {ended ? 'Session ended' : court.blocked ?? 'Waiting for players. Fills automatically when the next game ends.'}
        </p>
      </article>
    )
  }
  const proposed = match.status === 'PROPOSED'
  return (
    <article key={match.id} className={`pb-flip flex flex-col gap-3 rounded-2xl p-4 ${proposed ? 'border-2 border-dashed border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid={testId}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-bold">{court.label}</h3>
        <span className={`text-xs ${proposed ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{proposed ? 'Up next' : `${minutesSince(match.startedAt)} min`}</span>
      </div>
      <div className="grid gap-1 text-[15px]">
        <TeamNames side="A" names={match.teamA.map(nameOf)} />
        <TeamNames side="B" names={match.teamB.map(nameOf)} />
      </div>
      {proposed ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={() => onStart(match)}>Start</Button>
          <Button variant="ghost" onClick={() => onEdit(match)}>Edit</Button>
          <Button variant="quiet" className="col-span-2 !min-h-11 text-sm" onClick={() => onGameOver(match)}>Already played? Enter result</Button>
        </div>
      ) : (
        <Button variant="primary" onClick={() => onGameOver(match)}>Game over</Button>
      )}
    </article>
  )
}
