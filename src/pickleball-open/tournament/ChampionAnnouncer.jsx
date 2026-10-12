// src/pickleball-open/tournament/ChampionAnnouncer.jsx
// The champions, for screen readers: the podium on the final results shows
// them on screen. The live region is always mounted (render it before the
// tournament finishes) so the announcement is heard when it appears; a region
// inserted together with its text is often missed.
export default function ChampionAnnouncer({ champion }) {
  return (
    <div role="status" aria-live="polite" className="sr-only" data-testid="champion-announcement">
      {champion ? `Champions: ${champion.name}` : ''}
    </div>
  )
}
