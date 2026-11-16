// PB-QUEUE-08: does the queue order predict who plays next?
//
// Sessions are played through the real command path (testing/reducerSim.ts:
// applyCommand + finalizeCommand, games of different lengths so courts free
// one at a time, every proposal started at once). Before each result, three
// predictions of the four the server will call are taken and compared with
// the four it then proposes:
//
//   positions   the first four of the waiting list (what "You're #3 in line" implied)
//   projection  proposeForCourt on the state as it is, unconditionally
//   nextUp      the snapshot's nextUp, which names a four only when the state fixes it
//
// No keep-together or keep-apart rules here (the property test adds them).
// The numbers are recorded in the spec's Measurements section.
import { describe, expect, it } from 'vitest'
import { proposeForCourt } from './propose'
import { queueOutlook } from './outlook'
import { queueOrder } from './fairness'
import { Clock, createDriver, randomScore, setKey, startAll } from './testing/reducerSim'
import type { StackingMode } from './types'

const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']
const SIZES = [
  { players: 14, courts: 2 },
  { players: 24, courts: 3 },
  { players: 40, courts: 4 },
]
const RESULTS = 120

interface Tally { samples: number; positions: number; projection: number; gated: number; gatedRight: number }

function measure(mode: StackingMode, players: number, courts: number, seed: number): Tally {
  const driver = createDriver({ players, courts, mode, seed, skills: mode === 'BALANCED' })
  const clock = new Clock(driver.random)
  const tally: Tally = { samples: 0, positions: 0, projection: 0, gated: 0, gatedRight: 0 }
  startAll(driver)
  for (let n = 0; n < RESULTS; n += 1) {
    clock.track(driver.state, driver.minute)
    const next = clock.next(driver.state)
    if (!next) break
    const before = driver.state
    const positions = setKey(queueOrder(before).slice(0, 4).map((e) => e.player.id))
    const projected = proposeForCourt(before)
    const projection = projected ? setKey([...projected.teamA, ...projected.teamB]) : null
    const fixed = queueOutlook(before).nextUp
    const gated = fixed ? setKey(fixed.map((e) => e.player.id)) : null
    const proposedBefore = new Set(before.matches.filter((m) => m.status === 'PROPOSED').map((m) => m.id))
    const ok = driver.run({ type: 'RECORD_RESULT', matchId: next.match.id, ...randomScore(driver.random) }, Math.max(0, next.end - driver.minute))
    expect(ok).toBe(true)
    const called = driver.state.matches.find((m) => m.status === 'PROPOSED' && !proposedBefore.has(m.id) && m.courtId === next.match.courtId)
    if (called) {
      const actual = setKey([...called.teamA, ...called.teamB])
      tally.samples += 1
      if (positions === actual) tally.positions += 1
      if (projection === actual) tally.projection += 1
      if (gated !== null) {
        tally.gated += 1
        if (gated === actual) tally.gatedRight += 1
      }
    }
    startAll(driver)
  }
  return tally
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : 'n/a')

describe('PB-QUEUE-08: queue position versus the four actually called (real reducer)', () => {
  for (const mode of MODES) {
    it(`${mode}: nextUp is right every time it names a four, and names one often enough to matter`, () => {
      const rows: string[] = []
      for (const { players, courts } of SIZES) {
        const total: Tally = { samples: 0, positions: 0, projection: 0, gated: 0, gatedRight: 0 }
        for (const seed of [11, 23, 37]) {
          const t = measure(mode, players, courts, seed)
          for (const key of Object.keys(total) as Array<keyof Tally>) total[key] += t[key]
        }
        rows.push(`${mode} ${players}p/${courts}c: samples ${total.samples}, positions 1-4 right ${pct(total.positions, total.samples)}, `
          + `unconditional projection right ${pct(total.projection, total.samples)}, nextUp shown ${pct(total.gated, total.samples)} `
          + `and right ${total.gatedRight}/${total.gated}`)
        expect(total.samples).toBeGreaterThan(100)
        // The contract: whenever nextUp names four, they are the four called.
        expect(total.gatedRight).toBe(total.gated)
        // And the gate is not dead.
        expect(total.gated).toBeGreaterThan(0)
      }
      console.log(rows.join('\n'))
    })
  }
})
