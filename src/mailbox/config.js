/**
 * Mailbox configuration.
 *
 * Constants rather than settings rows, deliberately. Every value here is a
 * safety ceiling on hostile input — message size, attachment size, how much
 * body we keep. Those belong with the code that enforces them, where changing
 * one is a reviewed diff rather than a text box in an admin screen. The lead
 * engine puts operational budgets in D1 settings for the opposite reason: those
 * are dials an operator is expected to turn.
 */

/** The domain this mailbox answers for. */
export const MAIL_DOMAIN = 'devlabconnect.com'

/** The address a human reads, and the From on every reply. */
export const PRIMARY_ADDRESS = `hello@${MAIL_DOMAIN}`

export const LIMITS = Object.freeze({
  /**
   * Above this we store the raw message and do not parse it.
   *
   * Cloudflare refuses anything over 25 MiB before it reaches us, so this is
   * not a delivery limit — it is a limit on how much attacker-controlled MIME
   * we are willing to walk inside a Worker's CPU budget. The message is not
   * lost: the row records `skipped_too_large` and the original is downloadable.
   */
  parseMaxBytes: 8 * 1024 * 1024,

  /** Per-attachment ceiling. A larger part is recorded but its bytes are not stored. */
  attachmentMaxBytes: 10 * 1024 * 1024,

  /** Attachments stored per message. Beyond this they are recorded as skipped. */
  maxAttachments: 20,

  /**
   * Body text retained in D1. Matches the lead engine's ZOHO.maxBodyChars so a
   * message bridged into lead_messages is not truncated differently in the two
   * places it appears.
   */
  maxBodyChars: 20_000,

  /** Sanitized HTML retained in D1. */
  maxHtmlChars: 200_000,

  /** Subject stored. RFC 5322 caps a line at 998; this is generous already. */
  maxSubjectChars: 500,

  /** Recipients recorded per header. A message addressed to more is truncated. */
  maxRecipients: 50,

  /**
   * Inbound messages stored per sender address per rolling 24 hours. Beyond
   * this the message is dropped and the drop is logged with its reason
   * (`mailbox.ingest` result `dropped`, reason `sender_daily_cap`). Generous
   * next to any real correspondent, including DMARC reporters; it exists so
   * one address cannot fill D1 and R2.
   */
  maxInboundPerSenderPerDay: 100,
})

/**
 * R2 key layout, dated so a prefix listing is bounded and a retention sweep is
 * a prefix delete rather than a table scan.
 *
 * Keys are built from generated ids only. Nothing that came out of a message —
 * a filename, a Message-ID, an address — is ever interpolated into a key.
 *
 * @param {string} messageId our own row id
 * @param {Date} at
 */
export function rawObjectKey(messageId, at = new Date()) {
  return `mailbox/raw/${at.toISOString().slice(0, 10)}/${messageId}.eml`
}

/**
 * @param {string} messageId our own row id
 * @param {number} index position in the parsed attachment list
 * @param {Date} at
 */
export function attachmentObjectKey(messageId, index, at = new Date()) {
  return `mailbox/att/${at.toISOString().slice(0, 10)}/${messageId}/${index}`
}
