import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, postCommand } from './api'

const RETRY_MS = 3000

/**
 * Sends host commands in order. A network failure or 5xx keeps the command
 * queued and retries it with the SAME idempotency key, so a flaky court-side
 * connection can never apply a tap twice (spec §3.4). A 4xx is final and
 * surfaces its message.
 */
export function useCommandQueue(code, hostKey, onHost) {
  const queueRef = useRef([])
  const flushingRef = useRef(false)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState(null)

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      while (queueRef.current.length) {
        const item = queueRef.current[0]
        try {
          const result = await postCommand(code, hostKey, item.envelope)
          onHost(result.host)
          queueRef.current = queueRef.current.slice(1)
          item.resolve(true)
        } catch (failure) {
          if (failure instanceof ApiError && failure.status < 500 && failure.status !== 429) {
            queueRef.current = queueRef.current.slice(1)
            setError(failure.message)
            item.resolve(false)
          } else {
            break
          }
        } finally {
          setPending(queueRef.current.length)
        }
      }
    } finally {
      flushingRef.current = false
    }
  }, [code, hostKey, onHost])

  const send = useCallback((command) => new Promise((resolve) => {
    queueRef.current = [...queueRef.current, { envelope: { idempotencyKey: crypto.randomUUID(), command }, resolve }]
    setPending(queueRef.current.length)
    flush()
  }), [flush])

  useEffect(() => {
    const timer = setInterval(() => {
      if (queueRef.current.length) flush()
    }, RETRY_MS)
    return () => clearInterval(timer)
  }, [flush])

  return { send, pending, error, clearError: () => setError(null) }
}
