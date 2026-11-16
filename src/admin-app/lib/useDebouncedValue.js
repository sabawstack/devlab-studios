import { useEffect, useState } from 'react'

/** The value, once it has stopped changing for `ms` (CRM-06: one request per pause, not per keystroke). */
export function useDebouncedValue(value, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}
