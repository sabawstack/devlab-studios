import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import QualificationSettingsPanel from '../components/QualificationSettingsPanel'
import {
  INQUIRY_TYPE_LABELS,
  INQUIRY_TYPES,
  PIPELINE_STATUSES,
  QUALIFICATION_RESULTS,
} from '../../lib/schemas/inquiry'

/**
 * The operational inbox.
 *
 * Two status concepts are shown side by side on purpose and must not be
 * conflated: DELIVERY status answers "did the notification actually go out",
 * PIPELINE status answers "has a human dealt with this yet". A lead can be
 * delivered and untouched, or undelivered and already handled by phone.
 */

const DELIVERY_TONES = {
  pending: 'bg-amber-100 text-amber-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
}

const PIPELINE_TONES = {
  new: 'bg-sky-100 text-sky-800',
  in_review: 'bg-indigo-100 text-indigo-800',
  qualified: 'bg-violet-100 text-violet-800',
  contacted: 'bg-cyan-100 text-cyan-800',
  won: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-slate-200 text-slate-700',
  archived: 'bg-slate-100 text-slate-500',
}

const QUALIFICATION_TONES = {
  priority: 'bg-emerald-100 text-emerald-800',
  standard: 'bg-sky-100 text-sky-800',
  nurture: 'bg-amber-100 text-amber-800',
  review: 'bg-rose-100 text-rose-800',
  unscored: 'bg-slate-100 text-slate-600',
}

const RETRYABLE_CATEGORIES = new Set(['transient', 'configuration'])

function humanize(value) {
  if (!value) return '—'
  return String(value).replace(/_/g, ' ').replace(/^\w/, (character) => character.toUpperCase())
}

function Badge({ value, tones }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[value] || 'bg-slate-100 text-slate-600'}`}>
      {humanize(value)}
    </span>
  )
}

function DetailRow({ label, children }) {
  if (children === null || children === undefined || children === '' || children === '—') return null
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{children}</dd>
    </div>
  )
}

function Section({ title, children, count }) {
  return (
    <section className="border-t border-slate-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
        {typeof count === 'number' ? ` (${count})` : ''}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  )
}

const EMPTY_FILTERS = {
  inquiryType: '',
  pipelineStatus: '',
  qualification: '',
  status: '',
  search: '',
  includeArchived: false,
}

function LeadsPage() {
  const [leads, setLeads] = useState([])
  const [listState, setListState] = useState('loading')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [isRetrying, setIsRetrying] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [ownerDraft, setOwnerDraft] = useState('')

  // Typing in the search box should not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((current) => ({ ...current, search: searchInput })), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const query = useMemo(() => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(filters)) {
      if (value === '' || value === false) continue
      params.set(key, String(value))
    }
    const serialized = params.toString()
    return serialized ? `?${serialized}` : ''
  }, [filters])

  const loadLeads = useCallback(() => {
    let ignore = false
    setListState('loading')
    adminApi
      .get(`/api/admin/leads${query}`)
      .then((data) => {
        if (ignore) return
        setLeads(data)
        setListState('ready')
      })
      .catch(() => !ignore && setListState('error'))
    return () => {
      ignore = true
    }
  }, [query])

  useEffect(() => loadLeads(), [loadLeads])

  useEffect(() => {
    setFeedback(null)
    if (!selectedId) {
      setDetail(null)
      return undefined
    }
    let ignore = false
    setDetailState('loading')
    adminApi
      .get(`/api/admin/leads/${selectedId}`)
      .then((data) => {
        if (ignore) return
        setDetail(data)
        setNoteDraft(data.internalNotes || '')
        setOwnerDraft(data.assignedOwner || '')
        setDetailState('ready')
      })
      .catch(() => !ignore && setDetailState('error'))
    return () => {
      ignore = true
    }
  }, [selectedId])

  function applyUpdatedDetail(updated) {
    setDetail(updated)
    setLeads((current) => current.map((lead) => (lead.id === updated.id ? { ...lead, ...updated } : lead)))
  }

  async function patchLead(changes, successMessage) {
    if (!selectedId) return
    setFeedback(null)
    setIsSaving(true)
    try {
      applyUpdatedDetail(await adminApi.patch(`/api/admin/leads/${selectedId}`, changes))
      setFeedback({ tone: 'ok', message: successMessage })
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message || 'Update failed. Please try again.' })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRetry() {
    if (!selectedId) return
    setFeedback(null)
    setIsRetrying(true)
    try {
      const updated = await adminApi.post(`/api/admin/leads/${selectedId}/retry`, {})
      applyUpdatedDetail(updated)
      setFeedback({
        tone: updated.status === 'delivered' ? 'ok' : 'error',
        message:
          updated.status === 'delivered'
            ? 'Delivery succeeded.'
            : 'Retry ran but delivery still failed — see the attempt log below.',
      })
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message || 'Retry failed. Please try again.' })
    } finally {
      setIsRetrying(false)
    }
  }

  const latestFailure = (detail?.attempts || []).find((attempt) => attempt.status === 'failure')
  const hasSuccessfulNotification = (detail?.attempts || []).some(
    (attempt) => attempt.target === 'resend' && attempt.status === 'success',
  )
  const canRetry = detail ? detail.status !== 'delivered' || !hasSuccessfulNotification : false
  const retryHint = latestFailure && !RETRYABLE_CATEGORIES.has(latestFailure.errorCategory)
    ? 'The last failure was permanent — retrying will not help. This one needs a person.'
    : null

  const selectClass = 'rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inquiries</h1>
          <p className="mt-1 text-sm text-slate-500">
            Every submission is stored here before any email or webhook is attempted, so a failed delivery is visible,
            never lost.
          </p>
        </div>
        <a
          href={`/api/admin/leads/export${query}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Export CSV
        </a>
      </div>

      <QualificationSettingsPanel />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="sr-only" htmlFor="lead-search">
          Search inquiries
        </label>
        <input
          id="lead-search"
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search name, email, company, subject"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />

        <label className="sr-only" htmlFor="filter-type">Inquiry type</label>
        <select
          id="filter-type"
          value={filters.inquiryType}
          onChange={(event) => setFilters((current) => ({ ...current, inquiryType: event.target.value }))}
          className={selectClass}
        >
          <option value="">All types</option>
          {INQUIRY_TYPES.map((type) => (
            <option key={type} value={type}>
              {INQUIRY_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-pipeline">Pipeline status</label>
        <select
          id="filter-pipeline"
          value={filters.pipelineStatus}
          onChange={(event) => setFilters((current) => ({ ...current, pipelineStatus: event.target.value }))}
          className={selectClass}
        >
          <option value="">All pipeline states</option>
          {PIPELINE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-qualification">Qualification</label>
        <select
          id="filter-qualification"
          value={filters.qualification}
          onChange={(event) => setFilters((current) => ({ ...current, qualification: event.target.value }))}
          className={selectClass}
        >
          <option value="">All qualifications</option>
          {QUALIFICATION_RESULTS.map((result) => (
            <option key={result} value={result}>
              {humanize(result)}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-delivery">Delivery status</label>
        <select
          id="filter-delivery"
          value={filters.status}
          onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
          className={selectClass}
        >
          <option value="">All delivery states</option>
          <option value="pending">Pending</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) => setFilters((current) => ({ ...current, includeArchived: event.target.checked }))}
            className="h-4 w-4 rounded border-slate-400"
          />
          Show archived
        </label>

        <button
          type="button"
          onClick={() => {
            setSearchInput('')
            setFilters(EMPTY_FILTERS)
          }}
          className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
        >
          Reset
        </button>
      </div>

      {listState === 'loading' ? <p className="text-sm text-slate-500">Loading inquiries…</p> : null}
      {listState === 'error' ? (
        <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
          Could not load inquiries. Refresh to try again.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Inquiries, newest first</caption>
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">From</th>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Qualification</th>
                <th scope="col" className="px-4 py-3">Pipeline</th>
                <th scope="col" className="px-4 py-3">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${selectedId === lead.id ? 'bg-brand-mint/30' : ''}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                    {/*
                      The row opens via a real button rather than an onClick on
                      the <tr>: a div/row click handler is unreachable by
                      keyboard and invisible to assistive technology.
                    */}
                    <button
                      type="button"
                      onClick={() => setSelectedId(lead.id)}
                      className="text-left underline-offset-2 hover:underline"
                    >
                      {new Date(lead.createdAt).toLocaleString()}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-800">{lead.name}</p>
                    <p className="text-xs text-slate-500">{lead.email}</p>
                    {lead.company ? <p className="text-xs text-slate-500">{lead.company}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{INQUIRY_TYPE_LABELS[lead.inquiryType] || humanize(lead.inquiryType)}</td>
                  <td className="px-4 py-3"><Badge value={lead.qualification} tones={QUALIFICATION_TONES} /></td>
                  <td className="px-4 py-3"><Badge value={lead.pipelineStatus} tones={PIPELINE_TONES} /></td>
                  <td className="px-4 py-3"><Badge value={lead.status} tones={DELIVERY_TONES} /></td>
                </tr>
              ))}
              {!leads.length && listState === 'ready' ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No inquiries match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div>
          {detailState === 'loading' ? <p className="text-sm text-slate-500">Loading inquiry…</p> : null}
          {detailState === 'error' ? <p className="text-sm text-rose-600">Could not load this inquiry.</p> : null}

          {detail ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge value={detail.qualification} tones={QUALIFICATION_TONES} />
                <Badge value={detail.pipelineStatus} tones={PIPELINE_TONES} />
                <Badge value={detail.status} tones={DELIVERY_TONES} />
              </div>

              {feedback ? (
                <p
                  role="status"
                  className={`rounded-lg px-3 py-2 text-sm ${feedback.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}
                >
                  {feedback.message}
                </p>
              ) : null}

              <dl>
                <DetailRow label="Type">{INQUIRY_TYPE_LABELS[detail.inquiryType] || humanize(detail.inquiryType)}</DetailRow>
                <DetailRow label="Name">{detail.name}</DetailRow>
                <DetailRow label="Email">
                  <a href={`mailto:${detail.email}`} className="text-brand-teal hover:underline">{detail.email}</a>
                </DetailRow>
                <DetailRow label="Company">{detail.company}</DetailRow>
                <DetailRow label="Website">{detail.website}</DetailRow>
                <DetailRow label="Phone">{detail.phone}</DetailRow>
                <DetailRow label="Preferred">{humanize(detail.preferredContact)}</DetailRow>
                <DetailRow label="Timeline">{humanize(detail.timeline)}</DetailRow>
                <DetailRow label="Budget">{humanize(detail.budgetRange)}</DetailRow>
                <DetailRow label="Team size">{humanize(detail.teamSize)}</DetailRow>
                <DetailRow label="Volume">{detail.volume}</DetailRow>
                <DetailRow label="Role">{detail.roleTitle}</DetailRow>
                <DetailRow label="Employment">{humanize(detail.employmentType)}</DetailRow>
                <DetailRow label="Arrangement">{humanize(detail.workArrangement)}</DetailRow>
                <DetailRow label="Location">{detail.locationRequirement}</DetailRow>
                <DetailRow label="Job posting">{detail.jobPostingUrl}</DetailRow>
              </dl>

              <Section title="Message">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{detail.message}</p>
              </Section>

              {detail.desiredOutcome || detail.currentWorkflow || detail.currentTools ? (
                <Section title="Business context">
                  <dl>
                    <DetailRow label="Desired result">{detail.desiredOutcome}</DetailRow>
                    <DetailRow label="Current process">{detail.currentWorkflow}</DetailRow>
                    <DetailRow label="Current tools">{detail.currentTools}</DetailRow>
                  </dl>
                </Section>
              ) : null}

              <Section title="Why it scored this way">
                {detail.qualificationReasons?.length ? (
                  <ul className="space-y-1 text-sm text-slate-700">
                    {detail.qualificationReasons.map((reason, index) => (
                      <li key={`${reason.code}-${index}`} className="flex justify-between gap-3">
                        <span>{reason.label}</span>
                        <span className="flex-shrink-0 font-mono text-xs text-slate-500">
                          {reason.points > 0 ? `+${reason.points}` : reason.points}
                        </span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-slate-200 pt-1 font-semibold">
                      <span>Total</span>
                      <span className="font-mono text-xs">{detail.qualificationScore}</span>
                    </li>
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No qualification reasons recorded.</p>
                )}
              </Section>

              <Section title="Where it came from">
                {detail.attribution ? (
                  <dl>
                    <DetailRow label="Entry page">{detail.attribution.entryPage}</DetailRow>
                    <DetailRow label="Source page">{detail.attribution.sourcePage}</DetailRow>
                    <DetailRow label="Referrer">{detail.attribution.referrer}</DetailRow>
                    <DetailRow label="First touch">
                      {[detail.attribution.firstTouchSource, detail.attribution.firstTouchMedium].filter(Boolean).join(' / ')}
                    </DetailRow>
                    <DetailRow label="Latest touch">
                      {[detail.attribution.latestTouchSource, detail.attribution.latestTouchMedium].filter(Boolean).join(' / ')}
                    </DetailRow>
                    <DetailRow label="Campaign">{detail.attribution.utmCampaign}</DetailRow>
                    <DetailRow label="UTM source">{detail.attribution.utmSource}</DetailRow>
                    <DetailRow label="Form">{detail.attribution.formId}</DetailRow>
                    <DetailRow label="Offer">{detail.attribution.offerId}</DetailRow>
                    <DetailRow label="Solution">{detail.attribution.solutionId}</DetailRow>
                    <DetailRow label="Case study">{detail.attribution.caseStudyId}</DetailRow>
                  </dl>
                ) : (
                  <p className="text-sm text-slate-500">No attribution recorded.</p>
                )}
              </Section>

              <Section title="Consent" count={detail.consents?.length}>
                {detail.consents?.length ? (
                  <ul className="space-y-2 text-xs">
                    {detail.consents.map((consent) => (
                      <li key={consent.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        <p className="font-semibold text-slate-700">
                          {humanize(consent.consentType)} — {consent.granted ? 'granted' : 'not granted'}
                        </p>
                        <p className="mt-1 text-slate-500">
                          Consent text {consent.consentTextVersion || 'unversioned'} · Privacy policy{' '}
                          {consent.privacyPolicyVersion || 'unversioned'}
                        </p>
                        <p className="text-slate-500">{new Date(consent.createdAt).toLocaleString()}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No consent record.</p>
                )}
              </Section>

              <Section title="Delivery attempts" count={detail.attempts?.length}>
                {retryHint ? <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{retryHint}</p> : null}
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={isRetrying || !canRetry}
                  className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isRetrying ? 'Retrying…' : canRetry ? 'Retry delivery' : 'Already delivered'}
                </button>
                <ul className="space-y-2">
                  {(detail.attempts || []).map((attempt) => (
                    <li key={attempt.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          Attempt {attempt.attemptNumber} — {attempt.target}
                        </span>
                        <span className={attempt.status === 'success' ? 'text-emerald-700' : 'text-rose-600'}>
                          {attempt.status}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500">{new Date(attempt.attemptedAt).toLocaleString()}</p>
                      {attempt.errorCategory ? (
                        <p className="mt-1 text-slate-600">
                          Category: <span className="font-semibold">{attempt.errorCategory}</span>
                        </p>
                      ) : null}
                      {attempt.errorMessage ? <p className="mt-1 text-rose-600">{attempt.errorMessage}</p> : null}
                    </li>
                  ))}
                  {!detail.attempts?.length ? <li className="text-xs text-slate-500">No delivery attempts recorded.</li> : null}
                </ul>
              </Section>

              <Section title="Workflow">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600" htmlFor="pipeline-status">
                      Pipeline status
                    </label>
                    <select
                      id="pipeline-status"
                      value={detail.pipelineStatus}
                      disabled={isSaving}
                      onChange={(event) => patchLead({ pipelineStatus: event.target.value }, 'Status updated.')}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {PIPELINE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {humanize(status)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600" htmlFor="assigned-owner">
                      Assigned owner
                    </label>
                    <div className="mt-1 flex gap-2">
                      <input
                        id="assigned-owner"
                        type="text"
                        value={ownerDraft}
                        onChange={(event) => setOwnerDraft(event.target.value)}
                        placeholder="name@devlabstudios.com"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        disabled={isSaving || ownerDraft === (detail.assignedOwner || '')}
                        onClick={() => patchLead({ assignedOwner: ownerDraft }, 'Owner updated.')}
                        className="flex-shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Assign
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600" htmlFor="internal-notes">
                      Internal notes
                    </label>
                    <textarea
                      id="internal-notes"
                      rows={4}
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Context for whoever picks this up next. Not visible to the sender."
                    />
                    <button
                      type="button"
                      disabled={isSaving || noteDraft === (detail.internalNotes || '')}
                      onClick={() => patchLead({ internalNotes: noteDraft }, 'Notes saved.')}
                      className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Save notes
                    </button>
                  </div>

                  {detail.pipelineStatus !== 'archived' ? (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => patchLead({ pipelineStatus: 'archived' }, 'Inquiry archived.')}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Archive
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => patchLead({ pipelineStatus: 'in_review' }, 'Inquiry restored.')}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Restore from archive
                    </button>
                  )}
                </div>
              </Section>

              <Section title="Activity" count={detail.activities?.length}>
                <ol className="space-y-2 text-xs">
                  {(detail.activities || []).map((activity) => (
                    <li key={activity.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700">{humanize(activity.activityType)}</span>
                        <span className={activity.status === 'failed' ? 'text-rose-600' : 'text-slate-500'}>
                          {activity.status}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500">
                        {new Date(activity.createdAt).toLocaleString()}
                        {activity.actor ? ` · ${activity.actor}` : ''}
                      </p>
                    </li>
                  ))}
                  {!detail.activities?.length ? <li className="text-slate-500">No activity recorded.</li> : null}
                </ol>
              </Section>
            </div>
          ) : detailState === 'idle' ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
              Select an inquiry to see its message, qualification reasons, attribution, consent record, delivery attempts,
              and activity.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default LeadsPage
