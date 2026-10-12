import { useMemo, useState } from 'react'
import { useTurnstile, VERIFICATION_MESSAGES } from '../components/islands/useTurnstile.js'
import { OPEN_SESSION_TURNSTILE_ACTION } from '../lib/pickleball/open/constants'
import { defaultAnnouncement } from '../lib/pickleball/open/announcement'
import { parseRoster, parseRosterCsv } from '../lib/pickleball/open/roster'
import { LIMITS } from '../lib/pickleball/open/types'
import { createSession } from './lib/api'
import { rememberHostedSession } from './lib/hostKeys'
import HostLinkPanel from './components/HostLinkPanel.jsx'
import { ModePicker } from './components/ModePicker.jsx'
import { FormatPicker } from './tournament/Choice.jsx'
import { Button, Panel } from './components/ui.jsx'

const TARGETS = [11, 15, 21]
const KINDS = [
  ['OPEN_PLAY', 'Open play', 'Players rotate through the courts all session.'],
  ['TOURNAMENT', 'Tournament', 'Fixed pairs play a draw: round robin, pools or a bracket.'],
]
const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'

export default function CreateSessionApp({ siteKey }) {
  const [step, setStep] = useState('details')
  const [details, setDetails] = useState({ kind: 'OPEN_PLAY', format: 'ROUND_ROBIN', name: 'Open Play', hostDisplayName: '', courtCount: 4, target: 11, mode: 'PADDLE_STACK', selfCheckIn: true, announcement: null })
  const [rosterMode, setRosterMode] = useState('paste')
  const [pasted, setPasted] = useState('')
  const [csvText, setCsvText] = useState('')
  const [created, setCreated] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstile(siteKey, step === 'players', OPEN_SESSION_TURNSTILE_ACTION)

  const roster = useMemo(() => {
    if (rosterMode === 'csv') {
      const parsed = parseRosterCsv(csvText)
      return { entries: parsed.entries, duplicates: parsed.duplicates, warnings: parsed.warnings }
    }
    const parsed = parseRoster(pasted)
    return { entries: parsed.names.map((name) => ({ name, skill: null, duprId: null })), duplicates: parsed.duplicates, warnings: [] }
  }, [rosterMode, pasted, csvText])

  // The welcome message follows the name and kind until the host types their own (then announcement is a string).
  const announcement = details.announcement ?? defaultAnnouncement(details.kind, details.name)
  const announcementOver = announcement.trim().length > LIMITS.maxAnnouncementLength
  const overCap = Math.max(0, roster.entries.length - LIMITS.maxPlayers)
  const update = (patch) => setDetails((current) => ({ ...current, ...patch }))

  async function onCsvFile(event) {
    const file = event.target.files?.[0]
    if (file) setCsvText(await file.text())
  }

  async function start() {
    setError(null)
    if (!turnstile.token) {
      setError(VERIFICATION_MESSAGES[turnstile.state] || VERIFICATION_MESSAGES.error)
      return
    }
    setBusy(true)
    try {
      const result = await createSession({
        name: details.name,
        hostDisplayName: details.hostDisplayName,
        courtCount: details.courtCount,
        settings: { mode: details.mode, target: details.target, scoringStyle: 'SIDEOUT', selfCheckIn: details.selfCheckIn, announcement: announcement.trim() },
        kind: details.kind,
        ...(details.kind === 'TOURNAMENT' ? { tournament: { format: details.format } } : {}),
        players: roster.entries,
        turnstileToken: turnstile.token,
      })
      rememberHostedSession({ code: result.code, hostKey: result.hostKey, name: details.name })
      setCreated(result)
      setStep('done')
    } catch (failure) {
      setError(failure.message)
      turnstile.reset()
    } finally {
      setBusy(false)
    }
  }

  if (step === 'done' && created) return <HostLinkPanel code={created.code} hostKey={created.hostKey} name={details.name} />

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:py-12">
      <a href="/pickleball" className="text-sm text-mist hover:text-white">← Devlab Pickleball</a>
      <h1 className="mt-3 text-3xl font-bold md:text-4xl">{step === 'details' ? 'New session' : 'Add players'}</h1>
      <p className="mt-1 text-mist">Step {step === 'details' ? 1 : 2} of 2 · free, no sign-up</p>

      {step === 'details' && (
        <form className="mt-6 grid gap-5 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setStep('players') }}>
          <div className="grid gap-2 sm:grid-cols-2 md:col-span-2" role="radiogroup" aria-label="What are you running?">
            {KINDS.map(([kind, label, summary]) => (
              <button key={kind} type="button" role="radio" aria-checked={details.kind === kind}
                onClick={() => update({ kind, name: details.name === 'Open Play' || details.name === 'Tournament' ? label : details.name })}
                className={`min-h-16 rounded-2xl p-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon ${details.kind === kind ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900 text-white hover:border-pickle-neon'}`}>
                <span className="block text-lg font-bold">{label}</span>
                <span className={`block text-sm ${details.kind === kind ? 'text-ink' : 'text-mist'}`}>{summary}</span>
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm text-mist">Session name
            <input required maxLength={60} className={field} value={details.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="grid gap-1.5 text-sm text-mist">Your name (shown as "Hosted by")
            <input required maxLength={40} className={field} value={details.hostDisplayName} placeholder="e.g. Coach Mike" onChange={(e) => update({ hostDisplayName: e.target.value })} />
          </label>
          <Panel>
            <div className="flex items-center justify-between">
              <span className="font-semibold">Courts</span>
              <div className="flex items-center gap-3">
                <Button variant="ghost" aria-label="Fewer courts" className="!px-0 w-11" onClick={() => update({ courtCount: Math.max(1, details.courtCount - 1) })}>−</Button>
                <output className="w-8 text-center text-2xl font-bold" aria-live="polite">{details.courtCount}</output>
                <Button variant="ghost" aria-label="More courts" className="!px-0 w-11" onClick={() => update({ courtCount: Math.min(16, details.courtCount + 1) })}>+</Button>
              </div>
            </div>
          </Panel>
          <Panel>
            <span className="font-semibold">Games to</span>
            <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Games to">
              {TARGETS.map((target) => (
                <Button key={target} role="radio" aria-checked={details.target === target} variant={details.target === target ? 'neon' : 'ghost'} onClick={() => update({ target })}>{target}</Button>
              ))}
            </div>
            <p className="mt-3 text-sm text-mist">Sudden death or win by 2: both are accepted when you enter the score.</p>
          </Panel>
          {details.kind === 'TOURNAMENT' ? (
            <Panel className="md:col-span-2">
              <p className="mb-3 font-semibold">Format</p>
              <FormatPicker value={details.format} onChange={(format) => update({ format })} />
              <p className="mt-3 text-sm text-mist">Once everyone is in, you choose how pairs are made and seeded, generate the draw, and edit it as much as you like before you start.</p>
            </Panel>
          ) : (
            <Panel className="md:col-span-2">
              <p className="mb-3 font-semibold">Who plays next</p>
              <ModePicker value={details.mode} onChange={(mode) => update({ mode })} />
              <p className="mt-3 text-sm text-mist">You can switch any time during the session. Anyone who has sat out 2 rounds in a row goes on next, whichever you pick (a keep-together or keep-apart rule can hold them back), and every proposed game can be edited before it starts.</p>
            </Panel>
          )}
          <label className="flex min-h-11 items-center gap-3 md:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-[#c6ff2e]" checked={details.selfCheckIn} onChange={(e) => update({ selfCheckIn: e.target.checked })} />
            <span>Let players check themselves in by QR <span className="text-sm text-mist">(you can turn this off any time)</span></span>
          </label>
          <div className="grid gap-1.5 md:col-span-2">
            <label className="grid gap-1.5 text-sm text-mist">Welcome message (players see it on the board, check-in page and TV; leave empty for none)
              <textarea rows={2} className={field} value={announcement} onChange={(e) => update({ announcement: e.target.value })} />
            </label>
            <p className={`text-right text-xs ${announcementOver ? 'font-bold text-rose-200' : 'text-mist'}`} aria-live="polite">
              {announcement.trim().length}/{LIMITS.maxAnnouncementLength}{announcementOver ? `: keep it to ${LIMITS.maxAnnouncementLength} characters` : ''}
            </p>
          </div>
          <Button type="submit" variant="primary" className="md:col-span-2 text-lg" disabled={announcementOver}>Next: add players</Button>
        </form>
      )}

      {step === 'players' && (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="How to add players">
              <Button role="tab" aria-selected={rosterMode === 'paste'} variant={rosterMode === 'paste' ? 'neon' : 'ghost'} onClick={() => setRosterMode('paste')}>Paste list</Button>
              <Button role="tab" aria-selected={rosterMode === 'csv'} variant={rosterMode === 'csv' ? 'neon' : 'ghost'} onClick={() => setRosterMode('csv')}>Upload CSV</Button>
            </div>
            {rosterMode === 'paste' ? (
              <label className="grid gap-1.5 text-sm text-mist">Paste names from Reclub, WhatsApp or anywhere: one per line, or comma-separated
                <textarea className={`${field} h-48 font-mono text-sm`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={'1. Ana\n2. Ben\nCarlo, Dina'} />
              </label>
            ) : (
              <label className="grid gap-1.5 text-sm text-mist">CSV with columns: name, skill (1–8, optional), DUPR ID (optional)
                <input type="file" accept=".csv,text/csv" className={field} onChange={onCsvFile} />
              </label>
            )}
            <p className="text-sm text-mist">You can add late arrivals any time. The board is public to anyone with the link, so first names or nicknames are fine.</p>
          </div>
          <Panel>
            <div className="flex items-baseline justify-between">
              <h2 className="font-bold">{roster.entries.length} players found</h2>
              {roster.duplicates.length > 0 && <span className="text-xs text-mist">{roster.duplicates.length} duplicate{roster.duplicates.length > 1 ? 's' : ''} removed</span>}
            </div>
            <ul className="mt-3 flex flex-wrap gap-1.5 text-sm">
              {roster.entries.map((entry) => <li key={entry.name} className="rounded-full bg-navy-800 px-3 py-1">{entry.name}</li>)}
            </ul>
            {roster.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-200">{warning}</p>)}
            {roster.entries.length > 0 && roster.entries.length < 4 && <p className="mt-3 text-sm text-amber-200">Add at least 4 players for the first game.</p>}
            {overCap > 0 && <p role="alert" className="mt-3 text-sm text-amber-200">A session can have up to {LIMITS.maxPlayers} players — remove {overCap}.</p>}
          </Panel>
          <div className="lg:col-span-2 grid gap-3">
            <div ref={turnstile.containerRef} />
            {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <Button variant="ghost" onClick={() => setStep('details')}>Back</Button>
              <Button variant="primary" className="flex-1 text-lg" disabled={busy || overCap > 0} onClick={start}>
                {busy ? 'Starting…' : `Start session · ${roster.entries.length} players, ${details.courtCount} court${details.courtCount > 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
