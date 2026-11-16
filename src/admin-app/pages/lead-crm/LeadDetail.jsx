import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { COMPLIANCE_TONES, PRIORITY_TONES, STAGE_TONES, buttonClass, dangerButtonClass, formatDate, humanize, inputClass, primaryButtonClass } from './format'
import { Badge, EmptyState, Feedback, Field, Panel } from './shared'
import { useResource } from './useResource'
import { confirmAction } from '../../primitives/confirm'

/**
 * The lead detail panel.
 *
 * Every claim on this screen is traceable. A signal shows the URL it came from
 * and the excerpt that supports it; the AI opportunity shows its model and
 * prompt version; a contact shows the page that published it. That is the
 * difference between a screen you can act on and a screen you have to trust.
 *
 * The opportunity section renders OBSERVED and INFERRED separately, because the
 * model is instructed to keep them apart and the whole point is lost if the UI
 * runs them together.
 */

const DRAFT_VARIANTS = [
  ['regenerate', 'Regenerate'],
  ['shorter', 'Make shorter'],
  ['more_technical', 'More technical'],
  ['suggest_call', 'Suggest a call'],
  ['no_cta', 'No call to action'],
]

function ScoreBreakdown({ score }) {
  if (!score) return <EmptyState title="Not scored yet." />

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-slate-900">{score.total}</span>
        <Badge
          value={score.routing}
          tones={{
            priority_ai_review: 'bg-emerald-100 text-emerald-800',
            ai_review: 'bg-sky-100 text-sky-800',
            hold: 'bg-amber-100 text-amber-800',
            not_qualified: 'bg-slate-100 text-slate-500',
          }}
        />
        <span className="text-xs text-slate-400">ruleset v{score.rulesetVersion}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[
          ['ICP fit', score.icpFit],
          ['Workflow', score.workflowOpportunity],
          ['Contactability', score.contactability],
          ['Data quality', score.dataQuality],
        ].map(([label, value]) => (
          <div key={label} className="rounded border border-slate-200 px-2 py-1.5">
            <p className="text-slate-400">{label}</p>
            <p className="font-semibold text-slate-800">{value > 0 ? `+${value}` : value}</p>
          </div>
        ))}
      </div>

      <ul className="divide-y divide-slate-100 text-sm">
        {score.reasons.map((reason) => (
          <li key={reason.code} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-slate-700">{reason.label}</span>
            <span className={`font-mono text-xs ${reason.points < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {reason.points > 0 ? `+${reason.points}` : reason.points}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SignalList({ signals }) {
  if (signals.length === 0) return <EmptyState title="No signals extracted." />

  const byCategory = signals.reduce((groups, signal) => {
    const list = groups[signal.category] || []
    list.push(signal)
    return { ...groups, [signal.category]: list }
  }, {})

  return (
    <div className="space-y-4">
      {Object.entries(byCategory).map(([category, entries]) => (
        <div key={category}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{humanize(category)}</h4>
          <ul className="mt-1 space-y-1.5">
            {entries.map((signal) => (
              <li key={signal.id} className="text-sm leading-5">
                <div>
                  <span className="font-medium text-slate-800">{humanize(signal.signalKey)}</span>
                  {signal.valueText ? <span className="text-slate-500"> — {signal.valueText}</span> : null}
                </div>
                {signal.evidence ? (
                  <p className="mt-0.5 border-l-2 border-slate-200 pl-2 text-xs italic text-slate-500">
                    “{signal.evidence}”
                  </p>
                ) : null}
                {signal.sourceUrl ? (
                  <a
                    href={signal.sourceUrl}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="mt-0.5 inline-block text-xs text-slate-400 hover:text-[var(--ws-link)] hover:underline"
                  >
                    Source page ↗
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function DraftPanel({ draft, leadId, readiness, validationViolations = [], onChanged }) {
  const [subject, setSubject] = useState(draft?.subject ?? '')
  const [body, setBody] = useState(draft?.bodyText ?? '')
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [isEditing, setIsEditing] = useState(false)

  async function act(label, operation) {
    setBusy(label)
    setFeedback(null)
    try {
      const result = await operation()
      setFeedback({ tone: 'ok', message: result })
      onChanged()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(null)
    }
  }

  if (!draft) {
    return (
      <div className="space-y-3">
        {readiness.ready ? (
          <>
            <p className="text-sm text-slate-600">No draft yet.</p>
            <button
              type="button"
              disabled={busy !== null}
              className={primaryButtonClass}
              onClick={() =>
                act('generate', async () => {
                  await adminApi.post(`/api/admin/lead-crm/leads/${leadId}/run`, { step: 'outreach_draft' })
                  return 'Draft generated.'
                })
              }
            >
              {busy === 'generate' ? 'Generating…' : 'Generate outreach draft'}
            </button>
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700">This lead is not ready for outreach.</p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {readiness.blockers.map((blocker) => (
                <li key={blocker.code}>{blocker.detail}</li>
              ))}
            </ul>
          </div>
        )}
        <Feedback feedback={feedback} />
      </div>
    )
  }

  // `exported` is mapped in the drafts repository from a legacy stored
  // status; the mailbox integration it was named for no longer exists.
  const isExported = Boolean(draft.exported)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          value={draft.status}
          tones={{
            draft: 'bg-slate-100 text-slate-700',
            edited: 'bg-sky-100 text-sky-800',
            // Legacy stored value; the badge reads from draft.status.
            zoho_draft_created: 'bg-emerald-100 text-emerald-800',
          }}
        />
        <span className="text-xs text-slate-400">
          {draft.generatedBy === 'ai' ? 'Written by Workers AI' : 'Edited by a person'}
          {draft.variant ? ` · ${humanize(draft.variant)}` : ''}
        </span>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className={`${inputClass} w-full`} />
          <textarea
            rows={12}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className={`${inputClass} w-full font-mono text-xs`}
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              className={primaryButtonClass}
              onClick={() =>
                act('save', async () => {
                  await adminApi.put(`/api/admin/lead-crm/drafts/${draft.id}`, { subject, bodyText: body })
                  setIsEditing(false)
                  return 'Draft saved.'
                })
              }
            >
              Save
            </button>
            <button type="button" className={buttonClass} onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-800">{draft.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-slate-700">{draft.bodyText}</pre>
        </div>
      )}

      <Feedback feedback={feedback} />

      {validationViolations.length > 0 ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <p className="font-semibold">This AI draft failed content safeguards.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
            {validationViolations.map((violation, index) => (
              <li key={`${violation.code}-${index}`}>
                {humanize(violation.code)}: {violation.description}
                {violation.excerpt ? ` — “${violation.excerpt}”` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Edit and save the draft to correct and acknowledge these issues before exporting it.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!isEditing && !isExported ? (
          <button type="button" className={buttonClass} onClick={() => {
            // CRM-05: edit the draft as it is now (it may have been regenerated since this panel mounted).
            setSubject(draft?.subject ?? '')
            setBody(draft?.bodyText ?? '')
            setIsEditing(true)
          }}>
            Edit draft
          </button>
        ) : null}

        {!isExported
          ? DRAFT_VARIANTS.map(([variant, label]) => (
              <button
                key={variant}
                type="button"
                disabled={busy !== null}
                className={buttonClass}
                onClick={() =>
                  act(variant, async () => {
                    await adminApi.post(`/api/admin/lead-crm/drafts/${draft.id}/regenerate`, { variant })
                    return `Regenerated (${label.toLowerCase()}).`
                  })
                }
              >
                {busy === variant ? '…' : label}
              </button>
            ))
          : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
        <a
          href={`/api/admin/lead-crm/drafts/${draft.id}/export`}
          className={validationViolations.length > 0 ? `${buttonClass} pointer-events-none opacity-50` : primaryButtonClass}
          // A plain link, not a fetch: the browser handles the download and the
          // file lands where the operator expects it. The server runs the same
          // gate chain either way.
          download
        >
          {isExported ? 'Download again' : 'Download .eml'}
        </a>

        <button
          type="button"
          disabled={busy !== null || validationViolations.length > 0}
          className={buttonClass}
          onClick={() =>
            act('copy', async () => {
              const result = await adminApi.post(`/api/admin/lead-crm/drafts/${draft.id}/export`, {})
              await navigator.clipboard.writeText(`${result.subject}\n\n${result.bodyText}`)
              return `Copied. Nothing has been sent — paste it into a message to ${result.to} and send it yourself.`
            })
          }
        >
          {busy === 'copy' ? 'Copying…' : 'Copy subject & body'}
        </button>

        <button
          type="button"
          disabled={busy !== null}
          className={buttonClass}
          onClick={() =>
            act('contacted', async () => {
              await adminApi.post(`/api/admin/lead-crm/leads/${draft.leadId}/actions`, { action: 'mark_contacted' })
              return 'Marked contacted.'
            })
          }
        >
          {busy === 'contacted' ? '…' : 'I sent this'}
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Nothing here sends. The download opens as an unsent draft in your mail client — read it, edit it if you want,
        and press Send yourself. Then use <strong>I sent this</strong>, because nothing observes your mailbox any more.
      </p>
    </div>
  )
}

function LeadDetail({ leadId, onChanged }) {
  const { data, state, reload } = useResource(leadId ? `/api/admin/lead-crm/leads/${leadId}` : null, { skip: !leadId })
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [actionReason, setActionReason] = useState('')

  if (!leadId) return <EmptyState title="Select a lead." hint="Pick one from the list to see its full research." />
  if (state === 'loading') return <p className="text-sm text-slate-500">Loading lead…</p>
  if (state === 'error') return <p className="text-sm text-rose-600">This lead could not be loaded.</p>
  if (!data) return null

  const { lead, company, research, score, opportunity, contacts, compliance, drafts, messages, activity, readiness } = data
  const currentDraft = drafts.find((draft) => !['superseded', 'discarded'].includes(draft.status)) ?? null
  const draftValidationEvent = currentDraft?.generatedBy === 'ai'
    ? activity.find(
        (event) =>
          event.metadata?.draftId === currentDraft.id &&
          Array.isArray(event.metadata?.violations),
      )
    : null
  const draftValidationViolations = draftValidationEvent?.metadata?.violations ?? []

  async function runAction(action, extra = {}) {
    setBusy(action)
    setFeedback(null)
    try {
      await adminApi.post(`/api/admin/lead-crm/leads/${leadId}/actions`, { action, reason: actionReason, ...extra })
      setActionReason('')
      reload()
      onChanged?.()
      setFeedback({ tone: 'ok', message: `${humanize(action)} applied.` })
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(null)
    }
  }

  async function runStep(step) {
    setBusy(step)
    setFeedback(null)
    try {
      const result = await adminApi.post(`/api/admin/lead-crm/leads/${leadId}/run`, { step })
      reload()
      onChanged?.()
      setFeedback({
        tone: result.ok ? 'ok' : 'warn',
        message: result.ok ? `${humanize(step)} completed.` : `${humanize(step)} did not complete: ${result.error}`,
      })
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{company?.name}</h2>
          <p className="text-xs text-slate-500">
            <a
              href={company?.websiteUrl}
              target="_blank"
              rel="noreferrer nofollow"
              className="hover:text-[var(--ws-link)] hover:underline"
            >
              {company?.canonicalDomain}
            </a>
            {company?.city ? ` · ${company.city}` : ''}
            {company?.countryCode ? `, ${company.countryCode}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={lead.stage} tones={STAGE_TONES} />
          <Badge value={lead.priority} tones={PRIORITY_TONES} />
        </div>
      </div>

      {lead.nextAction ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">Next: </span>
          {lead.nextAction}
        </div>
      ) : null}

      <Feedback feedback={feedback} />

      <Panel title="Score" description="Every point comes from an observed signal. Workers AI does not set the score.">
        <ScoreBreakdown score={score} />
      </Panel>

      <Panel title="Opportunity" description={opportunity ? `${opportunity.model} · ${opportunity.promptVersion}` : undefined}>
        {opportunity ? (
          <dl>
            <Field label="Type">{humanize(opportunity.opportunity_type)}</Field>
            <Field label="Confidence">{opportunity.confidence?.toFixed?.(2) ?? '—'}</Field>
            <Field label="Observed">{opportunity.observed_problem}</Field>
            <Field label="Recommended">{opportunity.recommended_solution}</Field>
            <Field label="DevLab service">{humanize(opportunity.devlab_service)}</Field>
            <Field label="Outreach angle">{opportunity.outreach_angle}</Field>
            {opportunity.inference_notes ? (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Inferred, not observed</p>
                <p className="mt-1 text-sm text-amber-900">{opportunity.inference_notes}</p>
              </div>
            ) : null}
          </dl>
        ) : (
          <EmptyState title="No AI review yet." hint="A lead reaches the model only after the rules qualify it." />
        )}
      </Panel>

      <Panel
        title="Research"
        description={`${research.crawlRuns[0]?.pagesFetched ?? 0} pages analyzed${research.technologies.length ? ` · ${research.technologies.filter(Boolean).join(', ')}` : ''}`}
      >
        <SignalList signals={research.signals} />
      </Panel>

      <Panel title="Contact">
        {contacts.length === 0 ? (
          <EmptyState title="No public business contact found." hint="Add one manually if you can point at where it is published." />
        ) : (
          <ul className="space-y-3">
            {contacts.map((contact) => (
              <li key={contact.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-800">{contact.email}</span>
                  <Badge value={contact.emailType} tones={{ role: 'bg-emerald-100 text-emerald-800', named: 'bg-sky-100 text-sky-800' }} />
                  {contact.isPrimary ? <Badge value="primary" tones={{ primary: 'bg-slate-900 text-white' }} /> : null}
                  {contact.suppressed ? (
                    <Badge value="suppressed" tones={{ suppressed: 'bg-rose-100 text-rose-800' }} label={`Suppressed: ${humanize(contact.suppressionReason)}`} />
                  ) : null}
                </div>
                <dl className="mt-2">
                  {contact.fullName ? <Field label="Name">{contact.fullName}</Field> : null}
                  {contact.roleTitle ? <Field label="Role">{contact.roleTitle}</Field> : null}
                  <Field label="Published at">
                    <a href={contact.sourceUrl} target="_blank" rel="noreferrer nofollow" className="hover:underline">
                      {contact.sourceUrl}
                    </a>
                  </Field>
                  <Field label="Source type">{humanize(contact.sourceType)}</Field>
                  <Field label="Domain match">{contact.domainMatchesCompany ? 'Company domain' : 'Different domain'}</Field>
                  <Field label="Mail records">{contact.mxDescription}</Field>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Compliance" description="Operational safeguards and provenance. This is not a legal determination.">
        {compliance ? (
          <dl>
            <Field label="Country">{compliance.countryCode}</Field>
            <Field label="Profile">{compliance.profileKey}</Field>
            <Field label="State">
              <Badge value={compliance.state} tones={COMPLIANCE_TONES} />
            </Field>
            {compliance.legalBasis ? <Field label="Legal basis">{compliance.legalBasis}</Field> : null}
            {compliance.reviewedBy ? <Field label="Reviewed by">{`${compliance.reviewedBy} · ${formatDate(compliance.reviewedAt)}`}</Field> : null}
            <div className="mt-2 space-y-1">
              {compliance.checks.map((check) => (
                <p key={check.key} className="text-xs">
                  <span className={check.passed ? 'text-emerald-700' : check.required ? 'text-rose-700' : 'text-slate-400'}>
                    {check.passed ? '✓' : '✗'}
                  </span>{' '}
                  <span className="text-slate-600">{check.detail || humanize(check.key)}</span>
                </p>
              ))}
            </div>
          </dl>
        ) : (
          <EmptyState title="Not evaluated yet." />
        )}
      </Panel>

      <Panel title="Outreach">
        <DraftPanel
          draft={currentDraft}
          leadId={leadId}
          readiness={readiness}
          validationViolations={draftValidationViolations}
          onChanged={reload}
        />
      </Panel>

      {messages.length > 0 ? (
        <Panel title="Conversation">
          <ul className="space-y-3">
            {messages.map((message) => (
              <li
                key={message.id}
                className={`rounded-lg border p-3 ${message.direction === 'inbound' ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    {message.direction === 'inbound' ? message.fromAddress : 'DevLab (sent by hand)'}
                  </span>
                  <span className="text-xs text-slate-400">{formatDate(message.receivedAt || message.sentAt)}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-800">{message.subject}</p>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-600">{message.bodyText}</pre>
                {message.aiSummary ? (
                  <p className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-500">
                    <span className="font-semibold">AI summary:</span> {message.aiSummary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Actions">
        <div className="space-y-3">
          <input
            value={actionReason}
            onChange={(event) => setActionReason(event.target.value)}
            placeholder="Reason (required to hold, reject, mark lost or do-not-contact)"
            className={`${inputClass} w-full`}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runStep('lead_research')}>
              Re-research
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runStep('ai_review')}>
              Re-run AI review
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runAction('hold')}>
              Hold
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runAction('reject')}>
              Reject
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runAction('mark_won')}>
              Mark won
            </button>
            <button type="button" disabled={busy !== null} className={buttonClass} onClick={() => runAction('mark_lost')}>
              Mark lost
            </button>
            <button
              type="button"
              disabled={busy !== null}
              className={dangerButtonClass}
              onClick={async () => {
                // Decision 7: one dialog on both screens, which asks whether the whole domain goes too.
                const domain = company?.canonicalDomain
                const answer = await confirmAction({
                  title: 'Mark this lead do not contact?',
                  body: 'The contact address is suppressed and the lead moves to a state it cannot leave without a privileged, audited removal.',
                  confirmLabel: 'Mark do not contact',
                  danger: true,
                  option: domain ? { label: `Also suppress every address at ${domain}`, hint: 'Use this when the whole business asked not to be contacted.' } : undefined,
                })
                if (answer) runAction('do_not_contact', { suppressDomain: Boolean(answer.option) })
              }}
            >
              Mark do not contact
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Do-not-contact suppresses the address (and, if you choose, its whole domain) and moves the lead to a state it
            cannot leave without a privileged, audited removal.
          </p>
        </div>
      </Panel>

      <Panel title="Activity">
        <ul className="space-y-1.5">
          {activity.map((event) => (
            <li key={event.id} className="flex gap-3 text-xs">
              <span className="w-32 shrink-0 text-slate-400">{formatDate(event.createdAt)}</span>
              <span className="w-44 shrink-0 font-medium text-slate-600">{event.label}</span>
              <span className="text-slate-500">{event.summary}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

export default LeadDetail
