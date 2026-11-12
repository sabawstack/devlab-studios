import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminApi } from '../lib/adminApi'
import { BLOCK_FIELDS, BLOCK_LABELS, PAGE_BLOCK_TYPES, createEmptyBlockProps } from '../lib/blockFieldDescriptors'
import SchemaForm from '../components/SchemaForm'
import VersionHistoryPanel from './VersionHistoryPanel'
import PublicUsageNotice from '../components/PublicUsageNotice'
import { PUBLIC_SURFACES } from '../../config/publicSurfaces'
import { PAGE_STATUSES } from '../../lib/schemas/singletons'

// Only what the pages table accepts; 'archived' used to fail every save.
const STATUS_OPTIONS = PAGE_STATUSES
const HIDDEN_PUBLIC_BLOCKS = new Set(['featuredCaseStudies', 'testimonials'])
const PAGE_ALLOWED_BLOCK_TYPES = {
  home: ['hero', 'stats', 'richText', 'servicesGrid', 'processSteps'],
  about: ['hero', 'stats', 'richText', 'servicesGrid', 'faq', 'cta'],
  solutions: ['hero', 'richText', 'faq', 'cta'],
  insights: ['hero', 'richText', 'cta'],
  contact: ['hero', 'stats', 'cta'],
}
const RELATED_LIBRARY = {
  services: { label: 'Edit Service Catalog', to: '/admin/content/services' },
  insights: { label: 'Edit Insight Articles', to: '/admin/content/resources' },
  work: { label: 'Edit Projects', to: '/admin/content/projects' },
  profile: { label: 'Edit Profile Records', to: '/admin/content/profile' },
}

function PageBuilderPage() {
  const { slug } = useParams()
  const [page, setPage] = useState(null)
  const [status, setStatus] = useState('loading')
  const [message, setMessage] = useState(null)
  const [showHistory, setShowHistory] = useState(false)
  const [newBlockType, setNewBlockType] = useState(PAGE_BLOCK_TYPES[0])
  const surface = PUBLIC_SURFACES.find((item) => item.key === slug)
  const relatedLibrary = RELATED_LIBRARY[slug]
  const allowedBlockTypes = PAGE_ALLOWED_BLOCK_TYPES[slug] || PAGE_BLOCK_TYPES
  const hiddenBlockCount = page?.blocks?.filter((block) => HIDDEN_PUBLIC_BLOCKS.has(block.type) || !allowedBlockTypes.includes(block.type)).length || 0

  useEffect(() => {
    let ignore = false
    adminApi
      .get(`/api/admin/pages/${slug}`)
      .then((data) => !ignore && (setPage(data), setStatus('ready')))
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [slug])

  if (status === 'loading') return <p className="text-sm text-slate-500">Loading…</p>
  if (status === 'error' || !page) return <p className="text-sm text-rose-600">Could not load this page.</p>

  function updateBlockProps(index, props) {
    setPage((current) => ({
      ...current,
      blocks: current.blocks.map((block, i) => (i === index ? { ...block, props } : block)),
    }))
  }

  function addBlock() {
    setPage((current) => ({
      ...current,
      blocks: [...current.blocks, { type: newBlockType, props: createEmptyBlockProps(newBlockType) }],
    }))
  }

  function removeBlock(index) {
    setPage((current) => ({ ...current, blocks: current.blocks.filter((_, i) => i !== index) }))
  }

  function moveBlock(index, direction) {
    setPage((current) => {
      const blocks = [...current.blocks]
      const target = index + direction
      if (target < 0 || target >= blocks.length) return current
      ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
      return { ...current, blocks }
    })
  }

  async function handleSave() {
    setMessage(null)
    try {
      const saved = await adminApi.put(`/api/admin/pages/${slug}`, page)
      setPage(saved)
      setMessage({ type: 'success', text: 'Saved.' })
    } catch (error) {
      const detail = error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      setMessage({ type: 'error', text: detail ? `${error.message} (${detail})` : error.message })
    }
  }

  return (
    <div className="space-y-6">
      <PublicUsageNotice
        label={surface?.label || page.title || slug}
        publicPath={surface?.publicPath || `/${slug}`}
        description={surface?.description || 'Controls the corresponding public page.'}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Page: {page.title || slug}</h1>
        <div className="flex gap-2">
          {relatedLibrary ? <a href={relatedLibrary.to} className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100">{relatedLibrary.label}</a> : null}
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {showHistory ? 'Hide History' : 'Version History'}
          </button>
          <button type="button" onClick={handleSave} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
            Save Page
          </button>
        </div>
      </div>

      {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

      {showHistory ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <VersionHistoryPanel contentType="pages" contentId={slug} onRestored={setPage} />
        </div>
      ) : null}

      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="page-title" className="text-sm font-semibold text-slate-700">Title</label>
          <input
            id="page-title"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            value={page.title || ''}
            onChange={(e) => setPage((current) => ({ ...current, title: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="page-status" className="text-sm font-semibold text-slate-700">Status</label>
          <select
            id="page-status"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
            value={page.status || 'draft'}
            onChange={(e) => setPage((current) => ({ ...current, status: e.target.value }))}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="new-block-type" className="sr-only">Block type to add</label>
        <select
          id="new-block-type"
          value={newBlockType}
          onChange={(e) => setNewBlockType(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        >
          {allowedBlockTypes.map((type) => (
            <option key={type} value={type}>{BLOCK_LABELS[type]}</option>
          ))}
        </select>
        <button type="button" onClick={addBlock} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Add Block
        </button>
      </div>

      <div className="space-y-4">
        {hiddenBlockCount ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{hiddenBlockCount} legacy block{hiddenBlockCount === 1 ? '' : 's'} retained in storage but hidden because this public page does not render that component.</p> : null}
        {page.blocks.map((block, index) => HIDDEN_PUBLIC_BLOCKS.has(block.type) || !allowedBlockTypes.includes(block.type) ? null : (
          <div key={index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="rounded-full bg-brand-mint px-3 py-1 text-xs font-semibold text-brand-teal">{BLOCK_LABELS[block.type] || block.type}</span>
              <div className="flex gap-2 text-xs font-semibold text-slate-500">
                <button type="button" onClick={() => moveBlock(index, -1)} className="hover:text-slate-800">Up</button>
                <button type="button" onClick={() => moveBlock(index, 1)} className="hover:text-slate-800">Down</button>
                <button type="button" onClick={() => removeBlock(index)} className="text-rose-600 hover:text-rose-800">Remove</button>
              </div>
            </div>
            <SchemaForm
              fields={BLOCK_FIELDS[block.type] || []}
              value={block.props || {}}
              onChange={(props) => updateBlockProps(index, props)}
              idPrefix={`block-${index}`}
            />
          </div>
        ))}
        {!page.blocks.length ? <p className="text-sm text-slate-500">No blocks yet — add one above.</p> : null}
      </div>
    </div>
  )
}

export default PageBuilderPage
