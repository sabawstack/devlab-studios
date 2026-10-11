// src/pickleball-open/SessionApp.jsx
import { useCallback, useEffect, useState } from 'react'
import { captainKeyFor, captainKeyFromHash, forgetCaptainKey, rememberCaptainKey } from './lib/captainKeys'
import { forgetHostedSession, hostedSessions, hostKeyFor, hostKeyFromHash, rememberHostedSession } from './lib/hostKeys'
import { useOpenSession } from './lib/useOpenSession'
import CaptainConsole from './components/CaptainConsole.jsx'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import HostConsole from './components/HostConsole.jsx'
import ViewerBoard from './components/ViewerBoard.jsx'

export default function SessionApp({ code }) {
  // Every key is read once, before anything is written: the saved host key is
  // the fallback if the link's key turns out to be wrong (a mistyped or stale
  // link must not cost the host the key this phone already had).
  const [keys] = useState(() => {
    const captainFragment = captainKeyFromHash(window.location.hash)
    return {
      fragment: hostKeyFromHash(window.location.hash),
      saved: hostKeyFor(code),
      captainFragment,
      captain: captainFragment ?? captainKeyFor(code),
    }
  })
  const [fellBack, setFellBack] = useState(false)
  const hostKey = keys.fragment && !fellBack ? keys.fragment : keys.saved
  const canFallBack = Boolean(keys.fragment && keys.saved && keys.saved !== keys.fragment && !fellBack)
  // A host key always wins: a host who opens a captain link still hosts.
  const captainKey = hostKey ? null : keys.captain

  const onRejected = useCallback((key) => {
    if (key === keys.fragment && keys.saved && keys.saved !== keys.fragment) setFellBack(true)
  }, [keys])
  const { status, viewer, host, captain, captainRevoked, authFailed, setHost, setCaptain } = useOpenSession(code, hostKey, { onRejected, captainKey })

  // Keys are removed from the address bar so they are never left on screen or
  // in a screenshot of the URL (spec §3.3), and saved straight away so closing
  // the tab before the board loads loses nothing.
  useEffect(() => {
    if (!keys.fragment && !keys.captainFragment) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (keys.fragment) {
      const previousName = hostedSessions().find((entry) => entry.code === code)?.name ?? ''
      rememberHostedSession({ code, hostKey: keys.fragment, name: previousName })
    }
    if (keys.captainFragment) rememberCaptainKey(code, keys.captainFragment)
  }, [keys, code])

  useEffect(() => {
    if (host && hostKey) rememberHostedSession({ code, hostKey, name: host.viewer.name })
  }, [host, hostKey, code])

  useEffect(() => {
    if (status === 'not-found' || authFailed) forgetHostedSession(code)
    if (status === 'not-found' || captainRevoked) forgetCaptainKey(code)
  }, [status, authFailed, captainRevoked, code])

  // The link's key was refused: put the saved key back (the link's key replaced it on open).
  useEffect(() => {
    if (fellBack) rememberHostedSession({ code, hostKey: keys.saved, name: hostedSessions().find((entry) => entry.code === code)?.name ?? '' })
  }, [fellBack, keys, code])

  if (!code || status === 'not-found') return <ExpiredNotice />
  if (host && hostKey && !authFailed) return <HostConsole code={code} hostKey={hostKey} host={host} status={status} onHost={setHost} />
  if (captain && captainKey) return <CaptainConsole code={code} captainKey={captainKey} snapshot={captain} status={status} onSnapshot={setCaptain} />
  if (!viewer) return <p className="p-8 text-center text-mist" role="status">Loading the board…</p>
  return <ViewerBoard viewer={viewer} status={status} invalidHostLink={authFailed && !canFallBack} revokedCaptainLink={captainRevoked} />
}
