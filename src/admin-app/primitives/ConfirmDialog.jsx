import { useEffect, useId, useRef, useState } from 'react'
import { registerConfirmHost } from './confirm'
import { Dialog } from './Dialog'
import { BUTTON, INPUT } from './classes'

/**
 * Shows each confirmAction() request (ADMIN-06). Cancel is focused first for a
 * destructive request; a typed confirmation keeps the confirm button disabled
 * until the text matches; on Production a destructive request says so
 * (ADMIN-09), so work there is not mistaken for a test.
 */
export function ConfirmHost({ environment }) {
  const [request, setRequest] = useState(null)
  const [typed, setTyped] = useState('')
  const [option, setOption] = useState(false)
  const cancelRef = useRef(null)
  const typedRef = useRef(null)
  const typedId = useId()
  const optionId = useId()

  useEffect(() => registerConfirmHost((next) => {
    setTyped('')
    setOption(Boolean(next.option?.defaultChecked))
    setRequest(next)
  }), [])

  if (!request) return null
  const finish = (answer) => {
    request.resolve(answer)
    setRequest(null)
  }
  const needsTyping = Boolean(request.typeToConfirm)
  const matches = !needsTyping || typed.trim() === request.typeToConfirm
  const production = request.danger && environment?.key === 'production'

  return (
    <Dialog
      open
      role="alertdialog"
      title={request.title}
      description={request.body}
      onClose={() => finish(null)}
      initialFocusRef={needsTyping ? typedRef : request.danger ? cancelRef : undefined}
      footer={(
        <>
          <button ref={cancelRef} type="button" className={BUTTON.secondary} onClick={() => finish(null)}>Cancel</button>
          <button type="button" className={request.danger ? BUTTON.danger : BUTTON.primary} disabled={!matches} onClick={() => finish({ option, typed: typed.trim() })}>
            {request.confirmLabel ?? 'Confirm'}
          </button>
        </>
      )}
    >
      {production ? (
        <p data-testid="confirm-environment" className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-[var(--ws-danger)]">
          This is the Production workspace: the change affects the live site and real records.
        </p>
      ) : null}
      {request.option ? (
        <div className="flex items-start gap-2 text-sm">
          <input id={optionId} type="checkbox" className="mt-1" checked={option} onChange={(event) => setOption(event.target.checked)} />
          <label htmlFor={optionId}>
            <span className="font-semibold">{request.option.label}</span>
            {request.option.hint ? <span className="block text-xs text-[var(--ws-ink-3)]">{request.option.hint}</span> : null}
          </label>
        </div>
      ) : null}
      {needsTyping ? (
        <div className="mt-3 grid gap-1">
          <label htmlFor={typedId} className="text-sm font-semibold">Type <span className="ws-mono">{request.typeToConfirm}</span> to confirm</label>
          <input id={typedId} ref={typedRef} className={INPUT} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
        </div>
      ) : null}
    </Dialog>
  )
}
