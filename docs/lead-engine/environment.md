# Environment

Every variable the Lead Intelligence Engine reads. Site-wide variables are in
[`../operations.md`](../operations.md); the Lead Engine section of `.env.example`
mirrors this file.

## Vars vs secrets

| Kind | Set with | Visible in | Use for |
|---|---|---|---|
| **var** | `wrangler.jsonc` `vars` | The repository, and the Cloudflare dashboard | Deployment ceilings and emergency stops |
| **secret** | `npx wrangler secret put NAME` | Nowhere | Credentials |

The nine feature flags are deliberately **plain vars in the committed
`wrangler.jsonc`**. They are deployment ceilings, not credentials: an admin can
turn an allowed capability on or off in **Lead CRM > CRM Settings**, but can
never turn on a capability the deployment forbids. This keeps the deployment
configuration as an independent emergency stop.

Everything else — the Brave key, the Browser Rendering
token — is a secret and appears nowhere in the repository.

**Nothing in `lead_settings` is a credential.** That table is for operational
tunables and the validated `operations.flags` control row. Its `is_secret`
column marks a merely sensitive value the admin UI should mask, such as an
account id. Real secrets are Worker secrets.

## Feature flags

All nine have a Worker var in **both** `wrangler.jsonc` `vars` and
`env.preview.vars`. The effective state is:

> master switch in CRM Settings AND deployment master allowance AND the
> capability's CRM Settings switch AND its deployment allowance

Before an admin first saves a switch, every requested capability is off. The
committed deployment ceilings permit UI control in both environments; changing
a ceiling to `"false"` is an independent emergency stop. CRM Settings changes
take effect immediately and are audited. If D1 cannot be read, all effective
switches fail closed.

| Var | Gates | Required |
|---|---|---|
| `LEAD_ENGINE_ENABLED` | **Master switch.** Every other flag is ANDed with it. | For anything at all |
| `LEAD_DISCOVERY_ENABLED` | `runCampaignDiscovery` | To find candidates |
| `LEAD_CRAWLER_ENABLED` | `researchLead` | To research them |
| `LEAD_BROWSER_RUN_ENABLED` | The Browser Rendering fallback | Optional |
| `LEAD_AI_ENABLED` | All four Workers AI tasks | To qualify and draft |
| `LEAD_TRACKING_ENABLED` | Minting the tracked link in a draft, click recording, contact-form attribution | Optional. **Off means drafts contain no link at all** — the content guard rejects every URL — not an untracked one. |
| `LEAD_CAMPAIGN_SCHEDULES_ENABLED` | Cron-driven campaign discovery | Optional; leave off until a dry run looks right |

### Truthiness

`isFlagOn()` accepts only an explicit affirmative: `"true"`, `"1"`, `"on"`,
`"yes"` (case-insensitive, trimmed). An unset var, an empty string and **the
literal string `"false"`** are all off.

That last one matters: Cloudflare vars are always strings, and `Boolean('false')`
is `true`.

### Why gating cascades

A deployment that sets `LEAD_AI_ENABLED` but forgets `LEAD_ENGINE_ENABLED` does
nothing, which is the safe direction to fail in. And turning off one var stops the
whole engine without having to remember the rest.

### When a flag is off

`assertFlag(env, flag)` throws `FeatureDisabledError`, which routes answer as
**HTTP 503 naming both places to check**:

> `This capability is disabled. Enable it in Lead CRM Settings; LEAD_CRAWLER_ENABLED must also permit it.`

Not a generic failure and — importantly — not a silent success. `jobs/handlers.js`
classifies it as a **permanent** error, so a job fails once and dead-letters
rather than retrying three times against a switch.

### There is no auto-send flag

Deliberately. Automated prospect email sending does not exist in this system, and
a flag would imply a switch exists. Stated in `config/flags.js`, `.env.example`
and `wrangler.jsonc`.

## Cloudflare bindings

| Binding | Type | Required | Note |
|---|---|---|---|
| `DB` | D1 | **Yes** | `devlab-studios-cms` (production) / `devlab-studios-cms-preview`. All 22 `lead_*` tables. |
| `AI` | Workers AI | For AI features | Shared with the Insights digest. Absent → runs recorded `skipped`. |
| Cron trigger | — | For background work | `0 22 * * *` production, `30 22 * * *` preview. Drives `runScheduledTick`. |
| `LEAD_RESEARCH_QUEUE`, `LEAD_AI_REVIEW_QUEUE`, `LEAD_MAILBOX_QUEUE` | Queues | **No** | Commented out. See [queues.md](queues.md). |
| `LEAD_*_WORKFLOW` (×5) | Workflows | **No** | Commented out. See [cloudflare-workflows.md](cloudflare-workflows.md). |
| `MAILBOX_BUCKET` | R2 | For the mailbox | `devlab-mailbox` / `devlab-mailbox-preview`. Raw `.eml` and attachments. **Private — never the public `MEDIA_BUCKET`.** Commented out until the buckets exist; absent, mail is still stored and Diagnostics reports that originals are not. See [mailbox.md](mailbox.md). |

`IMAGES`, `MEDIA_BUCKET` (R2), `PICKLEBALL_DB` and `OPEN_SESSION` exist
on the Worker but are not used by this engine. `RATE_LIMITER` is used by the
outbox endpoints.

### The mailbox secret

| Name | Kind | Required | Note |
|---|---|---|---|
| `MAILBOX_OUTBOX_TOKEN` | **Secret** | To send replies | At least 32 random characters. The mailbox outbox endpoints sit outside the admin session gate because an automation cannot hold a browser session, so they carry their own bearer check — which **fails closed when unset**, refusing every request with 503. Set with `wrangler versions secret put`. |

There is deliberately no mailbox *inbound* credential. Cloudflare pushes each
message to the Worker; nothing polls a provider, so there is no OAuth token and
no API key that an email provider can revoke.

## Outreach handoff

**No variable at all, and no secret.** Approved drafts are exported as `.eml`
files the operator opens in their own mail client — there is no mail provider
to configure, no OAuth, and nothing an email provider can block.

The mailbox integration this replaced needed five secrets and got the account
blocked anyway: a Worker has no stable egress IP, so its scheduled calls arrived
from a different country each run and the provider read that as a compromised
account. See [outreach-handoff.md](outreach-handoff.md) for the evidence and the
schema names it left behind.

The only related setting is `business.identity.senderEmail`, in D1 rather than
the environment. Set, it becomes the `From` header; unset, the operator's own
client fills it in.

## Optional external services

### Nominatim (OpenStreetMap)

**No variable at all.** No key, no account, no card. The adapter needs only the
User-Agent the crawler already sends, and a campaign with
`config.nominatim.queries` configured.

This is the source that makes free discovery real: with Overpass's default
endpoint blocking us and Brave requiring a paid signup, Nominatim plus manual
import is the whole free path. See
[discovery.md](discovery.md#nominatim-openstreetmap) for the measured yield per
query phrasing, which decides whether it returns anything at all.

### Brave Search

| Variable | Kind | Default |
|---|---|---|
| `BRAVE_SEARCH_API_KEY` | **secret** | unset |

Entirely optional, and **not part of the free path**. Unset → the adapter
returns `{ candidates: [], error: 'brave_not_configured' }` and the run
continues on Overpass, Nominatim and manual imports. **Nothing downstream
treats the absence as a failure** — that is what keeps the pipeline runnable
without a paid API. The seeded cross-industry campaigns deliberately carry no
`brave` block at all.

### Browser Rendering

| Variable | Kind | Default |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | plain value (not sensitive) | unset |
| `BROWSER_RENDERING_API_TOKEN` | **secret** | unset |

**Both** are required, or `isBrowserRunConfigured` is false and the module is
completely inert. Plus `LEAD_BROWSER_RUN_ENABLED`.

The token should be an account-scoped API token with Browser Rendering
permissions and nothing else. The account id is not sensitive (it already appears
in `.github/workflows/deploy-preview.yml`), but `.env.example` groups it with the
token for convenience.

Overpass and the DNS-over-HTTPS MX resolver need **no** credentials.

## Runtime settings, not environment

These live in `lead_settings` and are edited at `/admin/lead-crm/settings`. Each
deep-merges over the matching export in `src/lead-engine/config/defaults.js`;
deleting a row restores the default.

| Key | Default source | Notes |
|---|---|---|
| `scoring.thresholds` | `SCORE_THRESHOLDS` | 40 / 60 / 75 |
| `scoring.weights` | `SIGNAL_WEIGHTS` | Bump `RULESET_VERSION` for a permanent change |
| `crawler.limits` | `CRAWLER` | Pages, bytes, timeouts, delay |
| `usage.daily` | `USAGE_LIMITS` | The eight daily budgets |
| `usage.monthlyDiscovery` | `MONTHLY_DISCOVERY_LIMIT` | 3000 |
| `concurrency` | `CONCURRENCY` | crawl 2, ai 1, overpass 1, nominatim 1, brave 2 |
| `ai.config` | `AI` | Model, max tokens, temperature, `minConfidenceForOutreach` |
| `contacts.config` | `CONTACTS` | Preferred/excluded local parts, DoH endpoint |
| `tracking.config` | `TRACKING` | Token bytes, expiry, `allowedHosts`, cookie name |
| **`business.identity`** | — | **Seeded empty. Fill this in.** |
| `crawler.identity` | — | User agent and `/crawler` URL |

### `business.identity` — the one you must fill in

```json
{
  "legalName": "DevLab Studios",
  "senderName": "",
  "senderEmail": "",
  "postalAddress": "",
  "city": "",
  "region": "",
  "postalCode": "",
  "countryCode": "",
  "website": "https://www.devlabstudios.com"
}
```

Seeded with empty strings on purpose. The US compliance profile's
`sender_identity_configured` and `postal_address_configured` checks both fail
until they are set, holding **every US lead** at `needs_human_review` rather than
letting the engine invent a postal address for a commercial email.

`senderEmail` is also what `buildUnsubscribeInstruction` needs — with it empty the
opt-out line is the empty string and `opt_out_mechanism_present` fails too.

Set these at `/admin/lead-crm/settings` before the first dry run.

`crawler.identity.userAgent` overrides `CRAWLER.userAgent`. **If you change it,
update `/crawler`'s copy too** — the whole value of a transparent user agent is
that the URL it names describes the bot that is actually asking. Arrays in a
setting are **replaced wholesale**, not merged element-wise.

## Local development

`.dev.vars` (gitignored) for `wrangler dev`:

```
LEAD_ENGINE_ENABLED=true
LEAD_DISCOVERY_ENABLED=false
LEAD_CRAWLER_ENABLED=false
LEAD_AI_ENABLED=false
LEAD_TRACKING_ENABLED=false
LEAD_CAMPAIGN_SCHEDULES_ENABLED=false
```

That gives you the admin screens with real data and **no outbound requests at
all**. Turn on individual capabilities as you need them, and understand what each
one reaches:

| Flag | Touches |
|---|---|
| `LEAD_DISCOVERY_ENABLED` | The real Overpass API (and Brave, if keyed) |
| `LEAD_CRAWLER_ENABLED` | **Real business websites** |
| `LEAD_AI_ENABLED` | Your Workers AI allocation |

Apply migrations and seed:

```bash
npx wrangler d1 migrations apply devlab-studios-cms --local
node scripts/lead-engine/seed.mjs > scripts/lead-engine/seed.sql
npx wrangler d1 execute devlab-studios-cms --local --file scripts/lead-engine/seed.sql
npx wrangler dev --local
```

Then `http://localhost:8787/admin/lead-crm`.

## Preview is not production, but it is the real internet

Every flag is `"false"` in `env.preview.vars` too, and the comment in
`wrangler.jsonc` says why: **preview shares the real internet, and a crawl from
preview is just as real to the site being crawled.**

`env.preview` inherits **nothing** from the top level. Every var, binding and
secret preview needs must be repeated inside it. This repository has been bitten
twice: `RESEND_FROM_EMAIL` / `LEAD_NOTIFICATION_EMAIL` silently fell back to
hardcoded defaults, and the `RATE_LIMITER` Durable Object was missing so every
rate limiter on preview was enforcing nothing.

Preview secrets are set with `--env preview` and are **separate values**.
Nothing is inherited from the top level.

## Quick checklist

Fully off (the shipped state) — nothing to set.

Read-only admin with seeded data:
- [ ] `LEAD_ENGINE_ENABLED=true`

Discovery dry run:
- [ ] `LEAD_DISCOVERY_ENABLED=true`
- [ ] Sources enabled and policy-reviewed in the admin
- [ ] Campaign moved to `active`

Full research:
- [ ] `LEAD_CRAWLER_ENABLED=true`
- [ ] `LEAD_AI_ENABLED=true` (needs the `AI` binding)

Outreach drafting:
- [ ] `business.identity` filled in completely

Sending:
- [ ] Nothing. Drafts export as files and a person sends them — see
      [outreach-handoff.md](outreach-handoff.md).

Optional:
- [ ] `BRAVE_SEARCH_API_KEY`
- [ ] `CLOUDFLARE_ACCOUNT_ID` + `BROWSER_RENDERING_API_TOKEN` + `LEAD_BROWSER_RUN_ENABLED`
- [ ] `LEAD_TRACKING_ENABLED`

Last, and only after a dry run looks right:
- [ ] `LEAD_CAMPAIGN_SCHEDULES_ENABLED=true` **and** `schedule_enabled = 1` on the campaign
