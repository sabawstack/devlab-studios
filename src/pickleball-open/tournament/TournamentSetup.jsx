// src/pickleball-open/tournament/TournamentSetup.jsx
// Spec §6.1–6.4: choose format, pairs and seeding, then Generate a draft.
// Generating again (before Start) replaces the draft. Once a draft exists the
// pickers fold into a one-line summary so the draft is what the host sees.
import { useState } from 'react'
import { minimumEntrants } from '../../lib/pickleball/tournament/generateFixtures'
import { FORMAT_INFO, PAIRING_INFO, SEEDING_INFO } from '../../lib/pickleball/open/tournament/info'
import { Button, Panel } from '../components/ui.jsx'
import { FormatPicker, PairingPicker, SeedingPicker } from './Choice.jsx'

export default function TournamentSetup({ tournament, activeCount, send, onGenerated }) {
  const [format, setFormat] = useState(tournament.format)
  const [pairing, setPairing] = useState(tournament.pairing)
  const [seeding, setSeeding] = useState(tournament.seeding)
  const [changing, setChanging] = useState(false)
  const drafted = tournament.phase === 'DRAFT'
  const pairs = Math.floor(activeCount / 2)
  const short = pairs < minimumEntrants(format)

  async function generate() {
    if (drafted && !window.confirm('Generate a new draw? The pairs and every edit you made to this draft are replaced.')) return
    if (!(await send({ type: 'GENERATE_DRAW', format, pairing, seeding }))) return
    setChanging(false)
    onGenerated?.()
  }

  if (drafted && !changing) {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-sm">
          <span className="font-bold">{tournament.formatLabel}</span>
          <span className="text-mist"> · Pairs: {PAIRING_INFO[tournament.pairing].label} · Seeding: {SEEDING_INFO[tournament.seeding].label}</span>
        </p>
        <Button variant="ghost" aria-expanded={false} onClick={() => setChanging(true)}>Change setup</Button>
      </Panel>
    )
  }

  return (
    <Panel className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{drafted ? 'Change the draw' : 'Set up the draw'}</h2>
          <p className="text-sm text-mist">
            {activeCount} players checked in: {pairs} pair{pairs === 1 ? '' : 's'}{activeCount % 2 ? ', 1 player left over' : ''}. Players on a break are not drawn.
          </p>
        </div>
        {drafted && <Button variant="ghost" aria-expanded onClick={() => setChanging(false)}>Keep this draft</Button>}
      </div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Format</h3><FormatPicker value={format} onChange={setFormat} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Pairs</h3><PairingPicker value={pairing} onChange={setPairing} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Seeding</h3><SeedingPicker value={seeding} onChange={setSeeding} /></div>
      {short && <p className="text-sm text-amber-200" role="status">{FORMAT_INFO[format].label} needs at least {minimumEntrants(format)} pairs. Add players first.</p>}
      <Button variant={drafted ? 'ghost' : 'primary'} disabled={short} onClick={generate}>{drafted ? 'Generate again' : 'Generate the draw'}</Button>
    </Panel>
  )
}
