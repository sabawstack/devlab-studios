// My sessions (spec §9.5): a signed-in host's linked sessions from any device,
// each reopenable as host. This is the recovery path for a lost host link.
import { useEffect, useState } from 'react'
import { fetchMe, fetchMySessions, reopenSession } from '../lib/api'
import { hostKeyFor, rememberHostedSession } from '../lib/hostKeys'
import { Button, Panel } from '../components/ui.jsx'
import ClubIdForm from './ClubIdForm.jsx'
import HostAccount from './HostAccount.jsx'
import { readSignInResult, SIGN_IN_MESSAGES, signInHref } from './duprSteps'

const errorText = (failure, fallback) => (failure instanceof Error && failure.message ? failure.message : fallback)
const dateOf = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function MySessionsApp() {
  const [signInResult] = useState(() => readSignInResult(window.location.search))
  const [host, setHost] = useState(undefined)
  const [sessions, setSessions] = useState([])
  const [error, setError] = useState(signInResult ? SIGN_IN_MESSAGES[signInResult] : null)
  const [optIn, setOptIn] = useState(false)
  const [opening, setOpening] = useState(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (signInResult) window.history.replaceState(null, '', window.location.pathname)
  }, [signInResult])

  useEffect(() => {
    let live = true
    fetchMe()
      .then(async ({ host: me }) => {
        const list = me ? (await fetchMySessions()).sessions : []
        if (!live) return
        setHost(me)
        setSessions(list)
      })
      .catch((failure) => { if (live) setError(errorText(failure, 'Could not load your sessions. Try again.')) })
    return () => { live = false }
  }, [reload])

  async function open(session) {
    const saved = hostKeyFor(session.code)
    if (saved) {
      window.location.assign(`/pickleball/s/${session.code}#host=${saved}`)
      return
    }
    setOpening(session.code)
    setError(null)
    try {
      const { hostKey } = await reopenSession(session.code)
      // The key travels in the fragment, which is never sent to a server or logged;
      // the session screen saves it on this device.
      rememberHostedSession({ code: session.code, hostKey, name: session.name })
      window.location.assign(`/pickleball/s/${session.code}#host=${hostKey}`)
    } catch (failure) {
      setError(errorText(failure, 'Could not open that session. Try again.'))
      setOpening(null)
    }
  }

  return (
    <main className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <header>
        <a href="/pickleball" className="text-sm text-mist underline">Devlab Pickleball</a>
        <h1 className="mt-2 text-3xl font-bold">My sessions</h1>
        <p className="mt-1 text-mist">Sessions you linked to your Google account for the DUPR export. Open one as host from any device.</p>
      </header>
      {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
      {host === undefined && !error && <p role="status" className="text-mist">Loading…</p>}

      {host === null && (
        <Panel className="grid gap-3">
          <p>Sign in with the Google account you used for a DUPR export. Running a session never needs an account; only sessions you linked show here.</p>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={optIn} onChange={(event) => setOptIn(event.target.checked)} className="h-5 w-5" />
            Email me occasional Devlab Pickleball news
          </label>
          <a href={signInHref('/pickleball/my-sessions', optIn)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white hover:bg-[#3a00d6]">Sign in with Google</a>
        </Panel>
      )}

      {host && (
        <>
          <section aria-label="Linked sessions" className="grid gap-3">
            {sessions.length === 0 && <Panel><p className="text-mist">No linked sessions yet. On a session’s console, choose More, then Email me the DUPR export, to link one.</p></Panel>}
            {sessions.map((session) => (
              <Panel key={session.code} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{session.name}</h2>
                  <p className="text-sm text-mist">
                    {session.kind === 'TOURNAMENT' ? 'Tournament' : 'Open play'}{session.status === 'ENDED' ? ' · Ended' : ''} · Results deleted on {dateOf(session.expiresAt)}
                  </p>
                </div>
                <Button disabled={opening !== null} onClick={() => open(session)}>{opening === session.code ? 'Opening…' : `Open ${session.name} as host`}</Button>
              </Panel>
            ))}
          </section>
          <Panel>
            <ClubIdForm key={host.duprClubId ?? ''} current={host.duprClubId} onSaved={setHost} onSignInEnded={() => setReload((n) => n + 1)} />
            <HostAccount host={host} showMySessions={false} onChanged={(next) => (next ? setHost(next) : setReload((n) => n + 1))} />
          </Panel>
        </>
      )}
    </main>
  )
}
