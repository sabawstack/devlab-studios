/**
 * Turning a raw inbound message into the shape the repositories store.
 *
 * MIME IS NOT HAND-PARSED HERE. Nested multiparts, transfer encodings, RFC 2047
 * encoded words in headers, and the dozen ways a real client can be
 * almost-conformant are a library's job — `postal-mime`, chosen because it is
 * maintained, MIT-0, has zero runtime dependencies, targets browser/edge
 * runtimes (so it works inside a Worker with no Node shims), and is what
 * Cloudflare's own Email Worker examples use. src/lead-engine/mail/eml.js
 * BUILDS RFC 5322 and its tests document several of the traps; parsing has more.
 *
 * WHAT THIS FILE DOES ADD is everything postal-mime deliberately does not:
 * a byte ceiling on hostile input, a stable dedupe key, the authentication
 * verdict the edge attached, and the normalisation the rest of the mailbox
 * expects.
 */

import PostalMime from 'postal-mime'
import { LIMITS } from '../config.js'
import { normalizeEmail } from '../../lead-engine/domain/domains.js'
import { parseReferences, stripBrackets } from '../domain/messageId.js'

/**
 * Reads a stream into memory, refusing to exceed a ceiling.
 *
 * Cloudflare already caps inbound at 25 MiB, so this is not a delivery limit —
 * it is a limit on how much attacker-controlled data we hold in a Worker's
 * memory at once. The stream is drained either way: abandoning it mid-read is
 * a resource leak on a hot path.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} maxBytes
 * @returns {Promise<{ bytes: Uint8Array, truncated: boolean, totalSize: number }>}
 */
export async function readStream(stream, maxBytes) {
  const reader = stream.getReader()
  const chunks = []
  let size = 0
  let truncated = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      size += value.byteLength
      if (size > maxBytes) {
        truncated = true
        // Keep draining rather than breaking, so `totalSize` is the real size
        // and the connection is not left half-read.
        continue
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const kept = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const bytes = new Uint8Array(kept)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { bytes, truncated, totalSize: size }
}

/** @param {Uint8Array} bytes */
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The authserv-id Cloudflare Email Routing stamps on the header it adds. */
export const TRUSTED_AUTHSERV_ID = 'mx.cloudflare.net'

/**
 * Reads the edge's `Authentication-Results`.
 *
 * Cloudflare evaluates SPF, DKIM and DMARC before the Worker runs and records
 * the verdict in this header. Recording it is what lets a person see that a
 * "reply" failed DMARC before they act on it — and, for a DSN, whether the
 * bounce is plausibly genuine rather than a forged one aimed at poisoning our
 * own suppression list.
 *
 * ONLY THE TOPMOST HEADER, AND ONLY IF CLOUDFLARE WROTE IT. A sender may put
 * any number of `Authentication-Results` headers in the message they submit,
 * each claiming `dmarc=pass`. The receiving edge adds its own header ABOVE
 * everything already in the message, so the first one is the only one a hop
 * we trust produced — and even that is believed only when its authserv-id is
 * Cloudflare's (`mx.cloudflare.net`). Anything else — no header, a first
 * header from some other host — yields `unknown` for every mechanism, which
 * the rest of the mailbox treats exactly like a failure: unverified.
 *
 * `Headers.get()` joins repeated headers with ", ", so the topmost header is
 * the text before the first comma once parenthesised comments (which may
 * contain commas in some MTAs' output) are removed.
 *
 * @param {Headers} headers
 * @returns {{ spf: string|null, dkim: string|null, dmarc: string|null }}
 */
export function parseAuthenticationResults(headers) {
  const unknown = { spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' }
  const raw = String(headers?.get?.('authentication-results') ?? '')
  if (!raw.trim()) return unknown

  const topmost = stripHeaderComments(raw).split(',')[0]
  const [authservSegment, ...results] = topmost.split(';')
  const authservId = String(authservSegment ?? '').trim().split(/\s+/)[0].toLowerCase()
  if (authservId !== TRUSTED_AUTHSERV_ID) return unknown

  const body = results.join(';')
  const read = (mechanism) => {
    const match = new RegExp(`(?:^|[;\\s])${mechanism}\\s*=\\s*([a-z]+)`, 'i').exec(body)
    return match ? match[1].toLowerCase() : null
  }

  return { spf: read('spf'), dkim: read('dkim'), dmarc: read('dmarc') }
}

/**
 * Removes RFC 5322 comments — `(…)`, nested included — from a header value.
 * Bounded so a hostile run of parentheses cannot loop for long.
 *
 * @param {string} value
 */
function stripHeaderComments(value) {
  let out = String(value).slice(0, 16_384)
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(/\([^()]*\)/g, ' ')
    if (next === out) break
    out = next
  }
  return out
}

/** @param {{ name?: string, address?: string }|undefined} mailbox */
function addressOf(mailbox) {
  if (!mailbox) return null
  return normalizeEmail(mailbox.address) ?? String(mailbox.address ?? '').toLowerCase() ?? null
}

/**
 * Flattens postal-mime's address list, expanding groups.
 *
 * `to: undisclosed-recipients:;` parses as a group with no members, and code
 * that reads `.address` off a group entry gets `undefined` and stores it.
 *
 * @param {Array<object>|undefined} list
 */
function addressList(list) {
  const out = []
  for (const entry of list ?? []) {
    if (entry?.group) {
      for (const member of entry.group) {
        const address = addressOf(member)
        if (address) out.push(address)
      }
      continue
    }
    const address = addressOf(entry)
    if (address) out.push(address)
  }
  return out.slice(0, LIMITS.maxRecipients)
}

/**
 * Parses a raw message.
 *
 * NEVER THROWS. A parse failure returns a result with `status: 'failed'` and
 * the error text, because the caller has already stored the original and must
 * still record a row — a message we could not read is exactly the one a person
 * needs to be told about. Throwing here would lose it.
 *
 * @param {Uint8Array} bytes
 * @param {{ tooLarge?: boolean }} [options]
 */
export async function parseMessage(bytes, options = {}) {
  if (options.tooLarge) {
    return { status: 'skipped_too_large', error: null, parsed: null, fields: emptyFields() }
  }

  try {
    const parsed = await PostalMime.parse(bytes, {
      // Bounded so a deeply nested or header-stuffed message cannot burn the
      // Worker's CPU budget. Both are generous next to real mail.
      maxNestingDepth: 20,
      maxRfc822NestingDepth: 4,
      maxHeadersSize: 256 * 1024,
      attachmentEncoding: 'arraybuffer',
      // DSNs carry the original message as a `message/rfc822` part, and the
      // bounce path reads it as a part rather than recursing into it.
      forceRfc822Attachments: true,
    })

    return { status: 'ok', error: null, parsed, fields: extractFields(parsed) }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'The message could not be parsed.',
      parsed: null,
      fields: emptyFields(),
    }
  }
}

function emptyFields() {
  return {
    messageId: null,
    inReplyTo: null,
    references: null,
    referenceIds: [],
    fromAddress: '',
    fromName: null,
    replyTo: null,
    toAddresses: [],
    ccAddresses: [],
    subject: '',
    bodyText: '',
    bodyHtml: null,
    date: null,
    contentType: null,
  }
}

/** @param {import('postal-mime').Email} parsed */
export function extractFields(parsed) {
  const references = parsed.references ?? null

  return {
    messageId: stripBrackets(parsed.messageId),
    inReplyTo: stripBrackets(parsed.inReplyTo),
    references,
    referenceIds: parseReferences(references),
    fromAddress: addressOf(parsed.from) ?? '',
    fromName: parsed.from?.name || null,
    replyTo: addressList(parsed.replyTo)[0] ?? null,
    toAddresses: addressList(parsed.to),
    ccAddresses: addressList(parsed.cc),
    subject: parsed.subject ?? '',
    bodyText: parsed.text ?? '',
    bodyHtml: parsed.html ?? null,
    date: normalizeDate(parsed.date),
    contentType: parsed.headers?.find((header) => header.key === 'content-type')?.value ?? null,
  }
}

/**
 * A `Date` header, if it is believable.
 *
 * A sender controls this field completely, and mail with a date years in the
 * future sorts to the top of the inbox forever. Anything outside a sane window
 * is discarded in favour of our own receipt time.
 *
 * @param {string|undefined} value
 * @param {Date} now
 * @returns {string|null} ISO 8601
 */
export function normalizeDate(value, now = new Date()) {
  if (!value) return null

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null

  const skewMs = 48 * 60 * 60 * 1000
  const tenYearsMs = 10 * 365 * 24 * 60 * 60 * 1000
  if (parsed.getTime() > now.getTime() + skewMs) return null
  if (parsed.getTime() < now.getTime() - tenYearsMs) return null

  return parsed.toISOString()
}

/**
 * The idempotency key for a message.
 *
 * The Message-ID when there is one, and a content hash when there is not —
 * plenty of automated mail, including some DSNs, omits it entirely. Scoped by
 * mailbox so the same notification legitimately delivered to two of our
 * addresses is stored once per address rather than once in total.
 *
 * @param {{ mailbox: string, messageId: string|null, bytes: Uint8Array }} input
 */
export async function buildDedupeKey({ mailbox, messageId, bytes }) {
  if (messageId) return `${mailbox}:${messageId}`
  return `${mailbox}:sha256:${await sha256Hex(bytes)}`
}
