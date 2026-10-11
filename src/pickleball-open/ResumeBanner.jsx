// src/pickleball-open/ResumeBanner.jsx
import { useEffect, useState } from 'react'
import { forgetHostedSession, hostedSessions } from './lib/hostKeys'

/** "Welcome back" card on /pickleball for a host who closed the tab (spec What-if). Renders nothing otherwise. */
export default function ResumeBanner() {
  const [sessions, setSessions] = useState([])
  // Read after mount so server HTML and first client render both start empty (no hydration mismatch).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setSessions(hostedSessions()) }, [])
  if (!sessions.length) return null
  const [latest] = sessions
  return (
    <section aria-label="Resume your session" className="mx-auto mt-6 max-w-3xl rounded-2xl bg-pickle-neon p-5 text-ink">
      <p className="text-xs font-bold tracking-[0.1em]">WELCOME BACK</p>
      <p className="mt-1 text-xl font-bold">{latest.name} is saved on this phone</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`/pickleball/s/${latest.code}`} className="inline-flex min-h-11 items-center rounded-xl bg-ink px-4 font-bold text-pickle-neon">Resume as host</a>
        <button type="button" className="min-h-11 rounded-xl px-3 underline" onClick={() => { forgetHostedSession(latest.code); setSessions(hostedSessions()) }}>Forget it</button>
      </div>
    </section>
  )
}
