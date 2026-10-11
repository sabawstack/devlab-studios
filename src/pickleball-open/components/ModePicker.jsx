import { MODE_INFO, MODE_ORDER } from '../../lib/pickleball/open/modes/info'
import { Sheet } from './ui.jsx'

/** The four ways to pick who plays next, each with its one-line explanation (spec §5.2). */
export function ModePicker({ value, onChange, label = 'Who plays next' }) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={label}>
      {MODE_ORDER.map((mode) => {
        const checked = mode === value
        return (
          <button key={mode} type="button" role="radio" aria-checked={checked} onClick={() => onChange(mode)}
            className={`min-h-14 rounded-2xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pickle-neon ${checked ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900 text-white hover:border-pickle-neon'}`}>
            <span className="block font-bold">{MODE_INFO[mode].label}</span>
            <span className={`block text-sm ${checked ? 'text-ink' : 'text-mist'}`}>{MODE_INFO[mode].summary}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Mid-session switch. The change applies from the next proposal only (spec §5.2). */
export default function ModeSheet({ mode, onPick, onClose }) {
  return (
    <Sheet title="Who plays next" onClose={onClose}>
      <ModePicker value={mode} onChange={onPick} />
      <p className="mt-4 text-sm text-mist">A change applies from the next game proposed. Games already proposed or on court stay as they are. Anyone who has sat out 2 rounds in a row still goes on next, in every mode.</p>
    </Sheet>
  )
}
