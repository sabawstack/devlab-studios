-- Seed file for CMS-managed non-project content.
-- This mirrors the current static repo content into D1 so Services, Resources,
-- Profile, Site Settings, and SEO can be managed from the CMS/admin.
--
-- Safe usage:
-- 1. Run after 0001_cms_foundation.sql, 0002_project_gallery_images.sql,
--    and 0003_expand_resources_feed.sql.
-- 2. This file intentionally replaces current rows in the CMS content tables below.
-- 3. Projects are seeded separately via project-seed.sql.
-- 4. This file is intentionally D1 Studio-safe, so it does not use
--    BEGIN TRANSACTION / COMMIT statements.

DELETE FROM page_sections;
DELETE FROM pages;
DELETE FROM service_groups;
DELETE FROM articles;
DELETE FROM faqs WHERE page_slug = 'services';
DELETE FROM experiences;
DELETE FROM skills;
DELETE FROM tools;
DELETE FROM workflow_items;
DELETE FROM seo_metadata;
DELETE FROM navigation_items;

INSERT INTO pages (id, slug, title, status, created_at, updated_at) VALUES
  ('page-home', 'home', 'Home', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-about', 'about', 'About', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-services', 'solutions', 'Solutions', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-resources', 'resources', 'Resources', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-profile', 'profile', 'Profile', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-work', 'work', 'Work', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('page-contact', 'contact', 'Contact', 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO page_sections (id, page_id, section_key, section_type, title, content_json, sort_order, status, created_at, updated_at) VALUES
  ('ui-home-hero', 'page-home', 'hero', 'hero', 'Home hero', '{"eyebrow":"Full-Stack Developer & AI Automation Specialist","heading":"From first click to final handoff, build the whole system to move.","subheading":"DevLab Studios connects polished web experiences, dependable APIs, structured data, and AI-powered automation into one clear operating flow.","variant":"system","iconMotif":"fullstack","signals":["React + Astro","Java + Laravel","n8n + Make"],"primaryCta":{"label":"Start a Project","href":"/contact"},"secondaryCta":{"label":"View Work","href":"/work"}}', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ui-about-hero', 'page-about', 'hero', 'hero', 'About hero', '{"eyebrow":"Founded March 2, 2026","heading":"Systems for clearer offers, faster operations, and cleaner handoffs.","subheading":"DevLab Studios helps businesses turn messy workflows into complete digital systems—customer-facing interfaces, dependable services, structured data, and automation that keeps work moving.","variant":"editorial","iconMotif":"fullstack","signals":[],"primaryCta":{"label":"View Services","href":"/solutions"},"secondaryCta":{"label":"Founder Profile","href":"/profile"}}', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO page_sections (id, page_id, section_key, section_type, title, content_json, sort_order, status, created_at, updated_at) VALUES
  ('work-hero', 'page-work', 'hero', 'hero', 'Work hero', '{"eyebrow":"Selected Work","heading":"Automation systems with the decisions, data flow, and handoff explained.","subheading":"Real project write-ups covering the operational problem, system architecture, safeguards, and practical value—not just a gallery of workflow screenshots.","variant":"editorial","iconMotif":"automation","signals":[],"primaryCta":{"label":"Explore Selected Projects","href":"#automation-projects"},"secondaryCta":{"label":"Start a Project Conversation","href":"/contact"}}', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('work-showcase', 'page-work', 'showcase', 'workProjectShowcase', 'Selected Projects', '{"heading":"Selected automation projects","subheading":"A closer look at how each system moves from trigger to verified operational handoff.","items":[{"projectId":"p10-automated-lead-qualification","description":"A three-workflow closed-loop system for real estate lead qualification: scheduled intake normalizes and deduplicates leads before dispatching authenticated outbound AI voice calls via Retell, inbound caller lookup matches phone numbers back to lead records, and post-call webhook processing analyzes transcripts, updates records, and routes qualified opportunities to human acquisitions handoff — with API response validation, failure routing, and monitoring throughout.","challenge":"Raw property leads needed consistent validation, qualification, calling, and follow-up without losing context between tools.","systemArchitecture":"Scheduled intake normalizes and deduplicates records, authenticated Retell calls handle outbound conversations, and post-call webhooks analyze transcripts before routing qualified opportunities to a human acquisitions queue.","deliveryValue":"The build turns disconnected lead tasks into a monitored flow with explicit validation, failure paths, and a clear human handoff.","status":"published"},{"projectId":"p11-wholesaling-buyer-intelligence","description":"n8n deal-intake system that geocodes property addresses, checks a 15-day address cache, looks up property and buyer data, skip-traces LLC and person routes, normalizes contacts, and uses AI to rank the best cash buyers into Google Sheets.","challenge":"Buyer research required several location, property, skip-trace, and ranking steps that were difficult to repeat consistently by hand.","systemArchitecture":"An n8n workflow geocodes the property, checks a reusable address cache, gathers property and buyer data, normalizes LLC and person contacts, then uses AI-assisted ranking to prepare a focused buyer list.","deliveryValue":"The system keeps data provenance visible while reducing repetitive research and presenting the team with a cleaner shortlist for review.","status":"published"},{"projectId":"p6-messenger-ai-agent","description":"Webhook-based Messenger agent that filters events, fetches context, generates AI replies, triggers downstream actions via HTTP, and responds back through the webhook flow.","challenge":"Incoming Messenger conversations needed fast, context-aware replies without allowing an AI response step to control the entire workflow.","systemArchitecture":"Webhook events are filtered and enriched with conversation context, an AI agent drafts the response, controlled HTTP actions trigger downstream work, and the final message returns through the Messenger flow.","deliveryValue":"Deterministic workflow steps retain control of routing and integrations while AI handles the language-heavy part of the interaction.","status":"published"}]}', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('work-case-studies', 'page-work', 'case-studies', 'featuredCaseStudies', 'Client Case Studies', '{"heading":"Client case studies","subheading":"Published engagements with additional context on the problem, delivery, and result.","limit":6}', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('work-cta', 'page-work', 'cta', 'cta', 'Work CTA', '{"heading":"Have a workflow that should operate like a system?","body":"We can map the trigger, rules, data, integrations, failure paths, and human handoff before deciding what should be automated.","primaryCta":{"label":"Start a Project","href":"/contact"}}', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO service_groups (
  id, eyebrow, title, description, icon, capabilities, project_ids, sort_order, status, created_at, updated_at
) VALUES
  (
    'customer-response-ai-agents',
    'Customer Response',
    'Customer Response & AI Agents',
    'AI-assisted messaging, customer follow-up, and response systems that keep leads and clients moving without waiting on manual replies.',
    'MessageSquare',
    '["Facebook Messenger AI agents","Escalation and quote follow-up emails","AI-assisted support and response workflows","Context-aware reply generation and routing"]',
    '["p6-messenger-ai-agent","p2-escalation-email","p2-quote-follow-up"]',
    10,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'lead-intake-scheduling',
    'Intake',
    'Lead Intake & Scheduling Automation',
    'Systems that capture inquiries, qualify leads, prepare context, and route next steps before work gets stuck in inboxes or calendars.',
    'Zap',
    '["Webhook-based lead enrichment","Booked-calendar intake workflows","AI call transcript qualification","Priority routing and stakeholder alerts","CRM, sheet, and task handoff logic"]',
    '["p10-automated-lead-qualification","p3-leads-enrichment","p9-guest-researcher-calendar-client"]',
    20,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'operations-data-workflows',
    'Operations',
    'Operations & Data Workflows',
    'Backend-friendly automation for files, finance records, location data, task systems, and reporting handoffs across business tools.',
    'Settings',
    '["Buyer ranking and contact enrichment","Xero transaction export and task handoff","Gmail attachment sorting and metadata logging","Geocoding and structured review pipelines","Google Sheets, Drive, Asana, and API integrations"]',
    '["p11-wholesaling-buyer-intelligence","p4-xero-to-asana","p5-gmail-attachments-drive","p8-arv-enterprise-geocoding"]',
    30,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'content-growth-automation',
    'Growth',
    'Content & Growth Automation',
    'Automations that help teams generate, route, check, and publish content without rebuilding the same campaign steps manually.',
    'Lightbulb',
    '["Content repurposing from uploaded assets","AI social content generation","Duplicate checks and publishing safeguards","Facebook, LinkedIn, Drive, and Sheets flows"]',
    '["p1-content-repurposing","p7-ai-social-content"]',
    40,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'web-business-interfaces',
    'Web Systems',
    'Web & Business Interfaces',
    'Conversion pages, business websites, ecommerce concepts, local-service pages, and full-stack UI samples built around clear offers and workflows.',
    'Code2',
    '["React and Tailwind landing pages","Local service lead-generation pages","E-commerce product landing flows","Full-stack dashboard and contact interface samples"]',
    '["w1-react-modern","w5-local-service","w6-ecommerce","w4-laravel-fullstack"]',
    50,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO articles (
  id, slug, title, summary, category, content_type, icon, points, body_markdown, cover_image_url, tags_json,
  author_name, published_at, reading_time_minutes, is_featured, sort_order, status, created_at, updated_at
) VALUES
  (
    'ai-automation-small-business-workflows',
    'ai-automation-small-business-workflows',
    'Where AI automation fits in small business workflows',
    'A practical guide to finding repetitive, high-friction tasks where automation can improve speed, consistency, and handoff quality.',
    'Strategy',
    'guide',
    'Lightbulb',
    '["Missed follow-ups","Manual routing","Repeated summaries","Disconnected tools"]',
    '## Start with repeated operational friction

Most small businesses do not need AI everywhere. They need it where work gets delayed, repeated, or dropped between tools. The best candidates usually appear in places where the same information is rewritten, triaged, summarized, or forwarded by hand.

## Look for tasks with predictable inputs

Good early automation targets often include lead intake, follow-up reminders, inbox classification, transcript summaries, file routing, CRM updates, and spreadsheet logging. These workflows already have a clear trigger and a known destination, which means they can be mapped, tested, and improved without guessing.

## Use AI where judgment is lightweight but useful

AI fits best when a workflow benefits from interpretation rather than strict rules alone. Common examples include drafting first replies, extracting key details from calls, classifying inquiries, ranking opportunities, or converting long text into shorter operational summaries.

- Draft responses that a human can approve
- Extract key fields from call transcripts or forms
- Classify requests by urgency, intent, or department
- Summarize activity into notes for CRM or task systems

## Keep business rules outside the prompt where possible

If a process depends on exact routing, deadlines, permissions, or financial logic, keep those decisions in the workflow layer. Use AI for interpretation, then let deterministic logic decide what happens next. That keeps the system easier to debug and safer to hand off.

## Design for handoff, not novelty

The strongest automation systems do not just save time on day one. They make the process clearer for the next person who owns it. Document the trigger, the expected input, the AI step, the validation rule, and the destination system. That is what makes automation operational rather than experimental.',
    '',
    '["AI Automation","Small Business","Workflow Mapping"]',
    'DevLab Studios',
    '2026-07-01',
    6,
    1,
    10,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'zapier-make-n8n-comparison',
    'zapier-make-n8n-comparison',
    'When to use Zapier, Make, or n8n',
    'How to choose an automation platform based on workflow complexity, maintainability, integrations, and technical control.',
    'Tools',
    'guide',
    'Settings',
    '["Simple app triggers","Router-heavy flows","Self-hosted control","API-heavy builds"]',
    '## Pick the platform that matches the maintenance model

The wrong automation platform usually fails in maintenance, not in the first demo. The real question is not which tool can connect two apps. It is which tool your team can understand, monitor, and change six months later.

## Use Zapier for straightforward business automation

Zapier is usually the cleanest choice when the workflow is mostly app-to-app and the team wants a fast setup with low technical overhead. It works well for CRM updates, inbox triggers, simple lead routing, and notification chains.

## Use Make when the flow needs more branching and transformation

Make is stronger when the workflow needs routers, payload shaping, intermediate processing, and clearer visual branching. It is often a better fit when the business logic is more complex than "if this, then that" but does not require custom-hosted control.

## Use n8n when API flexibility and system ownership matter

n8n becomes attractive when the workflow is API-heavy, when you want more control over execution logic, or when the process needs custom nodes, agent flows, or self-hosted options. It is usually the better platform when the automation starts to resemble a backend service.

- Zapier: fastest setup for simpler workflows
- Make: visual branching and payload shaping
- n8n: control, extensibility, and API-first builds

## Decide based on failure handling

Before choosing any platform, ask how the workflow will fail. What happens if an API times out, a sheet row is malformed, or an AI step returns incomplete output? The best platform is the one that gives you the right level of visibility and intervention for the actual business risk.',
    '',
    '["Zapier","Make","n8n","Tool Selection"]',
    'DevLab Studios',
    '2026-06-28',
    5,
    0,
    20,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'lead-intake-automation-checklist',
    'lead-intake-automation-checklist',
    'Lead intake automation checklist',
    'A checklist for capturing, qualifying, enriching, routing, and following up with inbound leads before opportunities get cold.',
    'Lead Systems',
    'guide',
    'Search',
    '["Capture source","Qualification logic","Priority routing","CRM or sheet logging"]',
    '## Capture the source and context together

Lead systems break when the record arrives without enough context for the next action. The intake should capture not only the contact information, but also the source, offer, urgency, and any notes that explain why the lead matters.

## Define what qualifies a lead before you automate follow-up

Qualification should not be left vague. Decide what makes a lead ready for sales, ready for nurture, or ready for a manual review. That can include budget indicators, service fit, response intent, property criteria, or timeline.

## Enrich only what will actually be used

Do not enrich for the sake of completeness. Pull only the fields that change the next decision. That might be company details, location data, owner information, message category, or channel history.

## Route by urgency and ownership

Every intake flow should answer two questions quickly:

- Who owns this lead next?
- How fast should someone act?

That means routing high-priority leads to the right human, logging everything for audit visibility, and triggering the correct follow-up sequence automatically.

## Build a close-the-loop check

The workflow should confirm that the lead was actually written to the destination system. Whether the destination is a CRM, a Google Sheet, or a task board, the automation should fail loudly if the write step does not complete. That is the difference between automation that looks impressive and automation that can be trusted.',
    '',
    '["Lead Intake","CRM","Qualification"]',
    'DevLab Studios',
    '2026-06-24',
    5,
    0,
    30,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'ai-agents-vs-workflow-automations',
    'ai-agents-vs-workflow-automations',
    'AI agents vs workflow automations',
    'A clear distinction between deterministic automations and AI agents that reason through context, messages, and multi-step tasks.',
    'AI Agents',
    'guide',
    'Zap',
    '["Fixed workflow","Context-aware response","Human review","Tool execution"]',
    '## Workflow automation is about control

Traditional automation is best when the steps are known in advance. A trigger happens, rules are applied, and the workflow follows a reliable path. This is the right model for notifications, routing, logging, field updates, and approvals.

## AI agents are about interpretation inside a workflow

An AI agent is useful when the system needs to evaluate context before deciding what to do. That might include understanding a message, comparing multiple options, drafting a response, or deciding which tool to call next.

## Most business systems need both

The practical pattern is not agent versus automation. It is agent inside automation. Let the deterministic workflow own the sequence, the permissions, and the destinations. Let the agent handle the messy input where language, ambiguity, or context matters.

- Automation controls sequence and system rules
- AI handles interpretation and drafting
- Human review stays where risk is high

## Use agents only where the ambiguity is real

If a step can be handled with a simple rule, use a rule. Agents should not replace straightforward logic. They should reduce the manual work that exists because the input is too inconsistent for strict branching alone.',
    '',
    '["AI Agents","Automation Design","Operations"]',
    'DevLab Studios',
    '2026-06-20',
    4,
    0,
    40,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'preparing-business-data-for-automation',
    'preparing-business-data-for-automation',
    'Preparing business data for automation',
    'What to clean, structure, and document before connecting spreadsheets, CRMs, inboxes, APIs, and task systems.',
    'Data Readiness',
    'guide',
    'Shield',
    '["Stable fields","Clean ownership","Error handling","Audit visibility"]',
    '## Automation inherits the quality of the source data

If the records are inconsistent, duplicated, or poorly owned, automation will move bad data faster. Before connecting tools, decide which fields are mandatory, which system owns each field, and which values are allowed.

## Standardize identifiers first

The most common integration issues happen because names are not enough. A workflow should rely on stable identifiers wherever possible: task IDs, CRM record IDs, email addresses, property IDs, or internal keys.

## Document the update rules

It should be clear when a workflow creates a new record, updates an existing one, or skips the action entirely. Without that rule, teams end up with duplicate records, overwritten notes, and inconsistent reporting.

## Make errors observable

Business data workflows need visibility. A failed write should not disappear into the background. Log the error, preserve the source payload if needed, and send the failure to a human when it blocks a customer-facing step.

## Build with operational ownership in mind

Every connected workflow should have an owner. If a sheet column changes, an API credential expires, or a field is renamed, someone should know where to look and what breaks next. That is part of system design, not an afterthought.',
    '',
    '["Data Quality","Operations","Implementation"]',
    'DevLab Studios',
    '2026-06-16',
    5,
    0,
    50,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'what-better-ai-models-change-for-ops',
    'what-better-ai-models-change-for-ops',
    'What better AI models change for operations teams',
    'As language models improve, the strongest gains come from better classification, clearer summaries, and more dependable first-pass drafting inside existing business workflows.',
    'AI Updates',
    'news',
    'TrendingUp',
    '["Better extraction","Cleaner summaries","Fewer manual rewrites","More usable first drafts"]',
    '## The important improvement is not novelty

For operations teams, the value of stronger AI models is rarely that they can do something completely new. The value is that they are more dependable at tasks businesses already wanted automated: summarizing, extracting, ranking, and drafting.

## Better models reduce cleanup work

When the first draft is cleaner, the human reviewer spends less time repairing tone, structure, or missing context. That matters in support queues, lead qualification, call note generation, and internal documentation workflows.

## Stronger reasoning improves edge-case handling

The biggest operational gain often shows up in messy inputs. Messages with mixed intent, long transcripts, partial forms, and inconsistent formatting become easier to interpret correctly, which improves the quality of downstream routing.

## The workflow still matters more than the model alone

Even with stronger AI, the system needs clear prompts, defined destinations, validation checks, and ownership. Better models widen what is practical, but they do not replace workflow design.',
    '',
    '["AI News","Operations","Practical Use"]',
    'DevLab Studios',
    '2026-07-05',
    4,
    0,
    60,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'why-website-speed-and-automation-now-overlap',
    'why-website-speed-and-automation-now-overlap',
    'Why website speed and automation now overlap',
    'Faster websites do more than improve page experience. They also strengthen the workflows connected to forms, callbacks, analytics, and CRM handoffs.',
    'Web Systems',
    'insight',
    'Globe',
    '["Fewer abandoned forms","Cleaner event tracking","Better handoff timing","Less operational noise"]',
    '## Frontend performance affects backend operations

When forms lag, scripts load late, or events misfire, the problem is not only visual. It affects lead quality, event tracking, attribution, and the reliability of the automations downstream.

## Good websites create cleaner operational signals

If the UI is responsive and the form flow is clear, the data entering the system is usually more complete and more consistent. That means fewer broken automations and less manual recovery work.

## Conversion systems are now cross-functional

The website, the CRM, the automation layer, and the response workflow all depend on each other. Treating the landing page as separate from operations usually creates a gap right where the handoff should be strongest.',
    '',
    '["Website Performance","Automation","Conversion"]',
    'DevLab Studios',
    '2026-07-03',
    3,
    0,
    70,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO faqs (
  id, page_slug, question, answer, sort_order, status, created_at, updated_at
) VALUES
  (
    'services-faq-custom-solutions',
    'services',
    'Are these fixed products or custom solutions?',
    'Most DevLab Studios solutions are custom builds using proven patterns. The starting point is the business problem, then the implementation is scoped around the tools, data, and workflow already in use.',
    10,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'services-faq-zapier-make-n8n',
    'services',
    'Can you work with Zapier, Make, and n8n?',
    'Yes. Solutions can be built with Zapier, Make, n8n, or direct API integrations depending on complexity, maintainability, and what the workflow requires.',
    20,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'services-faq-only-ai',
    'services',
    'Do you only build AI automations?',
    'No. AI is used where it creates leverage, such as drafting, summarizing, classifying, or responding. Many solutions also include websites, backend services, dashboards, CRM logic, or internal tools.',
    30,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'services-faq-best-fit',
    'services',
    'How do I know which solution fits?',
    'Start with the workflow that wastes the most time or loses the most opportunities. A discovery conversation can identify whether the best first move is a website, an automation, an AI agent, or a backend integration.',
    40,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO experiences (
  id, title, role, company, dates, bullets, image_url, sort_order, status, created_at, updated_at
) VALUES
  (
    'ai-automation-specialist',
    'Technical VA Work Experience',
    'AI Automation Specialist (Freelance / Part-Time)',
    'Self-Employed - Remote',
    'September 2024 - Present',
    '["Designed, built, and optimized automation workflows for small businesses using Make.com, Zapier, n8n, and HighLevel.","Developed AI-powered systems for data summarization, lead qualification, content drafting, and customer response automation using tools like OpenAI and Claude.","Integrated CRMs, spreadsheets, forms, and communication platforms to streamline lead management, task assignment, and internal processes.","Created automated email/SMS follow-up sequences, tagging systems, and pipeline updates for marketing and client engagement.","Troubleshooted broken workflows, identified bottlenecks, and rebuilt processes for improved reliability and scalability.","Documented SOPs, workflow maps, and automation guidelines to support smooth team operations and handovers.","Set up dashboards, trackers, and structured databases in Google Sheets, Notion, and Airtable for reporting and operational visibility.","Coordinated with clients to gather workflow requirements, analyze business needs, and implement step-by-step process improvements."]',
    '',
    10,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'accenture-java',
    'Professional Experience',
    'Custom Software Engineer Associate (Java)',
    'Accenture - eBloc 2, W Geonzon St., Cebu City, Cebu',
    'June 2025 - Present',
    '["Develop and maintain backend solutions for enterprise and client-facing websites and applications using Java, Spring Boot, and RESTful APIs.","Collaborate with cross-functional teams to design, implement, and deploy scalable backend services.","Integrate databases, authentication, and third-party services to support dynamic and secure web platforms.","Participate in code reviews, debugging, and performance optimization to ensure high-quality deliverables.","Contribute to documentation and best practices to support maintainability and knowledge sharing."]',
    '',
    20,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'process-engineer',
    'Professional Experience',
    'Process Engineer I',
    'ONSEMI - MEPZ 1, IBO, Lapu-Lapu City, Cebu',
    'September 2024 - June 2025',
    '["Handled electroplating process operations.","Conducted experiments to evaluate and optimize processes, including data collection, processing, and analysis.","Performed root cause analysis and established corrective, containment, and preventive measures for nonconforming products.","Evaluated process output in real-time for priority products and devices.","Organized and executed qualification of new direct and indirect materials used in production processes.","Defined and analyzed process parameters; analyzed yield and loss trends to support yield enhancement initiatives.","Deployed: Plating Loss Monitoring (Power BI-based dashboard for weekly plating-related losses)."]',
    '',
    30,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'manufacturing-engineer',
    'Professional Experience',
    'Manufacturing Engineer I (A 6-Month NCG Program)',
    'ONSEMI - MEPZ 1, IBO, Lapu-Lapu City, Cebu',
    'January 2024 - July 2024',
    '["Designed, built, and implemented stand-alone web applications to greatly improve manufacturing execution.","Supported manufacturing requirements sets and Manufacturing Execution System (MES) models.","Proactively deployed system improvements as site requirements changed to ensure smooth operations.","Actively participated in continuous enhancement of manufacturing processes by applying creative, technologically advanced solutions.","Deployed: Maintenance Online Logbook (website for maintenance operations to track machine downtime issues and tooling replacement logging for better data analysis and visualization).","Deployed: Fire Extinguisher Online Inspection (website for EHS personnel with QR codes to streamline fire extinguisher inspections in the manufacturing plant).","Built and supported data-driven web and automation solutions involving API integrations, structured payload handling, SQL-backed workflows, and modern TypeScript/React-based frontend delivery."]',
    '',
    40,
    'published',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO skills (
  id, category, label, sort_order, status, created_at, updated_at
) VALUES
  ('technical-1', 'technical', 'Java', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-2', 'technical', 'JavaScript', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-3', 'technical', 'TypeScript', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-4', 'technical', 'PHP', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-5', 'technical', 'SQL', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-6', 'technical', 'HTML + CSS', 60, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-7', 'technical', 'Spring Boot', 70, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-8', 'technical', 'Laravel', 80, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-9', 'technical', 'REST APIs', 90, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-10', 'technical', 'API Integrations', 100, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-11', 'technical', 'ReactJS', 110, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-12', 'technical', 'Next.js', 120, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-13', 'technical', 'Tailwind CSS', 130, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-14', 'technical', 'PostgreSQL-style schema design', 140, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-15', 'technical', 'Google Sheets', 150, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-16', 'technical', 'Airtable', 160, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-17', 'technical', 'n8n', 170, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-18', 'technical', 'Make.com', 180, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-19', 'technical', 'Zapier', 190, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-20', 'technical', 'HighLevel', 200, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-21', 'technical', 'Git + GitHub', 210, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-22', 'technical', 'Postman', 220, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-23', 'technical', 'Vercel', 230, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('technical-24', 'technical', 'AI-assisted workflows', 240, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('personal-1', 'personal', 'Excellent written and verbal communication', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('personal-2', 'personal', 'Highly organized and efficient', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('personal-3', 'personal', 'Works independently and in a team', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('personal-4', 'personal', 'Adapts quickly to change', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('personal-5', 'personal', 'Leadership and team motivation', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO tools (
  id, label, icon, sort_order, status, created_at, updated_at
) VALUES
  ('react', 'React', 'Code2', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('tailwind', 'Tailwind CSS', 'Lightbulb', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('vite', 'Vite', 'Settings', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('router', 'React Router', 'ArrowRight', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('github', 'GitHub + Git', 'Briefcase', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('cloudflare', 'Cloudflare Pages', 'Shield', 60, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('zapier', 'Zapier', 'Zap', 70, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('make', 'Make (Integromat)', 'Settings', 80, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('n8n', 'n8n', 'Wrench', 90, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('google', 'Google Workspace', 'Mail', 100, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('notion', 'Notion / Airtable', 'Lightbulb', 110, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('apis', 'API Integrations', 'Code2', 120, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('openai', 'OpenAI / AI Tools', 'Robot', 130, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('highlevel', 'GoHighLevel', 'Briefcase', 140, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO workflow_items (
  id, group_name, label, icon, sort_order, status, created_at, updated_at
) VALUES
  ('website-discovery', 'patterns', 'Website discovery, section planning, and conversion flow setup', 'Code2', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('landing-builds', 'patterns', 'Landing page implementation with responsive UI patterns', 'ArrowRight', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('multi-step-routers', 'patterns', 'Multi-step automation with routers & conditions', 'Zap', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ai-assisted', 'patterns', 'AI-assisted content & response systems', 'Lightbulb', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('crm-pipeline', 'patterns', 'CRM-connected lead pipelines', 'Briefcase', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('ops-webhooks', 'patterns', 'Email, forms, sheets, and webhook-driven operations', 'Mail', 60, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('website-automation-bridge', 'patterns', 'Website + automation handoff (forms to CRM and follow-up)', 'Settings', 70, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('reliable', 'characteristics', 'Reliable & documented', 'CheckCircle2', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('handoff', 'characteristics', 'Easy to hand off', 'ArrowRight', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('scalable', 'characteristics', 'Scalable & modular', 'Settings', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('error-aware', 'characteristics', 'Error-aware & monitored', 'Shield', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('conversion-minded', 'characteristics', 'Conversion-minded UX decisions', 'Lightbulb', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('launch-ready', 'characteristics', 'Launch-ready and deployment-safe', 'Shield', 60, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO navigation_items (
  id, label, href, sort_order, status, created_at, updated_at
) VALUES
  ('nav-home', 'Home', '/', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nav-services', 'Solutions', '/solutions', 20, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nav-work', 'Work', '/work', 30, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nav-resources', 'Insights', '/insights', 40, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nav-about', 'About', '/about', 50, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('nav-profile', 'Profile', '/profile', 60, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO seo_metadata (
  id, page_slug, meta_title, meta_description, meta_keywords, canonical_url, og_title, og_description, og_image, twitter_title, twitter_description, twitter_image, created_at, updated_at
) VALUES
  (
    'seo-home',
    'home',
    'DevLab Studios - Software & Automation Systems for Businesses',
    'DevLab Studios builds reliable software and automation systems for businesses: conversion websites, lead intake and follow-up, CRM workflows, backend services, APIs, and AI automation.',
    'business automation systems, lead intake automation, workflow automation, CRM integration, custom business software, AI automation for business, backend integration, internal tools, DevLab Studios',
    'https://www.devlabstudios.com/',
    'DevLab Studios - Software & Automation Systems for Businesses',
    'Conversion websites, backend services, structured data, CRM workflows, and AI automation connected into maintainable business systems.',
    'https://www.devlabstudios.com/og.png',
    'DevLab Studios - Software & Automation Systems for Businesses',
    'Lead intake and follow-up, workflow and AI automation, and custom operations software built to stay maintainable.',
    'https://www.devlabstudios.com/og.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'seo-about',
    'about',
    'About DevLab Studios - Software Engineering & AI Automation',
    'Learn about DevLab Studios, founded March 2, 2026, a software engineering and AI automation studio building websites, integrations, and workflow systems for modern businesses.',
    'DevLab Studios, software engineering studio, AI automation studio, business automation, website development, workflow automation, backend integrations',
    'https://www.devlabstudios.com/about',
    'About DevLab Studios - Software Engineering & AI Automation',
    'DevLab Studios builds conversion websites, backend integrations, and AI automation systems around real business workflows.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    'About DevLab Studios',
    'A practical software engineering and AI automation studio founded on March 2, 2026.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'seo-services',
    'solutions',
    'Services - Business Automation & Web Solutions | DevLab Studios',
    'Explore DevLab Studios services for websites, business automation, backend integrations, CRM-connected workflows, and custom internal tools.',
    'business automation services, website development services, backend integration services, CRM workflows, DevLab Studios services',
    'https://www.devlabstudios.com/solutions',
    'Services - Business Automation & Web Solutions | DevLab Studios',
    'Websites, backend systems, AI automation, and workflow support designed around real business operations.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    'Services - DevLab Studios',
    'Business automation, websites, backend support, and workflow system services from DevLab Studios.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'seo-insights',
    'insights',
    'Resources - AI, Automation & Web Systems Feed | DevLab Studios',
    'Read DevLab Studios resources covering practical automation guides, AI updates, website systems, operations insights, and implementation notes for modern business workflows.',
    'AI automation resources, workflow guides, automation news, website systems insights, operations playbook, DevLab Studios resources',
    'https://www.devlabstudios.com/insights',
    'Resources - AI, Automation & Web Systems Feed | DevLab Studios',
    'A feed of practical guides, AI updates, web systems notes, and operational implementation insights.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    'Resources - AI, Automation & Web Systems Feed',
    'DevLab Studios feed for automation systems, AI updates, web delivery, and operational implementation.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'seo-profile',
    'profile',
    'Profile - Stephen Rey Agustinez | DevLab Studios',
    'Profile of Stephen Rey Agustinez, founder of DevLab Studios, software engineer and AI automation specialist building websites, backend integrations, and business automation systems.',
    'Stephen Rey Agustinez profile, DevLab Studios founder, software engineer portfolio, AI automation specialist, React Laravel automation portfolio',
    'https://www.devlabstudios.com/profile',
    'Profile - Stephen Rey Agustinez | DevLab Studios',
    'Founder profile, experience, skills, and selected website and automation projects from DevLab Studios.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    'Profile - Stephen Rey Agustinez | DevLab Studios',
    'Software engineer and AI automation specialist profile with experience, skills, and project portfolio.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'seo-contact',
    'contact',
    'Hire a Software Engineer & AI Automation Specialist | Contact Devlab Studios',
    'Get in touch with Devlab Studios for software engineering, website builds, backend integrations, or AI automation projects. Available for remote work worldwide across Java, Laravel, React, Next.js, and workflow systems.',
    'hire software engineer, hire AI automation specialist, backend developer for hire, Java Spring Boot developer, Laravel developer, API integration specialist, remote developer hire, business automation consultant',
    'https://www.devlabstudios.com/contact',
    'Hire a Software Engineer & AI Automation Specialist | Contact Devlab Studios',
    'Hire Devlab Studios for software engineering, websites, backend integrations, or AI automation projects. Remote-first, available worldwide.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    'Hire a Software Engineer & AI Automation Specialist | Contact Devlab Studios',
    'Hire Devlab Studios for software engineering, backend integrations, websites, or AI automation. Remote-first, available worldwide.',
    'https://www.devlabstudios.com/devlabstudios-logo-only.png',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

INSERT INTO site_settings (key, value_json, updated_at) VALUES
  (
    'services_process_steps',
    '[{"id":"map-workflow","title":"Map the workflow","description":"Review the current process, tools, handoffs, and friction before recommending a solution.","icon":"Lightbulb","sortOrder":10},{"id":"build-system","title":"Build the system","description":"Implement the website, automation, integration, or internal workflow in practical delivery phases.","icon":"Wrench","sortOrder":20},{"id":"validate-handoff","title":"Validate and hand off","description":"Test reliability, document the flow, and make the system understandable for real operations.","icon":"CheckCircle2","sortOrder":30}]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'resources_playbook',
    '["Map one workflow from trigger to final handoff.","Identify where work waits on a person, inbox, or spreadsheet.","Define what should be automated, drafted, routed, or only reported.","Keep humans in the loop where risk, judgment, or client trust matters."]',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'profile_about',
    '{"name":"Stephen Rey G. Agustinez","role":"Full-Stack Developer & AI Automation Specialist","location":"Lapu-Lapu City, Cebu, Philippines","email":"hello@devlabstudios.com","resumeLink":"/resume.pdf","about":"Full-stack developer and AI automation specialist building end-to-end systems across React and Astro interfaces, Java and Laravel services, REST APIs, SQL-backed data flows, n8n workflows, and AI agents. I connect every layer from customer experience to operational handoff so systems remain useful, reliable, and maintainable.","education":[{"program":"Bachelor of Science in Computer Engineering","school":"University of Science and Technology of Southern Philippines, Lapasan, Cagayan de Oro City","years":"2019 - 2023"},{"program":"STEM Strand","school":"Liceo de Cagayan University - Senior High School, R.N.P. Blvd., Kauswagan, Cagayan de Oro City","years":"2017 - 2019"}],"achievementsAndResponsibilities":[{"title":"System Integrator / Programmer, Design 2 - Thesis","details":"Design and Development of Air Pollution Monitoring System in University of Science and Technology of Southern Philippines (2023)."},{"title":"Front-end Developer, Capstone Project","details":"Fishing Ban Report App for Lanao del Norte (2021-2022)."}],"certificatesAndLicenses":[{"name":"CCNA: Enterprise Networking, Security, and Automation","issuer":"Cisco","date":"June 2022"},{"name":"Google Technical Support Fundamentals","issuer":"Google","date":"February 2023"},{"name":"Introduction to Cybersecurity Tools & Cyber Attacks","issuer":null,"date":"September 2020"},{"name":"Using Google Forms to Analyze User Research Data","issuer":null,"date":"2020"},{"name":"OWASP Top 10: Securing Web Applications","issuer":"OWASP","date":"2025"},{"name":"CCSP 2019: Identity & Access Management","issuer":null,"date":"June 2025"},{"name":"CCSP 2019: Application Development & Security","issuer":null,"date":"June 2025"}]}',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'site_ctas',
    '{"navbarContactLabel":"Discuss Your System","mobileContactLabel":"Discuss Your System"}',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  (
    'site_footer',
    '{"companyName":"DevLab Studios","tagline":"Your Vision, Digitally Crafted — one solution at a time, always evolving.","email":"hello@devlabstudios.com","location":"Lapu-Lapu City, Cebu, PH","quickLinks":[{"label":"Home","href":"/"},{"label":"About","href":"/about"},{"label":"Services","href":"/solutions"},{"label":"Resources","href":"/insights"},{"label":"Profile","href":"/profile"},{"label":"Contact","href":"/contact"}],"socialLinks":[{"label":"LinkedIn","href":"https://www.linkedin.com/in/stephen-rey-agustinez-8b86041b3"},{"label":"GitHub","href":"https://github.com/stpn-dev"},{"label":"Email","href":"mailto:hello@devlabstudios.com"}],"legalLinks":[{"label":"Privacy Policy","href":"/privacy"},{"label":"Terms of Service","href":"/terms"}],"copyright":"(c) 2026 DevLab Studios. All rights reserved."}',
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(key) DO UPDATE SET
  value_json = excluded.value_json,
  updated_at = excluded.updated_at;
