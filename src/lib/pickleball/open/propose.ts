import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type ModeProposer, type Proposal } from './modes/paddleStack'
import { proposeWinnersLosers } from './modes/winnersLosers'
import { proposeBalanced } from './modes/balanced'
import { proposeByStanding } from './modes/byStanding'
import { activeRules } from './rules'
import { proposeFixture } from './tournament/courts'
import { LIMITS, type CommandContext, type OpenCourt, type OpenMatch, type OpenSessionState, type StackingMode } from './types'

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

/**
 * On deck: a proposed game whose court is still playing (PB-QUEUE-09). Its
 * four are set while the game before them runs, so they can get ready; it
 * becomes the court's call ("walk on now") when that game ends.
 */
export function isOnDeck(state: OpenSessionState, match: OpenMatch): boolean {
  return match.status === 'PROPOSED'
    && state.matches.some((m) => m.courtId === match.courtId && m.status === 'IN_PROGRESS')
}

/** The open-play game on deck, if any (there is at most one). */
export function onDeckMatch(state: OpenSessionState): OpenMatch | null {
  return state.matches.find((m) => isOnDeck(state, m)) ?? null
}

/** The playing court with no game behind it whose game started first: the one expected to free first. */
function deckCourt(state: OpenSessionState, courts: readonly OpenCourt[]): OpenCourt | null {
  const startedAt = (courtId: string) => {
    const m = state.matches.find((x) => x.courtId === courtId && x.status === 'IN_PROGRESS')
    return m ? Date.parse(m.startedAt ?? m.proposedAt) : null
  }
  const candidates = courts
    .filter((c) => startedAt(c.id) !== null && !state.matches.some((m) => m.courtId === c.id && m.status === 'PROPOSED'))
    .sort((a, b) => startedAt(a.id)! - startedAt(b.id)! || a.position - b.position)
  return candidates[0] ?? null
}

/**
 * Proposes a match for every enabled court that has none (spec §5.2). In open
 * play a court that frees takes the game on deck first, so its four never wait
 * longer than they were told; and once every court has a game, the next four
 * go on deck behind the court expected to free first (PB-QUEUE-09).
 */
export function fillProposals(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  const courts = [...state.courts].filter((c) => c.enabled).sort((a, b) => a.position - b.position)
  const openPlay = state.kind === 'OPEN_PLAY'
  const filled = courts.reduce((acc, court) => {
    if (!courtIsFree(acc, court.id)) return acc
    const deck = openPlay ? onDeckMatch(acc) : null
    if (deck) return { ...acc, matches: acc.matches.map((m) => (m.id === deck.id ? { ...m, courtId: court.id } : m)) }
    const proposal = proposeForCourt(acc)
    return proposal ? addProposal(acc, court.id, proposal, ctx) : acc
  }, state)
  if (!openPlay || onDeckMatch(filled) || courts.some((c) => courtIsFree(filled, c.id))) return filled
  const target = deckCourt(filled, courts)
  const proposal = target ? proposeForCourt(filled) : null
  return target && proposal ? addProposal(filled, target.id, proposal, ctx) : filled
}
