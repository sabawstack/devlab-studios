import { Link } from 'react-router-dom'
import { STAGE_TONES, formatDate, humanize } from './format'
import { Badge, DisabledNotice, EmptyState, Panel } from './shared'
import { useResource } from './useResource'

/**
 * The Lead CRM dashboard.
 *
 * Two halves, kept visually apart on purpose: the FUNNEL is a health metric and
 * the CARDS are a work queue. Mixing them produces a screen that looks busy and
 * tells you nothing about what to do next.
 *
 * There is no "opens" metric anywhere on this page, because this system does
 * not track email opens — no pixel is embedded in anything it produces.
 */

/**
 * What is configured, and what is missing before it can be used.
 *
 * Required gaps are always shown because they prevent a complete run. Optional
 * gaps appear only when their feature was explicitly enabled: an unused Brave
 * key or browser renderer is not a problem, but an enabled one that cannot run
 * is an actionable configuration error.
 */
function ReadinessNotice({ readiness }) {
  if (!readiness) return null

  const blocked = readiness.capabilities.filter(
    (capability) => capability.importance === 'required' && !capability.configured,
  )
  const degraded = readiness.capabilities.filter(
    (capability) => capability.importance === 'optional' && capability.enabled && !capability.configured,
  )
  if (blocked.length === 0 && degraded.length === 0) return null

  return (
    <div className="space-y-3">
      {blocked.length > 0 ? (
        <ReadinessGroup
          capabilities={blocked}
          title={`${blocked.length === 1 ? 'One capability is' : `${blocked.length} capabilities are`} missing configuration.`}
          tone="rose"
        />
      ) : null}
      {degraded.length > 0 ? (
        <ReadinessGroup
          capabilities={degraded}
          title={`${degraded.length === 1 ? 'One optional capability is' : `${degraded.length} optional capabilities are`} enabled but unavailable.`}
          tone="amber"
        />
      ) : null}
    </div>
  )
}

function ReadinessGroup({ capabilities, title, tone }) {
  const styles =
    tone === 'rose'
      ? { panel: 'border-rose-200 bg-rose-50', heading: 'text-rose-900', text: 'text-rose-800', code: 'bg-rose-100' }
      : {
          panel: 'border-amber-200 bg-amber-50',
          heading: 'text-amber-900',
          text: 'text-amber-800',
          code: 'bg-amber-100',
        }

  return (
    <div className={`rounded-xl border px-4 py-3 ${styles.panel}`}>
      <p className={`text-sm font-semibold ${styles.heading}`}>{title}</p>
      <ul className="mt-2 space-y-1.5">
        {capabilities.map((capability) => (
          <li key={capability.key} className={`text-xs ${styles.text}`}>
            <span className="font-semibold">{capability.label}</span> — {capability.impact}
            <br />
            <span>Missing: </span>
            {capability.missing.map((name) => (
              <code key={name} className={`ws-mono mr-1 inline-block break-all rounded px-1 ${styles.code}`}>
                {name}
              </code>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

const FUNNEL_ROWS = [
  ['Discovered', 'discovered'],
  ['Researched', 'researched'],
  ['Rule qualified', 'ruleQualified'],
  ['AI qualified', 'aiQualified'],
  ['Contactable', 'contactable'],
  ['Ready for review', 'readyForReview'],
  ['Ready to contact', 'readyToContact'],
  ['Contacted', 'contacted'],
  ['Awaiting reply', 'awaitingReply'],
  ['Replied', 'replied'],
  ['Conversations', 'conversations'],
  ['Meetings', 'meetings'],
  ['Proposals', 'proposals'],
  ['Won', 'won'],
  ['Lost', 'lost'],
]

function Metric({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
    </div>
  )
}

function ActionCard({ title, count, hint, to, children, tone = 'border-slate-200' }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${count > 0 ? tone : 'border-slate-200'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className={`text-2xl font-semibold ${count > 0 ? 'text-slate-900' : 'text-slate-300'}`}>{count}</span>
      </div>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {children}
      {to && count > 0 ? (
        <Link to={to} className="mt-3 inline-block text-xs font-semibold text-brand-teal hover:underline">
          Open →
        </Link>
      ) : null}
    </div>
  )
}

function UsageBar({ label, used, limit }) {
  const percent = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = percent >= 100 ? 'bg-rose-500' : percent >= 80 ? 'bg-amber-500' : 'bg-slate-400'

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-600">{humanize(label)}</span>
        <span className="text-slate-400">
          {used} / {limit ?? '∞'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function LeadCrmDashboardPage() {
  const { data, state } = useResource('/api/admin/lead-crm/dashboard')

  if (state === 'loading') return <p className="text-sm text-slate-500">Loading the pipeline…</p>
  if (state === 'error') return <p className="text-sm text-rose-600">The dashboard could not be loaded.</p>
  if (!data) return null

  const { totals, actionable, usage, flags, jobs, readiness } = data
  const maxFunnel = Math.max(1, ...FUNNEL_ROWS.map(([, key]) => totals[key] || 0))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Lead CRM</h1>
        <p className="mt-1 text-sm text-slate-500">
          Discovery through to Won. Every outbound email is written here and sent by hand from your own mail client — this system has no
          send capability.
        </p>
      </div>

      <DisabledNotice flags={flags} />

      <ReadinessNotice readiness={readiness} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ready for review" value={totals.readyForReview} tone="text-amber-700" />
        <Metric label="Ready to contact" value={totals.readyToContact} tone="text-amber-800" />
        <Metric label="New replies" value={actionable.newReplies.count} tone="text-emerald-700" />
        <Metric label="Won" value={totals.won} tone="text-emerald-700" />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Needs a person</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            title="Qualified, awaiting review"
            count={actionable.qualifiedAwaitingReview.count}
            hint="A draft is written and waiting for you to read it."
            to="/admin/lead-crm/review"
            tone="border-amber-300"
          />
          <ActionCard
            title="Ready to contact"
            count={actionable.readyToContact.count}
            hint="Approved. Export the draft, then send it yourself."
            to="/admin/lead-crm/leads?stage=READY_TO_CONTACT"
            tone="border-amber-300"
          />
          <ActionCard
            title="New replies"
            count={actionable.newReplies.count}
            hint="Prospects who answered and have not been answered back."
            to="/admin/lead-crm/replies"
            tone="border-emerald-300"
          />
          <ActionCard
            title="Reply drafts ready"
            count={actionable.replyDraftsReady.count}
            hint="Suggested responses waiting for your review."
            to="/admin/lead-crm/replies"
            tone="border-emerald-300"
          />
          <ActionCard
            title="Needing manual action"
            count={actionable.leadsNeedingManualAction.count}
            hint="Qualified, but no public business contact was found."
            to="/admin/lead-crm/leads?stage=NO_CONTACT"
            tone="border-orange-300"
          />
          <ActionCard
            title="Failed research jobs"
            count={actionable.failedResearchJobs.count}
            hint="Crawls and background jobs that gave up."
            to="/admin/lead-crm/activity?view=jobs"
            tone="border-rose-300"
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel title="Pipeline" description="Cumulative — each row counts leads at that stage or beyond.">
          <div className="space-y-2">
            {FUNNEL_ROWS.map(([label, key]) => {
              const value = totals[key] || 0
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 text-xs text-slate-600">{label}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-slate-400"
                      style={{ width: `${Math.round((value / maxFunnel) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-semibold text-slate-700">{value}</span>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-200 pt-3">
            <Badge value="NOT_QUALIFIED" tones={STAGE_TONES} label={`Not qualified: ${totals.notQualified}`} />
            <Badge value="HOLD" tones={STAGE_TONES} label={`On hold: ${totals.hold}`} />
            <Badge value="DO_NOT_CONTACT" tones={STAGE_TONES} label={`Do not contact: ${totals.doNotContact}`} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Today's usage" description="Budgets are reserved before work starts, never exceeded silently.">
            <div className="space-y-3">
              {Object.entries(usage.daily).map(([metric, entry]) => (
                <UsageBar key={metric} label={metric} used={entry.used} limit={entry.limit} />
              ))}
            </div>
            <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
              Workers AI today: {usage.ai.okRuns} succeeded, {usage.ai.invalidRuns} rejected as unusable,{' '}
              {usage.ai.failedRuns} failed. Neurons measured: {usage.ai.neurons.toFixed(2)}.
            </p>
          </Panel>

          <Panel title="Background jobs">
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(jobs).length === 0 ? (
                <span className="text-slate-400">Nothing queued.</span>
              ) : (
                Object.entries(jobs).map(([status, count]) => (
                  <span key={status} className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700">
                    {humanize(status)}: {count}
                  </span>
                ))
              )}
            </div>
          </Panel>

        </div>
      </div>

      {actionable.newReplies.replies.length > 0 ? (
        <Panel title="Latest replies">
          <ul className="divide-y divide-slate-100">
            {actionable.newReplies.replies.map((reply) => (
              <li key={reply.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{reply.companyName}</p>
                  <p className="truncate text-xs text-slate-500">{reply.subject}</p>
                </div>
                <span className="shrink-0 text-xs text-slate-400">{formatDate(reply.receivedAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <EmptyState title="No replies waiting." hint="Replies are recorded when you log them against a conversation." />
      )}
    </div>
  )
}

export default LeadCrmDashboardPage
