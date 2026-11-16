// confirmAction (ADMIN-06): the Admin's replacement for window.confirm and
// window.prompt. One ConfirmHost, mounted beside the router, shows each
// request in a ConfirmDialog. Resolves null when cancelled, else
// { option, typed }: `option` is the optional checkbox's answer, `typed` what
// was typed when typed confirmation was asked for.
//
//   if (!(await confirmAction({ title, body, confirmLabel, danger: true }))) return
//
// Without a mounted host (a page outside the Admin app) it falls back to
// window.confirm, so a caller never silently skips its confirmation.
let host = null

export function registerConfirmHost(show) {
  host = show
  return () => {
    if (host === show) host = null
  }
}

/**
 * @param {{ title: string, body?: string, confirmLabel?: string, danger?: boolean,
 *   typeToConfirm?: string, option?: { label: string, hint?: string, defaultChecked?: boolean } }} request
 * @returns {Promise<null | { option: boolean, typed: string }>}
 */
export function confirmAction(request) {
  if (!host) {
    const ok = globalThis.confirm?.([request.title, request.body].filter(Boolean).join('\n\n')) ?? false
    return Promise.resolve(ok ? { option: Boolean(request.option?.defaultChecked), typed: request.typeToConfirm ?? '' } : null)
  }
  return new Promise((resolve) => host({ ...request, resolve }))
}
