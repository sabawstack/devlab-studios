// src/pickleball-open/components/results/Podium.jsx
// Top three, standing 2nd · 1st · 3rd with 1st tallest. A shared place puts
// everyone on that step (a tie for 3rd can make four people). The steps rise
// and the names fade in once; nothing moves under prefers-reduced-motion.
import { podiumDisplayOrder, podiumStepColumns, recordWithPoints } from '../../../lib/pickleball/open/results'

const PLACE = { 1: '1st', 2: '2nd', 3: '3rd' }

// Step colours: 1st neon with ink text, 2nd team-B violet with ink text, 3rd navy with white text.
// On the TV the names and steps scale with --pb-fit (set by the TV, so a big tie still fits).
const STEP = {
  1: { tone: 'bg-pickle-neon text-ink', height: 'h-24 sm:h-28', tvHeight: 'lg:h-[calc(var(--pb-fit,1)*12vh)]', delay: '300ms' },
  2: { tone: 'bg-pickle-teamb text-ink', height: 'h-16 sm:h-20', tvHeight: 'lg:h-[calc(var(--pb-fit,1)*9vh)]', delay: '150ms' },
  3: { tone: 'border-2 border-b-0 border-pickle-teamb/60 bg-navy-800 text-white', height: 'h-12 sm:h-14', tvHeight: 'lg:h-[calc(var(--pb-fit,1)*6.5vh)]', delay: '0ms' },
}

function Entry({ entry, highlight, tv }) {
  return (
    <li className={`grid gap-0.5 ${highlight ? 'text-pickle-neon' : ''}`}>
      <span className={`font-bold leading-tight [overflow-wrap:anywhere] ${tv ? 'text-[calc(var(--pb-fit,1)*clamp(1.2rem,1.9vw,3rem))]' : 'text-base sm:text-lg'}`}>{entry.name}</span>
      <span className={`tabular-nums text-mist ${tv ? 'text-[clamp(1.05rem,1.35vw,2rem)]' : 'text-sm'}`}>{recordWithPoints(entry)}</span>
    </li>
  )
}

export default function Podium({ podium, highlightIds = [], tv = false }) {
  const steps = podiumDisplayOrder(podium)
  if (steps.length === 0) return null
  return (
    // Each step keeps a sensible width, so one or two steps never stretch into a long bar; a step
    // holding a big tie is wider, its names side by side.
    <ol className="mx-auto grid w-full items-end gap-2 sm:gap-3" aria-label="Podium"
      style={{
        gridTemplateColumns: steps.map((step) => `minmax(0, ${podiumStepColumns(step.entries.length)}fr)`).join(' '),
        maxWidth: `${steps.reduce((sum, step) => sum + podiumStepColumns(step.entries.length), 0) * (tv ? 16 : 13)}${tv ? 'vw' : 'rem'}`,
      }}>
      {steps.map((step) => {
        const look = STEP[step.place]
        return (
          <li key={step.place} className="flex min-w-0 flex-col justify-end text-center" data-testid={`podium-${step.place}`}>
            <div className="pb-fade-in mb-2 grid justify-items-center gap-1" style={{ '--pb-delay': `calc(${look.delay} + 450ms)` }}>
              {/* The medal names the place for screen readers (a visually hidden label would overflow the TV's no-truncation check). */}
              <span role="img" aria-label={`${PLACE[step.place]} place${step.entries.length > 1 ? ', shared' : ''}`}
                className={tv ? 'text-[calc(var(--pb-fit,1)*clamp(1.75rem,3vw,4.5rem))] leading-none' : 'text-3xl leading-none sm:text-4xl'}>{step.medal}</span>
              <ul className="grid w-full gap-x-3 gap-y-1.5" style={{ gridTemplateColumns: `repeat(${podiumStepColumns(step.entries.length)}, minmax(0, 1fr))` }}>
                {step.entries.map((entry) => <Entry key={entry.id} entry={entry} highlight={highlightIds.includes(entry.id)} tv={tv} />)}
              </ul>
            </div>
            <div className={`pb-rise grid place-items-center rounded-t-2xl font-bold ${look.tone} ${look.height} leading-none ${tv ? `${look.tvHeight} text-[calc(var(--pb-fit,1)*clamp(1.25rem,2.2vw,3.25rem))]` : 'text-2xl'}`}
              style={{ '--pb-delay': look.delay }} aria-hidden="true">
              {step.place}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
