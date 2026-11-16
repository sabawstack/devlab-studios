// The page title for every Admin route (ADMIN-02): shown in the header and as
// the document title ("Leads · Lead CRM · DevLab Workspace"). Routes are not
// changed; unknown paths are "Page not found" (the 404 route).
import { PRIMARY_PUBLIC_SURFACES, SUPPORTING_PUBLIC_SURFACES } from '../../config/publicSurfaces'

export const WORKSPACE = 'DevLab Workspace'

const CONTENT = {
  'site-settings': 'Site settings', seo: 'SEO', projects: 'Projects', services: 'Service catalog', resources: 'Insight articles', profile: 'Founder profile',
}
const COLLECTIONS = { certifications: 'Certifications', redirects: 'Redirects' }
const SIMPLE = { '': 'Home', media: 'Media', 'audit-log': 'Audit log', leads: 'Inquiries', digests: 'Daily digests', security: 'Security' }
const CRM = {
  '': 'Overview', campaigns: 'Campaigns', leads: 'Leads', review: 'Review queue', replies: 'Replies', conversations: 'Conversations',
  activity: 'Activity', sources: 'Sources', suppression: 'Suppression', settings: 'CRM settings',
}
const MAILBOX = { inbox: 'Inbox', drafts: 'Drafts', outbox: 'Outbox', sent: 'Sent', failed: 'Failed', archived: 'Archive', diagnostics: 'Diagnostics', bounces: 'Bounces', dmarc: 'DMARC' }
const SURFACES = new Map([...PRIMARY_PUBLIC_SURFACES, ...SUPPORTING_PUBLIC_SURFACES].map((s) => [s.adminPath, s.label]))

/** { title, section } for a pathname; section is the area name when the title alone is ambiguous. */
export function routeTitle(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/admin'
  const parts = path.split('/').slice(2)
  const [first = '', second, third] = parts
  if (third !== undefined) return { title: 'Page not found', section: null }
  if (first === 'pages' && second) return SURFACES.has(path) ? { title: `${SURFACES.get(path)} page`, section: 'Website' } : { title: 'Page not found', section: null }
  if (first === 'content' && second) return CONTENT[second] ? { title: CONTENT[second], section: 'Website' } : { title: 'Page not found', section: null }
  if (first === 'collections' && second) return COLLECTIONS[second] ? { title: COLLECTIONS[second], section: 'Website' } : { title: 'Page not found', section: null }
  if (first === 'lead-crm') return CRM[second ?? ''] ? { title: CRM[second ?? ''], section: 'Lead CRM' } : { title: 'Page not found', section: null }
  if (first === 'mailbox') {
    if (!second) return { title: 'Mailbox', section: null }
    return MAILBOX[second] ? { title: MAILBOX[second], section: 'Mailbox' } : { title: 'Page not found', section: null }
  }
  if (second === undefined && SIMPLE[first] !== undefined) return { title: SIMPLE[first], section: null }
  return { title: 'Page not found', section: null }
}

export function documentTitle(pathname) {
  const { title, section } = routeTitle(pathname)
  return [title, section, WORKSPACE].filter(Boolean).join(' · ')
}
