// Standard terms-of-service boilerplate. Flagged for legal review before
// being treated as final — in particular the governing-law clause, which
// defaults to the founder's actual location but hasn't been confirmed
// with counsel. See docs/content-model.md.
export const termsPage = {
  slug: 'terms',
  title: 'Terms of Service',
  status: 'published',
  blocks: [
    {
      type: 'hero',
      props: {
        eyebrow: 'Legal',
        heading: 'Terms of Service',
        subheading: 'Last updated: July 31, 2026. These terms govern your use of this website. They do not cover the terms of any specific client engagement, which are agreed separately.',
      },
    },
    {
      type: 'richText',
      props: {
        body: `## Who we are

This site is run by DevLab Studios, operated by Stephen Rey Agustinez, Cebu, Philippines. Contact: hello@devlabstudios.com.

## Acceptance of terms

By using this website, you agree to these terms. If you do not agree, please do not use the site.

## Use of this website

This site is provided to share information about DevLab Studios' services, portfolio, and background, and to let visitors get in touch. You agree not to misuse the site — including attempting to disrupt its operation, scrape it at scale, or use the contact form to send unsolicited commercial messages.

## Intellectual property

The content on this site (text, design, code samples shown, and portfolio descriptions) belongs to DevLab Studios or is used with permission, unless otherwise noted. You may not reproduce or redistribute it for commercial purposes without permission.

## No professional engagement implied

Browsing this site or submitting the contact form does not create a client relationship or any obligation on either party. Actual project work is governed by a separate, explicit agreement (proposal, statement of work, or contract) between DevLab Studios and the client.

## Portfolio and case studies

Project descriptions, screenshots, and outcomes shown on this site are presented for illustrative purposes. Specific results are not guaranteed for future engagements, since every project's scope and constraints differ.

## Disclaimer and limitation of liability

This site and its content are provided "as is" without warranties of any kind. To the fullest extent permitted by law, DevLab Studios is not liable for any indirect, incidental, or consequential damages arising from your use of this site.

## Third-party links

This site may link to third-party sites (live demos, social profiles, or tools referenced in project write-ups). We are not responsible for the content or practices of those sites.

## Governing law

These terms are governed by the laws of the Philippines, without regard to conflict-of-law principles.

## Changes to these terms

We may update these terms from time to time. The "last updated" date above reflects the most recent revision.

## Contact us

Questions about these terms can be sent to hello@devlabstudios.com.`,
      },
    },
  ],
}

export default termsPage
