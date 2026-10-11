// src/pickleball-open/SessionApp.jsx
import { useEffect, useMemo } from 'react'
import { forgetHostedSession, hostKeyFor, hostKeyFromHash, rememberHostedSession } from './lib/hostKeys'
import { useOpenSession } from './lib/useOpenSession'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import HostConsole from './components/HostConsole.jsx'
import ViewerBoard from './components/ViewerBoard.jsx'

export default function SessionApp({ code }) {
  // The fragment is read once and removed from the address bar, so the key is
  // never left on screen or in a screenshot of the URL (spec §3.3).
  const hostKey = useMemo(() => {
    const fromHash = hostKeyFromHash(window.location.hash)
    if (fromHash) {
      window.history.replaceState(null, '', window.location.pathname)
      return fromHash
    }
    return hostKeyFor(code)
  }, [code])

  const { status, viewer, host, authFailed, setHost } = useOpenSession(code, hostKey)

  useEffect(() => {
    if (host && hostKey) rememberHostedSession({ code, hostKey, name: host.viewer.name })
  }, [host, hostKey, code])

  useEffect(() => {
    if (status === 'not-found') forgetHostedSession(code)
    if (authFailed) forgetHostedSession(code)
  }, [status, authFailed, code])

  if (!code || status === 'not-found') return <ExpiredNotice />
  if (host && hostKey && !authFailed) return <HostConsole code={code} hostKey={hostKey} host={host} status={status} onHost={setHost} />
  if (!viewer) return <p className="p-8 text-center text-mist" role="status">Loading the board…</p>
  return <ViewerBoard viewer={viewer} status={status} invalidHostLink={authFailed} />
}
