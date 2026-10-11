import { useEffect, useState } from 'react'
import { fetchViewer } from './api'

const POLL_MS = 5000
const GONE = 4404

/** Live board state: WebSocket first, 5-second polling while it is down (spec §3.4). */
export function useOpenSession(code, hostKey) {
  const [status, setStatus] = useState('connecting')
  const [viewer, setViewer] = useState(null)
  const [host, setHost] = useState(null)
  const [authFailed, setAuthFailed] = useState(false)

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let pollTimer = null
    let cancelled = false
    let attempt = 0

    async function poll() {
      try {
        const snapshot = await fetchViewer(code)
        if (!cancelled) setViewer(snapshot)
        return true
      } catch (error) {
        if (!cancelled && error?.status === 404) setStatus('not-found')
        return error?.status !== 404
      }
    }

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      socket.onopen = () => {
        attempt = 0
        clearInterval(pollTimer)
        setStatus('open')
        if (hostKey) socket.send(JSON.stringify({ type: 'AUTH', hostKey }))
      }
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'VIEWER') setViewer(message.payload)
        if (message.type === 'HOST') {
          setHost(message.payload)
          setViewer(message.payload.viewer)
        }
        if (message.type === 'AUTH_FAILED') setAuthFailed(true)
      }
      socket.onclose = (event) => {
        if (cancelled) return
        if (event.code === GONE) {
          setStatus('not-found')
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
      if (found && !cancelled) connect()
    })

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      socket?.close()
    }
  }, [code, hostKey])

  return { status, viewer, host, authFailed, setHost }
}
