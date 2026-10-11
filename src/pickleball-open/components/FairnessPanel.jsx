import { useId } from 'react'
import { minutesSince, useNow } from '../lib/useNow'

/** Spec §5.5: the live numbers that make rotation visible. Used on the host console and the TV. */
export default function FairnessPanel({ fairness, tv = false }) {
  const now = useNow()
  const headingId = useId()
  const wait = fairness.longestWait
  const rounds = wait?.rounds ? ` · ${wait.rounds} round${wait.rounds === 1 ? '' : 's'} out` : ''
  const tiles = [
    { label: 'Games spread', value: String(fairness.sitOutSpread), hint: 'most minus fewest games' },
    { label: 'Longest wait', value: wait ? `${minutesSince(wait.since, now)} min` : '—', hint: wait ? `${wait.name}${rounds}` : 'nobody waiting' },
    { label: 'Repeat partners', value: String(fairness.repeatedPartners), hint: 'pairs who partnered again' },
  ]
  return (
    <section aria-labelledby={headingId} className={tv ? 'grid gap-2' : 'rounded-2xl bg-navy-900 p-4'} data-testid="fairness">
      <h2 id={headingId} className={tv ? 'text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon' : 'text-lg font-bold'}>Fairness</h2>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-xl bg-navy-800 p-3">
            <dt className={tv ? 'text-[clamp(0.8rem,1vw,1.25rem)] text-mist' : 'text-xs text-mist'}>{tile.label}</dt>
            <dd className={`font-bold ${tv ? 'text-[clamp(1.5rem,2.4vw,3rem)]' : 'text-2xl'}`}>{tile.value}</dd>
            <dd className={`truncate text-mist ${tv ? 'text-[clamp(0.8rem,1vw,1.25rem)]' : 'text-xs'}`}>{tile.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
