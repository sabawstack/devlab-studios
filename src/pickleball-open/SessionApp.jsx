// src/pickleball-open/SessionApp.jsx
import { useCallback, useEffect, useState } from 'react'
import { captainKeyFor, captainKeyFromHash, forgetCaptainKey, rememberCaptainKey } from './lib/captainKeys'
import { forgetHostedSession, hostedSessions, hostKeyFor, hostKeyFromHash, rememberHostedSession } from './lib/hostKeys'
import { useOpenSession } from './lib/useOpenSession'
import { boardSignInNotice, readSignInResult } from './host/duprSteps'
import CaptainConsole from './components/CaptainConsole.jsx'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import HostConsole from './components/HostConsole.jsx'
import ViewerBoard from './components/ViewerBoard.jsx'

export default function SessionApp({ code }) {
  // Every key is read once, before anything is written: a saved key is the
  // fallback if the link's key turns out to be wrong (a mistyped, stale or
  // turned-off link must not cost this phone the key it already had).
  const [keys] = useState(() => ({
    fragment: hostKeyFromHash(window.location.hash),
    saved: hostKeyFor(code),
    captainFragment: captainKeyFromHash(window.location.hash),
    captainSaved: captainKeyFor(code),
  }))
  // Back from Google (?signin=…): HostConsole handles it when this browser holds the host key.
  const [signInResult] = useState(() => readSignInResult(window.location.search))
  const [fellBack, setFellBack] = useState(false)
  const [captainFellBack, setCaptainFellBack] = useState(false)
  const hostKey = keys.fragment && !fellBack ? keys.fragment : keys.saved
  const canFallBack = Boolean(keys.fragment && keys.saved && keys.saved !== keys.fragment && !fellBack)
  // A host key always wins: a host who opens a captain link still hosts.
  const captainKey = hostKey ? null : (keys.captainFragment && !captainFellBack ? keys.captainFragment : keys.captainSaved)

  const onRejected = useCallback((key) => {
    if (key === keys.fragment && keys.saved && keys.saved !== keys.fragment) setFellBack(true)
  }, [keys])
  const onCaptainRevoked = useCallback((key) => {
    if (key === keys.captainFragment && keys.captainSaved && keys.captainSaved !== keys.captainFragment) setCaptainFellBack(true)
  }, [keys])
  const { status, viewer, host, captain, captainRevoked, authFailed, setHost, setCaptain } = useOpenSession(code, hostKey, { onRejected, onCaptainRevoked, captainKey })

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
    // A host opening a captain link stays the host; the captain key is not kept.
    if (keys.captainFragment && !keys.fragment && !keys.saved) rememberCaptainKey(code, keys.captainFragment)
  }, [keys, code])

  // No host key here (storage blocked or cleared): the board explains, and ?signin= leaves the address bar.
  useEffect(() => {
    if (signInResult && !hostKey) window.history.replaceState(null, '', window.location.pathname)
  }, [signInResult, hostKey])

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
  useEffect(() => {
    if (captainFellBack) rememberCaptainKey(code, keys.captainSaved)
  }, [captainFellBack, keys, code])

  if (!code || status === 'not-found') return <ExpiredNotice />
  if (host && hostKey && !authFailed) return <HostConsole code={code} hostKey={hostKey} host={host} status={status} onHost={setHost} />
  if (captain && captainKey) return <CaptainConsole code={code} captainKey={captainKey} snapshot={captain} status={status} onSnapshot={setCaptain} />
  if (!viewer) return <p className="p-8 text-center text-mist" role="status">Loading the board…</p>
  return <ViewerBoard viewer={viewer} status={status} invalidHostLink={authFailed && !canFallBack} revokedCaptainLink={captainRevoked}
    signInNotice={hostKey ? null : boardSignInNotice(signInResult)} />
}
