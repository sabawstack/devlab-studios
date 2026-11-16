import { useEffect, useMemo, useState } from 'react'
import { buildCidMap, hasDeferredRemoteImages, resolveMessageHtml } from './resolveImages'
import { adminFetch } from '../../lib/adminApi'

/**
 * Renders the body of an inbound message.
 *
 * THE HTML IS RENDERED IN A SANDBOXED IFRAME, AND THAT IS THE ACTUAL SECURITY
 * BOUNDARY — not the sanitizer that ran at ingest.
 *
 * `sandbox=""` (empty, every permission withheld) puts the content in an opaque
 * origin with scripting disabled, no access to this page's DOM or cookies, no
 * form submission, no top-level navigation and no popups. Even a total failure
 * of src/mailbox/inbound/sanitizeHtml.js cannot execute script in the admin
 * session from in here.
 *
 * `dangerouslySetInnerHTML` would have been fewer lines and would have made the
 * sanitizer the ONLY thing standing between a stranger's email and an
 * authenticated admin origin. One control is not a defence; this is the second
 * one, and it is the stronger of the two.
 *
 * The CSP inside the document is a third: nothing was going to be loaded anyway
 * because the sanitizer strips every remote reference, but if one were ever
 * missed, `default-src 'none'` stops the request — which also means a tracking
 * pixel cannot report that the message was opened.
 */

/**
 * Only `img-src` ever moves.
 *
 * `default-src 'none'` stays put in both states, which is what keeps a CSS
 * `url()`, an `@import`, a font and a frame dead even after the operator has
 * agreed to load images. Relaxing the whole policy to show a picture would hand
 * back every fetch the sanitizer spent its effort removing.
 *
 * `data:` is always allowed because inline images arrive that way -- the parent
 * fetched them with the admin session, which this frame does not have.
 *
 * @param {boolean} loadRemote
 */
function frameCsp(loadRemote) {
  const img = loadRemote ? 'data: https:' : 'data:'
  return `default-src 'none'; style-src 'unsafe-inline'; img-src ${img}; frame-src 'none'; form-action 'none'; base-uri 'none'`
}

/** Styling for the framed document. Kept minimal — this is someone else's mail. */
const FRAME_STYLE = `
  html { color-scheme: light; }
  body {
    margin: 0;
    padding: 12px;
    font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #1e293b;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  a { color: #0369a1; }
  blockquote {
    margin: 0 0 0 8px;
    padding-left: 10px;
    border-left: 3px solid #e2e8f0;
    color: #64748b;
  }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { border: 1px solid #e2e8f0; padding: 4px 6px; text-align: left; }
  pre { white-space: pre-wrap; }
`

function HtmlFrame({ html, loadRemote }) {
  const [expanded, setExpanded] = useState(false)

  // The whole document is assembled here rather than letting the iframe inherit
  // anything: an explicit charset stops a UTF-8 body being read as Latin-1, and
  // the CSP has to be inside the document because a sandboxed frame has no
  // response headers of its own.
  const srcDoc = useMemo(
    () =>
      [
        '<!doctype html><html><head><meta charset="utf-8">',
        `<meta http-equiv="Content-Security-Policy" content="${frameCsp(loadRemote)}">`,
        `<style>${FRAME_STYLE}</style>`,
        '</head><body>',
        html,
        '</body></html>',
      ].join(''),
    [html, loadRemote],
  )

  return (
    <div>
      <iframe
        // Empty sandbox: no scripts, no same-origin, no forms, no navigation.
        // Adding `allow-scripts` and `allow-same-origin` together would undo
        // the sandbox entirely, which is the one combination never to reach for.
        sandbox=""
        srcDoc={srcDoc}
        title="Message content"
        referrerPolicy="no-referrer"
        className={`w-full rounded-lg border border-slate-200 bg-white transition-all ${expanded ? 'h-[70vh]' : 'h-72'}`}
      />
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-1 text-xs font-semibold text-slate-500 underline"
      >
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  )
}

/** Larger than any signature logo; a bigger part is a document, not decoration. */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

/**
 * Fetches this message's inline images and returns them as `data:` URLs.
 *
 * Done in the parent rather than in the frame because the admin session cookie
 * is SameSite=Strict: a request issued by a `sandbox=""` iframe carries no
 * session and comes back 401. The parent is same-site, so it can.
 *
 * @param {object} message
 * @param {boolean} active whether the formatted view is actually being shown
 */
function useInlineImages(message, active) {
  const [cidSrc, setCidSrc] = useState(() => new Map())

  const wanted = useMemo(() => {
    if (!active || !message.bodyHtml) return []
    const map = buildCidMap(message.attachments)
    if (map.size === 0) return []

    // Only the parts the body actually references are fetched. A message can
    // carry attachments that no <img> points at, and those are downloads, not
    // decoration.
    const referenced = new Set(
      Array.from(String(message.bodyHtml).matchAll(/\sdata-cid="([^"]*)"/gi), (match) =>
        match[1].trim().toLowerCase(),
      ),
    )

    return (message.attachments ?? [])
      .filter((attachment) => attachment.size <= MAX_INLINE_IMAGE_BYTES)
      .map((attachment) => {
        const cid = String(attachment.contentId ?? '')
          .trim()
          .replace(/^<|>$/g, '')
          .toLowerCase()
        return { cid, id: attachment.id }
      })
      .filter((entry) => entry.cid && referenced.has(entry.cid))
  }, [active, message.bodyHtml, message.attachments])

  const key = wanted.map((entry) => entry.id).join(',')

  useEffect(() => {
    if (wanted.length === 0) return undefined

    let cancelled = false

    async function load() {
      const resolved = new Map()

      for (const entry of wanted) {
        try {
          const response = await adminFetch(`/api/admin/mailbox/attachments/${entry.id}`, {
            credentials: 'same-origin',
          })
          if (!response.ok) continue

          const blob = await response.blob()
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result ?? ''))
            reader.onerror = () => resolve('')
            reader.readAsDataURL(blob)
          })
          if (dataUrl) resolved.set(entry.cid, dataUrl)
        } catch {
          // An image that will not load is not an error worth showing. The
          // sanitizer kept the alt text for exactly this case.
        }
      }

      if (!cancelled) setCidSrc(resolved)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return cidSrc
}

/**
 * @param {{ message: object }} props
 */
function MessageBody({ message }) {
  const [showHtml, setShowHtml] = useState(Boolean(message.bodyHtml))
  // Per message, per viewing. Deliberately not remembered anywhere: a sticky
  // "always load images" is how tracking protection quietly stops existing.
  const [loadRemote, setLoadRemote] = useState(false)

  const hasHtml = Boolean(message.bodyHtml)
  const hasText = Boolean(message.bodyText)

  const cidSrc = useInlineImages(message, showHtml && hasHtml)
  const resolvedHtml = useMemo(
    () => resolveMessageHtml(message.bodyHtml, { cidSrc, loadRemote }),
    [message.bodyHtml, cidSrc, loadRemote],
  )
  const canLoadRemote = hasHtml && hasDeferredRemoteImages(message.bodyHtml)

  return (
    <div className="space-y-2">
      {hasHtml && hasText ? (
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setShowHtml(true)}
            className={`rounded px-2 py-0.5 font-semibold ${showHtml ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            Formatted
          </button>
          <button
            type="button"
            onClick={() => setShowHtml(false)}
            className={`rounded px-2 py-0.5 font-semibold ${showHtml ? 'bg-slate-100 text-slate-600' : 'bg-slate-900 text-white'}`}
          >
            Plain text
          </button>
        </div>
      ) : null}

      {showHtml && hasHtml ? (
        <HtmlFrame html={resolvedHtml} loadRemote={loadRemote} />
      ) : hasText ? (
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700">{message.bodyText}</pre>
      ) : (
        <p className="text-sm italic text-slate-400">
          This message has no readable body.{' '}
          {message.rawKey ? 'Download the original to see what arrived.' : ''}
        </p>
      )}

      {message.strippedRemoteContent && showHtml ? (
        // Said out loud, because a message missing its images otherwise reads
        // as broken rather than as edited -- and because loading them is a
        // decision with a consequence, which the operator should be told before
        // making rather than after.
        <div className="space-y-1 text-xs text-amber-700">
          {loadRemote ? (
            <p>
              Remote images are loading for this message. The sender can now tell that you opened it. This resets
              when you leave the message.
            </p>
          ) : (
            <p>
              Remote images were held back. Nothing here loads from the internet, so the sender cannot tell that you
              opened it.
            </p>
          )}
          {canLoadRemote && !loadRemote ? (
            <button
              type="button"
              onClick={() => setLoadRemote(true)}
              className="font-semibold text-amber-800 underline"
            >
              Load remote images for this message
            </button>
          ) : null}
        </div>
      ) : null}

      {message.bodyTruncated ? (
        <p className="text-xs text-slate-500">
          This body was longer than we store. Download the original to read it in full.
        </p>
      ) : null}
    </div>
  )
}

export default MessageBody
