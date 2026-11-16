import { useEffect, useRef } from 'react'

const VARIANTS = {
  primary: 'pb-action',
  neon: 'bg-pickle-neon text-ink hover:brightness-95',
  ghost: 'border border-navy-700 text-white hover:bg-navy-900',
  quiet: 'text-pickle-neon hover:underline',
  danger: 'border border-rose-400/60 text-rose-200 hover:bg-rose-500/10',
}

/** @param {{ variant?: keyof typeof VARIANTS, className?: string } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props */
export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function Panel({ className = '', as: Tag = 'div', ...props }) {
  return <Tag className={`rounded-2xl bg-navy-900 p-4 ${className}`} {...props} />
}

export function Dot({ side }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${side === 'A' ? 'bg-pickle-neon' : 'bg-pickle-teamb'}`} />
}

export function TeamNames({ side, names, emphasis = [] }) {
  return (
    <div className="flex items-center gap-2">
      <Dot side={side} />
      <span className="sr-only">{side === 'A' ? 'Team A:' : 'Team B:'}</span>
      <span>
        {names.map((name, index) => (
          <span key={name}>
            {index > 0 && <span className="text-mist"> · </span>}
            <span className={emphasis.includes(name) ? 'font-bold text-pickle-neon' : ''}>{name}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Bottom sheet on phones, centred panel from md up (spec §11). A real modal
 * (PB-UX): focus moves in, Tab stays inside, Escape closes it, and focus goes
 * back to whatever opened it.
 */
export function Sheet({ title, onClose, children, returnFocusRef = null }) {
  const panel = useRef(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  }, [onClose])
  useEffect(() => {
    const opener = document.activeElement
    const fallback = returnFocusRef?.current ?? null
    const root = panel.current
    const items = () => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
    // The first field if there is one, else the panel itself (the close button is last in reading order).
    const first = items().find((el) => el.getAttribute('aria-label') !== 'Close') ?? root
    first.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const list = items()
      if (list.length === 0) return
      const head = list[0]
      const tail = list[list.length - 1]
      if (event.shiftKey && (document.activeElement === head || !root.contains(document.activeElement))) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && (document.activeElement === tail || !root.contains(document.activeElement))) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // The opener may be gone (a menu item that closed with its menu): fall back to the given control.
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) opener.focus()
      else fallback?.focus()
    }
  }, [returnFocusRef])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-center" role="presentation" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="pb-flip max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-navy-950 p-5 shadow-elevated outline-none md:max-w-lg md:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-xl text-mist hover:bg-navy-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A yes/no question in a sheet, instead of window.confirm (PB-UX). */
export function ConfirmSheet({ title, body, confirmLabel, danger = false, onConfirm, onClose, returnFocusRef }) {
  return (
    <Sheet title={title} onClose={onClose} returnFocusRef={returnFocusRef}>
      <p className="text-mist">{body}</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onClose(); onConfirm() }}>{confirmLabel}</Button>
      </div>
    </Sheet>
  )
}
