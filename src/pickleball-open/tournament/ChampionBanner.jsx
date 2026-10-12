// src/pickleball-open/tournament/ChampionBanner.jsx
// Spec §11: "a short CSS celebration plays for a tournament winner". Transform
// and opacity only, twice, and not at all under prefers-reduced-motion.
// The live region is always mounted so a screen reader announces the champion
// when it appears (a region inserted together with its text is often missed).
export default function ChampionBanner({ champion, tv = false }) {
  return (
    <div role="status" aria-live="polite">
      {champion && (
        <div data-testid="champion"
          className={`pb-celebrate rounded-2xl bg-pickle-neon text-ink ${tv ? 'p-[1vw] text-[clamp(1.5rem,3vw,4rem)]' : 'px-5 py-4 text-xl'}`}>
          <p className="text-[0.6em] font-bold uppercase tracking-[0.14em]">Champions</p>
          <p className="font-bold [overflow-wrap:anywhere]">{champion.name}</p>
        </div>
      )}
    </div>
  )
}
