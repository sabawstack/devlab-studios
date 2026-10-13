// src/pickleball-open/components/results/SavePosterButton.jsx
// "Save poster" (brief §C): draws the results poster on this device, shows it,
// then saves or shares the PNG the way this platform allows (savePoster.js):
// a real download on laptops and Android, the share sheet's "Save Image" on
// iPhone, and instructions inside Facebook/Messenger/Instagram browsers, which
// drop downloads. Nothing is uploaded.
import { useState } from 'react'
import { drawPoster } from '../../results/drawPoster'
import { posterFilename, posterModel } from '../../results/posterLayout'
import { IN_APP_MESSAGE, canShareFiles, isTouchPlatform, platformFor, saveLabel, savePoster, sharePoster } from '../../results/savePoster'
import { Button, Sheet } from '../ui.jsx'

const dateText = (iso) => (iso ? new Date(iso) : new Date()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const NO_FILE_SHARE = "This browser can't share the image directly. Save it first, then share it from your photos."
const SAVE_FAILED = "Couldn't save the poster. Right-click it and choose Save image as, or on a phone tap and hold it."
const Alert = ({ children }) => <p role="alert" className="rounded-xl bg-amber-400/15 p-3 text-sm text-amber-100">{children}</p>

/** @param {{ results: import('../../../lib/pickleball/open/results').FinalResults, viewer: { hostDisplayName: string, endedAt: string | null, games: { lastFinishedAt: string | null } } }} props */
export default function SavePosterButton({ results, viewer }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [poster, setPoster] = useState(null)
  const [notice, setNotice] = useState('')
  const filename = posterFilename(results.name)

  async function make() {
    setBusy(true)
    setError('')
    try {
      const model = posterModel(results, { hostName: viewer.hostDisplayName, dateText: dateText(viewer.endedAt ?? viewer.games.lastFinishedAt) })
      const { blob, dataUrl } = await drawPoster({ model, qrUrl: `${window.location.origin}/pickleball?ref=poster` })
      const file = new File([blob], filename, { type: 'image/png' })
      const platform = platformFor(navigator)
      setNotice('')
      setPoster({ url: dataUrl, blob, file, platform, canShare: canShareFiles(navigator, file) })
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not make the poster. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Both run straight from the click, with no await before navigator.share,
  // so the share sheet keeps the tap's user activation.
  function report(outcome) {
    return outcome.then(({ message }) => setNotice(message), () => setNotice(SAVE_FAILED))
  }
  function save() {
    setNotice('')
    report(savePoster({ platform: poster.platform, blob: poster.blob, file: poster.file, filename, nav: navigator, doc: document, url: URL }))
  }
  function share() {
    setNotice('')
    report(sharePoster({ nav: navigator, file: poster.file }))
  }

  const label = poster && saveLabel(poster.platform)
  const touch = poster && isTouchPlatform(poster.platform)
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={make} disabled={busy} aria-busy={busy}>{busy ? 'Making poster…' : 'Save poster'}</Button>
        <p className="text-sm text-mist">Names appear as entered in the session.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {poster && (
        <Sheet title="Results poster" onClose={() => setPoster(null)}>
          <div className="grid gap-4">
            {poster.platform === 'in-app' && (
              <p data-testid="poster-in-app" className="rounded-xl border border-pickle-neon/60 bg-pickle-neon/10 p-3 text-sm font-semibold text-white">{IN_APP_MESSAGE}</p>
            )}
            <div className="grid gap-1">
              <img src={poster.url} alt={`Results poster for ${results.name}`} width={1080} height={1350} data-testid="poster-preview"
                className="mx-auto h-auto max-h-[60vh] w-auto max-w-full rounded-xl" />
              {touch && <p className="text-center text-sm text-mist">Tip: tap and hold the poster to save it</p>}
            </div>
            <div className="flex flex-wrap gap-3">
              {label && <Button variant="neon" onClick={save}>{label}</Button>}
              {poster.canShare && <Button variant={label ? 'ghost' : 'neon'} onClick={share}>Share</Button>}
            </div>
            {touch && poster.platform !== 'in-app' && !poster.canShare && <p className="text-sm text-mist">{NO_FILE_SHARE}</p>}
            {notice && <Alert>{notice}</Alert>}
          </div>
        </Sheet>
      )}
    </div>
  )
}
