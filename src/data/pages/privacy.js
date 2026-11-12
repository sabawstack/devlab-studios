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
        subheading: 'Last updated: August 14, 2026. This policy explains what information DevLab Studios collects through this website and how it is used.',
      },
    },
    {
      type: 'richText',
      props: {
        body: `## Who we are

This site is run by DevLab Studios, operated by Stephen Rey Agustinez, Cebu, Philippines. Contact: hello@devlabstudios.com.

## Information we collect

DevLab Studios collects information you voluntarily provide through the contact form on this site: your name, email address, subject, and message. We do not require an account to browse this site, and we do not knowingly collect information from children.

## How we use your information

- Respond to your inquiry or request
- Communicate about a potential or active project
- Keep records of client communications for service delivery

Contact form submissions are delivered to our email via a third-party transactional email service (Resend). We do not sell, rent, or trade your personal information to third parties for their marketing purposes.

## Analytics

This site uses Google Analytics (GA4) to understand aggregate visitor behavior, such as which pages are viewed. Our GA4 configuration enables IP anonymization and disables Google's client-side storage for this property, which limits (though does not eliminate) the data Google Analytics can associate with an individual visitor. You can opt out of Google Analytics tracking using browser extensions such as Google's own opt-out add-on, or by using your browser's tracking-protection settings.

## Data retention

Contact form submissions and related communications are retained for as long as reasonably necessary to respond to your inquiry, deliver services, and comply with our legal and accounting obligations.

## Your rights

You may request access to, correction of, or deletion of personal information you have submitted to us by emailing the address below. We will respond to reasonable requests within a reasonable timeframe.

## Third-party links

This site may link to third-party websites (for example, live project demos or social profiles). We are not responsible for the privacy practices of those third-party sites.

## Changes to this policy

We may update this policy from time to time. The "last updated" date above reflects the most recent revision.

## Contact us

Questions about this policy can be sent to hello@devlabstudios.com.`,
      },
    },
  ],
}

export default privacyPage
