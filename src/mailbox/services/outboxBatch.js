/**
 * Rendering a collected batch for the transmitter, one row at a time.
 *
 * By the time this runs every row in the batch is already `collected` — the
 * claim and the hand-out cannot be one atomic step across D1 and R2. So a
 * single row that cannot be rendered (its attachment is gone from storage, the
 * usual case) must not fail the whole response: that would leave every other
 * row collected, never offered again, and never sent.
 *
 * Each failure is recorded on its own row as a NON-retryable failure with the
 * reason, which puts it in the Outbox for a person; the rest are returned.
 */

import { markFailed } from '../repositories/outbound.js'
import { renderOutbound } from './reply.js'
import { createLogger } from '../../lead-engine/services/log.js'

/**
 * @param {Env} env
 * @param {object[]} collected `mailbox_outbound` rows, already `collected`
 * @param {{ render?: typeof renderOutbound, correlationId?: string }} [options]
 * @returns {Promise<object[]>} the rendered messages, failures omitted
 */
export async function renderCollectedBatch(env, collected, options = {}) {
  const render = options.render ?? renderOutbound
  const logger = createLogger({ correlationId: options.correlationId })
  const rendered = []

  // Sequential, not Promise.all: rendering reads attachment bytes out of R2,
  // and a batch of ten messages each carrying 10 MB would otherwise be held in
  // memory all at once.
  for (const outbound of collected) {
    try {
      rendered.push(await render(env, outbound))
    } catch (error) {
      const reason = error instanceof Error && error.message ? error.message : 'The message could not be prepared.'
      logger.log('mailbox.outbox_render_failed', { outbound_id: outbound.id, error: reason })
      try {
        await markFailed(env.DB, outbound.id, { error: `Not sent: ${reason}`, retryable: false })
      } catch (markError) {
        // Logged, not thrown: the remaining rows are already collected and
        // must still reach the transmitter.
        logger.log('mailbox.outbox_mark_failed_failed', {
          outbound_id: outbound.id,
          error: markError instanceof Error ? markError.message : 'unknown',
        })
      }
    }
  }

  return rendered
}
