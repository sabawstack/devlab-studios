// src/pickleball-open/tournament/TournamentSetup.jsx
// Spec §6.1–6.4: choose format, pairs and seeding, then Generate a draft.
// Generating again (before Start) replaces the draft.
import { useState } from 'react'
import { minimumEntrants } from '../../lib/pickleball/tournament/generateFixtures'
import { FORMAT_INFO } from '../../lib/pickleball/open/tournament/info'
import { Button, Panel } from '../components/ui.jsx'
import { FormatPicker, PairingPicker, SeedingPicker } from './Choice.jsx'

export default function TournamentSetup({ tournament, activeCount, send }) {
  const [format, setFormat] = useState(tournament.format)
  const [pairing, setPairing] = useState(tournament.pairing)
  const [seeding, setSeeding] = useState(tournament.seeding)
  const drafted = tournament.phase === 'DRAFT'
  const pairs = Math.floor(activeCount / 2)
  const short = pairs < minimumEntrants(format)

  function generate() {
    if (drafted && !window.confirm('Generate a new draw? The pairs and every edit you made to this draft are replaced.')) return
    send({ type: 'GENERATE_DRAW', format, pairing, seeding })
  }

  return (
    <Panel className="grid gap-4">
      <div>
        <h2 className="text-lg font-bold">{drafted ? 'Change the draw' : 'Set up the draw'}</h2>
        <p className="text-sm text-mist">
          {activeCount} players checked in: {pairs} pair{pairs === 1 ? '' : 's'}{activeCount % 2 ? ', 1 player left over' : ''}. Players on a break are not drawn.
        </p>
      </div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Format</h3><FormatPicker value={format} onChange={setFormat} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Pairs</h3><PairingPicker value={pairing} onChange={setPairing} /></div>
      <div className="grid gap-2"><h3 className="text-sm font-bold uppercase tracking-[0.1em] text-mist">Seeding</h3><SeedingPicker value={seeding} onChange={setSeeding} /></div>
      {short && <p className="text-sm text-amber-200" role="status">{FORMAT_INFO[format].label} needs at least {minimumEntrants(format)} pairs. Add players first.</p>}
      <Button variant={drafted ? 'ghost' : 'primary'} disabled={short} onClick={generate}>{drafted ? 'Generate again' : 'Generate the draw'}</Button>
    </Panel>
  )
}
