// src/lib/pickleball/open/rotationExample.test.ts
import { describe, expect, it } from 'vitest'
import { rotationExample } from './rotationExample'

describe('rotationExample', () => {
  it('14 players on 3 courts: 12 play each round, 2 sit out, and nobody sits out twice in a row', () => {
    const rounds = rotationExample()
    expect(rounds).toHaveLength(4)
    for (const round of rounds) {
      expect(round.courts).toHaveLength(3)
      expect(round.sittingOut).toHaveLength(2)
    }
    for (let i = 1; i < rounds.length; i += 1) {
      for (const name of rounds[i].sittingOut) expect(rounds[i - 1].sittingOut).not.toContain(name)
    }
  })
})
