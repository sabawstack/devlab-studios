// src/pickleball-open/components/results/ShareResultsButton.jsx
// The phone's share sheet when it has one, else a copy with "Copied". When the
// copy is refused the text is shown, selectable, so it can be copied by hand.
import { useState } from 'react'
import { shareText } from '../../../lib/pickleball/open/results'
import { shareResults } from '../../lib/shareResults'
import { Button } from '../ui.jsx'

export default function ShareResultsButton({ results, url }) {
  const [outcome, setOutcome] = useState(null)
  const text = shareText(results, url)

  async function share() {
    setOutcome(null)
    // No separate `url`: the text already ends with the link, and WhatsApp and Messages would show it twice.
    const result = await shareResults({ title: `Final standings · ${results.name}`, text })
    setOutcome(result.kind)
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="neon" onClick={share}>Share results</Button>
        {/* Always mounted, so a screen reader hears "Copied" when it appears. */}
        <span role="status" className="text-sm font-semibold text-pickle-neon">{outcome === 'copied' ? 'Copied' : ''}</span>
      </div>
      {outcome === 'failed' && (
        <div role="alert" className="grid gap-2 rounded-xl bg-amber-400/15 p-3 text-amber-100">
          <p className="text-sm">Couldn't copy. Select the text below and copy it yourself.</p>
          <textarea readOnly value={text} rows={4} aria-label="Results to share"
            onFocus={(event) => event.target.select()}
            className="w-full rounded-lg border border-navy-700 bg-navy-950 p-2 text-sm text-white" />
        </div>
      )}
    </div>
  )
}
