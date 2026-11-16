import { useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { buttonClass, formatDate, inputClass, primaryButtonClass } from './format'
import { Badge, Feedback, Panel } from './shared'
import { useResource } from './useResource'
import { confirmAction } from '../../primitives/confirm'
import { LoadState } from '../../primitives/index.jsx'

/**
 * Lead CRM settings.
 *
 * Two things live here and are kept visually separate because they behave
 * differently:
 *
 *   - TUNABLES (thresholds, weights, budgets, crawler limits, business
 *     identity). Editable, stored in D1, layered over the code defaults. A
 *     "Reset" removes the override and restores the default rather than
 *     writing the default back — so a later change to the default is picked up.
 *   - OPERATIONAL SWITCHES. Editable here and stored in D1, but bounded by
 *     deployment-level Worker vars. The Worker vars remain the emergency stop;
 *     the UI cannot enable a capability the deployment has forbidden.
 *
 * No credential value is ever rendered. The API masks anything marked secret
 * before it leaves the Worker, so it is not in the page source or the network
 * tab either.
 */

function SettingEditor({ settingKey, value, metadata, onSaved }) {
  const [draft, setDraft] = useState(() => JSON.stringify(value, null, 2))
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [isOpen, setIsOpen] = useState(false)

  const override = metadata.find((entry) => entry.key === settingKey)

  async function save() {
    setBusy(true)
    setFeedback(null)
    try {
      const parsed = JSON.parse(draft)
      await adminApi.put('/api/admin/lead-crm/settings', { key: settingKey, value: parsed })
      setFeedback({ tone: 'ok', message: 'Saved.' })
      onSaved()
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof SyntaxError ? 'That is not valid JSON.' : error.message,
      })
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setFeedback(null)
    try {
      await adminApi.delete(`/api/admin/lead-crm/settings?key=${encodeURIComponent(settingKey)}`)
      setFeedback({ tone: 'ok', message: 'Override removed — the built-in default applies again.' })
      onSaved()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  const isMasked = typeof value === 'string' && value.startsWith('••••')

  return (
    <div className="rounded-lg border border-slate-200">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="font-mono text-xs text-slate-700">{settingKey}</span>
        <span className="flex items-center gap-2">
          {override ? (
            <Badge value="overridden" tones={{ overridden: 'bg-sky-100 text-sky-800' }} label="Overridden" />
          ) : (
            <Badge value="default" tones={{ default: 'bg-slate-100 text-slate-500' }} label="Default" />
          )}
          <span className="text-xs text-slate-400">{isOpen ? '−' : '+'}</span>
        </span>
      </button>

      {isOpen ? (
        <div className="space-y-2 border-t border-slate-200 p-3">
          {isMasked ? (
            <p className="text-xs text-slate-500">This value is masked and cannot be viewed here.</p>
          ) : (
            <textarea
              rows={Math.min(16, draft.split('\n').length + 1)}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={`Value of ${settingKey}`}
              className={`${inputClass} w-full font-mono text-xs`}
            />
          )}

          <Feedback feedback={feedback} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || isMasked} className={primaryButtonClass} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {override ? (
              <button type="button" disabled={busy} className={buttonClass} onClick={reset}>
                Reset to default
              </button>
            ) : null}
            {override ? (
              <span className="text-xs text-slate-400">
                Last changed {formatDate(override.updatedAt)} by {override.updatedBy || 'unknown'}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}


const FLAG_ROWS = [
  { key: 'engine', label: 'Engine (master switch)', varName: 'LEAD_ENGINE_ENABLED' },
  { key: 'discovery', label: 'Discovery', varName: 'LEAD_DISCOVERY_ENABLED' },
  { key: 'crawler', label: 'Crawler', varName: 'LEAD_CRAWLER_ENABLED' },
  { key: 'browserRun', label: 'Browser rendering fallback', varName: 'LEAD_BROWSER_RUN_ENABLED' },
  { key: 'ai', label: 'Workers AI', varName: 'LEAD_AI_ENABLED' },
  { key: 'tracking', label: 'First-party tracking', varName: 'LEAD_TRACKING_ENABLED' },
  { key: 'campaignSchedules', label: 'Campaign schedules', varName: 'LEAD_CAMPAIGN_SCHEDULES_ENABLED', confirm: true },
]

function FlagRow({ item, state, busy, onToggle }) {
  const requested = Boolean(state.requested?.[item.key])
  const effective = Boolean(state.effective?.[item.key])
  const deploymentAllowed = Boolean(state.deployment?.engine && state.deployment?.[item.key])
  const disabled = busy || !state.available || !deploymentAllowed

  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 last:border-b-0">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{item.label}</span>
          <Badge
            value={effective ? 'on' : 'off'}
            tones={{ on: 'bg-emerald-100 text-emerald-800', off: 'bg-slate-100 text-slate-500' }}
            label={effective ? 'On' : requested ? 'Armed' : 'Off'}
          />
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          <code>{item.varName}</code>
          {!deploymentAllowed ? ' · locked by deployment configuration' : ''}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-label={`${item.label} operational switch`}
        aria-checked={requested}
        disabled={disabled}
        onClick={() => onToggle(item, !requested)}
        className={`relative inline-flex h-6 w-11 flex-none rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ws-focus)] focus-visible:ring-offset-2 ${
          requested ? 'bg-[var(--ws-action)]' : 'bg-slate-300'
        } disabled:cursor-not-allowed disabled:opacity-45`}
      >
        <span
          aria-hidden="true"
          className={`mt-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            requested ? 'translate-x-[1.375rem]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function FeatureFlagsPanel() {
  const { data, state, reload } = useResource('/api/admin/lead-crm/feature-flags')
  const [busyKey, setBusyKey] = useState(null)
  const [feedback, setFeedback] = useState(null)

  async function toggle(item, enabled) {
    if (
      enabled &&
      item.confirm &&
      !(await confirmAction({
        title: 'Enable unattended campaign schedules?', body: 'Individual campaigns must still be armed separately.', confirmLabel: 'Enable',
      }))
    ) {
      return
    }

    setBusyKey(item.key)
    setFeedback(null)
    try {
      await adminApi.put('/api/admin/lead-crm/feature-flags', { key: item.key, enabled })
      setFeedback({ tone: 'ok', message: `${item.label} turned ${enabled ? 'on' : 'off'}.` })
      reload()
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message })
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <Panel
      title="Operational switches"
      description="Changes take effect immediately. Worker vars remain the deployment-level emergency stop."
    >
      <LoadState state={state} label="switches" onRetry={reload} />
      {data ? (
        <div>
          {FLAG_ROWS.map((item) => (
            <FlagRow key={item.key} item={item} state={data} busy={busyKey === item.key} onToggle={toggle} />
          ))}
        </div>
      ) : null}
      <Feedback feedback={feedback} />
      <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-500">
        A deployment-locked switch cannot be enabled here. There is no automated-send switch, and no mail provider
        to configure: this system writes drafts and hands them to you as files, and a person sends them.
      </p>
    </Panel>
  )
}

function SettingsPage() {
  const { data, state, reload } = useResource('/api/admin/lead-crm/settings')

  const settings = data?.settings ?? {}
  const metadata = data?.metadata ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Lead CRM settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Control live capabilities, thresholds, weights, budgets and business identity from one place.
        </p>
      </div>

      <FeatureFlagsPanel />

      <Panel
        title="Tunables"
        description="Stored overrides layered over the code defaults in src/lead-engine/config/defaults.js."
      >
        <LoadState state={state} label="settings" onRetry={reload} />
        <div className="space-y-2">
          {Object.entries(settings).map(([key, value]) => (
            <SettingEditor key={key} settingKey={key} value={value} metadata={metadata} onSaved={reload} />
          ))}
        </div>
      </Panel>
    </div>
  )
}

export default SettingsPage
