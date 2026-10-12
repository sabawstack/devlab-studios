// QR self check-in (spec §4.2). Anonymous: a player types their own name and,
// if they like, a skill from 1 to 5 and a DUPR ID. Nothing but the name is required.
import { useEffect, useState } from 'react'
import { checkIn, fetchViewer } from './lib/api'
import { writeMe } from './lib/me'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import { Button, Panel } from './components/ui.jsx'
import Welcome from './components/Welcome.jsx'

const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'
const MESSAGES = {
  403: 'Check-in is closed for this session. Ask the host to add you.',
  404: 'This session has ended or the link is wrong.',
  429: 'Lots of people are checking in right now. Try again in a minute.',
}
// The page only needs the session name and the welcome message: one read, refreshed now and then.
const REFRESH_MS = 60_000

/** The public board, read once and every minute after, for the name and the host's message. */
function usePublicBoard(code) {
  const [viewer, setViewer] = useState(null)
  useEffect(() => {
    if (!code) return undefined
    let cancelled = false
    const load = () => fetchViewer(code)
      .then((next) => { if (!cancelled) setViewer(next) })
      // Only decoration: the form works without it, so a failed read keeps what is shown.
      .catch(() => {})
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [code])
  return viewer
}

export default function CheckInApp({ code }) {
  const [form, setForm] = useState({ name: '', skill: '', duprId: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const viewer = usePublicBoard(code)
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await checkIn(code, {
        name: form.name,
        skill: form.skill ? Number(form.skill) : null,
        duprId: form.duprId.trim() || null,
      })
      writeMe(code, result.playerId)
      setDone(result)
    } catch (failure) {
      setError(MESSAGES[failure?.status] ?? (failure instanceof Error && failure.message ? failure.message : 'Something went wrong. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!code) return <ExpiredNotice />

  if (done) {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Checked in</p>
        <h1 className="text-3xl font-bold">{done.alreadyCheckedIn ? `${done.name} is already on the list.` : `You're in, ${done.name}.`}</h1>
        <p className="text-mist">The board shows when you're up. This phone remembers it's you.</p>
        <a href={`/pickleball/s/${code}`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">See the board</a>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-md gap-5 px-4 py-10">
      <div>
        {/* Until the session name arrives the heading says "Check in" by itself, so the eyebrow waits. */}
        {viewer && <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Check in</p>}
        <h1 className="text-3xl font-bold [overflow-wrap:anywhere]">{viewer ? viewer.name : 'Check in'}</h1>
        {viewer && <Welcome announcement={viewer.announcement} className="mt-2" />}
        <p className="mt-3 text-mist">Type the name you want on the board. First names or nicknames are fine: the board is public.</p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-sm text-mist">Your name
          <input required maxLength={40} autoComplete="given-name" className={field} value={form.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <Panel className="grid gap-3">
          <label className="grid gap-1.5 text-sm text-mist">Skill (optional)
            <select className={field} value={form.skill} onChange={(e) => update({ skill: e.target.value })}>
              <option value="">Skip</option>
              <option value="1">1 · New to the game</option>
              <option value="2">2 · Beginner</option>
              <option value="3">3 · Intermediate</option>
              <option value="4">4 · Advanced</option>
              <option value="5">5 · Expert</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm text-mist">DUPR ID (optional)
            <input maxLength={6} autoCapitalize="characters" className={`${field} font-mono uppercase`} value={form.duprId} onChange={(e) => update({ duprId: e.target.value })} />
          </label>
          <p className="text-xs text-mist">Only the host sees these. They are deleted with the session.</p>
        </Panel>
        {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
        <Button type="submit" variant="primary" className="text-lg" disabled={busy || !form.name.trim()}>{busy ? 'Checking in…' : 'Check in'}</Button>
      </form>
    </main>
  )
}
