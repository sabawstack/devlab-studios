import { useState } from 'react'
import { validateResult } from '../../lib/pickleball/open/scoreValidation'
import { resultFromPad, scorePadOptions } from './scorePad'
import { Button, Sheet } from './ui.jsx'

export default function GameOverDialog({ title, match, nameOf, settings, initial, onSave, onAbandon, onClose }) {
  const [winner, setWinner] = useState(initial?.winner ?? null)
  const [loserScore, setLoserScore] = useState(initial && initial.scoreA !== null ? Math.min(initial.scoreA, initial.scoreB) : null)
  const [winBy2, setWinBy2] = useState(Boolean(initial && initial.scoreA !== null && Math.max(initial.scoreA, initial.scoreB) === settings.target + 1))
  const teamA = match.teamA.map(nameOf).join(' · ')
  const teamB = match.teamB.map(nameOf).join(' · ')
  const result = winner && loserScore !== null ? resultFromPad(winner, loserScore, settings, winBy2) : null
  const tied = loserScore === settings.target - 1
  const check = result ? validateResult(result, settings) : null

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="mb-3 text-sm text-mist">Game to {settings.target} · sudden death or win by 2</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who won?">
        {[['A', teamA], ['B', teamB]].map(([side, label]) => (
          <button key={side} type="button" role="radio" aria-checked={winner === side} onClick={() => setWinner(side)}
            className={`min-h-16 rounded-2xl p-3 text-left font-semibold ${winner === side ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900'}`}>
            <span className="block text-xs font-bold tracking-[0.08em]">{winner === side ? 'WINNER ✓' : 'TAP IF THEY WON'}</span>
            {label}
          </button>
        ))}
      </div>

      {winner && (
        <>
          <p className="mt-4 text-sm text-mist">Losing team's score</p>
          <div className="mt-2 grid grid-cols-6 gap-1.5 sm:grid-cols-8">
            {scorePadOptions(settings.target).map((value) => (
              <button key={value} type="button" aria-pressed={loserScore === value} onClick={() => setLoserScore(value)}
                className={`min-h-11 rounded-lg text-base ${loserScore === value ? 'bg-pickle-teamb font-bold text-ink' : 'bg-navy-900'}`}>{value}</button>
            ))}
          </div>
          {tied && (
            <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="How did it end?">
              <Button role="radio" aria-checked={!winBy2} variant={!winBy2 ? 'neon' : 'ghost'} onClick={() => setWinBy2(false)}>{settings.target}–{settings.target - 1} sudden death</Button>
              <Button role="radio" aria-checked={winBy2} variant={winBy2 ? 'neon' : 'ghost'} onClick={() => setWinBy2(true)}>{settings.target + 1}–{settings.target - 1} win by 2</Button>
            </div>
          )}
          {result && (
            <p className="mt-3 text-center text-3xl font-bold" aria-live="polite">
              <span className={result.winner === 'A' ? 'text-pickle-neon' : ''}>{result.scoreA}</span>
              <span className="mx-2 text-mist">–</span>
              <span className={result.winner === 'B' ? 'text-pickle-neon' : ''}>{result.scoreB}</span>
            </p>
          )}
          {check && !check.ok && <p role="alert" className="mt-2 text-sm text-rose-200">{check.reason}</p>}
        </>
      )}

      <div className="mt-5 grid gap-2">
        <Button variant="primary" disabled={!result || !check?.ok} onClick={() => onSave(result)}>
          {result ? `Save ${result.scoreA}–${result.scoreB}` : 'Pick the winner and score'}
        </Button>
        {onAbandon && <Button variant="quiet" onClick={onAbandon}>Game abandoned (no result)</Button>}
      </div>
    </Sheet>
  )
}
