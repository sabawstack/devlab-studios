// src/pickleball-open/components/results/SavePosterButton.jsx
// "Save poster" (brief §C): draws the results poster on this device, shows it,
// then Share (the phone's share sheet with the PNG, when it takes files) or
// Download. Nothing is uploaded.
import { useState } from 'react'
import { drawPoster } from '../../results/drawPoster'
import { posterFilename, posterModel } from '../../results/posterLayout'
import { Button, Sheet } from '../ui.jsx'

const dateText = (iso) => (iso ? new Date(iso) : new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

/** @param {{ results: import('../../../lib/pickleball/open/results').FinalResults, viewer: { hostDisplayName: string, endedAt: string | null, games: { lastFinishedAt: string | null } } }} props */
export default function SavePosterButton({ results, viewer }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [poster, setPoster] = useState(null)
  const [shareError, setShareError] = useState('')
  const filename = posterFilename(results.name)

  async function make() {
    setBusy(true)
    setError('')
    try {
      const model = posterModel(results, { hostName: viewer.hostDisplayName, dateText: dateText(viewer.endedAt ?? viewer.games.lastFinishedAt) })
      const { blob, dataUrl } = await drawPoster({ model, qrUrl: `${window.location.origin}/pickleball?ref=poster` })
      const file = new File([blob], filename, { type: 'image/png' })
      const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
      setShareError('')
      setPoster({ url: dataUrl, file, canShare })
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not make the poster. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    setShareError('')
    try {
      await navigator.share({ files: [poster.file], title: `Final standings · ${results.name}` })
    } catch (err) {
      // Closing the share sheet is a choice, not a failure.
      if (err?.name !== 'AbortError') setShareError("Couldn't share the poster. Use Download instead.")
    }
  }

  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={make} disabled={busy} aria-busy={busy}>{busy ? 'Making poster…' : 'Save poster'}</Button>
        <p className="text-sm text-mist">Names appear as entered in the session.</p>
      </div>
      {error && <p role="alert" className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-100">{error}</p>}
      {poster && (
        <Sheet title="Results poster" onClose={() => setPoster(null)}>
          <div className="grid gap-4">
            <img src={poster.url} alt={`Results poster for ${results.name}`} width={1080} height={1350} data-testid="poster-preview"
              className="mx-auto h-auto max-h-[60vh] w-auto max-w-full rounded-xl" />
            <div className="flex flex-wrap gap-3">
              {poster.canShare && <Button variant="neon" onClick={share}>Share</Button>}
              <a href={poster.url} download={filename}
                className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon ${poster.canShare ? 'border border-navy-700 text-white hover:bg-navy-900' : 'bg-pickle-neon text-ink hover:brightness-95'}`}>
                Download
              </a>
            </div>
            {shareError && <p role="alert" className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-100">{shareError}</p>}
          </div>
        </Sheet>
      )}
    </div>
  )
}
