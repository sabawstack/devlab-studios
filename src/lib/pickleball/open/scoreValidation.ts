// Only the FINAL score is ever entered, so the app cannot know whether a court
// played sudden death or win by 2. Both endings are accepted (spec §5.1).
import type { SessionSettings, Side } from './types'

export interface ResultInput {
  winner: Side
  scoreA: number | null
  scoreB: number | null
}

export type ValidationResult = { ok: true } | { ok: false; reason: string }

const OK: ValidationResult = { ok: true }

function isScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 99
}

/**
 * The pad's default winning score for a losing score: sudden death below the
 * target (most open play), deuce once the loser has reached the target.
 */
export function expectedWinnerScore(loserScore: number, settings: Pick<SessionSettings, 'target'>): number {
  return loserScore <= settings.target - 1 ? settings.target : loserScore + 2
}

/** True for a sudden-death ending (11–10, 11–7) or a win-by-2 ending (12–10, 13–11). */
export function isPossibleFinal(winnerScore: number, loserScore: number, target: number): boolean {
  if (winnerScore <= loserScore) return false
  if (winnerScore === target) return loserScore <= target - 1
  return winnerScore > target && winnerScore - loserScore === 2 && loserScore >= target - 1
}

export function validateResult(input: ResultInput, settings: SessionSettings): ValidationResult {
  const { winner, scoreA, scoreB } = input
  // Every result carries a score (owner decision 2026-10-12): standings rank on
  // the share of points won, so a winner-only save would rank on wins alone.
  if (scoreA === null || scoreB === null) return { ok: false, reason: 'Enter the score for both teams.' }
  if (!isScore(scoreA) || !isScore(scoreB)) return { ok: false, reason: 'Scores must be whole numbers from 0 to 99.' }

  const winnerScore = winner === 'A' ? scoreA : scoreB
  const loserScore = winner === 'A' ? scoreB : scoreA
  if (winnerScore <= loserScore) return { ok: false, reason: 'The winning team must have the higher score.' }
  if (!isPossibleFinal(winnerScore, loserScore, settings.target)) {
    return {
      ok: false,
      reason: `A game to ${settings.target} can't end ${winnerScore}–${loserScore}. It ends at ${settings.target} (sudden death), or 2 points clear once both teams reach ${settings.target - 1} (win by 2).`,
    }
  }
  return OK
}
