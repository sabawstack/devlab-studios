/**
 * Operational Notes: field notes on running modern workflows day to day.
 *
 * Part of the Insights library (src/data/resourcesContent.js composes the
 * topics). These are about what it is like to operate these systems after
 * they ship, which is the part that tends to go undocumented.
 */
export const opsNoteArticles = [
  {
    id: 'why-website-speed-and-automation-now-overlap',
    slug: 'why-website-speed-and-automation-now-overlap',
    problemTag: 'lead-intake',
    audience: 'owner',
    title: 'Why website speed and automation now overlap',
    summary:
      'A slow page and a broken workflow used to be separate problems owned by separate people. They are the same pipeline now, and they fail into each other.',
    category: 'Web Systems',
    contentType: 'ops-note',
    icon: 'Zap',
    points: ['Shared pipeline', 'Cleaner input', 'Fewer retries', 'One owner'],
    tags: ['Website Performance', 'Automation', 'Conversion'],
    body: `## The handoff used to be a wall

For a long time the website and the operational systems behind it were separate concerns. Marketing owned the page, operations owned what happened after the form submitted, and the boundary was the submit button.

That boundary has largely dissolved. The form posts to an endpoint that validates, stores, enriches, routes, and notifies, and the visitor's confirmation message depends on how far along that chain got. The page and the pipeline are one system with one failure surface.

## Slow pages produce worse data, not just fewer submissions

The obvious cost of a slow form is abandonment. The less obvious one is that the submissions you do get are lower quality.

People on a page that is fighting them rush. They skip optional fields, mistype, pick the first option rather than the right one, and abandon halfway and resubmit — producing the duplicate that the deduplication logic then has to handle. Every one of those lands in the automation as an exception to be sorted out by a person later.

Improving the page does not only increase volume. It reduces the proportion of records that need fixing.

## Validation placed early saves work everywhere downstream

A malformed phone number caught in the browser is a moment of friction. The same number caught at the messaging provider three steps later is a failed delivery, a retry, a log entry, and eventually someone investigating why a customer was not contacted.

The cheapest place to reject bad input is the closest place to where it was typed — as long as the same rule also runs on the server, because client-side checks are a convenience rather than a control.

- Same schema on the client and the server, defined once
- Reject early, with a message that says what to change
- Normalize formats on the way in, not in every consumer
- Store what was actually submitted alongside the normalized version

## The response the visitor sees is an architectural decision

If the confirmation message waits for every downstream system to accept the record, then the page is only as fast and as available as the slowest of them, and an outage at a third party becomes a visible failure on your site.

Writing to your own storage first and confirming from that write decouples the two. The visitor gets a fast, honest confirmation; delivery happens afterwards and can be retried. This single decision is usually worth more than any amount of front-end optimisation, because it removes an entire dependency from the critical path.

## Instrument the whole path, not the halves

Page analytics tell you about submissions. Pipeline logs tell you about deliveries. Neither answers the question that matters: of the people who tried, how many ended up as a record someone acted on?

Carrying one identifier from the form through to the delivery record makes that question answerable. Without it, a drop-off between the two halves is invisible — each side reports itself as healthy.

## One owner, or the seam rots

The practical failure mode is organisational. When the page and the pipeline have different owners, the seam between them belongs to nobody, and that is exactly where the interesting bugs live.

Someone should be able to answer what happens to a submission from keystroke to CRM record. If nobody can, the gap is not in the code.

## Third-party scripts are part of the pipeline now

Analytics, chat widgets, tag managers and pixels all run in the same page as the
form. Each is an external dependency in the critical path of a conversion, and
each can be slow or unavailable independently of your own infrastructure.

The failure is rarely total. It is a script that takes four seconds to load and
blocks interaction while it does, on a page whose entire purpose is a form
submission. Load them after the page is usable, and know which ones would take
the form down with them if they failed.

## Mobile is where the cost lands

Most of the difference between a fast page and a slow one shows up on a phone on
a mediocre connection, which is a large share of real traffic and almost none of
the testing.

Test the form on a throttled connection on an actual device. The gap between
that experience and the one on a developer's machine is usually where the
abandoned submissions are, and it is invisible from the desk where the page was
built.

## Failure states deserve design attention

Most forms are designed for the successful path. The interesting states are the
others: what a validation error looks like, what happens when the network drops
mid-submission, whether a retry produces a duplicate, whether the visitor can
tell the difference between "still working" and "stopped".

These are the moments where a person decides whether to try again or leave, and
they are usually the least designed part of the page.

## One owner, or the seam rots

The practical failure mode is organisational. When the page and the pipeline
have different owners, the seam between them belongs to nobody — and that is
exactly where the interesting bugs live.

Someone should be able to answer what happens to a submission from keystroke to
CRM record. If nobody can, the gap is not in the code.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-07-03',
    readingTimeMinutes: 3,
    isFeatured: false,
    sortOrder: 120,
    status: 'published',
  },
  {
    id: 'what-breaks-first-in-an-automation',
    slug: 'what-breaks-first-in-an-automation',
    problemTag: 'integration-maintenance',
    audience: 'ops',
    title: 'What breaks first in an automation, and why it is never the AI',
    summary:
      'Automations rarely fail because a model got something wrong. They fail on credentials, schema drift, volume, and assumptions about the world that quietly stopped being true.',
    category: 'Reliability',
    contentType: 'ops-note',
    icon: 'AlertTriangle',
    points: ['Credentials', 'Schema drift', 'Volume', 'Time'],
    tags: ['Reliability', 'Operations', 'Maintenance'],
    body: `## The model is rarely the first thing to go

When an automation that worked for months stops working, the instinct is to look at the interesting part. In practice the interesting part is usually fine and something mundane has moved underneath it.

Four things account for most of it.

## Credentials expire, and they expire quietly

Tokens have lifetimes. Keys get rotated during unrelated security work. An account gets deprovisioned when someone leaves, taking with it the integration that was connected under their login.

The failure is abrupt and total, and it presents as a permanent authentication error rather than anything resembling the business logic. Two habits prevent most of the pain: connect integrations under a service account rather than a person, and record expiry dates somewhere that produces a reminder before they arrive.

## Schemas drift without announcement

An upstream system adds a field, renames one, changes a type from string to number, or starts returning null where it never did. None of these are breaking changes from the provider's perspective and all of them can break a consumer that assumed a shape.

Validating what arrives — not just what you send — turns this from a mysterious downstream corruption into a clear rejection at the boundary, with the offending payload kept for inspection. That is the difference between an hour and a day.

## Volume grows past an assumption nobody wrote down

Pagination that was never needed because results always fit on one page. A rate limit that was never approached. A batch job sized for the volume at build time. A plan tier with a monthly ceiling.

These fail suddenly and at the worst moment, because they fail when things are going well. Worth checking at build time: what happens at ten times the current volume, and what is the first limit reached?

- Is every list endpoint paginated, or does it assume one page?
- What is the rate limit, and what happens when it is hit?
- Does the job have a time budget it could exceed as data grows?
- Which plan limit is nearest, and who is told when it is approached?

## Time is a recurring source of wrong

Timezones, daylight saving, month boundaries, and leap days break scheduled work with reliable regularity. A cron expression is interpreted in some timezone, and if nobody wrote down which, the first surprise arrives when the clocks change.

Related and just as common: a job that assumes it runs exactly once, then runs twice after a retry, or skips a day because the previous run was still going.

## The failure that is worst is the one that looks like success

Everything above announces itself. The dangerous category is the automation that continues running, reports success, and produces nothing — a filter that now matches zero rows, a sync pointed at an empty source, a model call whose output is being discarded by a parser that no longer matches its shape.

Guard against it by asserting expectations rather than only catching errors. If a run normally processes between ten and a thousand records, a run that processes zero should be loud. Silence is not evidence that it worked.

## Maintenance is a scheduled activity, not an event

Every integration ages. Credentials, dependencies, plan limits, and upstream APIs all move. Automations that get looked at on a schedule degrade gracefully; ones that only get looked at when someone complains degrade until someone complains.

## Retries can cause the damage they were meant to prevent

Retrying a transient failure is correct. Retrying an operation that already
partially succeeded is how one invoice becomes three.

The distinction is idempotency: whether running the same operation twice
produces the same result as running it once. Achieve it with a key derived from
the operation itself, so a duplicate collapses into the original by construction
rather than by a check that might race.

Where you cannot make an operation idempotent, do not retry it automatically.
Surface it for a person, who can look before deciding.

## Partial failure is the normal case

A workflow that touches four systems has, in practice, sixteen possible
outcomes, not two. The interesting ones are in the middle: the CRM accepted it
and the email failed, or the record was created and the status update was not.

Decide what each partial state means. Which steps must succeed together, which
can be retried independently, and what a half-completed run should leave behind.
A workflow that only handles "all worked" and "nothing worked" will eventually
leave a record in a state nobody designed, and someone will find it weeks later.

## Watch the trend, not just the threshold

Most monitoring alerts on a threshold: error rate above some number. That
catches the cliff and misses the slope.

A gradual rise in one error category over three weeks is usually the earliest
signal of something real — a growing dataset, an upstream slowly changing, a
limit being approached. Looking at counts by category over time, even briefly
and manually, catches things no threshold would have fired on.

## Keep a list of what could break

Write down the integrations, their credentials, their expiry dates, their rate
limits and their plan ceilings. Keep it with the runbook.

It takes an hour and turns the most common class of outage — something expired,
something hit a limit — from an investigation into a lookup. It also makes the
question "what are we exposed to" answerable, which it otherwise is not.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-08-21',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 130,
    status: 'published',
  },
  {
    id: 'the-cost-of-a-silent-failure',
    slug: 'the-cost-of-a-silent-failure',
    problemTag: 'silent-failures',
    audience: 'owner',
    title: 'The cost of a silent failure',
    summary:
      'A system that breaks loudly costs an afternoon. One that breaks quietly costs however long it takes someone to notice — and the damage compounds the whole time.',
    category: 'Reliability',
    contentType: 'ops-note',
    icon: 'AlertCircle',
    points: ['Detect', 'Assert expectations', 'Fail loudly', 'Report honestly'],
    tags: ['Reliability', 'Monitoring', 'Operations'],
    body: `## Loud failures are the cheap ones

An automation that throws an error and stops is doing you a favour. Someone sees it, the cause is near the symptom, and the blast radius is bounded by the thing not having run.

The expensive failure is the one that keeps reporting success. Leads that stop arriving. A sync that runs nightly against a source that is now empty. A summary step whose output is being thrown away by a parser that no longer recognises its shape. Nothing errors. Dashboards stay green. The cost accumulates for as long as it takes someone to notice by other means.

## Catching an error is not the same as handling it

The most common source of silent failure is a catch block that swallows. It usually starts as a reasonable defensive move — one flaky step should not take down the run — and then quietly becomes the reason nobody knows the step has been failing for a month.

Every swallowed error should do at least one of three things: record itself somewhere countable, surface in the result the caller receives, or change a status that someone looks at. A catch that does none of those is a decision to not know.

## Assert what you expect, not just what must not throw

Error handling protects against the run crashing. It does not protect against the run completing and doing nothing. For that you need an expectation.

If a job normally processes between ten and a thousand records, zero is an anomaly worth raising even though nothing failed. If a step normally produces a value, an empty value is worth recording distinctly from an error, because they have different causes and different fixes.

- Expected range, and what happens outside it
- Zero results: anomaly or legitimate?
- Empty output distinguished from failed output
- Last successful run, visible somewhere

That last one is the single highest-value signal: a timestamp that says when this last genuinely worked. Freshness is the check that catches every silent failure at once, including the ones nobody predicted.

## Report the outcome you actually had

A status that flattens several outcomes into one loses the information needed to diagnose. "Did not work" covers the upstream being down, a credential expiring, the input being malformed, and the output being unreadable — four different problems with four different fixes.

Worse, a message that names the wrong cause sends the next person down the wrong path. A label saying a service was unavailable, when in fact it answered and the answer was discarded, is more expensive than no label at all, because it is confidently misleading.

Report the outcome you observed, not the one you assumed. If you do not know which it was, say that.

## Degrade visibly

Graceful degradation is a good property and a dangerous habit. Falling back to a default is right when the alternative is an outage. It is wrong when nobody can tell the fallback is in use.

The pattern that works: degrade in behaviour, but record that you degraded. The page still renders, the digest still publishes, the form still submits — and a counter somewhere says how often the good path was not taken. Without that counter, the fallback becomes the permanent state and nobody finds out.

## A cheap test worth running

Pick an automation and break it deliberately in a staging environment. Revoke a credential, empty the source, make the upstream return an unexpected shape.

Then ask: how would we have found out? If the honest answer is a person eventually noticing something missing, that is the gap. It is far cheaper to find it on purpose than to find it in the middle of a month when nobody was looking.

## Freshness beats almost every other signal

If you add only one check, add the timestamp of the last successful run, with a
threshold for how old is too old.

It catches every silent failure at once, including the ones nobody predicted: the
trigger that stopped firing, the filter that now matches nothing, the credential
that expired, the schedule that was quietly disabled. It requires no
understanding of why something broke, only that it has not worked since Tuesday.

## Put it where someone will actually see it

An alert into a channel nobody reads is documentation, not monitoring. So is a
dashboard opened once a quarter.

Route it to where the affected work happens — the inbox of the person who
depends on the output, the channel the team already watches. And make the
message say what to do, not only what happened. An alert nobody knows how to act
on gets muted, and a muted alert is worse than none because it creates the
impression of coverage.

## Count the fallbacks

Every graceful degradation needs a counter. How many times today did the code
take the safe path instead of the good one.

Without it, degradation is indistinguishable from normal operation, and the
fallback becomes permanent. With it, "the summaries have been empty for a week"
is a number on a chart rather than something a person eventually notices.

## Reconcile against the source occasionally

For anything that syncs, periodically compare counts at both ends. How many
records exist upstream, how many downstream, and does the difference have an
explanation.

This is the check that catches drift no per-run error handling can see, because
every individual run succeeded. It is also the one that finds the records lost
during an incident three months ago that nobody realised had been lost.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-09-04',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 140,
    status: 'published',
  },
  {
    id: 'choosing-what-not-to-automate',
    slug: 'choosing-what-not-to-automate',
    problemTag: 'choosing-tools',
    audience: 'owner',
    title: 'Choosing what not to automate',
    summary:
      'Not every repetitive task should be automated. The ones that should not are identifiable in advance, and skipping them is what keeps the rest maintainable.',
    category: 'Strategy',
    contentType: 'ops-note',
    icon: 'ClipboardList',
    points: ['Low frequency', 'Unstable rules', 'Judgement-heavy', 'Unclear ownership'],
    tags: ['Strategy', 'Operations', 'Decision Making'],
    body: `## Automation has an ongoing cost

The build cost is visible and gets estimated. The ongoing cost usually does not: an automation is a small piece of infrastructure that has to be monitored, updated when an upstream changes, re-credentialed, and understood by whoever inherits it.

That cost is worth paying many times over for the right workflows. For the wrong ones it quietly exceeds the manual effort it replaced, and it does so in a form nobody is tracking.

## Frequency has to clear the maintenance bar

A task done twice a year takes a few minutes each time. Automating it costs a day to build and then needs to still work six months later, by which point the upstream API has moved and nobody remembers how it was set up.

The arithmetic that matters is not build cost against time saved. It is build cost plus maintenance against time saved over a realistic horizon. Low-frequency tasks frequently lose that comparison, and the honest answer is a good checklist instead.

## Unstable rules are a moving target

If a process changes shape every few weeks — new exceptions, new approvers, a rule that depends on this quarter's priorities — automating it means rebuilding it every few weeks.

Wait for it to settle. A process that has held its shape for a few months is a candidate. One still being argued about is a specification that has not been written yet, and encoding it just moves the argument into a tool where it is harder to see.

## Judgement-heavy work resists the useful part

Some tasks look repetitive but are actually a person applying context each time — knowing this client is sensitive about timing, that this request is a follow-up to a bad experience, that the exception is warranted this once.

Automating the mechanical shell of that work while removing the context usually produces something technically correct and situationally wrong. The better move is to automate the parts around it: assemble the information, draft the option, and leave the decision with the person.

- Does the same input reliably produce the same correct output?
- If not, what is the person using that the system would not have?
- Can that context be supplied, or does it live in their head?
- What does being wrong cost here?

## No owner means no automation

If nobody will own it after launch, it should not be built. Unowned automation does not fail immediately — it fails in three months, invisibly, and whoever depends on it discovers the failure downstream of some other problem.

"Owner" here means a specific person who would be told if it stopped, not a team name. If that person cannot be named before the build starts, that is the answer.

## Documenting beats automating more often than people expect

A written procedure with the exact steps, the actual field values, and the edge cases is fast to produce, needs no credentials, does not break when an API changes, and can be followed by anyone.

For infrequent, unstable, or judgement-heavy work it is usually the better tool. Choosing it is not a failure to automate. It is the same analysis, reaching a different answer — and it leaves the automation budget for the workflows that will actually repay it.

## Ask what the process is for before automating it

Some steps exist because of a constraint that no longer applies — a system that
was replaced, an approval for a risk that has passed, a report nobody reads.
Automating those makes a redundant step permanent and harder to remove, because
it is now in a tool rather than in a habit.

Before building, ask what each step is for and who consumes its output. The
answer is occasionally that nobody does, and deleting a step is a better outcome
than automating it.

## Partial automation is a real answer

The choice is not between fully automated and fully manual. Most of the value
often sits in the boring middle: gather the information, pre-fill the form,
assemble the draft, then stop and let a person decide.

This shape is cheaper to build, much cheaper to maintain, and keeps judgement
where judgement belongs. It also tends to be where the actual time goes — the
decision is usually quick, and the gathering is what takes twenty minutes.

## Beware the process that is really a conversation

Some workflows look like data movement and are actually negotiation: chasing a
late invoice, handling a complaint, agreeing a delivery date. The steps can be
described, but what makes them work is the person reading the situation.

Automating the visible steps while removing the reading produces something
technically correct and relationally wrong. Automate the record-keeping around
the conversation instead, and leave the conversation alone.

## Write the decision down either way

Whichever way it goes, record it: what was considered, what was decided, and
why. Otherwise the same proposal returns every six months and gets re-argued
from scratch by people who do not know it was already examined.

A short note saying "we looked at automating this in March and chose a checklist
because it runs twice a year" saves that whole conversation, and makes it easy
to revisit properly if the frequency changes.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-09-15',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 150,
    status: 'published',
  },
]
