import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, RotateCw, Save, Trash2 } from '../icons/icons'
import siteSettingsContent from '../../data/siteSettingsContent'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function moveItem(items, index, direction) {
  const next = [...items]
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= next.length) return items
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

function RowActions({ onMoveUp, onMoveDown, onRemove, disableUp, disableDown }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={disableUp}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronUp size={14} />
        Up
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={disableDown}
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronDown size={14} />
        Down
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
      >
        <Trash2 size={14} />
        Remove
      </button>
    </div>
  )
}

function SectionHeader({ title, description, action }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

function ArrayEditor({ title, description, items, onChange, createItem, fields }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <SectionHeader
        title={title}
        description={description}
        action={(
          <button
            type="button"
            onClick={() => onChange([...items, createItem(items.length)])}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Plus size={16} />
            Add Item
          </button>
        )}
      />
      <div className="grid gap-4 px-5 py-5">
        {items.map((item, index) => (
          <article key={item.id || `${title}-${index}`} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{title} {index + 1}</p>
              <RowActions
                onMoveUp={() => onChange(moveItem(items, index, -1))}
                onMoveDown={() => onChange(moveItem(items, index, 1))}
                onRemove={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                disableUp={index === 0}
                disableDown={index === items.length - 1}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field.key} className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  {field.label}
                  <input
                    value={item[field.key] || ''}
                    onChange={(event) => onChange(items.map((entry, itemIndex) => itemIndex === index ? { ...entry, [field.key]: event.target.value } : entry))}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

export default function SiteSettingsManager() {
  const [value, setValue] = useState(clone(siteSettingsContent))
  const [status, setStatus] = useState('Loading site settings...')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const loadContent = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/content/site-settings')
      if (response.status === 401) {
        setIsLoaded(false)
        setStatus('Admin API is protected. Sign in through Cloudflare Access before editing site settings.')
        return
      }
      // Unlocked only when the form holds something safe to save over D1: the
      // stored settings, or the static fallback when there is no database to
      // overwrite (503) or nothing stored yet. A failed load stays locked --
      // saving the fallback then would overwrite settings we failed to read --
      // and Refresh retries it.
      if (response.status === 503) {
        const payload = await response.json()
        setValue(clone(siteSettingsContent))
        setStatus(`${payload.error} Loaded static fallback. Save to seed D1.`)
        setIsLoaded(true)
        return
      }
      if (!response.ok) {
        setIsLoaded(false)
        setStatus(`Unable to load site settings (${response.status}). Editing is locked so the static fallback cannot overwrite them; press Refresh to try again.`)
        return
      }

      const data = await response.json()
      const nextValue = data?.navigation?.length ? data : siteSettingsContent
      setValue(clone(nextValue))
      setStatus(data?.navigation?.length ? 'Loaded site settings from D1.' : 'No site settings stored in D1 yet. Loaded static fallback; save to persist it.')
      setIsLoaded(true)
    } catch {
      setIsLoaded(false)
      setStatus('Unable to reach the site settings API. Editing is locked so the static fallback cannot overwrite your settings; press Refresh to try again.')
    }
  }, [])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  async function saveContent() {
    setIsSaving(true)
    setStatus('Saving site settings...')

    try {
      const response = await fetch('/api/admin/content/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })

      const data = await response.json()
      if (!response.ok) {
        setStatus(data.error || `Save failed (${response.status}).`)
        return
      }

      setValue(clone(data))
      setStatus(`Site settings saved at ${new Date().toLocaleTimeString()}.`)
    } catch {
      setStatus('Site settings save failed.')
    } finally {
      setIsSaving(false)
    }
  }

  const stats = useMemo(() => ([
    { label: 'Navigation Items', value: value.navigation?.length || 0 },
    { label: 'Footer Links', value: value.footer?.quickLinks?.length || 0 },
    { label: 'Social Links', value: value.footer?.socialLinks?.length || 0 },
  ]), [value])

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Site Settings</h2>
          <p className="mt-1 text-sm text-slate-500">Manage navigation labels, CTA text, footer links, contact details, and social links.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={loadContent}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCw size={16} />
            Refresh
          </button>
          <button
            type="button"
            onClick={saveContent}
            disabled={isSaving || !isLoaded}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} />
            Save Content
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {status}
      </div>

      {/* Locked until the stored settings have loaded. The form starts out
          showing the static fallback, so an edit made before the fetch lands is
          silently overwritten by it, and a Save in that window writes the
          fallback over what is in D1. */}
      <fieldset disabled={!isLoaded} className="contents">
        <ArrayEditor
          title="Navigation"
          description="Primary header navigation."
          items={value.navigation || []}
          onChange={(navigation) => setValue((current) => ({ ...current, navigation }))}
          createItem={(index) => ({
            id: makeId('nav'),
            label: '',
            href: '/',
            sortOrder: (index + 1) * 10,
            status: 'published',
          })}
          fields={[
            { key: 'label', label: 'Label' },
            { key: 'href', label: 'Path' },
          ]}
        />

        <section className="rounded-md border border-slate-200 bg-white">
          <SectionHeader title="CTA Labels" description="Header and mobile CTA button labels." />
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
              Header CTA
              <input
                value={value.ctas?.navbarContactLabel || ''}
                onChange={(event) => setValue((current) => ({ ...current, ctas: { ...(current.ctas || {}), navbarContactLabel: event.target.value } }))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
              Mobile CTA
              <input
                value={value.ctas?.mobileContactLabel || ''}
                onChange={(event) => setValue((current) => ({ ...current, ctas: { ...(current.ctas || {}), mobileContactLabel: event.target.value } }))}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
              />
            </label>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white">
          <SectionHeader title="Footer Identity" description="Main footer copy and contact info." />
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            {[
              ['companyName', 'Company Name'],
              ['tagline', 'Tagline'],
              ['email', 'Email'],
              ['location', 'Location'],
              ['copyright', 'Copyright'],
            ].map(([key, label]) => (
              <label key={key} className="grid gap-1.5 text-sm font-semibold text-slate-800">
                {label}
                <input
                  value={value.footer?.[key] || ''}
                  onChange={(event) => setValue((current) => ({ ...current, footer: { ...(current.footer || {}), [key]: event.target.value } }))}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>
            ))}
          </div>
        </section>

        <ArrayEditor
          title="Quick Links"
          description="Footer quick links."
          items={value.footer?.quickLinks || []}
          onChange={(quickLinks) => setValue((current) => ({ ...current, footer: { ...(current.footer || {}), quickLinks } }))}
          createItem={(index) => ({
            id: makeId(`quick-link-${index + 1}`),
            label: '',
            href: '/',
          })}
          fields={[
            { key: 'label', label: 'Label' },
            { key: 'href', label: 'Path' },
          ]}
        />

        <ArrayEditor
          title="Social Links"
          description="Footer outbound links."
          items={value.footer?.socialLinks || []}
          onChange={(socialLinks) => setValue((current) => ({ ...current, footer: { ...(current.footer || {}), socialLinks } }))}
          createItem={(index) => ({
            id: makeId(`social-link-${index + 1}`),
            label: '',
            href: '',
          })}
          fields={[
            { key: 'label', label: 'Label' },
            { key: 'href', label: 'URL' },
          ]}
        />

        <ArrayEditor
          title="Legal Links"
          description="Footer Privacy/Terms links."
          items={value.footer?.legalLinks || []}
          onChange={(legalLinks) => setValue((current) => ({ ...current, footer: { ...(current.footer || {}), legalLinks } }))}
          createItem={(index) => ({
            id: makeId(`legal-link-${index + 1}`),
            label: '',
            href: '/',
          })}
          fields={[
            { key: 'label', label: 'Label' },
            { key: 'href', label: 'Path' },
          ]}
        />
      </fieldset>
    </div>
  )
}
