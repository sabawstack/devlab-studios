// src/pickleball-open/components/CaptainsSheet.jsx
// The host makes and turns off court-captain links (spec §3.3). A new link's
// secret is shown once, here; the server keeps only its hash.
import { useState } from 'react'
import { createCaptainLink, revokeCaptainLink } from '../lib/api'
import { captainLink } from '../lib/captainKeys'
import QrCode from './QrCode.jsx'
import { Button, Sheet } from './ui.jsx'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)

export default function CaptainsSheet({ code, hostKey, courts, captains, onHost, onClose }) {
  const [fresh, setFresh] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function make(court) {
    setError(null)
    setBusy(true)
    try {
      const result = await createCaptainLink(code, hostKey, { courtId: court.id })
      setFresh({ courtLabel: court.label, label: result.label, url: captainLink(window.location.origin, code, result.captainKey) })
      onHost(result.host)
    } catch (failure) {
      setError(errorText(failure, 'Could not make the link. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function turnOff(captain) {
    if (!window.confirm(`Turn off ${captain.label}'s link? It stops working straight away.`)) return
    setError(null)
    try {
      const result = await revokeCaptainLink(code, hostKey, captain.id)
      onHost(result.host)
    } catch (failure) {
      setError(errorText(failure, 'Could not turn the link off. Try again.'))
    }
  }

  async function share() {
    if (!fresh) return
    try {
      if (navigator.share) await navigator.share({ title: fresh.label, text: `Captain link for ${fresh.courtLabel}`, url: fresh.url })
      else await navigator.clipboard.writeText(fresh.url)
    } catch {
      // the link stays on screen to copy by hand, and the QR code to scan
    }
  }

  return (
    <Sheet title="Court captains" onClose={onClose}>
      <p className="text-sm text-mist">A captain link lets someone run one court from their own phone: start its games and save, undo or fix its results. Nothing else. Turn a link off and it stops working at once.</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
      {fresh && (
        <div className="mt-4 grid min-w-0 gap-3 rounded-2xl border-2 border-pickle-neon p-4">
          <p className="font-bold">{fresh.label}</p>
          <div className="flex flex-col items-center gap-2 text-center">
            <QrCode url={fresh.url} size={176} label={`QR code for the ${fresh.courtLabel} captain link`} />
            <p className="text-xs text-mist">The captain scans this with their phone.</p>
          </div>
          <label className="grid min-w-0 gap-1 text-xs text-mist">Captain link for {fresh.courtLabel}
            <input readOnly value={fresh.url} onFocus={(event) => event.target.select()} className="min-h-11 w-full min-w-0 rounded-lg bg-ink px-3 py-2 font-mono text-xs text-white" />
          </label>
          <Button variant="neon" onClick={share}>Send link</Button>
          <p className="text-xs text-mist">Shown once. Send it now; you can always make another.</p>
        </div>
      )}
      <ul className="mt-4 grid gap-2">
        {courts.filter((court) => court.enabled).map((court) => {
          const links = captains.filter((c) => c.courtId === court.id)
          return (
            <li key={court.id} className="rounded-xl bg-navy-900 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">{court.label}</span>
                <Button variant="ghost" disabled={busy} onClick={() => make(court)}>Make a link for {court.label}</Button>
              </div>
              {links.map((c) => (
                <div key={c.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-mist">{c.label}</span>
                  <Button variant="danger" className="!px-3" onClick={() => turnOff(c)} aria-label={`Turn off ${c.label}`}>Turn off</Button>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
