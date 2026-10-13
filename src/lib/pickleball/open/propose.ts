import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type ModeProposer, type Proposal } from './modes/paddleStack'
import { proposeWinnersLosers } from './modes/winnersLosers'
import { proposeBalanced } from './modes/balanced'
import { proposeByStanding } from './modes/byStanding'
import { activeRules } from './rules'
import { proposeFixture } from './tournament/courts'
import { LIMITS, type CommandContext, type OpenSessionState, type StackingMode } from './types'

const PROPOSERS: Record<StackingMode, ModeProposer> = {
  PADDLE_STACK: proposePaddleStack,
  WINNERS_LOSERS: proposeWinnersLosers,
  BY_STANDING: proposeByStanding,
  BALANCED: proposeBalanced,
}

/**
 * Runs the session's current mode (spec §5.2). queueOrder is fair first
 * (fewest games, then the sit-out guard's forced players, then longest wait),
 * the modes other than paddle stack choose within modes/shared fairPool, and
 * every mode picks through pickFour, so
 * keep-together/keep-apart can never be broken: no fitting four means null.
 */
export function proposeForCourt(state: OpenSessionState, exclude?: readonly string[]): Proposal | null {
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  if (state.kind === 'TOURNAMENT') return proposeFixture(state)
  const queue = queueOrder(state)
  if (queue.length < 4) return null
  return PROPOSERS[state.settings.mode]({ state, queue, history: pairingHistory(state.matches), rules: activeRules(state), exclude })
}

/** Why a free court has no proposal, when the reason is not simply "fewer than 4 waiting". */
export function proposalBlocker(state: OpenSessionState): string | null {
  if (state.status !== 'ACTIVE' || state.kind === 'TOURNAMENT') return null
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
        fixtureId: proposal.fixtureId ?? null,
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
