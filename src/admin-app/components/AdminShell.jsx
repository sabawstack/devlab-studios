import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brandingAssets } from '../../config/branding'
import { currentEnvironment } from '../lib/environment'
import EnvironmentBadge from './EnvironmentBadge'
import { PRIMARY_PUBLIC_SURFACES, SUPPORTING_PUBLIC_SURFACES } from '../../config/publicSurfaces'
import {
  BadgeCheck,
  Briefcase,
  FileText,
  FolderOpen,
  Home,
  Image,
  Link2,
  Lock,
  Mail,
  Menu,
  Newspaper,
  Search,
  Settings,
  Target,
  Inbox,
  MessageSquare,
  ClipboardCheck,
  Activity,
  Database,
  Filter,
  Users,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from '../../components/icons/icons'

const NAV_GROUPS = [
  {
    key: 'overview',
    items: [{ label: 'Dashboard', to: '/admin', icon: Home }],
  },
  {
    key: 'public-pages',
    heading: 'Public Pages',
    items: PRIMARY_PUBLIC_SURFACES.map(({ label, adminPath: to, icon }) => ({ label, to, icon })),
  },
  {
    key: 'supporting-content',
    heading: 'Supporting Content',
    items: SUPPORTING_PUBLIC_SURFACES.map(({ label, adminPath: to, icon }) => ({ label, to, icon })),
  },
  {
    key: 'content-libraries',
    heading: 'Content Libraries',
    items: [
      { label: 'Projects', to: '/admin/content/projects', icon: Briefcase },
      { label: 'Service Catalog', to: '/admin/content/services', icon: Settings },
      { label: 'Insight Articles', to: '/admin/content/resources', icon: FileText },
      { label: 'Daily Digests', to: '/admin/digests', icon: Newspaper },
      { label: 'Certifications', to: '/admin/collections/certifications', icon: BadgeCheck },
    ],
  },
  {
    key: 'site-management',
    heading: 'Site Management',
    items: [
      { label: 'Navigation & Footer', to: '/admin/content/site-settings', icon: Settings },
      { label: 'SEO', to: '/admin/content/seo', icon: Search },
      { label: 'Media', to: '/admin/media', icon: Image },
      { label: 'Redirects', to: '/admin/collections/redirects', icon: Link2 },
      { label: 'Audit Log', to: '/admin/audit-log', icon: FolderOpen },
    ],
  },
  {
    key: 'operations',
    heading: 'Operations',
    items: [
      { label: 'Inquiries', to: '/admin/leads', icon: Mail },
      { label: 'Security', to: '/admin/security', icon: Lock },
    ],
  },
  {
    // Outbound prospecting, kept separate from 'Inquiries' above on purpose:
    // that one holds people who contacted US, this one holds businesses the
    // engine found. Conflating them in the navigation would be the first step
    // toward conflating them in someone's head.
    key: 'lead-crm',
    heading: 'Lead CRM',
    items: [
      { label: 'Dashboard', to: '/admin/lead-crm', icon: Target, end: true },
      { label: 'Campaigns', to: '/admin/lead-crm/campaigns', icon: Briefcase },
      { label: 'Leads', to: '/admin/lead-crm/leads', icon: Users },
      { label: 'Review Queue', to: '/admin/lead-crm/review', icon: ClipboardCheck },
      { label: 'Replies', to: '/admin/lead-crm/replies', icon: Inbox },
      { label: 'Conversations', to: '/admin/lead-crm/conversations', icon: MessageSquare },
      { label: 'Activity', to: '/admin/lead-crm/activity', icon: Activity },
      { label: 'Sources', to: '/admin/lead-crm/sources', icon: Database },
      { label: 'Suppression', to: '/admin/lead-crm/suppression', icon: Filter },
      { label: 'CRM Settings', to: '/admin/lead-crm/settings', icon: Settings },
    ],
  },
  {
    // The mailbox is its own group rather than an item under Lead CRM: it
    // receives mail from anyone, not only from leads, and filing it under
    // outbound prospecting would imply otherwise.
    key: 'mailbox',
    heading: 'Mailbox',
    // ONE entry. The folders (Inbox, Drafts, Outbox, Sent, Archive,
    // Diagnostics) live inside the mail client itself, where a mail client's
    // folders belong — duplicating them in the global sidebar made the same
    // navigation exist in two places with two different behaviours.
    items: [{ label: 'Mailbox', to: '/admin/mailbox', icon: Mail }],
  },
]

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'admin-sidebar-collapsed'
const OPEN_GROUPS_STORAGE_KEY = 'admin-nav-open-groups'

function routeMatches(pathname, item) {
  if (item.end || item.to === '/admin') return pathname === item.to
  return pathname === item.to || pathname.startsWith(`${item.to}/`)
}

function readCollapsedPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function readOpenGroups(activeGroupKey) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY) || 'null')
    if (Array.isArray(stored)) return new Set(activeGroupKey ? [...stored, activeGroupKey] : stored)
  } catch {
    // Storage can be unavailable or contain stale data. Current-route defaults
    // still leave every destination reachable.
  }
  return new Set(activeGroupKey ? [activeGroupKey] : [])
}

function AdminShell({ session, onLogout }) {
  const environment = currentEnvironment(session)
  const location = useLocation()
  const activeGroupKey = NAV_GROUPS.find((group) => group.heading && group.items.some((item) => routeMatches(location.pathname, item)))?.key
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readCollapsedPreference)
  const [openGroups, setOpenGroups] = useState(() => readOpenGroups(activeGroupKey))

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify([...openGroups]))
    } catch {
      // Persistence is optional; the controls still work for this session.
    }
  }, [openGroups])

  function toggleGroup(groupKey) {
    setOpenGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  function toggleSidebar() {
    setIsSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Persistence is optional; the control still works for this session.
      }
      return next
    })
  }

  function renderNavigation({ compact = false, mobile = false } = {}) {
    const idPrefix = mobile ? 'mobile' : 'desktop'

    return (
      <>
        <div className={`admin-sidebar-rule flex h-16 flex-shrink-0 items-center border-b ${compact ? 'justify-center px-2' : 'gap-2 px-4'}`}>
          <img src={brandingAssets.logoOnlyUrl} alt="DevLab Studios" className="h-8 w-8 rounded object-contain" />
          <span className={compact ? 'sr-only' : 'text-sm font-semibold'}>DevLab Workspace</span>
        </div>
        <nav aria-label="Admin navigation" className={`flex-1 overflow-y-auto py-4 ${compact ? 'space-y-4 px-2' : 'space-y-3 px-3'}`}>
          {NAV_GROUPS.map((group) => {
            const isOpen = compact || !group.heading || openGroups.has(group.key)
            const isCurrentGroup = group.key === activeGroupKey
            const groupId = `${idPrefix}-admin-nav-${group.key}`

            return (
              <div key={group.key} className={compact && group.heading ? 'admin-sidebar-rule border-t pt-4' : ''}>
                {group.heading && !compact ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={groupId}
                    onClick={() => toggleGroup(group.key)}
                    className={`admin-nav-group group mb-1 flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs font-semibold transition ${isCurrentGroup ? 'font-bold' : ''}`}
                  >
                    <span>{group.heading}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                ) : null}
                {isOpen ? (
                  <div id={groupId} className="space-y-1">
                    {group.items.map((item) => {
                      const Icon = item.icon
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          end={item.end ?? item.to === '/admin'}
                          title={compact ? item.label : undefined}
                          aria-label={compact ? item.label : undefined}
                          onClick={() => {
                            setOpenGroups((current) => new Set([...current, group.key]))
                            setIsMobileOpen(false)
                          }}
                          className={({ isActive }) =>
                            `admin-nav-link flex min-h-10 items-center gap-3 px-3 py-2.5 text-sm font-medium transition ${compact ? 'justify-center' : ''} ${
                              isActive ? 'admin-nav-link--active' : ''
                            }`
                          }
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.7} aria-hidden="true" />
                          <span className={compact ? 'sr-only' : ''}>{item.label}</span>
                        </NavLink>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </nav>
      </>
    )
  }

  return (
    <div className="admin-canvas flex h-screen overflow-hidden">
      <aside
        className={`admin-sidebar relative hidden shrink-0 flex-col border-r transition-[width] duration-200 motion-reduce:transition-none md:flex ${
          isSidebarCollapsed ? 'w-[4.5rem]' : 'w-64'
        }`}
      >
        {renderNavigation({ compact: isSidebarCollapsed })}
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={isSidebarCollapsed ? 'Expand admin navigation' : 'Collapse admin navigation'}
          className="admin-nav-group admin-sidebar-rule flex min-h-11 flex-shrink-0 items-center justify-center gap-2 border-t px-3 text-xs font-semibold transition"
        >
          {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : <ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          {isSidebarCollapsed ? null : 'Collapse navigation'}
        </button>
      </aside>

      {isMobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" aria-label="Close admin navigation" className="admin-dialog-backdrop absolute inset-0" onClick={() => setIsMobileOpen(false)} />
          <aside className="admin-sidebar relative flex h-full w-72 max-w-[88vw] flex-col shadow-2xl">
            {renderNavigation({ mobile: true })}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-header flex h-16 flex-shrink-0 items-center justify-between border-b px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setIsMobileOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 md:hidden" aria-label="Open admin navigation"><Menu className="h-5 w-5" /></button>
            <EnvironmentBadge environment={environment} />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/" target="_blank" rel="noreferrer" className="admin-link hidden sm:inline">Preview Site</a>
            <span className="hidden text-slate-500 lg:inline">{session.email}</span>
            <button type="button" onClick={onLogout} className="admin-link">
              Log Out
            </button>
          </div>
        </header>
        <main className="admin-workspace relative isolate flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AdminShell
