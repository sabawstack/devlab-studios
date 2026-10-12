import { useState } from 'react'
import { Button, Panel } from './ui.jsx'

const KIND_LABEL = { TOGETHER: 'always partners', APART: 'never on the same court' }
const SELECT = 'min-h-11 min-w-0 rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white'

/** Keep-together / keep-apart (spec §5.4). Every mode keeps these as hard rules. */
export default function RulesPanel({ rules, players, send }) {
  const [kind, setKind] = useState('TOGETHER')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const present = players.filter((p) => p.status !== 'LEFT')
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? 'Someone who left'

  // Second hides whoever is First, so picking that same player as First clears Second.
  function pickFirst(id) {
    setFirst(id)
    if (id === second) setSecond('')
  }

  async function add(event) {
    event.preventDefault()
    if (!first || !second || first === second) return
    if (await send({ type: 'ADD_RULE', rule: { kind, playerIds: [first, second] } })) {
      setFirst('')
      setSecond('')
    }
  }

  return (
    <Panel as="section" aria-labelledby="rules-heading" className="grid gap-3">
      <h2 id="rules-heading" className="text-lg font-bold">Keep together or apart</h2>
      <p className="text-sm text-mist">Every way of picking players keeps these rules. If no game fits them, the court waits and says why.</p>
      <form onSubmit={add} className="grid gap-2">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rule">
          <Button role="radio" aria-checked={kind === 'TOGETHER'} variant={kind === 'TOGETHER' ? 'neon' : 'ghost'} onClick={() => setKind('TOGETHER')}>Keep together</Button>
          <Button role="radio" aria-checked={kind === 'APART'} variant={kind === 'APART' ? 'neon' : 'ghost'} onClick={() => setKind('APART')}>Keep apart</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-mist">First player
            <select value={first} onChange={(e) => pickFirst(e.target.value)} className={SELECT}>
              <option value="">Pick…</option>
              {present.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-mist">Second player
            <select value={second} onChange={(e) => setSecond(e.target.value)} className={SELECT}>
              <option value="">Pick…</option>
              {present.filter((p) => p.id !== first).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <Button type="submit" variant="primary" disabled={!first || !second || first === second}>Add rule</Button>
      </form>
      {rules.length === 0 ? <p className="text-sm text-mist">No rules yet.</p> : (
        <ul className="grid gap-1.5" aria-label="Rules">
          {rules.map((rule) => {
            const text = `${nameOf(rule.playerIds[0])} & ${nameOf(rule.playerIds[1])}: ${KIND_LABEL[rule.kind]}`
            return (
              <li key={`${rule.kind}-${rule.playerIds.join('-')}`} className="flex items-center gap-2 rounded-xl bg-navy-800 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">{text}</span>
                <Button variant="quiet" className="!min-h-11 !px-2" aria-label={`Remove rule: ${text}`} onClick={() => send({ type: 'REMOVE_RULE', rule })}>Remove</Button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
