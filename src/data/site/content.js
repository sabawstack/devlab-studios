// Copy for the redesigned marketing pages (audit BUS-01, BR.3, F.2, F.5).
//
// Written to the audit's rules: one idea per sentence, short headings, the
// operational result before the mechanism, no stack names on the home page or
// the solutions index, no number that cannot be sourced, the founder named at
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

export const HOME = {
  hero: {
    eyebrow: 'DevLab Studios · operations software',
    heading: 'We build and run the systems behind your inquiries, handoffs and reports.',
    lead: 'One accountable engineer, production-grade practices, and systems your own team can operate.',
    primary: { label: 'Discuss your system', href: '/contact' },
    secondary: { label: 'See the work', href: '/work' },
  },
  problems: {
    eyebrow: '§1 The problem',
    heading: 'Work goes missing between tools.',
    text: 'Inquiries land in four places, nobody owns them, and follow-up depends on someone remembering. We draw what is happening, then build the version where nothing is lost.',
  },
  solutions: {
    eyebrow: '§2 What we build',
    heading: 'Three kinds of system. One way to start.',
  },
  work: {
    eyebrow: '§3 Work',
    heading: 'Systems already running.',
    text: 'Each write-up shows the problem, the system and what it verifiably does. Results we cannot evidence are not claimed.',
  },
  reliability: {
    eyebrow: '§4 How we build',
    heading: 'Built to fail visibly, not silently.',
    text: 'This site runs on the same rules. Its own inquiry form saves before it sends, and every delivery is logged.',
  },
  start: {
    eyebrow: '§5 Start here',
    heading: 'Not sure what to fix first?',
    text: 'The audit reviews one workflow end to end and ends in a written recommendation, whether or not we build it.',
  },
  founder: {
    text: 'DevLab Studios is run by Stephen Rey Agustinez, a full-stack engineer in Cebu, Philippines, working with clients remotely.',
    linkLabel: 'Read the founder profile',
  },
  final: {
    heading: 'Tell us about the system you need.',
    text: 'A person reads every inquiry. Nothing is auto-replied and closed.',
    primary: { label: 'Discuss your system', href: '/contact' },
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
