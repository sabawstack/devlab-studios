import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import LeadDetail from './LeadDetail'
import { PRIORITY_TONES, STAGE_TONES, buttonClass, humanize, inputClass, relativeTime } from './format'
import { Badge, EmptyState } from './shared'
import { LoadState } from '../../primitives/index.jsx'
import { useResource } from './useResource'

/**
 * The leads table.
 *
 * Filter state lives in the URL, not in component state. That is what makes a
 * dashboard card able to link straight to "leads that need a contact added" and
 * what lets an operator bookmark or share a view — a filtered list that cannot
 * be linked to is a filtered list nobody else ever sees.
 */

const STAGE_OPTIONS = [
  'DISCOVERED', 'RESEARCHING', 'RESEARCHED', 'RULE_QUALIFIED', 'AI_REVIEW', 'AI_QUALIFIED',
  'CONTACT_FOUND', 'READY_FOR_REVIEW', 'READY_TO_CONTACT', 'CONTACTED', 'AWAITING_REPLY',
  'REPLIED', 'CONVERSATION', 'MEETING', 'PROPOSAL', 'WON', 'LOST',
  'NOT_QUALIFIED', 'HOLD', 'NO_CONTACT', 'DO_NOT_CONTACT', 'UNSUBSCRIBED', 'ARCHIVED',
]

const FILTER_KEYS = [
  'campaignId', 'stage', 'priority', 'countryCode', 'aiStatus', 'contactability',
  'complianceState', 'search', 'sort', 'minScore',
]

const PAGE_SIZE = 100

function LeadsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '')
  // CRM-03: `?lead=` (the mailbox's "open in Lead CRM" link) opens that lead.
  const selectedId = searchParams.get('lead')
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  function setSelectedId(id) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('lead', id)
      else next.delete('lead')
      return next
    })
  }

  // Typing must not fire a request per keystroke; the URL is only updated once
  // the operator has stopped.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        if ((current.get('search') ?? '') === searchInput) return current
        if (searchInput) next.set('search', searchInput)
        else next.delete('search')
        next.delete('page')
        return next
      })
    }, 300)
    return () => clearTimeout(timer)
  }, [searchInput, setSearchParams])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    for (const key of FILTER_KEYS) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    // CRM-03: pages of PAGE_SIZE instead of a silent cap at 100.
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String((page - 1) * PAGE_SIZE))
    return `?${params.toString()}`
  }, [searchParams, page])

  const { data, state, reload } = useResource(`/api/admin/lead-crm/leads${query}`)
  const { data: campaignData } = useResource('/api/admin/lead-crm/campaigns')

  const leads = data?.leads ?? []
  const campaigns = campaignData?.campaigns ?? []

  function setFilter(key, value) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      next.delete('page')
      return next
    })
  }

  function setPage(nextPage) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (nextPage > 1) next.set('page', String(nextPage))
      else next.delete('page')
      return next
    })
  }

  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = total ? (page - 1) * PAGE_SIZE + 1 : 0
  const last = Math.min(total, page * PAGE_SIZE)

  const hasFilters = FILTER_KEYS.some((key) => searchParams.get(key))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Leads</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data ? `${data.total} lead${data.total === 1 ? '' : 's'}` : 'Loading…'}
            {hasFilters ? ' matching these filters' : ''}
            {data && total > PAGE_SIZE ? ` · showing ${first}–${last}` : ''}
          </p>
        </div>
        {hasFilters ? (
          <button type="button" className={buttonClass} onClick={() => setSearchParams(new URLSearchParams())}>
            Clear filters
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search company or domain"
          aria-label="Search leads"
          className={`${inputClass} min-w-[200px] flex-1`}
        />

        <select
          value={searchParams.get('campaignId') ?? ''}
          onChange={(event) => setFilter('campaignId', event.target.value)}
          aria-label="Campaign"
          className={inputClass}
        >
          <option value="">All campaigns</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get('stage') ?? ''}
          onChange={(event) => setFilter('stage', event.target.value)}
          aria-label="Stage"
          className={inputClass}
        >
          <option value="">All stages</option>
          {STAGE_OPTIONS.map((stage) => (
            <option key={stage} value={stage}>
              {humanize(stage)}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get('priority') ?? ''}
          onChange={(event) => setFilter('priority', event.target.value)}
          aria-label="Priority"
          className={inputClass}
        >
          <option value="">Any priority</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>

        <select
          value={searchParams.get('contactability') ?? ''}
          onChange={(event) => setFilter('contactability', event.target.value)}
          aria-label="Contactability"
          className={inputClass}
        >
          <option value="">Any contactability</option>
          <option value="contactable">Has a contact</option>
          <option value="no_contact">No contact</option>
        </select>

        <select
          value={searchParams.get('aiStatus') ?? ''}
          onChange={(event) => setFilter('aiStatus', event.target.value)}
          aria-label="AI status"
          className={inputClass}
        >
          <option value="">Any AI status</option>
          <option value="qualified">AI reviewed</option>
          <option value="pending">Not yet reviewed</option>
        </select>

        <select
          value={searchParams.get('sort') ?? 'recent'}
          onChange={(event) => setFilter('sort', event.target.value)}
          aria-label="Sort"
          className={inputClass}
        >
          <option value="recent">Recent activity</option>
          <option value="score">Highest score</option>
          <option value="confidence">AI confidence</option>
          <option value="created">Newest</option>
          <option value="company">Company name</option>
        </select>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className={state === 'ready' ? '' : 'p-4'}><LoadState state={state} label="leads" onRetry={reload} /></div>

          {state === 'ready' && leads.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No leads match."
                hint={hasFilters ? 'Try clearing a filter.' : 'Run a campaign to discover some.'}
              />
            </div>
          ) : null}

          {leads.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Stage</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">AI</th>
                    <th className="px-3 py-2 font-medium">Contact</th>
                    <th className="px-3 py-2 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelectedId(lead.id)}
                      aria-selected={selectedId === lead.id}
                      className={`cursor-pointer transition hover:bg-slate-50 ${selectedId === lead.id ? 'bg-slate-50' : ''}`}
                    >
                      <td className="px-3 py-2">
                        {/* ADMIN-10: the row opens from the keyboard too, through a real button. */}
                        <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedId(lead.id) }}
                          aria-pressed={selectedId === lead.id} className="text-left font-medium text-slate-800 hover:text-[var(--ws-link)]">
                          {lead.companyName}
                        </button>
                        <p className="text-xs text-slate-400">
                          {lead.canonicalDomain}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge value={lead.stage} tones={STAGE_TONES} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-slate-700">{lead.ruleScore ?? '—'}</span>{' '}
                        <Badge value={lead.priority} tones={PRIORITY_TONES} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {lead.aiConfidence !== null && lead.aiConfidence !== undefined
                          ? `${lead.aiConfidence.toFixed(2)} · ${humanize(lead.opportunityType)}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{lead.contactEmail || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">{relativeTime(lead.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {pages > 1 ? (
            <nav aria-label="Lead pages" className="flex items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-sm">
              <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <span>Page {page} of {pages}</span>
              <button type="button" className={buttonClass} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </nav>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <LeadDetail leadId={selectedId} onChanged={reload} />
        </div>
      </div>
    </div>
  )
}

export default LeadsPage
