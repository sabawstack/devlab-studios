// Sends the DUPR export to the host's verified Google email (spec §9.6),
// through the studio's existing Resend provider, with the CSV attached.
// The CSV and the email text are built by the pure modules in
// src/lib/pickleball/open/dupr/; this file only delivers them.
import type { DuprEmail } from '../../../lib/pickleball/open/dupr/email'
import { createResendProvider } from '../../delivery/providers.js'

const DEFAULT_SENDER = 'hello@devlabstudios.com'

export interface DuprOutbox { to: string; subject: string; text: string; filename: string; csv: string }

export type DuprDelivery =
  | { delivery: 'SENT' }
  /** Test environments never email anyone; the message comes back for the test to read instead. */
  | { delivery: 'SUPPRESSED'; outbox: DuprOutbox }
  | { delivery: 'FAILED'; reason: string }

type MailEnv = Pick<Env, 'RESEND_API_KEY' | 'RESEND_FROM_EMAIL' | 'PICKLEBALL_TEST_AUTH_ENABLED'>

/** Standard base64 of the UTF-8 bytes, which is what Resend expects for attachment content. */
export function base64Utf8(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The subject carries the host-typed session name: no CR, LF or other control character may reach a mail header. */
function headerSafe(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

export async function sendDuprExport(
  env: MailEnv,
  message: { to: string; email: DuprEmail; filename: string; csv: string },
): Promise<DuprDelivery> {
  const subject = headerSafe(message.email.subject)
  // An environment that accepts forged logins must not email real people
  // (the same rule as the old invite email): the e2e suite reads the outbox.
  if (env.PICKLEBALL_TEST_AUTH_ENABLED === 'true') {
    return { delivery: 'SUPPRESSED', outbox: { to: message.to, subject, text: message.email.text, filename: message.filename, csv: message.csv } }
  }
  const provider = createResendProvider(env, { name: 'resend-dupr', fromName: 'Devlab Pickleball' })
  if (!provider.isConfigured) {
    console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: 'skipped', reason: 'missing_api_key' }))
    return { delivery: 'FAILED', reason: 'missing_api_key' }
  }
  const result = await provider.send({
    to: message.to,
    // Hosts report a refused upload by replying (spec §9.4).
    replyTo: env.RESEND_FROM_EMAIL || DEFAULT_SENDER,
    subject,
    text: message.email.text,
    html: message.email.html,
    attachments: [{ filename: message.filename, content: base64Utf8(message.csv) }],
  })
  // Only the status code and a fixed reason are logged: Resend's own message
  // can quote the recipient, which is personal data, and the code is enough to diagnose.
  const reason = result.ok ? undefined : result.networkError ? 'network_error' : 'upstream_refused'
  console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: result.ok ? 'success' : 'failure', statusCode: result.statusCode, reason }))
  return reason ? { delivery: 'FAILED', reason } : { delivery: 'SENT' }
}

/**
 * Sends, and gives the reserved export back on anything but success, a thrown
 * send included: a failed email must never cost the host one of the day's 5.
 * Never throws; a failed release is logged and the failure still reported.
 */
export async function sendOrRelease(
  env: MailEnv,
  message: { to: string; email: DuprEmail; filename: string; csv: string },
  release: () => Promise<void>,
  send: typeof sendDuprExport = sendDuprExport,
): Promise<DuprDelivery> {
  let sent: DuprDelivery
  try {
    sent = await send(env, message)
  } catch {
    // The error text is not logged: it may carry the recipient.
    console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: 'failure', reason: 'send_threw' }))
    sent = { delivery: 'FAILED', reason: 'send_threw' }
  }
  if (sent.delivery === 'FAILED') {
    await release().catch(() => console.log(JSON.stringify({ event: 'pickleball_open.dupr_email', outcome: 'release_failed' })))
  }
  return sent
}
