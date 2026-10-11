import { expectedWinnerScore } from '../../lib/pickleball/open/scoreValidation'

/** Losing scores a host can tap: 0..target-1, plus four deuce steps (Review Focus 5). */
export function scorePadOptions(target) {
  return [...Array.from({ length: target }, (_, i) => i), target, target + 1, target + 2, target + 3]
}

/**
 * The result for a tapped losing score. Sudden death is the default; when the
 * loser has exactly target - 1, `winBy2` turns 11–10 into 12–10.
 */
export function resultFromPad(winner, loserScore, settings, winBy2 = false) {
  const winnerScore = winBy2 && loserScore === settings.target - 1 ? settings.target + 1 : expectedWinnerScore(loserScore, settings)
  return winner === 'A'
    ? { winner, scoreA: winnerScore, scoreB: loserScore }
    : { winner, scoreA: loserScore, scoreB: winnerScore }
}
