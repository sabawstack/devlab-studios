// Client consent register (spec K.2, CASE-04; owner decision Q-16: no client
// is named or quoted until they agree in writing). The human-readable record
// is docs/content/consent.md; this list is what the site checks. Add an entry
// only with written consent, and record where that consent is kept.
//
// { client: 'Exact name as shown', writeup: 'project-id', name: true, quote: false, consentOn: 'YYYY-MM-DD', evidence: 'where the written consent is stored' }
export const CLIENT_CONSENT = []
