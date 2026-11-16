import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, dangerButtonClass, formatDate, humanize, inputClass, primaryButtonClass } from './format'
import { Badge, EmptyState, Feedback } from './shared'
import { useResource } from './useResource'
import { confirmAction } from '../../primitives/confirm'

/**
 * The replies queue — the reply copilot.
 *
 * A COPILOT, not an agent. It reads the message, says what it thinks was asked,
 * and proposes an answer. Nothing on this screen sends anything: the export
 * draft" puts text in a mailbox, and a person presses Send there.
 *
 * The prospect's own words are shown in full, above the AI's reading of them,
 * deliberately. Anyone reviewing a suggested reply needs to be able to check
 * the summary against the message rather than take it on trust.
 */

const INTENT_TONES = {
  interested: 'bg-emerald-100 text-emerald-800',
  meeting_request: 'bg-emerald-100 text-emerald-800',
  technical_question: 'bg-sky-100 text-sky-800',
  pricing_question: 'bg-amber-100 text-amber-800',
  not_now: 'bg-slate-100 text-slate-600',
  wrong_person: 'bg-slate-100 text-slate-600',
  not_interested: 'bg-rose-100 text-rose-800',
  unsubscribe: 'bg-rose-100 text-rose-800',
  out_of_office: 'bg-slate-100 text-slate-500',
  unknown: 'bg-slate-100 text-slate-500',
}

const REPLY_VARIANTS = [
  ['regenerate', 'Regenerate'],
  ['shorter', 'Shorter'],
  ['more_technical', 'More technical'],
  ['explain_solution', 'Explain solution'],
  ['suggest_call', 'Suggest call'],
  ['no_cta', 'No CTA'],
]

function ReplyCard({ reply, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [draftBody, setDraftBody] = useState(reply.suggestedDraft?.bodyText ?? '')
  const [draftSubject, setDraftSubject] = useState(reply.suggestedDraft?.subject ?? '')
  const [isEditing, setIsEditing] = useState(false)

  const analysis = reply.analysis
  const draft = reply.suggestedDraft

  async function act(key, operation) {
    setBusy(key)
    setFeedback(null)
    try {
      setFeedback({ tone: 'ok', message: await operation() })
      onChanged()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{reply.companyName}</h3>
          <p className="text-xs text-slate-500">
            {reply.fromAddress} · {formatDate(reply.receivedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {analysis ? <Badge value={analysis.intent} tones={INTENT_TONES} /> : <Badge value="not_analyzed" label="Not analysed" />}
          {analysis?.needs_human_attention ? (
            <Badge value="attention" tones={{ attention: 'bg-amber-100 text-amber-900' }} label="Needs your attention" />
          ) : null}
        </div>
      </header>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Their message</h4>
        <p className="mt-1 text-sm font-medium text-slate-700">{reply.subject}</p>
        <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">
          {reply.bodyText}
        </pre>
      </section>

      {analysis ? (
        <section className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Summary</h4>
            <p className="mt-1 text-sm text-slate-700">{analysis.summary}</p>
          </div>
          {analysis.important_new_information ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">What changed</h4>
              <p className="mt-1 text-sm text-slate-700">{analysis.important_new_information}</p>
            </div>
          ) : null}
          {analysis.questions_detected?.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Questions</h4>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
                {analysis.questions_detected.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended</h4>
            <p className="mt-1 text-sm text-slate-700">
              {humanize(analysis.recommended_action)}
              {analysis.recommended_strategy ? ` — ${analysis.recommended_strategy}` : ''}
            </p>
          </div>
          {reply.analysisPromptVersion ? (
            <p className="text-xs text-slate-400 sm:col-span-2">
              {reply.analysisModel} · {reply.analysisPromptVersion}
            </p>
          ) : null}
        </section>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          className={buttonClass}
          onClick={() =>
            act('analyze', async () => {
              await adminApi.post(`/api/admin/lead-crm/replies/${reply.id}`, { action: 'analyze' })
              return 'Analysed.'
            })
          }
        >
          {busy === 'analyze' ? 'Analysing…' : 'Analyse this reply'}
        </button>
      )}

      {draft ? (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Suggested reply</h4>
          {isEditing ? (
            <div className="mt-1 space-y-2">
              <input value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} className={`${inputClass} w-full`} />
              <textarea
                rows={10}
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                className={`${inputClass} w-full font-mono text-xs`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={busy !== null}
                  onClick={() =>
                    act('save', async () => {
                      await adminApi.put(`/api/admin/lead-crm/drafts/${draft.id}`, {
                        subject: draftSubject,
                        bodyText: draftBody,
                      })
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
            <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-800">{draft.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-slate-700">{draft.bodyText}</pre>
            </div>
          )}
        </section>
      ) : analysis ? (
        <button
          type="button"
          disabled={busy !== null}
          className={buttonClass}
          onClick={() =>
            act('draft', async () => {
              await adminApi.post(`/api/admin/lead-crm/replies/${reply.id}`, { action: 'draft' })
              return 'Reply drafted.'
            })
          }
        >
          {busy === 'draft' ? 'Drafting…' : 'Draft a reply'}
        </button>
      ) : null}

      <Feedback feedback={feedback} />

      <footer className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
        {draft && !isEditing ? (
          <>
            {!draft.exported ? (
              <button type="button" className={buttonClass} onClick={() => {
                // CRM-05: edit the draft as it is now (it may have been regenerated since this card mounted).
                setDraftSubject(draft.subject ?? '')
                setDraftBody(draft.bodyText ?? '')
                setIsEditing(true)
              }}>
                Edit draft
              </button>
            ) : null}

            {!draft.exported
              ? REPLY_VARIANTS.map(([variant, label]) => (
                  <button
                    key={variant}
                    type="button"
                    disabled={busy !== null}
                    className={buttonClass}
                    onClick={() =>
                      act(variant, async () => {
                        await adminApi.post(`/api/admin/lead-crm/replies/${reply.id}`, { action: 'draft', variant })
                        return `Regenerated (${label.toLowerCase()}).`
                      })
                    }
                  >
                    {busy === variant ? '…' : label}
                  </button>
                ))
              : null}

            <a
              href={`/api/admin/lead-crm/drafts/${draft.id}/export`}
              className={primaryButtonClass}
              download
            >
              {draft.exported ? 'Download again' : 'Download .eml'}
            </a>

            <button
              type="button"
              disabled={busy !== null}
              className={buttonClass}
              onClick={() =>
                act('copy', async () => {
                  const result = await adminApi.post(`/api/admin/lead-crm/drafts/${draft.id}/export`, {})
                  await navigator.clipboard.writeText(`${result.subject}\n\n${result.bodyText}`)
                  return `Copied. Nothing has been sent — paste it into a reply to ${result.to} and send it yourself.`
                })
              }
            >
              {busy === 'copy' ? 'Copying…' : 'Copy subject & body'}
            </button>
          </>
        ) : null}

        <button
          type="button"
          disabled={busy !== null}
          className={buttonClass}
          onClick={() =>
            act('resolve', async () => {
              await adminApi.post(`/api/admin/lead-crm/replies/${reply.id}`, {
                action: 'resolve',
                conversationId: reply.conversationId,
              })
              return 'Marked resolved.'
            })
          }
        >
          Mark resolved
        </button>

        <button
          type="button"
          disabled={busy !== null}
          className={dangerButtonClass}
          onClick={async () => {
            // Decision 7: the same question as on the lead page, instead of a silent "address only".
            const domain = String(reply.fromAddress ?? '').split('@')[1]
            const answer = await confirmAction({
              title: 'Mark this lead do not contact?',
              body: 'The contact address is suppressed and the lead moves to a state it cannot leave without a privileged, audited removal.',
              confirmLabel: 'Mark do not contact',
              danger: true,
              option: domain ? { label: `Also suppress every address at ${domain}`, hint: 'Use this when the whole business asked not to be contacted.' } : undefined,
            })
            if (!answer) return
            act('dnc', async () => {
              await adminApi.post(`/api/admin/lead-crm/leads/${reply.leadId}/actions`, {
                action: 'do_not_contact',
                reason: 'Marked from the replies queue.',
                suppressDomain: Boolean(answer.option),
              })
              return answer.option ? `Marked do not contact; ${domain} suppressed.` : 'Marked do not contact.'
            })
          }}
        >
          Mark do not contact
        </button>
      </footer>
    </article>
  )
}

function RepliesPage() {
  const { data, state, reload } = useResource('/api/admin/lead-crm/replies')
  const replies = data?.replies ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Replies</h1>
        <p className="mt-1 text-sm text-slate-500">
          Prospects who answered and have not been answered back. Workers AI reads and suggests; you send.
        </p>
      </div>

      {state === 'loading' ? <p className="text-sm text-slate-500">Loading replies…</p> : null}
      {state === 'error' ? <p className="text-sm text-rose-600">Replies could not be loaded.</p> : null}

      {state === 'ready' && replies.length === 0 ? (
        <EmptyState
          title="No replies waiting."
          hint="Log a reply against its conversation and it appears here."
        />
      ) : null}

      <div className="space-y-4">
        {replies.map((reply) => (
          <ReplyCard key={reply.id} reply={reply} onChanged={reload} />
        ))}
      </div>
    </div>
  )
}

export default RepliesPage
