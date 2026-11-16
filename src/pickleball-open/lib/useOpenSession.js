import { useCallback, useEffect, useRef, useState } from 'react'
import { HEARTBEAT_PING, HEARTBEAT_PONG } from '../../lib/pickleball/open/realtime'
import { fetchCaptain, fetchHost, fetchViewer } from './api'
import { REALTIME } from './realtimeConfig'

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
 *
 * Freshness (PB-REALTIME-01) is the time of the last server contact
 * (`lastContactAt`: any frame, a heartbeat pong, or a successful poll), never
 * the socket's own state: a phone that slept can hold a socket that says
 * "open" and is dead. An open socket sends a heartbeat ping, which the runtime
 * answers without waking the Durable Object; no reply in time means the socket
 * is dropped and the poll-and-reconnect path takes over. When the page becomes
 * visible again or the device comes back online, the snapshot is polled at
 * once and an open socket is asked to RESYNC, under the same reply deadline.
 * Every timing is in realtimeConfig.js. Nothing here invents state: the screen
 * only ever shows a snapshot the server sent (PB-REALTIME-02).
 */
export function useOpenSession(code, hostKey, { onRejected, onCaptainRevoked, captainKey = null } = {}) {
  const [status, setStatus] = useState('connecting')
  const [viewer, setViewer] = useState(null)
  const [host, setHost] = useState(null)
  const [captain, setCaptain] = useState(null)
  // When a snapshot last arrived (socket push or poll): the "data from" time.
  const [lastSnapshotAt, setLastSnapshotAt] = useState(null)
  // When the server was last heard from at all (a snapshot, a pong, a poll): what "live" means.
  const [lastContactAt, setLastContactAt] = useState(null)
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
    setLastContactAt(Date.now())
  }, [accept])

  const applyHost = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setHost(snapshot)
    setViewer(snapshot.viewer)
    setLastSnapshotAt(Date.now())
    setLastContactAt(Date.now())
  }, [accept])

  const applyCaptain = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setCaptain(snapshot)
    setViewer(snapshot.viewer)
    setLastSnapshotAt(Date.now())
    setLastContactAt(Date.now())
  }, [accept])

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let pollTimer = null
    let heartbeatTimer = null
    let replyTimer = null
    // Set once the first poll found the session and the first socket was opened.
    let started = false
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

    function stopHeartbeat() {
      clearInterval(heartbeatTimer)
      clearTimeout(replyTimer)
      heartbeatTimer = null
      replyTimer = null
    }

    function end() {
      ended = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      stopHeartbeat()
      pollTimer = null
      setStatus('not-found')
    }

    async function pollViewer() {
      try {
        const snapshot = await fetchViewer(code)
        if (!cancelled) {
          applyViewer(snapshot)
          setLastContactAt(Date.now())
        }
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
        if (!cancelled) {
          apply(snapshot)
          setLastContactAt(Date.now())
        }
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

    /** The message that proves the socket serves this page's role, not just the public board. */
    const liveType = () => {
      if (hostKey && !hostDenied) return 'HOST'
      if (!hostKey && captainKey && !captainDenied) return 'CAPTAIN'
      return 'VIEWER'
    }

    const poll = () => {
      if (hostKey && !hostDenied) return pollKeyed(() => fetchHost(code, hostKey), applyHost, reject)
      if (!hostKey && captainKey && !captainDenied) return pollKeyed(() => fetchCaptain(code, captainKey), applyCaptain, revokeCaptain)
      return pollViewer()
    }

    /** The socket stopped answering: drop it (without waiting for a close handshake that may never come) and fall back. */
    function abandon(dead) {
      if (dead !== socket) return
      stopHeartbeat()
      dead.onclose = null
      dead.onmessage = null
      try {
        dead.close()
      } catch {
        // already closing
      }
      socket = null
      fallBack()
    }

    /** Poll until a socket is live again, and reconnect with backoff. */
    function fallBack() {
      if (cancelled || ended) return
      setStatus('reconnecting')
      // Keep a poll that is already running: restarting it on every quick reconnect
      // would push its first tick out forever.
      if (pollTimer === null) pollTimer = setInterval(poll, REALTIME.pollMs)
      clearTimeout(retryTimer)
      // 1, 2, 4, then every 8 seconds until a socket goes live.
      retryTimer = setTimeout(connect, Math.min(REALTIME.reconnectBaseMs * 2 ** attempt, REALTIME.reconnectMaxMs))
      attempt += 1
    }

    /** Sends a frame that must be answered (ping or RESYNC); no answer in time means the socket is dead. */
    function expectReply(ws, frame) {
      if (ws !== socket || ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(frame)
      } catch {
        abandon(ws)
        return
      }
      clearTimeout(replyTimer)
      replyTimer = setTimeout(() => abandon(ws), REALTIME.replyTimeoutMs)
    }

    /** Back from sleep, a hidden tab or no network: check now rather than trust what is on screen. */
    function wake() {
      if (cancelled || ended || !started) return
      if (document.visibilityState === 'hidden') return
      poll()
      if (socket && socket.readyState === WebSocket.OPEN) expectReply(socket, JSON.stringify({ type: 'RESYNC' }))
      else if (!socket || socket.readyState === WebSocket.CLOSED) {
        attempt = 0
        clearTimeout(retryTimer)
        connect()
      }
    }

    function connect() {
      if (cancelled || ended) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      socket = ws
      // The socket only counts as live once it delivers the snapshot this page signed in
      // for. An open socket whose sign-in keeps failing (AUTH_ERROR) must neither reset the
      // backoff nor stop the poll, or the console would never refresh.
      let live = false
      ws.onopen = () => {
        setStatus('open')
        // Opening is not contact: the server sends the snapshot at once, and only a frame counts.
        // None within the reply window means the socket is dead on arrival.
        clearTimeout(replyTimer)
        replyTimer = setTimeout(() => abandon(ws), REALTIME.replyTimeoutMs)
        clearInterval(heartbeatTimer)
        heartbeatTimer = setInterval(() => expectReply(ws, HEARTBEAT_PING), REALTIME.heartbeatMs)
        if (hostKey) ws.send(JSON.stringify({ type: 'AUTH', hostKey }))
        else if (captainKey && !captainDenied) ws.send(JSON.stringify({ type: 'AUTH', captainKey }))
      }
      ws.onmessage = (event) => {
        // Any frame is server contact and answers a pending ping or RESYNC.
        clearTimeout(replyTimer)
        replyTimer = null
        setLastContactAt(Date.now())
        if (event.data === HEARTBEAT_PONG) return
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (!live && message.type === liveType()) {
          live = true
          attempt = 0
          clearInterval(pollTimer)
          pollTimer = null
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
        if (message.type === 'AUTH_ERROR') ws.close()
      }
      ws.onclose = (event) => {
        if (ws === socket) {
          stopHeartbeat()
          socket = null
        }
        if (cancelled || ended) return
        if (event.code === GONE) {
          end()
          return
        }
        fallBack()
      }
    }

    poll().then((found) => {
      if (!found || cancelled || ended) return
      started = true
      connect()
    })
    const onVisibility = () => wake()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onVisibility)

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      stopHeartbeat()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onVisibility)
      socket?.close()
    }
  }, [code, hostKey, captainKey, applyHost, applyViewer, applyCaptain])

  return {
    status, viewer, host, lastSnapshotAt, lastContactAt,
    captain: captainKey && !revokedCaptainKeys.includes(captainKey) ? captain : null,
    captainRevoked: Boolean(captainKey) && revokedCaptainKeys.includes(captainKey),
    authFailed: Boolean(hostKey) && rejectedKeys.includes(hostKey),
    setHost: applyHost,
    setCaptain: applyCaptain,
  }
}
