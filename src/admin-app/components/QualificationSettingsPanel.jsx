import { useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

/**
 * Qualification thresholds and weights (audit LEAD-04), on the Inquiries
 * screen. Every number starts at today's built-in default; only values that
 * differ from the default are stored, and "Reset to defaults" clears them all.
 * Changes apply to new inquiries only -- stored ones keep their tier and the
 * reasons they were given.
 */
const GROUPS = [
  { key: 'thresholds', title: 'Tier thresholds', help: 'Minimum score for each tier. Must descend: priority > standard > nurture. Messages shorter than the minimum length always go to review.' },
  { key: 'timelinePoints', title: 'Timeline points' },
  { key: 'budgetPoints', title: 'Budget points' },
  { key: 'teamSizePoints', title: 'Team size points' },
  { key: 'signalPoints', title: 'Other signals' },
]

function humanize(key) {
  return key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/** Only the values that differ from the defaults, so a later default change still applies elsewhere. */
function overridesFrom(values, defaults) {
  const result = {}
  for (const { key } of GROUPS) {
    const changed = Object.fromEntries(
      Object.entries(values[key] || {}).filter(([field, value]) => value !== defaults[key][field]),
    )
    if (Object.keys(changed).length) result[key] = changed
  }
  return result
}

function QualificationSettingsPanel() {
  const [open, setOpen] = useState(false)
  const [defaults, setDefaults] = useState(null)
  const [values, setValues] = useState(null)
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || defaults) return
    let ignore = false
    adminApi
      .get('/api/admin/leads/qualification-settings')
      .then((data) => {
        if (ignore) return
        setDefaults(data.defaults)
        setValues(data.effective)
      })
      .catch((error) => !ignore && setMessage({ tone: 'error', text: error.message || 'Could not load the settings.' }))
    return () => {
      ignore = true
    }
  }, [open, defaults])

  async function save(overrides) {
    setSaving(true)
    setMessage(null)
    try {
      const data = await adminApi.put('/api/admin/leads/qualification-settings', overrides)
      setValues(data.effective)
      setMessage({ tone: 'ok', text: 'Saved. New inquiries are scored with these values.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error.message || 'Could not save the settings.' })
    } finally {
      setSaving(false)
    }
  }

  const setField = (group, field, raw) => {
    const number = raw === '' ? '' : Number(raw)
    setValues((current) => ({ ...current, [group]: { ...current[group], [field]: number } }))
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-800"
      >
        Qualification settings
        <span className="text-xs font-normal text-slate-500">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-200 px-4 py-4">
          {!values && !message && <p className="text-sm text-slate-500">Loading…</p>}
          {values && defaults && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                save(overridesFrom(values, defaults))
              }}
              className="space-y-5"
            >
              {GROUPS.map((group) => (
                <fieldset key={group.key} className="space-y-2">
                  <legend className="text-sm font-semibold text-slate-800">{group.title}</legend>
                  {group.help && <p className="text-xs text-slate-500">{group.help}</p>}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {Object.keys(defaults[group.key]).map((field) => {
                      const id = `qualification-${group.key}-${field}`
                      return (
                        <label key={field} htmlFor={id} className="grid gap-1 text-xs font-medium text-slate-700">
                          {humanize(field)}
                          <input
                            id={id}
                            type="number"
                            min="0"
                            step="1"
                            required
                            value={values[group.key][field]}
                            onChange={(event) => setField(group.key, field, event.target.value)}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                          />
                          <span className="text-[11px] font-normal text-slate-400">Default {defaults[group.key][field]}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save qualification settings'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({})}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
                >
                  Reset to defaults
                </button>
              </div>
            </form>
          )}
          {message && (
            <p role="status" className={message.tone === 'error' ? 'text-sm text-rose-700' : 'text-sm text-emerald-700'}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export default QualificationSettingsPanel
