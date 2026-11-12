/**
 * Guides: how to actually do a thing, start to finish.
 *
 * Part of the Insights library (src/data/resourcesContent.js composes the
 * topics). Split by topic so no single file carries the whole library.
 *
 * Written from first principles about how this work is done. Nothing here
 * cites a client, a project outcome, or a measured result, because none of
 * those can be evidenced on a public page.
 */
export const guideArticles = [
    {
      id: 'ai-automation-small-business-workflows',
      slug: 'ai-automation-small-business-workflows',
      problemTag: 'choosing-tools',
      audience: 'owner',
      title: 'Where AI automation fits in small business workflows',
      summary:
        'Most small businesses do not need AI everywhere. They need it in the four or five places where the same information gets rewritten by hand. Here is how to find them.',
      category: 'Strategy',
      contentType: 'guide',
      icon: 'Lightbulb',
      points: ['Missed follow-ups', 'Manual routing', 'Repeated summaries', 'Disconnected tools'],
      tags: ['AI Automation', 'Small Business', 'Workflow Mapping'],
      body: `## Start where work is repeated, not where it is interesting

The instinct when adopting AI is to look for the most impressive thing it can do. That is almost always the wrong place to start, because impressive tasks tend to be rare, high-stakes, and hard to verify. The tasks worth automating first are the boring ones that happen every day and cost a few minutes each time.

A useful filter: find every point in the week where a person reads something in one system and types a version of it into another. That copying is pure overhead. It produces no new judgement, it is where transcription errors enter, and it is the first thing to get skipped when the week gets busy.

## Map one workflow end to end before touching a tool

Pick a single process and write it out as a sequence: what starts it, who touches it, what they decide, where the information ends up. Do this on paper before opening any automation platform. Two things usually fall out of the exercise immediately.

The first is that the process has more steps than anyone thought. The second is that at least one step exists only because a previous tool could not do something — a workaround that has outlived its cause.

- What event starts this work?
- What information is needed, and where does it currently live?
- What decision does a person actually make?
- Where does the result have to land for the next person?
- How does anyone know it finished?

That last question is the one most often missing, and it is the one that decides whether the automation is trustworthy later.

## Separate interpretation from decision

This is the distinction that keeps automated systems debuggable. AI is good at interpretation: reading unstructured text and producing a structured answer. It is a poor choice for the decision itself when that decision has rules.

Classifying an inbound message as a billing question is interpretation. Deciding that billing questions go to a specific person, within a specific window, and escalate after it, is a rule. Put the interpretation in the model and the rule in the workflow.

The practical benefit is that when something goes wrong you can tell which half failed. If the routing is wrong, you read a rule. If the classification is wrong, you look at the input and the prompt. When both live inside one prompt, every failure looks the same and none of them are reproducible.

## Good candidates share three traits

Workflows that automate well tend to have a clear trigger, a bounded input, and a destination that can confirm receipt. Lead intake has all three. So does turning a call transcript into notes, routing inbound mail by intent, and keeping a CRM field in step with a form submission.

Workflows that automate badly usually fail one of those. If the trigger is "when someone mentions it", if the input could be anything, or if the destination is a person's judgement rather than a system, the automation will produce more exceptions than throughput.

## Keep a person in the loop where the cost of being wrong is real

Drafting is a safer pattern than sending. A system that writes a reply and holds it for approval captures most of the time saving while keeping the failure mode visible. Once the approval step has run for a few weeks and the edits have become trivial, you have evidence for removing it — evidence that did not exist on day one.

The reverse order, automating the send and adding review after something goes wrong, means the first failure happens in front of a customer.

## Design the handover before you need it

The measure of a working automation is not that it saves time this month. It is that the next person to own it can understand it without you. That means the trigger, the expected input, the model's role, the validation, the destination, and the failure behaviour are all written down somewhere that is not a person's memory.

Automation that only its author understands is not an asset. It is a dependency.

## Cost the workflow before you cost the tool

The question "what will this cost" usually gets answered with a subscription price, which is the smallest part of it. The real figure is the build, plus the ongoing attention, plus what it costs when it is wrong.

A more useful estimate has four lines. What the manual version costs per month in time. What building it costs once. What it will cost to keep working — credential renewals, upstream changes, the occasional investigation. And what a failure costs, multiplied by how often you expect one.

That fourth line is the one that changes decisions. A workflow saving two hours a month that produces a customer-visible error twice a year is not a good trade, however cheap the platform is.

## Start with one workflow and finish it

The most common failure pattern is breadth: five workflows started, none finished, none trusted, all needing maintenance. It happens because starting is satisfying and finishing is not — finishing means error handling, the runbook, the monitoring, and the awkward edge cases.

One workflow taken all the way to the point where someone else could own it is worth more than five that mostly work. It also teaches you what "all the way" costs in your environment, which is the number you need before committing to the next four.

## What good looks like after six months

A useful test, applied later rather than at launch: can someone who did not build it explain what it does, tell whether it ran today, and fix it when it breaks?

If yes, the automation is infrastructure. If no, it is a person's side project that happens to be load-bearing, and the business is exposed to whether that person is available. The difference is not in the code — it is in the documentation, the observability, and whether anyone else has ever touched it.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-07-18',
      readingTimeMinutes: 4,
      isFeatured: true,
      sortOrder: 10,
      status: 'published',
    },
    {
      id: 'lead-intake-automation-checklist',
      slug: 'lead-intake-automation-checklist',
      problemTag: 'lead-intake',
      audience: 'owner',
      title: 'A checklist for automating lead intake without losing leads',
      summary:
        'Lead intake is the workflow most often automated first and most often automated badly. A checklist for the parts that decide whether an inquiry survives the trip.',
      category: 'Lead Systems',
      contentType: 'guide',
      icon: 'ClipboardList',
      points: ['Capture', 'Validate', 'Persist', 'Deliver', 'Confirm'],
      tags: ['Lead Intake', 'CRM', 'Automation Design'],
      body: `## The failure nobody sees

A lead intake system fails silently more often than loudly. The form submits, the visitor sees a success message, and the inquiry never arrives anywhere. Nobody complains, because the person who would complain does not know it happened, and the business only notices as a vague sense that the site is not converting.

Everything below exists to make that failure impossible or at least loud.

## Persist before you deliver

This is the single most important structural decision. Write the submission to your own storage first, synchronously, and decide the visitor's success message from that write. Only then attempt to deliver it onward — to a CRM, an email, a webhook, whatever.

The reason is that every downstream system will be unavailable at some point. If the visitor's confirmation depends on the CRM accepting the record, then a CRM outage becomes a lost lead. If it depends only on your own write, a CRM outage becomes a queued delivery you can retry.

- Validate the input
- Write it to storage
- Respond to the visitor
- Attempt delivery in the background
- Record the outcome of every attempt

## Validate on the server, whatever the form does

Client-side validation is a convenience for the visitor. It is not a control. Anything that can be submitted from a browser can be submitted without one, so the same schema has to run on the server, and the server's answer is the one that counts.

Sharing one schema definition between the form and the endpoint is worth the small amount of setup. It means the rules cannot drift apart, and a field added in one place cannot be silently ignored in the other.

## Record every delivery attempt, not just the last one

A single status column — delivered or failed — throws away the information you need when something is wrong. Keep a row per attempt with the timestamp, the target, the response, and a category for the failure.

The category matters more than it sounds. A transient failure (timeout, rate limit, 5xx) should be retried. A permanent one (malformed payload, rejected address, revoked credential) should not — retrying it just burns attempts and hides the real problem. A configuration failure (missing API key) is a third thing again: it means nothing will ever succeed until a person changes something.

## Make duplicates impossible rather than unlikely

Retries, double-clicks, and browser refreshes all produce the same submission twice. Rather than trying to prevent that at the edges, give each submission a key derived from its own content — the type, the sender, the message, and a coarse time bucket — and make that key unique in storage.

The second submission then collapses into the first by construction. This is much more reliable than debouncing a button.

## Decide what happens to spam before it arrives

Some proportion of submissions will be automated. A challenge widget handles most of it, a rate limit handles bursts, and a length cap on the request body handles the rest. None of these should be able to reject a real inquiry, which means each needs a decision about what happens when the control itself is unavailable.

A rate limiter that fails closed will eventually take your contact form offline during an unrelated outage. One that fails open will briefly stop counting. For an intake form, failing open is usually the right trade — but it should be a decision someone made, not an accident.

## Confirm the path end to end, in production, on purpose

The last item on the checklist is the one most often skipped: submit a real inquiry through the real form on the real site, and follow it all the way to where it is supposed to land. Do this after every change to the pipeline.

An intake system that has never been tested end to end is not a system. It is a hypothesis.

## Decide what the visitor is told, and when

The confirmation message is part of the system's contract, not a decoration. "Thanks, we'll be in touch" implies a person will see this. If delivery failed silently and nobody does, the message was a promise the system did not keep.

Say what is true at the moment you say it. If the submission is stored and a person reviews it within a working day, say that. If an automated reply is coming, say so and say roughly when. Vague reassurance is worse than a specific modest claim, because a specific claim can be verified and a vague one quietly erodes trust when it turns out to be untrue.

## Keep the raw submission, not only the parsed one

Normalizing input is necessary — trimming, formatting phone numbers, mapping a free-text field onto a known set. Keep what was actually typed as well.

When something looks wrong three weeks later, the question is almost always "what did they actually send us", and a normalized record cannot answer it. The storage cost is trivial. The alternative is reconstructing intent from a value that has already been through two transformations.

## Instrument the funnel across the seam

Page analytics tell you how many people submitted. Pipeline logs tell you how many records were delivered. Neither answers the question that matters: of the people who tried, how many became something a person acted on?

Carry one identifier from the form through to the delivery record. Without it a drop-off between the two halves is invisible, because each side reports itself as healthy and neither can see the other.

## Review the failures on a schedule, not on complaint

Put a recurring slot in the calendar to look at the failed and pending records. Ten minutes a fortnight is enough.

This is the control that catches everything the other items miss — the failure nobody anticipated, the upstream that started rejecting a field, the gradual rise in one error type. Intake systems do not usually break all at once. They develop a small persistent leak, and the only thing that finds a leak is someone looking.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-07-11',
      readingTimeMinutes: 4,
      isFeatured: false,
      sortOrder: 20,
      status: 'published',
    },
    {
      id: 'zapier-make-n8n-comparison',
      slug: 'zapier-make-n8n-comparison',
      problemTag: 'choosing-tools',
      audience: 'ops',
      title: 'Zapier, Make, and n8n: choosing on constraints, not features',
      summary:
        'All three will connect your tools. The feature lists are not what separates them — cost shape, debuggability, and who can maintain the result are.',
      category: 'Tools',
      contentType: 'guide',
      icon: 'Boxes',
      points: ['Cost shape', 'Debuggability', 'Portability', 'Who maintains it'],
      tags: ['Zapier', 'Make', 'n8n', 'Tooling'],
      body: `## The feature comparison is a distraction

Any of these platforms can move data between two systems on a trigger. Comparing connector counts is close to meaningless, because the connector you need either exists or you are calling an HTTP endpoint yourself, and every one of them can call an HTTP endpoint.

The decisions that actually matter show up months later: what it costs as volume grows, how quickly you can tell why a run failed, and whether the person who inherits it can work on it.

## Cost scales differently, and the difference compounds

These platforms bill on different units. Some count each step in a workflow, some count each run regardless of steps, some are a flat cost for a server you operate. A workflow with many small steps is cheap under one model and expensive under another, and the ranking flips depending on the shape of your automation rather than its usefulness.

The practical move is to take one real workflow you already run, count its steps and its monthly volume, and price it under each model. This takes twenty minutes and is far more informative than any comparison table, because it uses your shape rather than an average one.

Watch for the cliff: pricing tiers tend to jump rather than glide, so the meaningful question is not what it costs now but what it costs at three times the volume.

## Debuggability is the property you will care about most

Six months in, the question is never "can this platform do X". It is "why did last Tuesday's run not fire". What you want to know is which step failed, what the input to that step was, what came back, and whether it was retried.

Look specifically for: how long execution history is retained, whether you can see the actual payload at each step, whether you can replay a failed run with the original input, and whether failures notify anyone or simply sit in a log. Retention is the one people are most often surprised by, because it is short on the cheaper tiers and you only discover that while investigating something that happened last week.

## Self-hosting trades a bill for a responsibility

Running your own instance removes per-run pricing and gives you full access to execution data. It also makes you responsible for uptime, upgrades, backups, and the credentials stored inside it.

That trade is worth making when automation volume is high enough that per-run pricing dominates, or when the data passing through genuinely cannot leave your own infrastructure. It is not worth making to save a small subscription, because the operational cost of a server nobody is watching is much higher than the invoice.

- High volume, predictable shape: self-hosting usually wins
- Sensitive data with residency requirements: self-hosting is often the only option
- A handful of workflows, low volume: hosted is almost always cheaper in total
- Nobody on hand to own a server: hosted, without hesitation

## Ask who maintains it, and design for that answer

If the answer is a non-technical operations person, a visual builder with a constrained node set is a feature, not a limitation — the constraint is what keeps the workflow readable. If the answer is a developer, the ability to drop into code inside a step will save a great deal of contorted node-wiring.

Choosing a tool that assumes the wrong maintainer produces the same outcome either way: the workflow stops being edited, then stops being trusted, then gets replaced by a person doing it manually again.

## Assume you will move at least once

Treat the platform as replaceable. Keep the business rules written down outside it, keep credentials in one place you control, and prefer plain HTTP calls to proprietary steps where the difference is small.

None of that is free, but it is much cheaper than discovering that a year of process knowledge exists only as boxes and arrows inside a product you have outgrown.

## Test the integration you are actually worried about

Every platform's connector list includes the tool you need. What the list does not tell you is whether that connector supports the specific operation you depend on, at the volume you need, with the fields you care about.

Before committing, build the single riskiest step — the unusual API, the high-volume sync, the one with awkward pagination — on a trial account. An afternoon spent here answers a question no comparison article can, because the answer depends on your endpoint rather than on the platform in general.

## Credentials and access are a security decision

These platforms hold long-lived credentials to your business systems. That makes the platform part of your security surface, and worth the same questions you would ask of any vendor with that access.

Who on your team can see or export stored credentials. Whether connections are made under a service account or a person's login — the latter breaks when they leave, and takes the workflow with it. Whether audit history shows who changed a workflow and when. Whether data passing through is retained, and for how long.

- Connect under service accounts, never a personal login
- Keep an inventory of which workflows hold which credentials
- Know the retention period for execution data containing customer information
- Confirm you can revoke access quickly if you need to

## Plan the exit before you need it

Treat the platform as replaceable, because eventually it will be. Keep the business rules written down outside it, keep credentials in one place you control, and prefer plain HTTP calls to proprietary steps where the difference is small.

Exports help less than people expect: most platforms export a workflow in their own format, which is useful for backup and useless for migration. The portable artifact is the written description of what the process does and why.

## The honest summary

For a handful of straightforward workflows maintained by a non-technical team, the hosted options are almost always right and the choice between them is close to arbitrary. For high volume, unusual integrations, or data that cannot leave your infrastructure, self-hosting starts to pay — provided somebody owns the server.

The wrong answer is choosing on a feature matrix and discovering the real constraints six months later.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-07-04',
      readingTimeMinutes: 4,
      isFeatured: false,
      sortOrder: 30,
      status: 'published',
    },
    {
      id: 'preparing-business-data-for-automation',
      slug: 'preparing-business-data-for-automation',
      problemTag: 'data-consistency',
      audience: 'ops',
      title: 'Preparing business data before you automate anything',
      summary:
        'Automation does not fix messy data. It industrialises it. What to settle about your records before workflows start reading and writing them.',
      category: 'Data Readiness',
      contentType: 'guide',
      icon: 'Database',
      points: ['One source of truth', 'Stable identifiers', 'Explicit states', 'Known gaps'],
      tags: ['Data Quality', 'CRM', 'Operations'],
      body: `## Automation amplifies whatever is already there

A manual process tolerates inconsistent data because a person silently corrects it. They see two spellings of a company name and know it is one company. They see a blank field and ask. An automated process does none of that — it applies the same rule to both spellings and treats the blank as a value.

So the question before automating is not "is our data good enough". It is "what is my process currently doing by hand that the automation will not do".

## Decide which system is authoritative for each field

Most businesses end up with the same customer represented in several places: a CRM, a spreadsheet, an invoicing tool, an inbox. That is fine, as long as each field has exactly one system that owns it.

Without that decision, two automations will eventually write conflicting values and the last one to run wins. That failure is particularly unpleasant because it is intermittent and depends on timing, so it looks random.

Write it down as a table: field, owning system, everything else reads it. It takes an afternoon and prevents a category of bug that is very hard to diagnose later.

## Give every record a stable identifier

Matching records on a name or an email address works right up until someone changes their name or address, and then it silently creates a duplicate. Every entity that automation touches needs an identifier that never changes and is not derived from anything a person can edit.

If a system does not expose one, generate one and store it on both sides. The cost of adding this early is small. The cost of adding it after two years of records is a data migration.

## Make status explicit rather than inferred

A great deal of operational knowledge lives as inference: this row is "active" because the last column has a date in it, or a deal is "closed" because someone moved it to a particular tab. That works when a person reads it and fails when a rule does.

Replace inferred states with an explicit field holding a value from a known set. Then enumerate every value the set contains, including the awkward ones — "on hold", "cancelled by us", "duplicate". Automations will encounter all of them, and the ones you did not enumerate are the ones that will produce the strange behaviour.

- Every state a record can be in, named
- Which transitions are legal, and which are not
- What should happen to work already in flight when a record changes state

## Know where the gaps are before the workflow finds them

Run a count of empty values in every field the automation will read. Not a sample — a count. The number is usually higher than anyone expects, and it tells you whether a field can be treated as required or needs a fallback.

The same goes for format: how many phone numbers are in a form your SMS provider will accept, how many dates are strings rather than dates, how many email addresses have trailing spaces. These are all trivial to fix in bulk beforehand and genuinely annoying to handle one-at-a-time inside a workflow.

## Fix the intake, not just the backlog

Cleaning existing records is worth doing once. It is worth very little if the thing producing those records keeps producing them in the same shape.

Most data quality problems are validation problems that happened earlier — a free-text field where a list belonged, an optional field that should have been required, a form that accepted anything because rejecting input felt unfriendly. Tighten the intake first, then clean up behind it. Otherwise you will be cleaning the same fields again next quarter.

## Agree what a duplicate is before you deduplicate

"Remove duplicates" sounds like a settled instruction and almost never is. Two records with the same email and different names might be one person who changed theirs, or two people sharing an inbox. Two companies with the same name at different addresses might be branches, or might be unrelated.

Write the rule down as a decision someone made: these fields matching means the same entity, these fields matching means a probable match to review, everything else is distinct. Then automate against the rule rather than against an intuition, and keep probable matches in a queue rather than merging them silently.

A wrong merge is much harder to undo than a missed one.

## Decide what happens to history

When a record changes, does the old value matter? For a status field the answer is usually yes — knowing something was proposed before it was approved is often the entire question. For a corrected typo, no.

This decision determines whether you need an event log alongside the current state. Retrofitting one is expensive, because the history you wanted is exactly the history you did not keep. Deciding early costs almost nothing.

## Test the migration on a copy, with the real data

Cleaning scripts behave differently on real data than on samples, because real data contains the cases nobody thought of: the empty string that is not null, the date in a different century, the name with an unexpected character.

Run the cleanup against a full copy first and count what changed. If the count is much larger or much smaller than expected, the rule is wrong — and finding that out on a copy is free.

## Assign an owner per system, not per project

Data quality is not a project that finishes. Fields drift, new integrations write new values, and somebody eventually needs a decision about whether a new status is legitimate.

Name a person per system who owns those decisions. Without one, each integration makes its own choice and the definitions diverge again, usually within a year and usually invisibly until two reports disagree.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-06-27',
      readingTimeMinutes: 4,
      isFeatured: false,
      sortOrder: 40,
      status: 'published',
    },
    {
      id: 'ai-agents-vs-workflow-automations',
      slug: 'ai-agents-vs-workflow-automations',
      problemTag: 'choosing-tools',
      audience: 'ops',
      title: 'AI agents versus workflow automation: which problem are you solving?',
      summary:
        'An agent decides what to do next. A workflow already knows. That single difference determines cost, reliability, and how you debug it at 2am.',
      category: 'AI Agents',
      contentType: 'guide',
      icon: 'Zap',
      points: ['Fixed path', 'Chosen path', 'Verifiable output', 'Bounded blast radius'],
      tags: ['AI Agents', 'Automation Design', 'Operations'],
      body: `## The distinction is who chooses the next step

A workflow automation has its path decided in advance. When this happens, do that, then that. The model, if one is involved at all, fills in a value somewhere along a route that was fixed before the run started.

An agent is given a goal and chooses its own steps, including which tools to call and in what order. The path is decided during the run, and it can differ every time.

Everything else — cost, latency, reliability, how you test it — follows from that one difference.

## Fixed paths are cheap and boring, which is the point

A workflow costs what its steps cost. It takes as long as its slowest step. It fails in a small number of ways you can enumerate, and when it fails you can point at the step. You can write a test that asserts the whole thing end to end, because the path is knowable.

For the overwhelming majority of business processes this is exactly what you want. Lead routing, data sync, notification, report generation, document handling — none of these need anything chosen at runtime. They need to be right every time.

## Agents earn their cost when the path genuinely cannot be known

There are real problems where enumerating the branches is impractical. Investigating an open-ended question across several systems. Handling a request that could be any of forty things. Working through a task where step three depends on what step two turned up.

For these, an agent is not overengineering — a workflow covering the same ground would be an unmaintainable tree of conditionals. But be honest about which problem you have, because the agent shape costs more on every axis.

- Cost: several model calls per run rather than zero or one, and the count varies
- Latency: seconds to minutes rather than milliseconds
- Testing: the same input can produce different paths, so assertions have to be about outcomes, not sequences
- Debugging: you are reconstructing a decision, not reading a route

## Bound what an agent can reach

The blast radius of a workflow is whatever its steps touch, and you can read them. The blast radius of an agent is every tool you gave it, in any order, any number of times.

That means the tool list is the real security boundary. Give it the narrowest possible set. Prefer tools that read over tools that write. For anything destructive or externally visible — sending mail, issuing refunds, deleting records — require a human approval step rather than trusting the model to have judged correctly.

A useful test: if the agent did the most damaging combination of its available actions, what would that cost? If the answer is unacceptable, the tool list is wrong, not the prompt.

## Most useful systems are mostly workflow

In practice the strongest designs are a fixed pipeline with a model at one or two specific points. Classify this. Extract these fields. Draft this reply. The surrounding structure — validation, routing, storage, retries, notification — stays deterministic.

This gets most of the benefit of using a model while keeping the properties that make a system operable. When something breaks you are usually looking at one step with a known input and a known expected output, which is a debuggable situation.

## Decide by the failure you can live with

Ask what happens when it gets it wrong, because it will. If the answer is "a person notices and fixes it in a minute", either shape is fine. If the answer is "a customer receives something incorrect" or "a record is changed and nobody knows", you want the fixed path, and you want a person in front of the irreversible step.

Start with the workflow. Add the agent when you have a concrete case where enumerating the branches has actually become the problem.

## Cost is variable in a way a workflow's is not

A workflow's cost is a known number per run. An agent's is not: it depends on how many steps it chose to take, and that varies with the input. The same task can cost twice as much on a Tuesday because the phrasing was ambiguous.

That matters for budgeting, and it matters more for the failure mode. An agent stuck in a loop — calling a tool, getting an unhelpful result, trying again — can spend a great deal before anything notices. A hard cap on steps and on total spend per run is not an optimisation; it is the thing standing between a bad input and a large bill.

- Cap the number of steps per run, and log when the cap is hit
- Cap total spend per run, and per day
- Alert on runs that hit either cap, since that is where the pathologies live

## Testing an agent is a different discipline

A workflow is tested by asserting that a given input produces a given output. That works because the path is fixed.

An agent's path varies, so the same assertion style produces flaky tests that fail for reasons unrelated to correctness. What you can assert is the outcome: the record ended up in the right state, the answer contains the right facts, no forbidden tool was called. Build a set of real inputs with known-good outcomes and measure the pass rate rather than expecting determinism.

A pass rate also gives you something a binary test cannot — the ability to tell whether a prompt change helped, which is otherwise guesswork.

## The hybrid shape in practice

Most useful systems are a fixed pipeline with a model at one or two specific points, and the interesting design work is deciding where those points are.

A good rule: the model handles the step where the input is unstructured and the output is small and checkable. Everything around it — deciding what to do with that output, where it goes, what happens on failure — stays deterministic code you can read.

That shape keeps the debuggable properties of a workflow while getting the part of the model that is genuinely hard to replace.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-06-20',
      readingTimeMinutes: 4,
      isFeatured: false,
      sortOrder: 50,
      status: 'published',
    },
    {
      id: 'writing-automation-runbooks',
      slug: 'writing-automation-runbooks',
      problemTag: 'handoffs',
      audience: 'ops',
      title: 'Writing a runbook an automation can actually be handed over with',
      summary:
        'An automation only one person understands is a dependency, not an asset. What a runbook needs to contain for someone else to own it.',
      category: 'Handover',
      contentType: 'guide',
      icon: 'FileText',
      points: ['Trigger', 'Contract', 'Failure modes', 'Recovery', 'Owner'],
      tags: ['Documentation', 'Handover', 'Operations'],
      body: `## The test a runbook has to pass

Hand it to someone competent who has never seen the system, take away their ability to ask you anything, and give them a failure. If they can work out what broke and what to do about it, the runbook works. If they cannot, it is a description rather than a runbook.

Most automation documentation fails this test because it explains what the system does rather than what to do when it does not.

## Start with the contract, not the diagram

Diagrams age badly and tend to describe an implementation that has since changed. What stays stable is the contract: what goes in, what comes out, and what is guaranteed.

State it plainly. This workflow accepts a submission with these fields. It guarantees the record is stored before the visitor sees a confirmation. It attempts delivery to these targets. It does not guarantee delivery on the first attempt. It retries transient failures up to this many times.

Someone reading that knows immediately whether a missing record and a missing email are the same problem. They are not, and that distinction is the whole of the debugging.

## Name the trigger precisely

"Runs when a form is submitted" is not precise enough. Which form, on which page, posting to which endpoint, and is there a schedule as well? If there is a cron, state the expression and the timezone it is interpreted in — a cron written in UTC and read by someone in another timezone is a recurring source of "it did not run" reports when it ran exactly as configured.

## Enumerate the failure modes you already know about

This is the section that earns the document. For each one: what it looks like from the outside, how to confirm it, and what to do.

- The upstream service is down — symptom, how to check, what to do, and whether it self-recovers
- A credential has expired — how it presents, where to renew, what to replay afterwards
- The input arrived in an unexpected shape — where the rejected payload is kept, how to reprocess
- The run did not fire at all — how to distinguish "did not fire" from "fired and did nothing"

That last one matters more than it looks. A run that fired and found nothing to do, and a run that never fired, are completely different problems with the same visible signature: nothing happened.

## Say how to observe it

Where do the logs go, how long are they kept, and what is the one query that answers "did this run today". If observability is an execution history inside a hosted platform, say how long that history is retained, because that number decides whether investigating last week's incident is even possible.

If nothing notifies anyone on failure, write that down explicitly. A known gap is manageable. An assumed alert that does not exist is how failures go unnoticed for weeks.

## Write down the recovery, including the manual one

Every automation should have a documented way to do the same work by hand. Not because you expect to, but because the day the platform is down is not the day to be reverse-engineering what the workflow was supposed to produce.

Include whether reprocessing is safe. If the workflow is idempotent, say so and say why — usually because of a key that makes a duplicate collapse into the original. If it is not idempotent, say what running it twice would do, because someone will eventually be deciding whether to press the button under time pressure.

## Name an owner and a review date

An unowned automation degrades quietly. APIs change, credentials expire, volumes grow past a tier. Put a name against it and a date to look at it again, and keep the runbook next to the code rather than in a document nobody opens.

The runbook is not overhead on the build. It is the part that makes the build survivable.

## Write it while building, not afterwards

A runbook written after the fact documents what you remember, which is the happy path. The awkward details — why that retry is three and not five, why that field is nullable, which upstream returns a 200 with an error body — are exactly the things that fade first and matter most.

Keeping a running note while building costs almost nothing and captures decisions at the moment there is a reason for them. Tidy it at the end.

## Record what you decided not to do

A runbook that only describes the built thing invites the next person to "improve" it back into a problem you already solved.

If you deliberately did not retry a class of failure, say so and say why. If a step is manual on purpose because the cost of being wrong is high, write that down. These notes prevent a specific and frustrating kind of regression: someone removing a safeguard because its reason was never recorded.

## Include the queries, not just the advice

"Check whether the sync ran" is advice. The exact query, with the table and the field, is a runbook.

Paste the commands. The log filter that shows this workflow's runs. The query that returns the last successful run. The call that re-triggers it. Someone debugging at an inconvenient hour should be copying and pasting, not reconstructing your reasoning.

## Test the handover for real

The only reliable check is to have someone else use it. Pick a colleague, give them a deliberately broken staging environment and the runbook, and stay out of the conversation.

Everything they have to ask you is a gap. Write down the answer and the document improves permanently. Skip this and you have a document that is complete to its author, which is the only reader who did not need it.`,
      coverImageUrl: '',
      authorName: 'DevLab Studios',
      publishedAt: '2026-09-05',
      readingTimeMinutes: 4,
      isFeatured: false,
      sortOrder: 60,
      status: 'published',
    },
]
