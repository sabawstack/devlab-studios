import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, formatDate, humanize, inputClass, primaryButtonClass } from './format'
import { Badge, EmptyState, Feedback } from './shared'
import { useResource } from './useResource'

/**
 * The source registry.
 *
 * A source that is not a row here cannot be used by the engine at all. The
 * database keeps separate fail-closed permissions, while this screen combines
 * them into the single operator intent: may this source supply lead candidates?
 *
 * `policyStatus` records a HUMAN's reading of that source's terms. Automation
 * cannot be enabled until it says `approved`, and the API enforces that, not
 * just this form.
 */

const POLICY_TONES = {
  approved: 'bg-emerald-100 text-emerald-800',
  unreviewed: 'bg-amber-100 text-amber-800',
  restricted: 'bg-orange-100 text-orange-800',
  prohibited: 'bg-rose-100 text-rose-800',
}

function SourceRow({ source, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [notes, setNotes] = useState(source.policyNotes ?? '')
  const [isEditing, setIsEditing] = useState(false)
  const isManualImport = source.type === 'manual_import'
  const isAvailable = source.enabled && source.automationAllowed
  const controlLabel = isManualImport ? 'Allow manual lead import' : 'Use for automated lead discovery'

  async function patch(changes, message) {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await adminApi.patch(`/api/admin/lead-crm/sources?slug=${encodeURIComponent(source.slug)}`, changes)
      onChanged(result.source)
      setFeedback({ tone: 'ok', message })
      return true
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{source.name}</h3>
            <Badge value={source.policyStatus} tones={POLICY_TONES} />
            {isAvailable ? <Badge value="active" tones={{ active: 'bg-slate-900 text-white' }} /> : null}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {humanize(source.type)} · {source.recordCount ?? 0} records · parser v{source.parserVersion}
            {source.lastRunAt ? ` · last run ${formatDate(source.lastRunAt)}` : ''}
          </p>
          {source.baseUrl ? (
            <a
              href={source.baseUrl}
              target="_blank"
              rel="noreferrer nofollow"
              className="text-xs text-slate-400 hover:text-brand-teal hover:underline"
            >
              {source.baseUrl}
            </a>
          ) : null}
          {source.lastRunError ? <p className="mt-1 text-xs text-rose-600">{source.lastRunError}</p> : null}
        </div>
      </div>

      <Feedback feedback={feedback} />

      <div className="border-t border-slate-200 pt-3">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={isAvailable}
            disabled={busy || source.policyStatus !== 'approved'}
            onChange={(event) => {
              const enabled = event.target.checked
              patch(
                { enabled, automationAllowed: enabled },
                enabled ? `${controlLabel} enabled.` : `${controlLabel} disabled.`,
              )
            }}
          />
          <span>
            <span className="block text-xs font-medium text-slate-700">{controlLabel}</span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {source.policyStatus !== 'approved'
                ? 'Review and approve this source first.'
                : isManualImport
                  ? 'Lets an operator paste domains or upload a CSV. It does not run automatically.'
                  : 'Lets active campaigns request lead candidates from this API.'}
            </span>
          </span>
        </label>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Policy last reviewed{' '}
            {source.lastPolicyReviewedAt
              ? `${formatDate(source.lastPolicyReviewedAt)} by ${source.lastPolicyReviewedBy || 'unknown'}`
              : 'never'}
          </p>
          <button type="button" className={buttonClass} onClick={() => setIsEditing((current) => !current)}>
            {isEditing ? 'Cancel' : 'Record a policy review'}
          </button>
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            <textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="What do this source's terms say about automated access?"
              className={`${inputClass} w-full`}
            />
            <div className="flex flex-wrap gap-2">
              {['approved', 'restricted', 'prohibited', 'unreviewed'].map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy}
                  className={status === 'approved' ? primaryButtonClass : buttonClass}
                  onClick={() =>
                    // CRM-02: a failed save keeps the editor open with the error and the typed notes.
                    patch({ policyStatus: status, policyNotes: notes }, `Policy recorded as ${status}.`).then((saved) => {
                      if (saved) setIsEditing(false)
                    })
                  }
                >
                  Mark {status}
                </button>
              ))}
            </div>
          </div>
        ) : source.policyNotes ? (
          <p className="mt-2 text-xs text-slate-600">{source.policyNotes}</p>
        ) : null}
      </div>
    </div>
  )
}

function SourcesPage() {
  const { data, state, setData } = useResource('/api/admin/lead-crm/sources')
  const sources = data?.sources ?? []

  function handleChanged(updated) {
    setData((current) => ({
      ...current,
      sources: current.sources.map((source) => (source.slug === updated.slug ? updated : source)),
    }))
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sources</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose where lead candidates may come from. A source becomes available only after its policy has been reviewed
          and approved.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Website research is controlled separately by the Crawler switch in CRM Settings.
        </p>
      </div>

      {state === 'loading' ? <p className="text-sm text-slate-500">Loading sources…</p> : null}
      {state === 'ready' && sources.length === 0 ? (
        <EmptyState title="No sources registered." hint="Run the seed script to register the built-in adapters." />
      ) : null}

      <div className="space-y-3">
        {sources.map((source) => (
          <SourceRow key={source.slug} source={source} onChanged={handleChanged} />
        ))}
      </div>
    </div>
  )
}

export default SourcesPage
