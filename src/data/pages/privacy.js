// Standard privacy policy boilerplate reflecting what this site actually
// does technically (contact form fields, Resend delivery, GA4 config) —
// not invented legal claims. Flagged for legal review before being
// treated as final; see docs/content-model.md.
export const privacyPage = {
  slug: 'privacy',
  title: 'Privacy Policy',
  status: 'published',
  blocks: [
    {
      type: 'hero',
      props: {
        eyebrow: 'Legal',
        heading: 'Privacy Policy',
        subheading: 'Last updated: November 12, 2026. What this website collects, why, where it goes, and how long it is kept.',
      },
    },
    {
      type: 'richText',
      props: {
        body: `## Who we are

This site is run by DevLab Studios, operated by Stephen Rey Agustinez, Cebu, Philippines. Contact: hello@devlabstudios.com. This page describes what the site actually does with personal information. It is pending legal review and does not claim compliance with any particular law.

## Inquiry and contact forms

When you send an inquiry we store what you type: your name, email address, company and website if given, phone if given, your message, and the optional details the form asks for (current workflow and tools, the result you want, timeline, budget range, team size, volume, preferred contact method; or, for an employment inquiry, the role and arrangement). We also store the consent you gave, the page and campaign that brought you (see "Attribution" below), and a record of each attempt to notify us.

Your inquiry is saved before anything is sent. We are then notified by email through Resend, our transactional email provider, and, if we have connected one, our own automation or CRM receives a copy through a signed webhook. Forms are protected by Cloudflare Turnstile, which checks that a person, not a script, is submitting.

## Confirmation emails

After you submit, we may email you one confirmation per address per 24 hours. To enforce that limit we keep a one-way hash of your address, never the address itself, for that purpose.

## Attribution

To know which pages and campaigns lead to inquiries, your browser keeps three small items in its own storage: a random identifier (devlab.aid), the first campaign parameters you arrived with (devlab.first_touch), and the first page of your visit (devlab.entry_page). They are sent only with an inquiry you submit. They are not cookies and are not shared with advertisers.

## Analytics

The site uses Google Analytics 4 to count page views and events such as a form being started. It is configured with Google's client-side storage turned off and IP anonymisation on, so it sets no analytics cookies. Cloudflare, which hosts the site, also sees standard request information (such as IP address and browser) to deliver and protect it.

## Correspondence

Email sent to our devlabconnect.com addresses is received and stored in our own mailbox system so we can read and reply to it.

## Prospect research

We research businesses that may need our services, using information those businesses publish themselves (for example on their websites). We do not send automated email: any message is written or approved by a person, includes a way to opt out, and an opt-out is honoured permanently. To make sure we never contact you again after you opt out, we keep a minimal suppression record of the address or domain.

## Devlab Pickleball host accounts

Hosts who sign in to save sessions do so with Google, which gives us your Google account identifier, name and email. You may add a DUPR club ID for exports. A sign-in lasts 30 days. Session data is described in the open-play section below.

## How long we keep it

- Inquiries: until they are no longer needed to respond to you and follow up, or until you ask us to delete them. An automatic schedule to delete closed inquiries after 24 months is being introduced.
- Confirmation-limit hashes: intended to be deleted after 30 days.
- Correspondence: until it is no longer needed or you ask us to delete it.
- Suppression records: kept, so that an opt-out keeps working.
- Backups: a backup may hold deleted information for up to 30 days before it is overwritten.

## Your rights

Under the Philippine Data Privacy Act of 2012 you may ask to be informed about, access, correct, or delete your personal information, object to its processing, and obtain a copy of it. Email hello@devlabstudios.com and we will respond within a reasonable time. You may also complain to the National Privacy Commission of the Philippines.

## Third-party links

This site links to other websites (for example live project demos or social profiles). Their privacy practices are their own.

## Changes to this policy

We will update this page when what the site does changes. The date at the top shows the latest revision.`,
      },
    },
  ],
}

export default privacyPage
