// The host console's DUPR export (spec §9): sign in with Google, link the
// session once, enter the DUPR Club ID once, fix missing DUPR IDs, then email
// the CSV to the verified Google address. Only HostConsole renders this:
// viewers and captains never see it.
import { useEffect, useState } from 'react'
import { DUPR_CLICK_PATH } from '../../lib/pickleball/open/dupr/email'
import { ApiError, claimSession, emailDuprExport, fetchDuprStatus } from '../lib/api'
import { hostKeyFor } from '../lib/hostKeys'
import { Button, Sheet } from '../components/ui.jsx'
import ClubIdForm from './ClubIdForm.jsx'
import HostAccount from './HostAccount.jsx'
import { DUPR_ID_INPUT, duprStep, exportSummary, nextExportLine, sentMessage, SIGN_IN_MESSAGES, signInHref } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)
const alertClass = 'mb-3 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100'
const NO_STORAGE = 'This browser can’t remember your host link, so signing in would bring you back to the public board. Allow site storage, or keep your host link and open it again after signing in.'

export default function DuprSheet({ code, hostKey, version, send, commandError = null, signInResult = null, onClose }) {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(signInResult ? SIGN_IN_MESSAGES[signInResult] : null)
  const [loadError, setLoadError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [optIn, setOptIn] = useState(false)
  const [reload, setReload] = useState(0)
  const [ids, setIds] = useState({})
  const step = duprStep(status)
  const refresh = () => setReload((n) => n + 1)
  const retry = () => { setLoadError(null); refresh() }
  // Google brings the browser back without the #host= fragment, so the console reopens only from the saved key.
  const keyRemembered = hostKeyFor(code) === hostKey
  const nextExport = step === 'READY' ? nextExportLine(status) : null

  // Refetched whenever the session changes (a DUPR ID was added) or an action here asks for it.
  useEffect(() => {
    let live = true
    fetchDuprStatus(code, hostKey).then(
      (next) => { if (live) { setStatus(next); setLoadError(null) } },
      (failure) => { if (live) setLoadError(errorText(failure, 'Could not load the DUPR export. Try again.')) },
    )
    return () => { live = false }
  }, [code, hostKey, version, reload])

  async function act(action, fallback) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (failure) {
      setError(errorText(failure, fallback))
      // The sign-in ended (or was deleted elsewhere): reload so the sheet offers Google again.
      if (failure instanceof ApiError && failure.status === 401) refresh()
    } finally {
      setBusy(false)
    }
  }

  const link = () => act(async () => {
    await claimSession(code, hostKey)
    refresh()
  }, 'Could not link the session. Try again.')

  const email = () => act(async () => {
    setNotice(null)
    setNotice(sentMessage(await emailDuprExport(code, hostKey)))
    refresh()
  }, 'Could not send the export. Try again.')

  async function saveId(player) {
    const value = (ids[player.id] ?? '').trim()
    if (!DUPR_ID_INPUT.test(value)) {
      setError(`A DUPR ID is 6 letters or digits. Check ${player.name}’s.`)
      return
    }
    setError(null)
    if (await send({ type: 'SET_PLAYER_DUPR_ID', playerId: player.id, duprId: value })) {
      setIds((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== player.id)))
    }
  }

  return (
    <Sheet title="Email me the DUPR export" onClose={onClose}>
      {error && <p role="alert" className={alertClass}>{error}</p>}
      {commandError && <p role="alert" className={alertClass}>{commandError}</p>}
      {notice && <p role="status" className="mb-3 rounded-xl bg-pickle-neon px-4 py-3 font-semibold text-ink">{notice}</p>}
      {loadError && (
        <div role="alert" className={`${alertClass} flex flex-wrap items-center justify-between gap-2`}>
          <span className="min-w-0 break-words">{loadError}</span>
          <Button variant="ghost" onClick={retry}>Retry</Button>
        </div>
      )}
      {step === 'LOADING' && !loadError && <p role="status" className="text-mist">Loading…</p>}

      {step === 'SIGN_IN' && (
        <div className="grid gap-3">
          <p>{status.claim === 'OTHER'
            ? 'This session is linked to a Google account. Sign in with that account to send it to DUPR.'
            : 'The export is emailed to you, so sign in with Google first. That is only for DUPR: running a session never needs an account.'}</p>
          {keyRemembered ? (
            <>
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} className="h-5 w-5" />
                Email me occasional Devlab Pickleball news
              </label>
              <a href={signInHref(`/pickleball/s/${code}`, optIn)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-[#3a00d6]">Sign in with Google</a>
            </>
          ) : <p role="alert" className="rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">{NO_STORAGE}</p>}
        </div>
      )}

      {step === 'OTHER' && <p>This session is linked to another Google account. Only that account can send it to DUPR.</p>}

      {step === 'CLAIM' && (
        <div className="grid gap-3">
          <p>Link this session to <strong className="break-all">{status.host.email}</strong>? A session is linked once: from then on only this account can send it to DUPR, and it shows in My sessions on any device.</p>
          <Button disabled={busy} onClick={link}>Link to my account</Button>
        </div>
      )}

      {step === 'CLUB_ID' && <ClubIdForm current={null} onSaved={refresh} onSignInEnded={refresh} />}

      {step === 'READY' && (
        <div className="grid gap-3">
          <p className="font-semibold">{exportSummary(status)}</p>
          {status.skipped.length > 0 && (
            <ul aria-label="Left out" className="grid gap-1 break-words text-sm text-mist">
              {status.skipped.map((s) => <li key={s.game}>Game {s.game}{s.court ? `, ${s.court}` : ''}: {s.summary}. {s.reason}</li>)}
            </ul>
          )}
          {status.missingIds.length > 0 && (
            <div className="grid gap-2">
              <p className="text-sm">Add a DUPR ID to bring their games in:</p>
              {status.missingIds.map((player) => (
                <form key={player.id} className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); saveId(player) }}>
                  <label className="grid min-w-0 flex-1 gap-1 break-words text-xs text-mist">DUPR ID for {player.name}
                    <input value={ids[player.id] ?? ''} maxLength={6} autoComplete="off"
                      onChange={(event) => setIds((prev) => ({ ...prev, [player.id]: event.target.value }))}
                      className="min-h-11 w-full min-w-0 rounded-lg bg-ink px-3 py-2 font-mono uppercase text-white" />
                  </label>
                  <Button type="submit" variant="ghost">Save</Button>
                </form>
              ))}
            </div>
          )}
          <p className="text-sm text-mist">Club ID {status.host.duprClubId}. In DUPR, go to {DUPR_CLICK_PATH} and choose the file. Your DUPR account must be a Club Director or Organizer of the club.</p>
          <Button variant="neon" disabled={busy || !status.exported || !status.exportsLeft} onClick={email}>{busy ? 'Sending…' : 'Email me the export'}</Button>
          <p className="break-words text-xs text-mist">{status.exportsLeft} of {status.exportLimit} exports left today, sent to {status.host.email}.</p>
          {nextExport && <p className="text-sm font-semibold text-amber-100">{nextExport}</p>}
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm">Change Club ID</summary>
            <ClubIdForm current={status.host.duprClubId} onSaved={refresh} onSignInEnded={refresh} />
          </details>
        </div>
      )}

      {status?.host && <HostAccount host={status.host} onChanged={refresh} />}
    </Sheet>
  )
}
