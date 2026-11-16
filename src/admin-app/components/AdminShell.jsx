import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { brandingAssets } from '../../config/branding'
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Inbox, LayoutDashboard, Mail, Menu, Shield, Target } from '../../components/icons/icons'
import { activeArea, areaItems, NAV_AREAS } from '../lib/adminNav'
import { currentEnvironment } from '../lib/environment'
import { documentTitle, routeTitle } from '../lib/routeTitles'
import { Dialog } from '../primitives/Dialog'
import { AttentionCount, AttentionProvider, useAttention } from './AttentionContext'
import EnvironmentBadge from './EnvironmentBadge'

const ICONS = { LayoutDashboard, Globe, Inbox, Target, Mail, Shield }
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'admin-sidebar-collapsed'
const OPEN_GROUPS_STORAGE_KEY = 'admin-nav-open-groups'
const SITE_LINK = { production: 'Open live site', preview: 'Open preview site', local: 'Open local site' }

function readCollapsedPreference() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function readOpenGroups(current) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY) || 'null')
    if (Array.isArray(stored)) return new Set(current ? [...stored, current] : stored)
  } catch {
    // Storage can be unavailable or hold stale data; the current area still opens.
  }
  return new Set(current ? [current] : [])
}

/** The attention count for an area (a string key) or one of its items ([area, item]). */
function countFor(attention, key) {
  if (!key) return 0
  if (Array.isArray(key)) {
    const [area, item] = key
    return attention[area]?.value?.items?.find((entry) => entry.key === item)?.count ?? 0
  }
  return attention[key]?.value?.total ?? 0
}

function NavItem({ item, compact, onNavigate, attention, icon: Icon = null }) {
  const count = countFor(attention, item.attention)
  // The count is the link's description, so its name stays exactly the label.
  const countId = count && !compact ? `count-${item.to.replace(/\W+/g, '-')}` : undefined
  return (
    <NavLink
      to={item.to}
      aria-describedby={countId}
      end={item.end ?? false}
      title={compact ? item.label : undefined}
      aria-label={compact ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) => `admin-nav-link flex min-h-10 items-center gap-3 px-3 py-2 text-sm font-medium transition ${compact ? 'justify-center' : ''} ${isActive ? 'admin-nav-link--active' : ''}`}
    >
      {Icon ? <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.7} aria-hidden="true" /> : null}
      <span className={compact ? 'sr-only' : 'min-w-0 truncate'}>{item.label}</span>
      {!compact ? <AttentionCount id={countId} count={count} label="need attention" /> : null}
    </NavLink>
  )
}

function Navigation({ compact = false, mobile = false, openGroups, onToggle, onNavigate }) {
  const attention = useAttention()
  const location = useLocation()
  const current = activeArea(location.pathname)
  const idPrefix = mobile ? 'mobile' : 'desktop'
  return (
    <>
      <div className={`admin-sidebar-rule flex h-16 flex-shrink-0 items-center border-b ${compact ? 'justify-center px-2' : 'gap-2 px-4'}`}>
        <img src={brandingAssets.logoOnlyUrl} alt="" className="h-8 w-8 object-contain" width="32" height="32" />
        <span className={compact ? 'sr-only' : 'text-sm font-semibold'}>DevLab Workspace</span>
      </div>
      <nav aria-label="Admin navigation" className={`flex-1 overflow-y-auto py-4 ${compact ? 'space-y-2 px-2' : 'space-y-1 px-3'}`}>
        {NAV_AREAS.map((area) => {
          const Icon = ICONS[area.icon]
          if (area.to) return <NavItem key={area.key} item={area} compact={compact} onNavigate={onNavigate} attention={attention} icon={Icon} />
          // Collapsed: the area's icon links to its first page.
          if (compact) {
            const first = areaItems(area)[0]
            return <NavItem key={area.key} item={{ label: area.label, to: first.to, end: false }} compact onNavigate={onNavigate} attention={attention} icon={Icon} />
          }
          const isOpen = openGroups.has(area.key)
          const groupId = `${idPrefix}-admin-nav-${area.key}`
          const total = countFor(attention, area.attention)
          return (
            <div key={area.key}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={groupId}
                onClick={() => onToggle(area.key)}
                aria-describedby={total ? `count-area-${area.key}` : undefined}
                className={`admin-nav-group flex min-h-10 w-full items-center gap-3 rounded-[var(--ws-radius)] px-3 py-2 text-left text-sm font-medium transition ${current === area.key ? 'font-semibold' : ''}`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.7} aria-hidden="true" />
                <span>{area.label}</span>
                <AttentionCount id={`count-area-${area.key}`} count={total} label="need attention" />
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${total ? '' : 'ml-auto'} ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {isOpen ? (
                <div id={groupId} className="mb-2 ml-5 space-y-0.5 border-l border-[var(--ws-sidebar-rule)] pl-2">
                  {area.sections.map((section, index) => (
                    <div key={section.label ?? index} className={index ? 'pt-2' : ''}>
                      {section.label ? <p className="ws-mono px-3 pb-1 text-[0.68rem] text-[var(--ws-sidebar-ink-2)]">{section.label}</p> : null}
                      {section.items.map((item) => <NavItem key={item.to} item={item} compact={false} onNavigate={onNavigate} attention={attention} />)}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>
    </>
  )
}

function ShellFrame({ session, onLogout }) {
  const location = useLocation()
  const environment = currentEnvironment(session)
  const current = activeArea(location.pathname)
  const { title } = routeTitle(location.pathname)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readCollapsedPreference)
  const [openGroups, setOpenGroups] = useState(() => readOpenGroups(current))

  // ADMIN-02: every route names itself in the browser tab.
  useEffect(() => {
    document.title = documentTitle(location.pathname)
  }, [location.pathname])

  // The current area opens when you arrive in it (and can still be collapsed while you are there).
  const [arrivedIn, setArrivedIn] = useState(current)
  if (current !== arrivedIn) {
    setArrivedIn(current)
    if (current && !openGroups.has(current)) setOpenGroups(new Set([...openGroups, current]))
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify([...openGroups]))
    } catch {
      // Persistence is optional; the controls still work for this session.
    }
  }, [openGroups])

  function toggleGroup(key) {
    setOpenGroups((groups) => {
      const next = new Set(groups)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSidebar() {
    setIsSidebarCollapsed((collapsed) => {
      const next = !collapsed
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Persistence is optional.
      }
      return next
    })
  }

  return (
    <div className="admin-canvas flex h-screen overflow-hidden">
      <aside className={`admin-sidebar relative hidden shrink-0 flex-col border-r transition-[width] duration-200 motion-reduce:transition-none md:flex ${isSidebarCollapsed ? 'w-[4.5rem]' : 'w-64'}`}>
        <Navigation compact={isSidebarCollapsed} openGroups={openGroups} onToggle={toggleGroup} />
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

      {/* ADMIN-06: on phones the navigation is a real dialog (focus kept inside, Escape closes, focus returns). */}
      <Dialog open={isMobileOpen} variant="drawer" title="Admin navigation menu" onClose={() => setIsMobileOpen(false)}>
        <Navigation mobile openGroups={openGroups} onToggle={toggleGroup} onNavigate={() => setIsMobileOpen(false)} />
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="admin-header flex h-16 flex-shrink-0 items-center justify-between gap-3 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => setIsMobileOpen(true)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--ws-rule)] md:hidden" aria-label="Open admin navigation" aria-haspopup="dialog">
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
            <p className="truncate text-base font-semibold" data-testid="page-title">{title}</p>
            <EnvironmentBadge environment={environment} />
          </div>
          <div className="flex shrink-0 items-center gap-4 text-sm">
            <a href="/" target="_blank" rel="noreferrer" className="admin-link hidden sm:inline">{SITE_LINK[environment.key]}</a>
            <span className="ws-mono hidden text-xs text-[var(--ws-ink-3)] lg:inline">{session.email}</span>
            <button type="button" onClick={onLogout} className="admin-link">Log out</button>
          </div>
        </header>
        <main className="admin-workspace relative isolate min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function AdminShell({ session, onLogout }) {
  return (
    <AttentionProvider>
      <ShellFrame session={session} onLogout={onLogout} />
    </AttentionProvider>
  )
}

export default AdminShell
