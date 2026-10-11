import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type ModeProposer, type Proposal } from './modes/paddleStack'
import { proposeWinnersLosers } from './modes/winnersLosers'
import { activeRules } from './rules'
import { LIMITS, type CommandContext, type OpenSessionState, type StackingMode } from './types'

// Tasks 3-5 add one entry each; Task 5 makes this a total Record.
const PROPOSERS: Partial<Record<StackingMode, ModeProposer>> = {
  PADDLE_STACK: proposePaddleStack,
  WINNERS_LOSERS: proposeWinnersLosers,
}

/**
 * Runs the session's current mode (spec §5.2). The sit-out guard is inside
 * queueOrder (forced players first), and every mode picks through pickFour, so
 * keep-together/keep-apart can never be broken: no fitting four means null.
 */
export function proposeForCourt(state: OpenSessionState, exclude?: readonly string[]): Proposal | null {
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const queue = queueOrder(state)
  if (queue.length < 4) return null
  const proposer = PROPOSERS[state.settings.mode]
  if (!proposer) throw new Error(`Stacking mode ${state.settings.mode} is not available yet.`)
  return proposer({ state, queue, history: pairingHistory(state.matches), rules: activeRules(state), exclude })
}

/** Why a free court has no proposal, when the reason is not simply "fewer than 4 waiting". */
export function proposalBlocker(state: OpenSessionState): string | null {
  if (state.status !== 'ACTIVE') return null
  if (state.matches.length >= LIMITS.maxMatches) return `This session has reached ${LIMITS.maxMatches} games.`
  if (queueOrder(state).length < 4) return null
  return proposeForCourt(state)
    ? null
    : 'No four waiting players fit the keep-together and keep-apart rules. Change a rule, or wait for the next game to end.'
}

export function addProposal(state: OpenSessionState, courtId: string, proposal: Proposal, ctx: CommandContext): OpenSessionState {
  const seq = state.matches.reduce((max, m) => Math.max(max, m.seq), 0) + 1
  return {
    ...state,
    matches: [
      ...state.matches,
      {
        id: ctx.newId(), courtId, seq, status: 'PROPOSED', teamA: proposal.teamA, teamB: proposal.teamB,
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null, recordedBy: null,
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
