import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type Proposal } from './modes/paddleStack'
import { LIMITS, type CommandContext, type OpenSessionState } from './types'

export function proposeForCourt(state: OpenSessionState, exclude?: readonly string[]): Proposal | null {
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const queue = queueOrder(state)
  const history = pairingHistory(state.matches)
  switch (state.settings.mode) {
    case 'PADDLE_STACK':
      return proposePaddleStack(queue, history, exclude)
    default:
      // Unreachable in Phase 1: the create schema only accepts PADDLE_STACK.
      throw new Error(`Stacking mode ${state.settings.mode} is not available yet.`)
  }
}

export function addProposal(state: OpenSessionState, courtId: string, proposal: Proposal, ctx: CommandContext): OpenSessionState {
  const seq = state.matches.reduce((max, m) => Math.max(max, m.seq), 0) + 1
  return {
    ...state,
    matches: [
      ...state.matches,
      {
        id: ctx.newId(), courtId, seq, status: 'PROPOSED', teamA: proposal.teamA, teamB: proposal.teamB,
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null,
      },
    ],
  }
}

function courtIsFree(state: OpenSessionState, courtId: string): boolean {
  return !state.matches.some((m) => m.courtId === courtId && (m.status === 'PROPOSED' || m.status === 'IN_PROGRESS'))
}

/** Proposes a match for every enabled court that has none (spec §5.2). */
export function fillProposals(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return [...state.courts]
    .filter((c) => c.enabled)
    .sort((a, b) => a.position - b.position)
    .reduce((acc, court) => {
      if (!courtIsFree(acc, court.id)) return acc
      const proposal = proposeForCourt(acc)
      return proposal ? addProposal(acc, court.id, proposal, ctx) : acc
    }, state)
}
