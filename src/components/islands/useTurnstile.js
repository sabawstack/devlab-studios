import { useEffect, useRef, useState } from 'react'

/**
 * Cloudflare Turnstile, rendered explicitly.
 *
 * Extracted from ContactForm so every public form shares one implementation —
 * three forms each maintaining their own widget lifecycle is how one of them
 * ends up silently not verifying.
 *
 * The token this returns is only ever a hint to the UI; the real check is
 * server-side in verifyTurnstileToken(), which fails closed.
 */

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
export const TURNSTILE_ACTION = 'contact_form'

export const VERIFICATION_MESSAGES = {
  loading: 'Completing secure verification…',
  verified: 'Secure verification complete.',
  expired: 'Verification expired. Please try again.',
  timeout: 'Verification timed out. Please retry.',
  unsupported: 'This browser cannot complete verification. Try another browser.',
  error: 'Verification could not load. Please retry.',
  'configuration-error': 'Verification is temporarily unavailable. Please try again later.',
}

/**
 * @param {string} siteKey
 * @param {boolean} [enabled]  false while the widget's container is not
 *   mounted. Without this the hook renders once on mount, finds no container
 *   (because the container lives on a later form step), and never tries
 *   again -- leaving a form that can never produce a token and therefore can
 *   never be submitted. Including it in the dependency list is what makes the
 *   widget render the moment its container actually appears.
 * @param {string} [action]  Turnstile action; must match the server's expectedAction.
 */
export function useTurnstile(siteKey, enabled = true, action = TURNSTILE_ACTION) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const [token, setToken] = useState('')
  const [state, setState] = useState(siteKey ? 'loading' : 'configuration-error')

  useEffect(() => {
    if (!siteKey || !enabled) return undefined
    let cancelled = false
    let script = document.querySelector(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current !== null) return
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'light',
          size: 'flexible',
          appearance: 'always',
          retry: 'auto',
          'refresh-expired': 'auto',
          callback: (nextToken) => {
            setToken(nextToken)
            setState('verified')
          },
          'expired-callback': () => {
            setToken('')
            setState('expired')
          },
          'timeout-callback': () => {
            setToken('')
            setState('timeout')
          },
          'unsupported-callback': () => {
            setToken('')
            setState('unsupported')
          },
          'error-callback': () => {
            setToken('')
            setState('error')
          },
        })
      } catch {
        setState('error')
      }
    }

    function handleScriptError() {
      if (!cancelled) setState('error')
    }

    if (window.turnstile) {
      renderWidget()
    } else if (!script) {
      script = document.createElement('script')
      script.src = TURNSTILE_SCRIPT_SRC
      script.async = true
      script.defer = true
      script.addEventListener('load', renderWidget, { once: true })
      script.addEventListener('error', handleScriptError, { once: true })
      document.head.appendChild(script)
    } else {
      script.addEventListener('load', renderWidget, { once: true })
      script.addEventListener('error', handleScriptError, { once: true })
    }

    return () => {
      cancelled = true
      script?.removeEventListener('load', renderWidget)
      script?.removeEventListener('error', handleScriptError)
      if (window.turnstile && widgetIdRef.current !== null) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey, enabled, action])

  function reset() {
    setToken('')
    setState('loading')
    if (window.turnstile && widgetIdRef.current !== null) window.turnstile.reset(widgetIdRef.current)
  }

  return { containerRef, token, state, reset }
}
