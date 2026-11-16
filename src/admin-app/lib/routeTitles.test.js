import { describe, expect, it } from 'vitest'
import { activeArea, NAV_AREAS, areaItems } from './adminNav'
import { documentTitle, routeTitle } from './routeTitles'

describe('route titles (ADMIN-02)', () => {
  it('names every navigation destination', () => {
    for (const area of NAV_AREAS) {
      for (const item of areaItems(area)) expect(routeTitle(item.to).title, item.to).not.toBe('Page not found')
    }
  })

  it('builds document titles with the area and the workspace name', () => {
    expect(documentTitle('/admin')).toBe('Home · DevLab Workspace')
    expect(documentTitle('/admin/lead-crm/review')).toBe('Review queue · Lead CRM · DevLab Workspace')
    expect(documentTitle('/admin/mailbox/outbox')).toBe('Outbox · Mailbox · DevLab Workspace')
    expect(documentTitle('/admin/content/site-settings')).toBe('Site settings · Website · DevLab Workspace')
  })

  it('anything else is "Page not found"', () => {
    for (const path of ['/admin/nope', '/admin/lead-crm/nope', '/admin/content/nope', '/admin/pages/nope', '/admin/a/b/c']) {
      expect(routeTitle(path).title, path).toBe('Page not found')
    }
  })
})

describe('navigation (ADMIN-03)', () => {
  it('has the six areas, in order, with routes unchanged and no label used twice', () => {
    expect(NAV_AREAS.map((a) => a.label)).toEqual(['Home', 'Website', 'Inquiries', 'Lead CRM', 'Mailbox', 'Admin'])
    const labels = NAV_AREAS.flatMap((area) => areaItems(area).map((item) => item.label))
    expect(labels.filter((label) => label === 'Dashboard')).toEqual([])
    const icons = NAV_AREAS.map((a) => a.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('keeps Inquiries and Lead CRM apart and finds the area of each page', () => {
    expect(activeArea('/admin/leads')).toBe('inquiries')
    expect(activeArea('/admin/lead-crm/leads')).toBe('lead-crm')
    expect(activeArea('/admin/mailbox/sent')).toBe('mailbox')
    expect(activeArea('/admin/content/seo')).toBe('website')
    expect(activeArea('/admin')).toBe('home')
  })
})
