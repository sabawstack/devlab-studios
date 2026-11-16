// The workspace navigation (ADMIN-03): six areas, routes unchanged.
// Inquiries (people who contacted us) and Lead CRM (businesses we found) stay
// separate on purpose, and the Mailbox keeps its own folders inside it.
// Only the six areas carry an icon, so no icon repeats; their pages are text.
import { PRIMARY_PUBLIC_SURFACES, SUPPORTING_PUBLIC_SURFACES } from '../../config/publicSurfaces'

// "Home page" (the website's home) so it is never confused with the workspace's own Home.
const pages = [...PRIMARY_PUBLIC_SURFACES, ...SUPPORTING_PUBLIC_SURFACES].map(({ key, label, adminPath }) => ({ label: key === 'home' ? 'Home page' : label, to: adminPath }))

export const NAV_AREAS = [
  { key: 'home', label: 'Home', icon: 'LayoutDashboard', to: '/admin', end: true },
  {
    key: 'website',
    label: 'Website',
    icon: 'Globe',
    sections: [
      { label: 'Pages', items: pages },
      {
        label: 'Libraries',
        items: [
          { label: 'Projects', to: '/admin/content/projects' },
          { label: 'Insight articles', to: '/admin/content/resources' },
          { label: 'Certifications', to: '/admin/collections/certifications' },
          { label: 'Service catalog', to: '/admin/content/services' },
          { label: 'Daily digests', to: '/admin/digests' },
        ],
      },
      {
        label: 'Site',
        items: [
          { label: 'Site settings', to: '/admin/content/site-settings' },
          { label: 'SEO', to: '/admin/content/seo' },
          { label: 'Media', to: '/admin/media' },
          { label: 'Redirects', to: '/admin/collections/redirects' },
        ],
      },
    ],
  },
  { key: 'inquiries', label: 'Inquiries', icon: 'Inbox', to: '/admin/leads', attention: 'inquiries' },
  {
    key: 'lead-crm',
    label: 'Lead CRM',
    icon: 'Target',
    attention: 'leadCrm',
    sections: [
      {
        items: [
          { label: 'Overview', to: '/admin/lead-crm', end: true },
          { label: 'Review queue', to: '/admin/lead-crm/review', attention: ['leadCrm', 'review'] },
          { label: 'Replies', to: '/admin/lead-crm/replies', attention: ['leadCrm', 'replies'] },
          { label: 'Leads', to: '/admin/lead-crm/leads' },
          { label: 'Campaigns', to: '/admin/lead-crm/campaigns' },
          { label: 'Conversations', to: '/admin/lead-crm/conversations' },
          { label: 'Activity', to: '/admin/lead-crm/activity' },
          { label: 'Sources', to: '/admin/lead-crm/sources' },
          { label: 'Suppression', to: '/admin/lead-crm/suppression' },
          { label: 'CRM settings', to: '/admin/lead-crm/settings' },
        ],
      },
    ],
  },
  { key: 'mailbox', label: 'Mailbox', icon: 'Mail', to: '/admin/mailbox', attention: 'mailbox' },
  {
    key: 'admin',
    label: 'Admin',
    icon: 'Shield',
    sections: [{ items: [{ label: 'Security', to: '/admin/security' }, { label: 'Audit log', to: '/admin/audit-log' }] }],
  },
]

export function routeMatches(pathname, item) {
  if (item.end) return pathname === item.to || pathname === `${item.to}/`
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

/** Every link of an area, in order. */
export function areaItems(area) {
  return area.to ? [area] : area.sections.flatMap((section) => section.items)
}

/** The area the current page belongs to (the most specific match wins). */
export function activeArea(pathname) {
  let best = null
  for (const area of NAV_AREAS) {
    for (const item of areaItems(area)) {
      if (routeMatches(pathname, item) && (!best || item.to.length > best.length)) best = { key: area.key, length: item.to.length }
    }
  }
  return best?.key ?? null
}
