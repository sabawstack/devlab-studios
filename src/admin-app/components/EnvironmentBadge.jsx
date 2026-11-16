/** The deployment in words (never colour alone): Production stands out, so destructive work there is not mistaken for a test. */
const TONES = {
  production: 'border-rose-300 bg-rose-50 text-rose-800',
  preview: 'border-amber-300 bg-amber-50 text-amber-900',
  local: 'border-slate-300 bg-white text-slate-700',
}

export default function EnvironmentBadge({ environment }) {
  return (
    <span data-testid="environment-badge" className={`ws-mono inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONES[environment.key]}`}>
      {environment.label}
    </span>
  )
}
