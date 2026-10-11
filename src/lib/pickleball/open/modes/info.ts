// src/lib/pickleball/open/modes/info.ts
// One name and one line per stacking mode, shared by the create form, the
// host console, the board, the TV and the public pages, so they never
// describe a mode differently. Public-page copy rule: no "vs" (the
// comparative-language check on /pickleball/how-it-works would flag it).
import type { StackingMode } from '../types'

export const MODE_ORDER: readonly StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

export const MODE_INFO: Record<StackingMode, { label: string; summary: string }> = {
  PADDLE_STACK: {
    label: 'Paddle stack',
    summary: 'Fewest games first, then longest wait. Partners rotate.',
  },
  WINNERS_LOSERS: {
    label: 'Winners play winners',
    summary: 'Winners meet winners and losers meet losers, and last game’s partners end up on opposite sides.',
  },
  BY_STANDING: {
    label: 'By standing',
    summary: 'Players close in today’s standings play each other: 1st and 4th against 2nd and 3rd.',
  },
  BALANCED: {
    label: 'Balanced teams',
    summary: 'Teams are split so their skill adds up as evenly as possible.',
  },
}
