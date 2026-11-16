// DevLab Workspace primitives (ADMIN-06): the small set every Admin screen
// builds from, on the semantic tokens in src/styles/admin.css. Grown out of
// the Lead CRM's shared.jsx and format.js, which now re-export these.
import { useId } from 'react'
import { BUTTON, FEEDBACK_TONE, INPUT } from './classes'

export { Dialog } from './Dialog'
export { ConfirmHost } from './ConfirmDialog'

/** @param {{ variant?: 'primary'|'secondary'|'danger'|'quiet' } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props */
export function Button({ variant = 'secondary', className = '', type = 'button', ...props }) {
  return <button type={type} className={`${BUTTON[variant]} ${className}`} {...props} />
}

export function Input({ className = '', ...props }) {
  return <input className={`${INPUT} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return <select className={`${INPUT} ${className}`} {...props}>{children}</select>
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`${INPUT} ${className}`} {...props} />
}

/**
 * A label above its control, an optional hint, and an error tied to the
 * control (aria-describedby). `children` is a render function given the id.
 */
export function FormField({ label, hint, error, children }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-[var(--ws-ink)]">{label}</label>
      {children({ id, 'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined, 'aria-invalid': error ? true : undefined })}
      {hint ? <p id={hintId} className="text-xs text-[var(--ws-ink-3)]">{hint}</p> : null}
      {error ? <p id={errorId} role="alert" className="text-xs font-semibold text-[var(--ws-danger)]">{error}</p> : null}
    </div>
  )
}

/** A read-only label/value row (definition list). Renders nothing when there is no value. */
export function Field({ label, children }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-[var(--ws-ink-3)]">{label}</dt>
      <dd className="break-words text-[var(--ws-ink)]">{children}</dd>
    </div>
  )
}

export function Badge({ value, tones = {}, label }) {
  const text = label ?? (value === null || value === undefined || value === '' ? '—' : String(value).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[value] || 'bg-slate-100 text-slate-700'}`}>
      {text}
    </span>
  )
}

export function Panel({ title, description, actions, children, className = '', as: Tag = 'section', ...props }) {
  return (
    <Tag className={`rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-surface)] ${className}`} {...props}>
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ws-rule)] px-4 py-3">
          <div>
            {title ? <h2 className="text-sm font-semibold text-[var(--ws-ink)]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-[var(--ws-ink-3)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </Tag>
  )
}

/** A scrollable table frame; rows and cells stay plain HTML so screen readers read a real table. */
export function Table({ caption, children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-[var(--ws-rule)] bg-[var(--ws-surface)] ${className}`}>
      <table className="w-full text-left text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  )
}

export function EmptyState({ title, hint, action }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--ws-rule)] px-4 py-8 text-center">
      <p className="text-sm font-medium text-[var(--ws-ink-2)]">{title}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--ws-ink-3)]">{hint}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

/**
 * A result or problem message, announced to screen readers (ADMIN-10): errors
 * interrupt (role="alert"), everything else is polite (role="status").
 */
export function Feedback({ feedback }) {
  if (!feedback) return null
  const tone = feedback.tone === 'ok' ? 'ok' : feedback.tone === 'warn' ? 'warn' : feedback.tone === 'info' ? 'info' : 'error'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${FEEDBACK_TONE[tone]}`}>
      {feedback.message}
    </div>
  )
}

/** Loading, failed and empty, said the same way on every screen (ADMIN-07). */
export function LoadState({ state, label = 'this', onRetry }) {
  if (state === 'loading') return <p role="status" className="text-sm text-[var(--ws-ink-3)]">Loading {label}…</p>
  if (state === 'error') {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[var(--ws-danger)]">
        <span>Could not load {label}.</span>
        {onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}
      </div>
    )
  }
  return null
}

/** The page's one heading, a short description, and its actions. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ws-ink)]">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-[var(--ws-ink-2)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
