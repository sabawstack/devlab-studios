/**
 * The bearer token the LOCAL e2e worker accepts on /api/mailbox/outbox/*.
 *
 * Not a secret: playwright.config.js hands it to `wrangler dev --local` with
 * --var, and no deployed environment has it. It exists so a test can play the
 * external transmitter and put a reply of its OWN into `failed`, instead of
 * consuming the one failed reply in the seed -- which can be retried exactly
 * once per server start, so any second execution of the test (--repeat-each,
 * a CI retry) found nothing to retry.
 */
export const MAILBOX_OUTBOX_TOKEN = 'e2e-local-only-mailbox-outbox-token-0000000000'
