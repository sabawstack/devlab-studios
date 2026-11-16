import { BUTTON, INPUT } from '../../primitives/classes'

/**
 * Presentation constants and formatters for the Lead CRM screens.
 *
 * Separated from the components in shared.jsx because a module that exports
 * both components and plain values defeats React Fast Refresh — the whole
 * module gets remounted on every edit, which the project's lint config
 * (react-refresh/only-export-components) enforces rather than merely suggests.
 *
 * The tone maps are deliberately the same Tailwind vocabulary the existing
 * Inquiries screen uses, so the CRM reads as part of this CMS.
 */

export const STAGE_TONES = {
  DISCOVERED: 'bg-slate-100 text-slate-700',
  RESEARCHING: 'bg-sky-100 text-sky-800',
  RESEARCHED: 'bg-sky-100 text-sky-800',
  RULE_QUALIFIED: 'bg-indigo-100 text-indigo-800',
  AI_REVIEW: 'bg-violet-100 text-violet-800',
  AI_QUALIFIED: 'bg-violet-100 text-violet-800',
  CONTACT_FOUND: 'bg-cyan-100 text-cyan-800',
  READY_FOR_REVIEW: 'bg-amber-100 text-amber-800',
  READY_TO_CONTACT: 'bg-amber-100 text-amber-900',
  CONTACTED: 'bg-teal-100 text-teal-800',
  AWAITING_REPLY: 'bg-teal-100 text-teal-700',
  REPLIED: 'bg-emerald-100 text-emerald-800',
  CONVERSATION: 'bg-emerald-100 text-emerald-800',
  MEETING: 'bg-emerald-100 text-emerald-900',
  PROPOSAL: 'bg-emerald-200 text-emerald-900',
  WON: 'bg-emerald-600 text-white',
  LOST: 'bg-slate-200 text-slate-700',
  NOT_QUALIFIED: 'bg-slate-100 text-slate-500',
  HOLD: 'bg-amber-50 text-amber-700',
  NO_CONTACT: 'bg-orange-100 text-orange-800',
  DO_NOT_CONTACT: 'bg-rose-100 text-rose-800',
  UNSUBSCRIBED: 'bg-rose-100 text-rose-800',
  BOUNCED: 'bg-rose-50 text-rose-700',
  NOT_INTERESTED: 'bg-slate-200 text-slate-600',
  ARCHIVED: 'bg-slate-100 text-slate-400',
}

export const PRIORITY_TONES = {
  high: 'bg-rose-100 text-rose-800',
  normal: 'bg-slate-100 text-slate-700',
  low: 'bg-slate-50 text-slate-500',
}

export const COMPLIANCE_TONES = {
  passed: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-slate-100 text-slate-600',
  needs_human_review: 'bg-amber-100 text-amber-800',
  blocked: 'bg-rose-100 text-rose-800',
  waived: 'bg-violet-100 text-violet-800',
}

export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
    .replace(/_/g, ' ')
    .replace(/^\w/, (character) => character.toUpperCase())
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function relativeTime(value) {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'

  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`
  return formatDate(value)
}

// ADMIN-06: the workspace primitives' classes, so every Lead CRM screen gets
// the same buttons and fields as the rest of the Admin.
export const buttonClass = BUTTON.secondary

export const primaryButtonClass = BUTTON.primary

export const dangerButtonClass = BUTTON.danger

export const inputClass = INPUT.replace('w-full ', '')
