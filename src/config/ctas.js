// Call-to-action labels (spec K.3, CONTENT-02; owner approved 2026-11-13).
// One primary label site-wide; the audit keeps its own; service lines and
// write-ups use the approved variants. Pages and content import these; the
// header label can still be overridden in Site Settings (site_ctas).
export const CTA = Object.freeze({
  primary: 'Talk to us about your system',
  header: 'Talk to us',
  headerPhone: 'Contact',
  audit: 'Request the audit',
  similar: 'Talk to us about something similar',
  line: Object.freeze({ intake: 'Talk to us about your intake', workflow: 'Talk to us about your workflow', build: 'Talk to us about your build' }),
  primaryHref: '/contact?type=business_system',
})
