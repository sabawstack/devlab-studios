import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import AdminShell from './components/AdminShell'
import SessionExpiredDialog from './components/SessionExpiredDialog'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ContentTypePage from './pages/ContentTypePage'
import CollectionTypePage from './pages/CollectionTypePage'
import PageBuilderPage from './pages/PageBuilderPage'
import MediaLibraryPage from './pages/MediaLibraryPage'
import AuditLogPage from './pages/AuditLogPage'
import LeadsPage from './pages/LeadsPage'
import DigestsPage from './pages/DigestsPage'
import SecurityPage from './pages/SecurityPage'
import WorkPageManager from './pages/WorkPageManager'
import LeadCrmDashboardPage from './pages/lead-crm/DashboardPage'
import LeadCrmCampaignsPage from './pages/lead-crm/CampaignsPage'
import LeadCrmLeadsPage from './pages/lead-crm/LeadsPage'
import LeadCrmReviewQueuePage from './pages/lead-crm/ReviewQueuePage'
import LeadCrmRepliesPage from './pages/lead-crm/RepliesPage'
import LeadCrmConversationsPage from './pages/lead-crm/ConversationsPage'
import LeadCrmActivityPage from './pages/lead-crm/ActivityPage'
import LeadCrmSourcesPage from './pages/lead-crm/SourcesPage'
import LeadCrmSuppressionPage from './pages/lead-crm/SuppressionPage'
import LeadCrmSettingsPage from './pages/lead-crm/SettingsPage'
import MailboxPage from './pages/mailbox/MailboxPage'

function buildRouter(session, onLogout) {
  return createBrowserRouter([
    {
      path: '/admin',
      element: <AdminShell session={session} onLogout={onLogout} />,
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'content/:type', element: <ContentTypePage /> },
        { path: 'collections/:type', element: <CollectionTypePage /> },
        { path: 'pages/work', element: <WorkPageManager /> },
        { path: 'pages/:slug', element: <PageBuilderPage /> },
        { path: 'media', element: <MediaLibraryPage /> },
        { path: 'audit-log', element: <AuditLogPage /> },
        { path: 'leads', element: <LeadsPage /> },
        { path: 'digests', element: <DigestsPage /> },
        { path: 'security', element: <SecurityPage /> },

        // Lead CRM. A first-class section of this CMS rather than a separate
        // application: same router, same shell, same auth, same API client.
        { path: 'lead-crm', element: <LeadCrmDashboardPage /> },
        { path: 'lead-crm/campaigns', element: <LeadCrmCampaignsPage /> },
        { path: 'lead-crm/leads', element: <LeadCrmLeadsPage /> },
        { path: 'lead-crm/review', element: <LeadCrmReviewQueuePage /> },
        { path: 'lead-crm/replies', element: <LeadCrmRepliesPage /> },
        { path: 'lead-crm/conversations', element: <LeadCrmConversationsPage /> },
        { path: 'lead-crm/activity', element: <LeadCrmActivityPage /> },
        { path: 'lead-crm/sources', element: <LeadCrmSourcesPage /> },
        { path: 'lead-crm/suppression', element: <LeadCrmSuppressionPage /> },
        { path: 'lead-crm/settings', element: <LeadCrmSettingsPage /> },

        // The devlabconnect.com mailbox. A section of this CMS rather than a
        // separate application, for the same reasons the Lead CRM is: same
        // router, same shell, same admin session, same API client. There is
        // deliberately no separately exposed mailbox app to authenticate.
        // Every mailbox section renders the SAME element, including
        // diagnostics. That is what keeps the mail-client shell and its folder
        // rail mounted across navigation: react-router only swaps the routed
        // element, and if that element is unchanged it simply re-renders.
        // Giving diagnostics its own element would tear the shell down and
        // rebuild it, which is the flicker in a different costume.
        { path: 'mailbox', element: <MailboxPage /> },
        { path: 'mailbox/:section', element: <MailboxPage /> },
      ],
    },
  ])
}

function AdminApp() {
  const [session, setSession] = useState(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  useEffect(() => {
    let isMounted = true

    async function checkSession() {
      try {
        const response = await fetch('/api/admin/session', { credentials: 'include' })
        if (!isMounted) return
        setSession(response.ok ? await response.json() : null)
      } catch {
        if (isMounted) setSession(null)
      } finally {
        if (isMounted) setIsCheckingSession(false)
      }
    }

    checkSession()
    return () => {
      isMounted = false
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    setSession(null)
  }, [])

  // Built once per sign-in, never per render: a rebuilt router remounts every
  // page and loses whatever the admin was editing (ADMIN-05 relies on this).
  const router = useMemo(() => (session ? buildRouter(session, handleLogout) : null), [session, handleLogout])

  if (isCheckingSession) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500">Loading admin session…</div>
  }

  if (!session) {
    return <LoginPage onLogin={setSession} />
  }

  return (
    <>
      <RouterProvider router={router} />
      <SessionExpiredDialog email={session.email} onSignedOut={() => setSession(null)} />
    </>
  )
}

export default AdminApp
