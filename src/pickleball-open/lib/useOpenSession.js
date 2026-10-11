import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCaptain, fetchHost, fetchViewer } from './api'

const POLL_MS = 5000
const GONE = 4404

/**
 * Live board state: WebSocket first, 5-second polling while it is down
 * (spec §3.4). With a host key the poll also fetches the host snapshot, and
 * with a captain key (and no host key) the captain's court snapshot, so both
 * consoles work even when the socket never connects.
 *
 * Snapshots can arrive out of order (a poll that left before a command but
 * landed after it), so anything older than the version already held is ignored.
 *
 * A captain link the host turned off (403 on poll, AUTH_FAILED, or
 * CAPTAIN_REVOKED on the socket) drops to the public board: captainRevoked.
 *
 * Only a refusal costs a key: an HTTP 403 or AUTH_FAILED. A 5xx, a network
 * failure or AUTH_ERROR (the server failed while checking the key) keeps it:
 * the socket is closed and the usual poll-and-reconnect path takes over.
 */
export function useOpenSession(code, hostKey, { onRejected, onCaptainRevoked, captainKey = null } = {}) {
  const [status, setStatus] = useState('connecting')
  const [viewer, setViewer] = useState(null)
  const [host, setHost] = useState(null)
  const [captain, setCaptain] = useState(null)
  // When a snapshot last arrived (socket push or poll), so a screen can tell live from stale.
  const [lastSnapshotAt, setLastSnapshotAt] = useState(null)
  // Every key the server refused, so a caller can switch keys without the new
  // one inheriting the old one's failure.
  const [rejectedKeys, setRejectedKeys] = useState([])
  const [revokedCaptainKeys, setRevokedCaptainKeys] = useState([])
  const versionRef = useRef(-1)
  const onRejectedRef = useRef(onRejected)
  const onCaptainRevokedRef = useRef(onCaptainRevoked)
  useEffect(() => {
    onRejectedRef.current = onRejected
    onCaptainRevokedRef.current = onCaptainRevoked
  }, [onRejected, onCaptainRevoked])

  /** True when this version is at least as new as anything already shown; records it. */
  const accept = useCallback((version) => {
    if (typeof version !== 'number') return true
    if (version < versionRef.current) return false
    versionRef.current = version
    return true
  }, [])

  const applyViewer = useCallback((snapshot) => {
    if (!snapshot || !accept(snapshot.version)) return
    setViewer(snapshot)
    setLastSnapshotAt(Date.now())
  }, [accept])

  const applyHost = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setHost(snapshot)
    setViewer(snapshot.viewer)
    setLastSnapshotAt(Date.now())
  }, [accept])

  const applyCaptain = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setCaptain(snapshot)
    setViewer(snapshot.viewer)
    setLastSnapshotAt(Date.now())
  }, [accept])

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let pollTimer = null
    let cancelled = false
    let ended = false
    let attempt = 0
    let hostDenied = false
    let captainDenied = false
    versionRef.current = -1

    function reject() {
      hostDenied = true
      setRejectedKeys((keys) => (keys.includes(hostKey) ? keys : [...keys, hostKey]))
      onRejectedRef.current?.(hostKey)
    }

    function revokeCaptain() {
      captainDenied = true
      setRevokedCaptainKeys((keys) => (keys.includes(captainKey) ? keys : [...keys, captainKey]))
      onCaptainRevokedRef.current?.(captainKey)
    }

    function end() {
      ended = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      setStatus('not-found')
    }

    async function pollViewer() {
      try {
        const snapshot = await fetchViewer(code)
        if (!cancelled) applyViewer(snapshot)
        return true
      } catch (error) {
        if (!cancelled && error?.status === 404) end()
        return error?.status !== 404
      }
    }

    /** The host or captain snapshot; a refused key falls back to the public board. */
    async function pollKeyed(fetchSnapshot, apply, onDenied) {
      try {
        const snapshot = await fetchSnapshot()
        if (!cancelled) apply(snapshot)
        return true
      } catch (error) {
        if (cancelled) return false
        if (error?.status === 404) {
          end()
          return false
        }
        if (error?.status === 403) onDenied()
        // 403 still shows the public board; anything else is retried by the next poll
        return pollViewer()
      }
    }

    const poll = () => {
      if (hostKey && !hostDenied) return pollKeyed(() => fetchHost(code, hostKey), applyHost, reject)
      if (!hostKey && captainKey && !captainDenied) return pollKeyed(() => fetchCaptain(code, captainKey), applyCaptain, revokeCaptain)
      return pollViewer()
    }

    function connect() {
      if (cancelled || ended) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      socket.onopen = () => {
        attempt = 0
        clearInterval(pollTimer)
        setStatus('open')
        if (hostKey) socket.send(JSON.stringify({ type: 'AUTH', hostKey }))
        else if (captainKey && !captainDenied) socket.send(JSON.stringify({ type: 'AUTH', captainKey }))
      }
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'VIEWER') applyViewer(message.payload)
        if (message.type === 'HOST') applyHost(message.payload)
        if (message.type === 'CAPTAIN') applyCaptain(message.payload)
        if (message.type === 'CAPTAIN_REVOKED') revokeCaptain()
        if (message.type === 'AUTH_FAILED') {
          if (hostKey) reject()
          else revokeCaptain()
        }
        // The server failed while checking the key; the key may well be fine. Drop this
        // socket and let onclose poll and reconnect, which signs in again.
        if (message.type === 'AUTH_ERROR') socket.close()
      }
      socket.onclose = (event) => {
        if (cancelled || ended) return
        if (event.code === GONE) {
          end()
          return
        }
        setStatus('reconnecting')
        clearInterval(pollTimer)
        pollTimer = setInterval(poll, POLL_MS)
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 8000))
        attempt += 1
      }
    }

    poll().then((found) => {
      if (found && !cancelled && !ended) connect()
    })

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      socket?.close()
    }
  }, [code, hostKey, captainKey, applyHost, applyViewer, applyCaptain])

  return {
    status, viewer, host, lastSnapshotAt,
    captain: captainKey && !revokedCaptainKeys.includes(captainKey) ? captain : null,
    captainRevoked: Boolean(captainKey) && revokedCaptainKeys.includes(captainKey),
    authFailed: Boolean(hostKey) && rejectedKeys.includes(hostKey),
    setHost: applyHost,
    setCaptain: applyCaptain,
  }
}
