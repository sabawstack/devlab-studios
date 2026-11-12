/**
 * AI Updates: what changed in AI, and what it means for a working business.
 *
 * Part of the Insights library (src/data/resourcesContent.js composes the
 * topics). These describe how the technology behaves and what it implies for
 * building on it — they do not report vendor announcements as news, because a
 * static file cannot stay current with those and should not pretend to.
 */
export const aiUpdateArticles = [
  {
    id: 'what-better-ai-models-change-for-ops',
    slug: 'what-better-ai-models-change-for-ops',
    problemTag: 'choosing-tools',
    audience: 'technical',
    title: 'What better AI models actually change for operations teams',
    summary:
      'Each model generation gets framed as a leap. From an operations seat, the gains that matter are narrower and more specific than the announcements suggest.',
    category: 'AI Updates',
    contentType: 'ai-update',
    icon: 'TrendingUp',
    points: ['Cleaner extraction', 'Fewer rewrites', 'Better refusals', 'Longer inputs'],
    tags: ['AI News', 'Operations', 'Practical Use'],
    body: `## The announcements and the working gains are different things

Model releases are announced in terms of benchmarks and capability demonstrations. Neither maps cleanly onto whether a workflow that classifies inbound mail got better this month.

The gains that matter operationally are duller: the output comes back in the requested shape more often, extraction is right on messy inputs more often, and the model says it does not know instead of inventing something. Those are not headline features, but they decide how much human correction a pipeline needs.

## Format reliability is worth more than raw capability

For anything feeding a downstream system, the most valuable property is that the output parses. A model that is slightly less capable but returns valid structured output every time is more useful in a pipeline than a stronger one that occasionally wraps its answer in prose.

Every malformed response is either a retry, a fallback, or a manual fix. Reducing their frequency shows up as real recovered time even when benchmark movement is modest.

## Longer context changes architecture, not just capacity

Larger context windows get reported as a capacity number. The operational effect is that a class of workaround disappears: chunking a document, summarizing the chunks, then summarizing the summaries.

That pattern loses information at every hop and is hard to debug, because a wrong final answer could have originated at any stage. Passing the whole document removes the hops. It is worth re-examining pipelines built around the old constraint, because some of their complexity now exists for no reason.

Longer context is not free. Cost scales with tokens, and a prompt that now carries an entire document carries it on every run.

## Better refusals reduce a specific, expensive failure

A model that confidently produces a plausible wrong answer is worse operationally than one that declines. The confident wrong answer propagates into a record, a reply, or a decision, and is discovered later by someone who has to work out where it came from.

Improvements in calibration mean more cases land in a review queue and fewer land in the database. That is a good trade even though the queue looks like more work.

## Smaller models improving matters more than the flagship improving

Most production automation does not need frontier capability. It needs classification, extraction, and short-form drafting. Each generation pushes more of that work into the range where a cheap, fast model is sufficient.

This has the larger practical effect on cost, because it applies to the high-volume work. The flagship improving affects the rare hard call; the small model improving affects every run.

## How to tell whether an upgrade helped you

Do not take the benchmark's word for it. Keep a fixed set of twenty or thirty real inputs from your own workflow, with the answers you actually want. Run them against the current model and the candidate, and compare.

This takes an hour to set up and turns model selection from a reading exercise into a measurement. It also catches the case nobody expects: an upgrade that improves general capability while regressing on the narrow thing your pipeline depends on.

## Cheaper is a capability change too

Price drops get reported as a commercial story, but for operations they are a
capability story. Work that was uneconomic at one price becomes routine at a
tenth of it.

Summarizing every inbound message rather than the flagged ones. Classifying an
entire backlog rather than sampling it. Running a second model over the first
one's output as a check. None of these need any new capability — they were
simply not worth the cost, and at some point they are.

Worth revisiting periodically: the list of things you decided against on cost
grounds. Some of them have quietly become sensible.

## Deprecation is the risk nobody budgets for

Models are retired. A pipeline pinned to a specific version will eventually get
a notice with a date on it, and the replacement will behave slightly differently
on your inputs even when it is better in general.

The defence is the same evaluation set as above, plus keeping the model
identifier in configuration rather than scattered through the code. With both,
a deprecation is an afternoon. Without them, it is an unplanned project with an
externally imposed deadline.

## What to actually do when a new model ships

Not much, immediately. Read what changed, and check the two things that affect
you: whether your current model is now deprecated, and whether the price of the
tier you use moved.

Then, when there is a quiet hour, run your evaluation set against the new model
and compare. Most of the time the answer is that nothing meaningful changed for
your workload, and knowing that with evidence is worth more than the upgrade
would have been.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-07-05',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 70,
    status: 'published',
  },
  {
    id: 'small-models-are-often-the-right-call',
    slug: 'small-models-are-often-the-right-call',
    problemTag: 'choosing-tools',
    audience: 'technical',
    title: 'When a small model is the right call',
    summary:
      'Reaching for the largest available model is usually wrong for production workloads. What small models handle well, and how to tell whether your task is one of them.',
    category: 'AI Updates',
    contentType: 'ai-update',
    icon: 'Cpu',
    points: ['Classification', 'Extraction', 'Short drafting', 'High volume'],
    tags: ['AI News', 'Cost', 'Model Selection'],
    body: `## The default is expensive and often unnecessary

When a workflow needs a model, the path of least resistance is the strongest one available. It works, so nothing forces a re-examination. Meanwhile the cost per run is several times what the task requires, and the latency is several times what the experience allows.

The question worth asking on every model call is not which model is best. It is what is the smallest model that is reliably correct here.

## Three task shapes where small models hold up

Classification with a known set of labels. Routing an inbound message to one of eight categories needs reading comprehension and instruction-following, not deep reasoning. The fixed label set also makes correctness measurable.

Extraction from semi-structured text. Pulling a date, an amount, and a reference out of a message is pattern recognition with tolerance for mess. The failure mode is usually a missing field rather than an invented one, which is the safer direction.

Short-form drafting where a person reviews the output. One or two sentences from supplied material, in the tone requested. The review step absorbs the quality gap.

## Where they do not hold up

Multi-step reasoning where an early error compounds. Tasks needing broad world knowledge rather than reading the supplied text. Anything acted on without review where being subtly wrong is costly. Long inputs where the relevant detail is buried and easily missed.

The boundary is fuzzy and moves with each generation, which is exactly why it should be measured rather than assumed.

## Measure it on your own inputs

Take thirty real examples and write down the correct output for each. Run them through a small model and a large one. Count the differences and read them.

Two outcomes are common. Either the small model is indistinguishable, and the choice is obvious. Or it fails on a recognisable subset — the longest inputs, the ambiguous ones — in which case route on that property rather than upgrading everything.

- Same accuracy: use the small model
- Fails on an identifiable subset: route, do not upgrade wholesale
- Fails unpredictably: use the larger model, and keep the test set for next time

## Cost is not the only reason

Latency compounds in a pipeline. Three model calls at two seconds each is a six-second wait, which is the difference between a response feeling immediate and feeling broken.

Small models also make retries affordable. If a call is cheap and fast, you can run it twice and compare, or validate the output and re-ask when it fails a check. Those patterns buy back much of the reliability gap, and they are impractical when each call is expensive.

## Keep the choice reversible

Whatever you pick, keep the model identifier in configuration rather than scattered through code, and keep the evaluation set. Models get deprecated, renamed, and repriced on someone else's schedule.

A pipeline that can swap models by changing one value, and prove the swap was safe by re-running thirty examples, treats that as routine maintenance. One that cannot treats it as a project.

## Routing beats upgrading

When a small model fails on part of your workload, the reflex is to move
everything to a larger one. That pays the larger price on the majority of cases
that were already fine.

Routing is usually better: send the easy cases to the small model and the hard
ones to the large one, on whatever property distinguishes them. Input length is
often enough. So is a confidence signal, or a validation step that re-asks a
stronger model when the first answer fails a check.

The result costs close to the small model's price with close to the large one's
accuracy, and it degrades sensibly — if the router is wrong, you have paid too
much rather than got it wrong.

## Prompt quality closes more of the gap than model size

A small model with a clear, specific prompt and two examples routinely beats a
larger one with a vague instruction. Examples matter disproportionately: they
communicate format and edge-case handling more reliably than any description of
them.

This is worth trying before concluding a small model cannot do the job. The
cheapest experiment in this whole area is rewriting the prompt and re-running
the same thirty inputs.

## Latency is a product decision, not just a number

Where a person is waiting, model choice becomes a user experience decision
rather than an infrastructure one. A form that takes four seconds to validate
feels broken regardless of how good the validation is.

Small models make interactive use realistic. They also make it feasible to run
the call on every keystroke-pause rather than on submit, which changes what the
feature can be — a different thing from doing the same feature more cheaply.

## What to keep after choosing

Whatever you land on, keep three artifacts: the evaluation set, the measured
result per model, and the date. Together they are the answer to "why are we on
this model", which someone will ask, and the starting point for re-checking when
the next generation lands.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-08-14',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 80,
    status: 'published',
  },
  {
    id: 'structured-output-changed-integration-work',
    slug: 'structured-output-changed-integration-work',
    problemTag: 'integration-maintenance',
    audience: 'technical',
    title: 'Structured output changed what integration work looks like',
    summary:
      'Getting a model to reliably return parseable data used to be most of the work in an AI integration. That changed — and it moved the hard part somewhere less obvious.',
    category: 'AI Updates',
    contentType: 'ai-update',
    icon: 'Code2',
    points: ['Schema enforcement', 'Fewer retries', 'Validation still required', 'New failure shape'],
    tags: ['AI News', 'Integration', 'Data'],
    body: `## What the old work looked like

Connecting a model to a system meant coaxing text into a shape a program could read. Prompts carried elaborate formatting instructions. Parsers stripped code fences, handled trailing commas, and coped with the model explaining its answer before giving it. A retry loop caught what the parser could not.

A meaningful share of the code in an early AI integration was not about the task at all. It was about the transport.

## Schema-constrained output removed most of that

Supplying a schema and having the response conform to it structurally removes an entire category of defect. No fences to strip, no preamble to discard, no retry because the model decided to be conversational.

The integration code gets much smaller and much less interesting, which is the correct direction for integration code.

## Structurally valid is not the same as correct

This is the part that catches people out. A schema guarantees the shape: that the amount field is a number and the date field is a string. It guarantees nothing about whether the amount is the right amount.

A model that cannot find a value in the source will still produce one, because the schema requires a value. The failure has moved from unparseable to parseable and wrong, which is harder to notice and considerably more dangerous downstream.

- Make fields nullable when "not present" is a real answer, and check for null
- Validate ranges and formats yourself; the schema only checks types
- Cross-check derived values against their inputs where you can
- Keep a found flag per field when the source may legitimately lack it

## Design the schema to permit uncertainty

The most common mistake is a schema where every field is required. It reads as rigour and produces fabrication, because it forecloses the model's ability to say the information was not there.

Allowing null, or including an explicit found flag, lets uncertainty surface where it can be handled. Whether that routes to a person or to a fallback is then a decision you get to make. Without it, you never get to make it.

## The hard part is now schema design

Deciding what the fields are, which are optional, what the enumerations contain, and what to do when the source disagrees with itself — that is where the difficulty went. It is a better place for it, because those are domain questions with real answers rather than a fight with a text format.

It also means the schema is worth reviewing with whoever owns the process, not only with whoever writes the code. They are the one who knows a record can legitimately have no reference number.

## What to carry forward

Structured output is a transport improvement, and a large one. It is not a correctness guarantee, and treating it as one replaces a loud failure with a quiet one.

Keep the validation layer you wrote for the old world. It is doing a different job now — checking meaning rather than shape — and that job never went away.

## Null is a real answer and should be allowed to be one

The single most useful schema habit is making a field nullable whenever "not
present in the source" is a legitimate outcome, and then handling the null.

It sounds obvious and is routinely skipped, because a required field feels more
rigorous. It is not: it removes the model's only honest option and forces a
guess. A nullable field with an explicit downstream branch turns a silent
fabrication into a visible decision.

## Enumerations need an escape hatch

A closed set of values is good schema design right up to the input that belongs
to none of them. Without an escape, the model picks the nearest wrong option and
the record looks fine.

Include an "other" or "unknown" member, and route it somewhere a person sees.
The count of items landing there is also a useful signal in itself: a rising
number usually means the real world has developed a category your schema does
not have yet.

## Validate the meaning, not just the shape

The schema checks types. Everything about whether the values make sense is still
yours to check: dates within a plausible range, amounts matching their currency,
identifiers matching a known format, totals equal to the sum of their parts.

These checks are cheap and catch exactly the failures a schema cannot. They are
also the natural place to decide what happens next — reject, queue for review,
or accept with a flag — which is a business decision rather than a parsing one.

## Keep the raw response

Store what the model returned alongside the parsed record, at least for a while.

When a value looks wrong later, the question is whether the model produced it or
something downstream transformed it, and only the raw response answers that.
It is also what you need to build an evaluation set from real traffic, which is
much better than one assembled from imagination.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-08-28',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 90,
    status: 'published',
  },
  {
    id: 'inference-at-the-edge-what-it-changes',
    slug: 'inference-at-the-edge-what-it-changes',
    problemTag: 'integration-maintenance',
    audience: 'technical',
    title: 'Running inference at the edge: what it changes and what it does not',
    summary:
      'Models running next to the request remove a round trip and a vendor relationship. They also bring constraints worth understanding before you build on them.',
    category: 'AI Updates',
    contentType: 'ai-update',
    icon: 'Globe',
    points: ['Lower latency', 'Fewer dependencies', 'Smaller catalogue', 'Different limits'],
    tags: ['AI News', 'Edge', 'Architecture'],
    body: `## The shape of the change

Running a model on the same platform that serves the request removes a hop to a third-party API. No outbound call, no separate key to manage, no second vendor's status page to check during an incident.

For workloads already running at the edge this is a genuine simplification. Fewer moving parts in the request path means fewer things that can be unavailable independently.

## Latency improves for a specific reason

The gain is not that the model runs faster. It is that the network round trip disappears. For a small model doing a short task, that round trip can be a large fraction of total time.

This matters most for work in the request path, where someone is waiting. For background work it barely matters — a scheduled job does not care about two hundred milliseconds. Be clear about which you have before treating latency as the reason.

## The model catalogue is the real constraint

Platforms offering edge inference expose a curated set of models, not the whole field. That set skews small and open-weight, which suits classification, extraction, and short drafting, and does not suit tasks needing frontier capability.

It also moves on the platform's schedule. Models get added, deprecated, and renamed without reference to your roadmap, so the identifier belongs in configuration and the evaluation set belongs in version control.

- Check the model you want is actually in the catalogue before designing around it
- Expect the catalogue to change; keep the model id configurable
- Verify the response shape, which differs between models on the same platform
- Confirm behaviour in local development, which often differs from deployed

That last point deserves emphasis. Local development environments frequently cannot reach these bindings at all, so a pipeline that appears to work locally may be silently skipping the model. Whatever the degraded path is, it should be visible rather than inferred.

## Pricing is usage-shaped and needs measuring

Edge inference tends to be billed in a platform-specific unit tied to compute rather than tokens, often with a daily included allowance. That shape is generous for low-volume work and can move quickly at scale.

The right response is to measure rather than estimate. Log the reported usage per run. Then "are we near the limit" has an answer in a dashboard instead of an argument.

## What it does not change

It does not change that the model can be wrong, that outputs need validating, or that a schema does not guarantee correctness. It does not remove the need for a fallback when inference is unavailable.

The failure mode is worth designing deliberately. If the allowance is exhausted, does the feature degrade or break? A summary that publishes without its summary line is degraded. A page that fails to render is an outage. Which one you get is a decision made at build time.

## A reasonable rule

Use edge inference for high-volume, latency-sensitive, small-model work in the request path. Keep an external provider for the harder calls. Keep both behind one interface so the choice per task stays a configuration decision rather than a rewrite.

## Design the degraded path first

The most important decision is what happens when inference is unavailable, and
it is best made before anything is built.

There are only really three answers: fail the request, serve a fallback, or
serve the result without the model's contribution. Which is right depends on
whether the model output is the feature or an enhancement to it. A translation
feature without the model is broken. A summary line above a list of links is an
enhancement, and the list is still worth serving.

Whichever you choose, make it observable. A degraded path nobody can see becomes
the permanent state, and nobody finds out until somebody asks why the summaries
stopped appearing weeks ago.

## Verify the response shape per model, not per platform

Models on the same platform do not agree on their response format. Some return a
simple text field, some return an OpenAI-style structure with the text nested
several levels down.

Reading only the shape you first encountered produces a failure that is
genuinely hard to spot: the call succeeds, the usage is billed, and the result is
discarded. The code looks correct and the logs say the model was unavailable.
Handle the shapes you might receive, and log which one arrived.

## Local development is not a rehearsal

It is common for these bindings to be unavailable or to behave differently
outside the deployed environment. That means local testing exercises the
degraded path rather than the real one, and can give a false impression in either
direction.

Know which of the two you are looking at. If the local environment cannot reach
the model at all, a green local run tells you the fallback works and nothing
about the model call.

## Measure usage from the first day

Log whatever usage figure the platform reports, per run, from the beginning.

It costs one field and converts every future capacity conversation from an
argument into a query. It also makes the day you approach a limit a thing you
notice in advance rather than a thing you discover from a failure.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-09-10',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 100,
    status: 'published',
  },
  {
    id: 'retrieval-is-plumbing-not-a-feature',
    slug: 'retrieval-is-plumbing-not-a-feature',
    problemTag: 'data-consistency',
    audience: 'technical',
    title: 'Retrieval is plumbing, not a feature',
    summary:
      'Most disappointing answers from a document assistant are retrieval failures, not model failures. The model never saw the right passage.',
    category: 'AI Updates',
    contentType: 'ai-update',
    icon: 'Search',
    points: ['Retrieval first', 'Chunking matters', 'Cite the source', 'Measure the fetch'],
    tags: ['AI News', 'Retrieval', 'Knowledge'],
    body: `## The usual diagnosis is wrong

When an assistant over a document set answers badly, the instinct is to blame the model and reach for a better one. Usually the model performed correctly on what it was given. It was given the wrong passages.

Retrieval is a search problem sitting in front of a language problem, and it fails on its own terms. Debugging the model first means debugging the wrong component.

## Look at what was retrieved before anything else

The first diagnostic is not the answer. It is the list of passages fetched for the question. Print them and read them.

Two patterns account for most failures. Either the relevant passage is simply absent, or it is present but surrounded by enough near-miss material that the salient line is buried. These have different fixes, and neither is a better model.

## Chunking decides what can be found

Documents get split before indexing, and where the splits land determines what is findable. Split too small and a passage loses the context that made it meaningful. Split too large and a chunk covers several topics, so its embedding represents an average of them and matches nothing precisely.

Splitting on structure — headings, sections, natural boundaries — tends to work better than splitting on a fixed character count, because it preserves the unit the author intended. Carrying a little surrounding context into each chunk helps a passage stand on its own.

- Split on document structure, not arbitrary length
- Keep enough surrounding context that a chunk stands alone
- Store the source and location with every chunk
- Re-index when the source changes, and know how you would tell

## Semantic search alone misses exact terms

Embedding similarity is good at meaning and unreliable at precision. A query containing a specific product code, error number, or proper noun can fail to retrieve the document containing that exact string, because the embedding captures general sense rather than the token.

Combining keyword matching with semantic search covers both. It is more machinery, and it removes an entire class of "why can it not find the thing I literally named".

## Make the answer cite its source

Requiring each claim to point at the passage it came from does two things. It gives the reader a way to verify, and it gives you a way to debug: a wrong answer with a citation tells you immediately whether retrieval or interpretation failed.

It also constrains fabrication. A model asked to answer only from supplied passages, and to say when they do not contain the answer, produces "not found" far more often than one asked to be helpful.

## Measure retrieval separately

Keep a set of real questions with the passages that should be retrieved for each. Then you can measure whether the right material was fetched, independently of what was written afterwards.

Without that separation, every change is judged on the final answer, and you cannot tell whether a prompt tweak helped or an unrelated indexing change did. Retrieval quality is measurable on its own, and measuring it is what stops the whole system being tuned by feel.

## Metadata filtering removes more noise than better ranking

A large share of "the answer was wrong" turns out to be the right answer from
the wrong document — a superseded version, another customer's, a different
region's.

Storing structured metadata alongside each chunk and filtering before ranking
removes that class entirely. Date, source, version, owner, visibility. It is
less interesting than tuning similarity and it fixes more real failures,
because it eliminates candidates rather than reordering them.

## Decide what happens to stale content

An index is a copy, and copies go out of date. The failure is quiet: confident
answers from a document that was replaced last quarter.

Decide up front how the index learns about changes, how quickly, and what
happens to deleted sources. Then carry the source's date into the answer, so a
reader can see they are being told something from two years ago even when the
retrieval did exactly what it was asked.

## Test with the questions people actually ask

Evaluation sets tend to be written by the person who built the system, which
means they are phrased the way the system expects. Real questions are shorter,
vaguer, full of internal shorthand, and often not questions at all.

Collect real ones as soon as there are any, and evaluate against those. The
first batch is usually humbling and always more useful than the imagined set.

## Know when retrieval is the wrong tool

Some questions cannot be answered by finding a passage: anything requiring a
count, an aggregate, a comparison across many records, or a calculation. No
amount of retrieval quality fixes "how many open tickets does this customer
have", because the answer is not written down anywhere to retrieve.

Those belong to a query against structured data. Recognising which kind of
question you are handling — and routing accordingly — matters more than any
tuning inside the retrieval path.`,
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '2026-09-12',
    readingTimeMinutes: 4,
    isFeatured: false,
    sortOrder: 110,
    status: 'published',
  },
]
