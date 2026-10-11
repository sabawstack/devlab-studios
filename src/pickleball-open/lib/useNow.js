import { useEffect, useState } from 'react'

/** Whole minutes from an ISO time to `now` (ms); 0 for a missing or future time. */
export function minutesSince(iso, now) {
  if (!iso) return 0
  const ms = now - Date.parse(iso)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0
}

/** The current time, refreshed every intervalMs, so "waiting 12 min" keeps counting between snapshots. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
