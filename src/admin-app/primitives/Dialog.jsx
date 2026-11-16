import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0)
}

/**
 * A modal dialog (ADMIN-06): focus moves in (to `initialFocusRef`, else the
 * first field or button), Tab stays inside, Escape closes it when it may be
 * dismissed, and focus returns to whatever opened it.
 *
 * `dismissible: false` is for dialogs that must be answered (signing in again):
 * no Escape, no backdrop click, no close button.
 */
export function Dialog({ open, title, description, onClose, dismissible = true, initialFocusRef, children, footer, size = 'md', role = 'dialog' }) {
  const panel = useRef(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const root = panel.current
    const first = initialFocusRef?.current ?? focusables(root)[0] ?? root
    first.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape' && dismissible) {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === firstItem || !root.contains(document.activeElement))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (document.activeElement === lastItem || !root.contains(document.activeElement))) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [open, dismissible, initialFocusRef])

  if (!open) return null
  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'
  return createPortal(
    <div
      className="admin-dialog-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`admin-dialog w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl sm:p-6`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label="Close" className="admin-dialog-close -mr-2 -mt-1 inline-flex h-10 w-10 items-center justify-center rounded-lg">
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
        {description && <p id={descriptionId} className="admin-dialog-description mt-1 text-sm">{description}</p>}
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export default Dialog
