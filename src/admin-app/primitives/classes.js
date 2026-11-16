// Class strings for the workspace primitives (ADMIN-06), on the semantic
// tokens in src/styles/admin.css. Plain values live here, components in
// index.jsx (react-refresh/only-export-components).

const control = 'rounded-[var(--ws-radius)] px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50'

export const BUTTON = {
  primary: `${control} bg-[var(--ws-action)] text-[var(--ws-action-ink)] hover:bg-[var(--ws-action-hover)]`,
  secondary: `${control} border border-[var(--ws-rule)] bg-[var(--ws-surface)] text-[var(--ws-ink)] hover:bg-[var(--ws-selected)]`,
  danger: `${control} border border-[var(--ws-danger)] bg-[var(--ws-surface)] text-[var(--ws-danger)] hover:bg-rose-50`,
  quiet: `${control} text-[var(--ws-link)] hover:bg-[var(--ws-selected)]`,
}

export const INPUT = 'w-full rounded-[var(--ws-radius)] border border-[var(--ws-rule)] bg-[var(--ws-surface)] px-3 py-2 text-sm text-[var(--ws-ink)]'

export const FEEDBACK_TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-[var(--ws-ok)]',
  warn: 'border-amber-200 bg-amber-50 text-[var(--ws-warning)]',
  info: 'border-[var(--ws-rule)] bg-[var(--ws-selected)] text-[var(--ws-ink)]',
  error: 'border-rose-200 bg-rose-50 text-[var(--ws-danger)]',
}
