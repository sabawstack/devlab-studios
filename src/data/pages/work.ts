import type { PageData } from '../../lib/content/pages'

export const workPage: PageData = {
  slug: 'work',
  title: 'Work',
  status: 'published',
  blocks: [
    {
      type: 'hero',
      props: {
        eyebrow: 'Selected Work',
        heading: 'Business systems, with the decisions, data flow, and handoff explained.',
        subheading: 'Each write-up states the business problem, the system designed for it, and what that system verifiably does. Where a client result is not something we can evidence, it is not claimed.',
        variant: 'editorial',
        iconMotif: 'automation',
        signals: [],
        primaryCta: { label: 'Explore Selected Systems', href: '#selected-systems' },
        secondaryCta: { label: 'Discuss Your System', href: '/contact?type=business_system' },
      },
    },
    {
      type: 'workProjectShowcase',
      props: {
        heading: 'Selected systems',
        subheading: 'A closer look at how each one moves from trigger to verified operational handoff.',
        items: [
          {
            projectId: 'p10-automated-lead-qualification',
            description: 'A real estate lead system that cleans new leads, calls them with an AI voice agent, records the result, and hands qualified sellers to a person.',
            challenge: 'Raw property leads needed consistent validation, qualification, calling, and follow-up without losing context between tools.',
            systemArchitecture: 'Scheduled intake normalizes and deduplicates records, authenticated Retell calls handle outbound conversations, and post-call webhooks analyze transcripts before routing qualified opportunities to a human acquisitions queue.',
            deliveryValue: 'The build turns disconnected lead tasks into a monitored flow with explicit validation, failure paths, and a clear human handoff.',
            status: 'published',
          },
          {
            projectId: 'p11-wholesaling-buyer-intelligence',
            description: 'A deal-intake system that geocodes a property, looks up likely cash buyers, ranks them with AI, and puts the shortlist in a sheet for review.',
            challenge: 'Buyer research required several location, property, skip-trace, and ranking steps that were difficult to repeat consistently by hand.',
            systemArchitecture: 'An n8n workflow geocodes the property, checks a reusable address cache, gathers property and buyer data, normalizes LLC and person contacts, then uses AI-assisted ranking to prepare a focused buyer list.',
            deliveryValue: 'The system keeps data provenance visible while reducing repetitive research and presenting the team with a cleaner shortlist for review.',
            status: 'published',
          },
          {
            projectId: 'p6-messenger-ai-agent',
            description: 'A Messenger agent that filters incoming messages, fetches context, drafts a reply with AI, and runs the follow-up actions.',
            challenge: 'Incoming Messenger conversations needed fast, context-aware replies without allowing an AI response step to control the entire workflow.',
            systemArchitecture: 'Webhook events are filtered and enriched with conversation context, an AI agent drafts the response, controlled HTTP actions trigger downstream work, and the final message returns through the Messenger flow.',
            deliveryValue: 'Deterministic workflow steps retain control of routing and integrations while AI handles the language-heavy part of the interaction.',
            status: 'published',
          },
        ],
      },
    },
    {
      type: 'featuredCaseStudies',
      props: {
        heading: 'Client case studies',
        subheading: 'Published engagements with additional context on the problem, delivery, and result.',
        limit: 6,
      },
    },
    {
      type: 'cta',
      props: {
        heading: 'Have a workflow that should operate like a system?',
        body: 'The first step maps the trigger, rules, data, integrations, failure paths, and human handoff before deciding what should be automated.',
        primaryCta: { label: 'Discuss Your System', href: '/contact?type=business_system' },
      },
    },
  ],
}

export default workPage
