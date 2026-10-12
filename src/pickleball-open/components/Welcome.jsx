// src/pickleball-open/components/Welcome.jsx
// The greeting (this device's local time) and the host's welcome message,
// shown under the session name on the board and the check-in page.
import { greetingFor } from '../lib/greeting'
import { useNow } from '../lib/useNow'

const MINUTE = 60_000

export default function Welcome({ announcement, className = '' }) {
  // Re-read the clock each minute, so a session that runs past noon says good afternoon.
  const now = useNow(MINUTE)
  return (
    <div className={`grid gap-0.5 ${className}`} data-testid="welcome">
      <p className="font-semibold text-pickle-neon">{greetingFor(new Date(now))}</p>
      {announcement && <p className="[overflow-wrap:anywhere] text-white" data-testid="welcome-message">{announcement}</p>}
    </div>
  )
}
