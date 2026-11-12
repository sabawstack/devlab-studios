// Copy for the redesigned marketing pages (audit BUS-01, BR.3, F.2, F.5).
//
// Written to the audit's rules: one idea per sentence, short headings, the
// operational result before the mechanism, no stack names on the solutions
// index (the home page allows them only as CMS-sourced tags on system cards), no number that cannot be sourced, the founder named at
// most once per business page. Word budgets per page are enforced by
// tests/e2e/redesign.spec.js. Everything here was cut down from the site's
// earlier, already-truthful copy (git history: src/data/solutionsContent.js),
// not invented.
//
// Projects, Work narratives, articles, SEO records, navigation and the founder
// profile stay in the CMS; the page structure and this copy are code-owned
// since 2.4.0 (see docs/content-model.md).

export const OFFER_AUDIT = {
  slug: 'workflow-systems-audit',
  path: '/solutions/workflow-systems-audit',
  title: 'Workflow Systems Audit',
  summary: 'A fixed-scope review of one workflow, ending in a written recommendation you can act on.',
  contactHref: '/contact?type=workflow_audit&solution=workflow-systems-audit',
}

/** Each line's contact link carries its context, so the visitor never classifies themselves twice. */
export function serviceLineContactHref(line) {
  return `/contact?type=${line.inquiryType}&solution=${line.solutionId}`
}

/** The three service lines (audit G.1), each with its own page under /solutions/<slug>. */
export const SERVICE_LINES = [
  {
    slug: 'lead-intake-and-follow-up',
    solutionId: 'lead-intake-followup',
    title: 'Lead intake and follow-up',
    sceneId: 'connected-system',
    problem: 'Inquiries arrive, then sit. Follow-up depends on someone remembering.',
    outcome: 'Every inquiry is recorded once, has an owner, and stays visible until someone acts on it.',
    lead: 'For businesses whose inquiries come in through a form, an inbox, chat and the phone, and land in four places with no owner.',
    includes: [
      'Inquiry forms and landing pages that save before they send',
      'Qualification rules you can read and change',
      'Routing to a named owner, with reminders',
      'CRM and calendar handoff',
      'Source attribution, so you know what brings work in',
      'Failure alerts when a delivery does not go through',
    ],
    inquiryType: 'business_system',
    ctaLabel: 'Discuss your intake',
    workProjectId: 'p10-automated-lead-qualification',
    faq: [
      { question: 'Do we have to replace our CRM?', answer: 'Usually not. The system records every inquiry first, then keeps the tools you already use in step.' },
      { question: 'What happens when an integration is down?', answer: 'The inquiry is already saved. The failed delivery is recorded and shows up for a person to retry.' },
    ],
  },
  {
    slug: 'workflow-and-ai-automation',
    solutionId: 'workflow-ai-automation',
    title: 'Workflow and AI automation',
    sceneId: 'handoff-to-person',
    problem: 'The same process runs every week across an inbox, a spreadsheet and three tools.',
    outcome: 'The process runs on a schedule or a trigger, exceptions surface, and a person approves what needs approval.',
    lead: 'For repeated work that moves between inboxes, spreadsheets, CRMs, task systems and customer messages.',
    includes: [
      'Scheduled and triggered workflows',
      'AI for classification, drafting and summaries, never for the final decision',
      'Approval steps for anything ambiguous or high-impact',
      'Data cleaned up as it moves between tools',
      'Exception handling and escalation to a person',
      'Notifications that say what happened, not just that something did',
    ],
    inquiryType: 'business_system',
    ctaLabel: 'Discuss your workflow',
    workProjectId: 'p6-messenger-ai-agent',
    faq: [
      { question: 'Where does AI make decisions?', answer: 'It does not. AI drafts and summarises; rules you can read decide routing, and people approve what matters.' },
      { question: 'Which automation tools do you use?', answer: 'Whatever fits the work and the team that will run it. The choice is part of the written recommendation.' },
    ],
  },
  {
    slug: 'custom-software-and-operations',
    solutionId: 'custom-software-operations',
    title: 'Custom software and operations systems',
    sceneId: 'build-in-layers',
    problem: 'The work has outgrown what a spreadsheet or an off-the-shelf tool can hold.',
    outcome: 'A maintainable system with its own data, its own interface and documented integration points.',
    lead: 'For businesses that need a real interface, a real data model and services other systems can talk to.',
    includes: [
      'Internal tools and customer-facing interfaces',
      'APIs, webhooks and integrations',
      'Databases designed around how the business works',
      'Dashboards and reports people trust',
      'Deployment, documentation and a handover',
      'Ongoing care once it is live',
    ],
    inquiryType: 'software_project',
    ctaLabel: 'Discuss your build',
    // No client write-up yet: the proof is a product we built and run ourselves.
    workProjectId: '',
    productProof: {
      title: 'Devlab Pickleball',
      text: 'A live product we built and operate: accounts, real-time boards, tournaments and exports, on the same practices offered here.',
      href: '/products',
    },
    faq: [
      { question: 'Who runs it after launch?', answer: 'Your team, with documentation and a walkthrough. Ongoing monitoring and small changes are available as Operations Care.' },
      { question: 'Can you work with our existing systems?', answer: 'Yes. Integration with the tools already in use is most of the work, and it is planned before anything is built.' },
    ],
  },
]

export const RELIABILITY_PRINCIPLES = [
  { title: 'Saved before it is sent', text: 'A submission is written to the database before any email, CRM or webhook call is attempted.' },
  { title: 'Failures are visible', text: 'Every delivery attempt is recorded with its outcome, so a broken integration reaches a person, not a customer.' },
  { title: 'Rules decide, AI assists', text: 'AI summarises and drafts. Routing and permissions follow rules that can be read and tested.' },
  { title: 'Every workflow ends at a person', text: 'Anything ambiguous or high-impact goes to a named reviewer.' },
]

export const DELIVERY_STEPS = [
  { title: 'Map the workflow', text: 'Walk the current process end to end: where it stalls, who owns each step, what the data does.' },
  { title: 'Agree the system', text: 'A written recommendation with the structure, the tools and what will be true when it works.' },
  { title: 'Build in phases', text: 'Interface, integrations, data and automation, each tested before the next depends on it.' },
  { title: 'Hand it over', text: 'Deployment, a walkthrough, documentation and the failure paths written down.' },
]

/**
 * Home (Blueprint, ADR 0014). Voice: declarative, no rhetorical questions,
 * no filler; the founder is named once (in `principal`). Stack names are
 * allowed here only as tags on the production-system cards, which come from
 * the CMS. Shape and voice are guarded by homeContent.test.js.
 */
export const HOME = {
  hero: {
    eyebrow: '[ DEVLAB STUDIOS • SYSTEMS ARCHITECTURE ]',
    heading: "Systems that don't silently fail.",
    lead: 'Custom web interfaces, backend services, and AI workflows engineered end-to-end by one senior architect. No outsourced handoffs. No brittle wrappers.',
    primary: { label: 'Request a Workflow Audit', href: OFFER_AUDIT.contactHref },
    secondary: { label: 'Explore Production Systems', href: '/work' },
  },
  /** The hero schematic. Client-side only: the outage toggle never calls the network. */
  pipeline: {
    caption: 'Inquiry pipeline · live schematic',
    checkpoints: [
      { id: 'intake', index: '01', label: 'Intake' },
      { id: 'persist', index: '02', label: 'SQL persist' },
      { id: 'route', index: '03', label: 'Deterministic route' },
      { id: 'handoff', index: '04', label: 'Human handoff' },
    ],
    branchLabel: 'Webhook',
    retryLabel: 'Retry queue',
    toggleLabel: 'Simulate outage',
    status: {
      nominal: 'Nominal: payload persisted, delivered, handed off.',
      outage: 'Outage: webhook failed. Payload persisted in SQL, retry queued, operator alerted.',
    },
  },
  problems: {
    eyebrow: '§01 Failure modes',
    heading: 'Four ways operations fail quietly.',
    text: 'Each one is invisible until a customer finds it. Select a failure vector to see the architecture that closes it.',
    labels: { vector: 'Failure vector', architecture: 'DevLab architecture', verification: 'Node verification' },
  },
  console: [
    {
      id: 'unowned-intake',
      title: 'Unowned lead intake',
      vector: 'Inquiries arrive by form, inbox, chat and phone and land in four tools with no owner.',
      architecture: 'Every inquiry is written once to SQL with a status and a named owner, then routed by rules that can be read.',
      verification: 'VERIFIED · one record per inquiry · owner assigned at write time',
    },
    {
      id: 'silent-drops',
      title: 'Silent automation drops',
      vector: 'A scheduled job fails at 02:00 and nobody learns until a customer asks.',
      architecture: 'Every delivery attempt is recorded with its outcome. Failures alert an operator and stay retryable from the admin.',
      verification: 'VERIFIED · attempt log · retry queue · operator alert',
    },
    {
      id: 'data-silos',
      title: 'Fragmented data silos',
      vector: 'The CRM, the spreadsheet and the billing tool each hold a different version of the customer.',
      architecture: 'One system of record with documented integration points; other tools are kept in step by deterministic sync, never by hand.',
      verification: 'VERIFIED · single source of record · typed integration contracts',
    },
    {
      id: 'manual-reentry',
      title: 'Manual re-entry bottlenecks',
      vector: 'The same details are typed into three tools, and the gaps between them are where work is lost.',
      architecture: 'Data moves between tools by code. People approve what needs approval and never retype what the system already knows.',
      verification: 'VERIFIED · zero re-keying on the audited path',
    },
  ],
  reliability: {
    eyebrow: '§02 Rules of reliability',
    heading: 'Four rules every system ships with.',
    text: 'This site runs on the same rules: its own inquiry form saves before it sends, and every delivery is logged.',
  },
  /** The delivery log drawn in the first rule's card: what "persist before delivery" looks like during an outage. */
  persistLog: [
    { step: 'write', target: 'inquiry saved', result: 'ok' },
    { step: 'deliver', target: 'crm webhook', result: 'retry' },
    { step: 'deliver', target: 'crm webhook', result: 'ok' },
  ],
  bento: [
    { id: 'persist', title: 'Persist Before Delivery', text: 'Every submission writes to SQL before any external webhook, CRM, or email API fires. Outages leave work queued, never lost.' },
    { id: 'visible', title: 'Visible Failures', text: 'Every delivery attempt records its outcome and retry eligibility. Broken integrations alert operators immediately, never customers.' },
    { id: 'deterministic', title: 'Deterministic Routing', text: 'AI summarizes and drafts; permissions, state transitions, and delivery rules are governed by testable code.' },
    { id: 'handoff', title: 'Human Handoff', text: 'Ambiguous or high-impact decisions always terminate at a verified human operator, never an unmonitored black box.' },
  ],
  work: {
    eyebrow: '§03 Production systems',
    heading: 'Systems in production.',
    text: 'Specification cards for systems running today. Each links to the full engineering write-up.',
    linkLabel: 'Inspect the write-up',
    productBadge: 'Product · live',
    productLinkLabel: 'Open the product',
  },
  solutions: {
    eyebrow: '§04 What we build',
    heading: 'Three service lines. One entry point.',
    linkLabel: 'What this includes',
  },
  start: {
    eyebrow: '§05 Start here',
    heading: 'Start with one workflow.',
  },
  audit: {
    title: OFFER_AUDIT.title,
    text: 'A fixed-scope diagnostic of one workflow, end to end.',
    deliverables: ['End-to-end bottleneck map', 'Recommended architecture', 'Prioritised build roadmap'],
    primary: { label: 'Request the audit', href: OFFER_AUDIT.contactHref },
    secondary: { label: 'What you receive', href: OFFER_AUDIT.path },
  },
  principal: {
    eyebrow: 'Principal engineer',
    text: 'Stephen Rey Agustinez designs the schema, writes the API, documents the failure paths and answers the email. No account managers, no handoffs between teams, one person accountable for the system in production.',
    linkLabel: 'Read the profile',
  },
  final: {
    heading: 'Describe the system you need.',
    text: 'Every inquiry is persisted before it is delivered, and a person reads it.',
    primary: { label: 'Discuss your system', href: '/contact?type=business_system' },
  },
}

export const SOLUTIONS_INDEX = {
  eyebrow: 'Solutions',
  heading: 'Operational software, built to be run.',
  lead: 'Three kinds of system, each designed around the work it supports. If you are not sure which you need, start with the audit.',
  deliveryHeading: 'How a project runs',
  ctaHeading: 'Start with one workflow.',
}

export const AUDIT_PAGE = {
  eyebrow: 'Start here',
  heading: 'Workflow Systems Audit',
  lead: 'A fixed-scope review of one workflow, end to end. You receive a written recommendation and a prioritised roadmap, whether or not the build happens here.',
  whoFor: [
    'You know a process is losing time, but not which part to fix first.',
    'Inquiries, orders or requests move between several tools and people.',
    'You want a plan you can act on before committing to a build.',
  ],
  receive: [
    'A written review of the current workflow, step by step',
    'Where it stalls, and who owns each handoff',
    'An assessment of the data and integrations involved',
    'A recommended architecture, drawn',
    'A roadmap in priority order',
    'A decision point: build it here, elsewhere, or not at all',
  ],
  steps: [
    { title: 'Intake', text: 'A short form and one call to choose the workflow to review.' },
    { title: 'Review', text: 'We walk the workflow with the people who run it and look at the tools and data.' },
    { title: 'Recommendation', text: 'You receive the written review, the drawing and the roadmap, and we go through it together.' },
  ],
  faq: [
    { question: 'Is there a price?', answer: 'The scope is fixed; the price is quoted after the intake call, before any work starts.' },
    { question: 'Do we have to build it with you?', answer: 'No. The recommendation is yours to use with any team.' },
    { question: 'How long does it take?', answer: 'It depends on the workflow, and the timeline is agreed at intake.' },
  ],
}

export const ABOUT = {
  eyebrow: 'About',
  heading: 'A small studio that builds operational software properly.',
  lead: 'DevLab Studios designs, builds and runs the systems behind small and mid-sized businesses: the ones that capture inquiries, move work between tools, keep data consistent and make failures visible.',
  facts: [
    { label: 'Founded', value: 'March 2026' },
    { label: 'Based in', value: 'Cebu, Philippines' },
    { label: 'Works', value: 'Remote-first' },
    { label: 'Run by', value: 'Stephen Rey Agustinez' },
  ],
  principlesHeading: 'What we hold to',
  howHeading: 'How we work',
}

export const PRODUCTS = {
  eyebrow: 'Products',
  heading: 'What we build and run ourselves.',
  lead: 'Alongside client work, we build small products. One is live. A few more are ideas we want to test with the businesses that would use them.',
  live: {
    title: 'Devlab Pickleball',
    status: 'Live · free',
    text: 'Run open play and small tournaments from a phone: fair rotation, a live board for players, and an export for DUPR.',
    href: '/pickleball?ref=products',
    ctaLabel: 'Start a free session',
    // Shipped behaviour only (see /pickleball).
    facts: [
      'Fair rotation on up to 16 courts: paddle stack, winners play winners, by standing or balanced teams.',
      'Players follow every court by QR, and a TV board shows the hall. Nobody needs an account.',
      'Tournaments too: round robin, pools then a bracket, or single or double elimination.',
    ],
  },
  exploring: [
    { id: 'distributor-collections', title: 'Collections for distributors', text: 'Tracking what each customer owes and following up before it is late.' },
    { id: 'isp-revenue-assurance', title: 'Revenue assurance for internet providers', text: 'Matching what is provisioned with what is billed.' },
    { id: 'construction-retention', title: 'Retention billing for contractors', text: 'Keeping retention amounts and release dates visible until they are collected.' },
  ],
  exploringNote: 'These are ideas in exploration, not products. Register interest and we will talk to you before anything is built.',
}

export const CONTACT_PAGE = {
  eyebrow: 'Contact',
  heading: 'Describe the problem. A person reads it.',
  lead: 'Use your own words; no jargon needed. Nothing is auto-replied and closed.',
  persistence: 'Your inquiry is saved before anything else happens, so it cannot be lost on the way to us.',
}

export const WORK_INDEX = {
  eyebrow: 'Work',
  heading: 'Real systems, honestly described.',
  lead: 'Each write-up states the problem, the system built for it and what that system verifiably does. Where a result is not something we can evidence, it is not claimed.',
}

export const INSIGHTS_INDEX = {
  eyebrow: 'Insights',
  heading: 'Notes on the problems behind operations work.',
  lead: 'Organised by the problem they address. Some are for owners, some for operations teams, some for engineers.',
}

/** Which service line an article's problem points to (audit UX-09: related solution on articles). */
const PROBLEM_TAG_TO_LINE = {
  'lead-intake': 'lead-intake-and-follow-up',
  'follow-up': 'lead-intake-and-follow-up',
  handoffs: 'workflow-and-ai-automation',
  'silent-failures': 'workflow-and-ai-automation',
  'integration-maintenance': 'workflow-and-ai-automation',
  'data-consistency': 'custom-software-and-operations',
  reporting: 'custom-software-and-operations',
  'choosing-tools': 'custom-software-and-operations',
}

export function serviceLineForProblemTag(tag) {
  const slug = PROBLEM_TAG_TO_LINE[tag]
  return SERVICE_LINES.find((line) => line.slug === slug) || null
}
