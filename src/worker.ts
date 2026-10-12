// Custom Worker entrypoint for the whole site.
//
// @astrojs/cloudflare normally generates this entrypoint itself
// (`main: "@astrojs/cloudflare/entrypoints/server"`), but that generated
// entrypoint cannot export additional classes — and a Durable Object has to be
// exported from the Worker's entrypoint module to be bound. So this file takes
// over as `main` and does exactly two things:
//
//   1. Delegates *every* request to Astro's own `handle()`, unchanged. No
//      routing, no interception, no short-circuits — the public site, the
//      Admin CMS, and every API route behave exactly as they did before.
//   2. Additionally exports the Durable Object class alongside it.
//
// See docs/architecture/decisions/0006-pickleball-durable-objects.md.
//
// Owning this file also makes `scheduled()` possible, which is what the daily
// Insights digest runs on. ADR 0003 ruled out cron because the generated
// entrypoint could not export one; ADR 0006 already had to replace that
// entrypoint for the Durable Objects, so the constraint no longer applies.
import { handle } from '@astrojs/cloudflare/handler'
import { SessionCoordinatorDO } from './worker/pickleball/SessionCoordinatorDO'
import { RateLimiterDO } from './worker/RateLimiterDO'
import { OpenSessionDO } from './worker/pickleball/open/OpenSessionDO'
import { runDailyDigest } from './worker/digest/runDigest.js'
import { runScheduledTick } from './lead-engine/jobs/scheduler.js'
import { runHostLoginPurge, runOpenSessionPurge } from './worker/pickleball/open/purge'
import { handleQueueBatch } from './lead-engine/queues/consumer.js'
import { handleEmail } from './mailbox/inbound/handler.js'
import {
  CampaignDiscoveryWorkflow,
  LeadResearchWorkflow,
  MaintenanceWorkflow,
  ReplyAnalysisWorkflow,
} from './lead-engine/workflows/index'

export { SessionCoordinatorDO, RateLimiterDO, OpenSessionDO }

// Lead Intelligence Engine Workflows. Exported here because a Workflow class,
// like a Durable Object, has to be exported from the Worker's entrypoint to be
// bindable — but the `workflows` block in wrangler.jsonc is COMMENTED OUT, so
// nothing is bound to them yet. Exporting an unbound class is inert; declaring
// a binding for a Workflow that has not been created would fail `wrangler
// deploy` for the whole Worker, public site included. See
// docs/lead-engine/cloudflare-workflows.md for the activation steps.
export {
  CampaignDiscoveryWorkflow,
  LeadResearchWorkflow,
  ReplyAnalysisWorkflow,
  MaintenanceWorkflow,
}

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx)
  },

  // Cron: see the `triggers` block in wrangler.jsonc (and in `env.preview`).
  //
  // `waitUntil` rather than `await`: the digest's stages are individually
  // bounded, but a scheduled handler that throws is retried, and a retried
  // digest run would re-summarize items that already published. `runDailyDigest`
  // contains its own failures and logs the outcome.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      runDailyDigest(env, { now: new Date(event.scheduledTime), trigger: 'cron' }).catch((error) => {
        console.log(
          JSON.stringify({
            event: 'digest_run',
            outcome: 'crashed',
            error: error instanceof Error ? error.message : 'unknown',
          }),
        )
      }),
    )

    // The Lead Intelligence Engine's tick, on the same cron as the digest.
    //
    // A SEPARATE waitUntil, not chained onto the digest's: the two are
    // unrelated jobs and one must not be able to prevent or delay the other.
    // `runScheduledTick` contains its own failures for the same reason the
    // digest does — a scheduled handler that throws is retried, and a retried
    // invocation would re-run the digest, which must not happen.
    //
    // With the feature flags at their shipped defaults this returns
    // immediately, having done nothing.
    ctx.waitUntil(
      runScheduledTick(env, { now: new Date(event.scheduledTime), trigger: 'cron' }).catch((error) => {
        console.log(
          JSON.stringify({
            event: 'lead_engine.scheduled_tick',
            result: 'crashed',
            error: error instanceof Error ? error.message : 'unknown',
          }),
        )
      }),
    )

    // Free open play retention (spec §8): its own waitUntil so it can neither
    // block nor be blocked by the digest or the lead engine.
    ctx.waitUntil(
      runOpenSessionPurge(env, { now: new Date(event.scheduledTime) })
        .then(async (purged) => {
          const logins = await runHostLoginPurge(env, { now: new Date(event.scheduledTime) })
          console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'ok', purged, logins }))
        })
        .catch((error) => {
          console.log(JSON.stringify({ event: 'pickleball_open.purge', outcome: 'crashed', error: error instanceof Error ? error.message : 'unknown' }))
        }),
    )
  },

  // Inbound mail for devlabconnect.com.
  //
  // Lives here rather than in a separate Worker because `ExportedHandler`
  // accepts `email` alongside `fetch`, `scheduled` and `queue` — so the mailbox
  // shares this Worker's D1, R2 and deployment instead of duplicating all
  // three. Nothing routes to it until an Email Routing rule points an address
  // at this Worker, which is an account-level setting rather than a binding;
  // until then this handler is inert, exactly like the Workflow exports above.
  //
  // NOT wrapped in `waitUntil`. A scheduled job that fails should not be
  // retried, which is why the two above are detached — but a delivery that
  // fails SHOULD be, and awaiting is the only thing that lets the runtime know
  // whether the message was stored. See src/mailbox/inbound/handler.js.
  async email(message, env, ctx) {
    await handleEmail(message, env, ctx)
  },

  // Cloudflare Queues consumer for the Lead Intelligence Engine.
  //
  // Present but currently unreachable: the `queues` block in wrangler.jsonc is
  // commented out, so no queue is bound and this handler is never invoked.
  //
  // Both halves are wired, not just this one. `dispatchJob`
  // (src/lead-engine/jobs/dispatch.js) publishes to a queue whenever a binding
  // exists and falls back to the D1 job ledger when it does not, so enabling
  // Queues really is a configuration change. Until then the cron tick above
  // drains the same work through the same handlers.
  // See docs/lead-engine/queues.md.
  async queue(batch, env) {
    // The consumer is plain JS and declares the narrow message shape it uses;
    // the runtime's MessageBatch is wider. Narrowed at the boundary rather than
    // widening the consumer, so the consumer stays testable with a plain object.
    await handleQueueBatch(batch as unknown as Parameters<typeof handleQueueBatch>[0], env)
  },
} satisfies ExportedHandler<Env>
