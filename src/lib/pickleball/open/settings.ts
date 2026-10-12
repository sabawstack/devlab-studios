// Settings are stored as JSON (open_sessions.settings_json). Sessions created
// before a field existed load without it, so every read goes through this:
// one canonical shape, with a fixed key order (diffState compares JSON).
import { cleanAnnouncement } from './announcement'
import { DEFAULT_SETTINGS, type PairRule, type SessionSettings, type StackingMode } from './types'

export const STACKING_MODES: readonly StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

function isPairRule(value: unknown): value is PairRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as { kind?: unknown; playerIds?: unknown }
  return (rule.kind === 'TOGETHER' || rule.kind === 'APART')
    && Array.isArray(rule.playerIds) && rule.playerIds.length === 2
    && rule.playerIds.every((id) => typeof id === 'string' && id.length > 0)
    && rule.playerIds[0] !== rule.playerIds[1]
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
}

export function normalizeSettings(raw: unknown): SessionSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    mode: STACKING_MODES.includes(value.mode as StackingMode) ? (value.mode as StackingMode) : DEFAULT_SETTINGS.mode,
    target: value.target === 15 || value.target === 21 ? value.target : 11,
    scoringStyle: value.scoringStyle === 'RALLY' ? 'RALLY' : 'SIDEOUT',
    selfCheckIn: typeof value.selfCheckIn === 'boolean' ? value.selfCheckIn : DEFAULT_SETTINGS.selfCheckIn,
    rules: Array.isArray(value.rules)
      ? value.rules.filter(isPairRule).map((rule) => ({ kind: rule.kind, playerIds: [rule.playerIds[0], rule.playerIds[1]] as const }))
      : [],
    // A session from before the welcome message existed has none (not the default).
    announcement: typeof value.announcement === 'string' ? cleanAnnouncement(value.announcement) : DEFAULT_SETTINGS.announcement,
    endedAt: isIsoDate(value.endedAt) ? value.endedAt : null,
  }
}
