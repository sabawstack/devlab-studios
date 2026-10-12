import { useCallback, useEffect, useMemo, useState } from 'react'
import { RotateCw, Save } from '../icons/icons'
import seoContent from '../../data/seoContent'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const emptySeoPage = {
  id: '',
  pageSlug: '',
  metaTitle: '',
  metaDescription: '',
  metaKeywords: '',
  canonicalUrl: '',
  ogTitle: '',
  ogDescription: '',
  ogImage: '',
  twitterTitle: '',
  twitterDescription: '',
  twitterImage: '',
}

export default function SeoManager() {
  const [value, setValue] = useState(clone(seoContent))
  /**
   * Selection is by POSITION, not by slug.
   *
   * It used to look the row up by `pageSlug`, but Page Slug is an editable
   * field: typing one character into it meant the slug no longer matched,
   * `findIndex` returned -1, and `Math.max(0, -1)` silently selected row 0.
   * The editor appeared to jump to "About" mid-keystroke, and every further
   * keystroke then edited About's slug instead. A position cannot drift out
   * from under the thing it identifies.
   */
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [status, setStatus] = useState('Loading SEO content...')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const pages = useMemo(() => value.pages || [], [value.pages])
  // Reloading or deleting can shorten the list under a stale index.
  const safeIndex = Math.min(selectedIndex, Math.max(0, pages.length - 1))
  const selectedPage = pages[safeIndex] || emptySeoPage

  const loadContent = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/content/seo')
      if (response.status === 401) {
        setIsLoaded(false)
        setStatus('Admin API is protected. Sign in through Cloudflare Access before editing SEO.')
        return
      }
      // Same rule as SiteSettingsManager: unlocked only when the form holds
      // something safe to save over D1. Before that, a page added or edited
      // is overwritten when the fetch lands, and Save writes the fallback.
      if (response.status === 503) {
        const payload = await response.json()
        setValue(clone(seoContent))
        setStatus(`${payload.error} Loaded static fallback. Save to seed D1.`)
        setIsLoaded(true)
        return
      }
      if (!response.ok) {
        setIsLoaded(false)
        setStatus(`Unable to load SEO content (${response.status}). Editing is locked so the static fallback cannot overwrite it; press Refresh to try again.`)
        return
      }

      const data = await response.json()
      const nextValue = data?.pages?.length ? data : seoContent
      setValue(clone(nextValue))
      setStatus(data?.pages?.length ? 'Loaded SEO content from D1.' : 'No SEO content stored in D1 yet. Loaded static fallback; save to persist it.')
      setIsLoaded(true)
    } catch {
      setIsLoaded(false)
      setStatus('Unable to reach the SEO API. Editing is locked so the static fallback cannot overwrite your SEO content; press Refresh to try again.')
    }
  }, [])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  async function saveContent() {
    setIsSaving(true)
    setStatus('Saving SEO content...')

    try {
      const response = await fetch('/api/admin/content/seo', {
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
      setStatus(`SEO content saved at ${new Date().toLocaleTimeString()}.`)
    } catch {
      setStatus('SEO content save failed.')
    } finally {
      setIsSaving(false)
    }
  }

  function updateSelected(field, fieldValue) {
    setValue((current) => ({
      ...current,
      pages: (current.pages || []).map((item, index) => (index === safeIndex ? { ...item, [field]: fieldValue } : item)),
    }))
  }

  /**
   * Adds a page record. Without this the editor could only ever change rows
   * that already existed, so a new public route had no way to get SEO at all
   * short of a hand-written SQL statement — which is how /process, /privacy
   * and /terms ended up with none.
   */
  function addPage() {
    setValue((current) => {
      const next = [...(current.pages || []), { ...emptySeoPage }]
      setSelectedIndex(next.length - 1)
      return { ...current, pages: next }
    })
    setStatus('Added a page. Set its Page Slug to match the route, then save.')
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">SEO Content</h2>
          <p className="mt-1 text-sm text-slate-500">Manage page titles, descriptions, canonical URLs, and social metadata.</p>
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

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {status}
      </div>

      <fieldset disabled={!isLoaded} className="contents">
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-950">Pages</h3>
            </div>
            <div className="grid gap-3 px-4 py-4">
              {pages.map((item, index) => (
                <button
                  key={item.id || `page-${index}`}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={`rounded-md border px-4 py-3 text-left transition ${
                    index === safeIndex
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-sm font-semibold capitalize">{item.pageSlug || 'Untitled page'}</p>
                  <p className={`mt-1 text-xs ${index === safeIndex ? 'text-slate-300' : 'text-slate-500'}`}>
                    {item.canonicalUrl || 'No canonical URL'}
                  </p>
                </button>
              ))}
              <button
                type="button"
                onClick={addPage}
                className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-500 hover:text-slate-900"
              >
                + New page
              </button>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-950 capitalize">{selectedPage.pageSlug || 'Page'} Metadata</h3>
            </div>
            <div className="grid gap-4 px-5 py-5">
              {[
                ['pageSlug', 'Page Slug'],
                ['metaTitle', 'Meta Title'],
                ['metaDescription', 'Meta Description'],
                ['metaKeywords', 'Meta Keywords'],
                ['canonicalUrl', 'Canonical URL'],
                ['ogTitle', 'Open Graph Title'],
                ['ogDescription', 'Open Graph Description'],
                ['ogImage', 'Open Graph Image'],
                ['twitterTitle', 'Twitter Title'],
                ['twitterDescription', 'Twitter Description'],
                ['twitterImage', 'Twitter Image'],
              ].map(([key, label]) => (
                <label key={key} className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  {label}
                  {String(key).toLowerCase().includes('description') || key === 'metaKeywords' ? (
                    <textarea
                      rows={key === 'metaKeywords' ? 3 : 4}
                      value={selectedPage[key] || ''}
                      onChange={(event) => updateSelected(key, event.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  ) : (
                    <input
                      value={selectedPage[key] || ''}
                      onChange={(event) => updateSelected(key, event.target.value)}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  )}
                </label>
              ))}
            </div>
          </section>
        </div>
      </fieldset>
    </div>
  )
}
