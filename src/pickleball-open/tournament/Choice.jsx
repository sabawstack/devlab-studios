// src/pickleball-open/tournament/Choice.jsx
import { FORMAT_INFO, FORMAT_ORDER, PAIRING_INFO, SEEDING_INFO } from '../../lib/pickleball/open/tournament/info'

/** A radio group of cards, each with its one-line explanation (same look as the stacking-mode picker). */
export function Choice({ label, order, info, value, onChange, columns = false }) {
  return (
    <div className={`grid gap-2 ${columns ? 'sm:grid-cols-3' : ''}`} role="radiogroup" aria-label={label}>
      {order.map((key) => {
        const checked = key === value
        return (
          <button key={key} type="button" role="radio" aria-checked={checked} onClick={() => onChange(key)}
            className={`min-h-14 rounded-2xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pb-play ${checked ? 'bg-pb-play text-pb-canvas' : 'border border-pb-rule bg-pb-surface text-white hover:border-pb-play'}`}>
            <span className="block font-bold">{info[key].label}</span>
            <span className={`block text-sm ${checked ? 'text-pb-canvas' : 'text-pb-ink-2'}`}>{info[key].summary}</span>
          </button>
        )
      })}
    </div>
  )
}

export function FormatPicker({ value, onChange }) {
  return <Choice label="Format" order={FORMAT_ORDER} info={FORMAT_INFO} value={value} onChange={onChange} />
}

export function PairingPicker({ value, onChange }) {
  return <Choice label="Pairs" order={['RANDOM', 'BALANCED', 'MANUAL']} info={PAIRING_INFO} value={value} onChange={onChange} columns />
}

export function SeedingPicker({ value, onChange }) {
  return <Choice label="Seeding" order={['RANDOM', 'BY_SKILL', 'MANUAL']} info={SEEDING_INFO} value={value} onChange={onChange} columns />
}
