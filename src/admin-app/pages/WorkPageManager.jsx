import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { workPage as staticWorkPage } from '../../data/pages/work'
import { portfolioItems } from '../../data/portfolio'
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  Image,
  Plus,
  RotateCw,
  Save,
  Search,
  Trash2,
} from '../../components/icons/icons'
import { adminApi } from '../lib/adminApi'
import VersionHistoryPanel from './VersionHistoryPanel'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizePage(value) {
  const fallback = clone(staticWorkPage)
  if (!value?.blocks?.length) return fallback

  const blocksByType = new Map(value.blocks.map((block) => [block.type, block]))
  return {
    ...fallback,
    ...value,
    blocks: fallback.blocks.map((fallbackBlock) => blocksByType.get(fallbackBlock.type) || fallbackBlock),
  }
}

function imageSource(project) {
  if (project?.imageUrl) return project.imageUrl
  if (typeof project?.image === 'string') return project.image
  return project?.image?.src || ''
}

function mediaCount(project) {
  const galleryCount = Array.isArray(project?.galleryImages) ? project.galleryImages.length : 0
  return Math.max(galleryCount, imageSource(project) ? 1 : 0)
}

function blockOf(page, type) {
  return page.blocks.find((block) => block.type === type)
}

function Field({ label, value, onChange, type = 'text', rows = 4, help = '' }) {
  const className = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-teal focus:ring-2 focus:ring-brand-teal/10'
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
      {label}
      {type === 'textarea' ? (
        <textarea className={className} rows={rows} value={value || ''} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input className={className} type={type} value={value || ''} onChange={(event) => onChange(event.target.value)} />
      )}
      {help ? <span className="text-xs font-normal leading-5 text-slate-500">{help}</span> : null}
    </label>
  )
}

function Section({ title, description, children, action = null }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function WorkPageManager() {
  const [page, setPage] = useState(() => clone(staticWorkPage))
  const [projects, setProjects] = useState([])
  const [message, setMessage] = useState('Loading Work content and Projects…')
  const [search, setSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isReadOnly, setIsReadOnly] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const loadContent = useCallback(async () => {
    setMessage('Loading Work content and Projects…')
    try {
      const [pageData, projectData] = await Promise.all([
        adminApi.get('/api/admin/pages/work'),
        adminApi.get('/api/admin/projects'),
      ])
      setPage(normalizePage(pageData))
      setProjects(Array.isArray(projectData) ? projectData : [])
      setIsReadOnly(false)
      setMessage('Loaded Work content and Project records from D1.')
    } catch (error) {
      setPage(clone(staticWorkPage))
      setProjects(portfolioItems)
      setIsReadOnly(true)
      setMessage(`${error.message || 'The admin API is unavailable.'} Showing the static Work fallback in read-only mode.`)
    }
  }, [])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  const hero = blockOf(page, 'hero')
  const showcase = blockOf(page, 'workProjectShowcase')
  const caseStudies = blockOf(page, 'featuredCaseStudies')
  const cta = blockOf(page, 'cta')
  // Memoized on `showcase` rather than computed inline: `|| []` mints a fresh
  // array on every render where the block has no items, which made the
  // `selectedIds` memo below recompute every time and, through it, the
  // `availableProjects` filter. The memo existed but never memoized anything.
  const featuredItems = useMemo(() => showcase?.props?.items || [], [showcase])
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const selectedIds = useMemo(() => new Set(featuredItems.map((item) => item.projectId)), [featuredItems])
  const availableProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    return projects.filter((project) => {
      if (selectedIds.has(project.id)) return false
      if (!query) return true
      return [project.title, project.id, project.type, ...(project.techStack || [])]
        .some((value) => String(value || '').toLowerCase().includes(query))
    })
  }, [projects, search, selectedIds])

  function updateBlock(type, updater) {
    setPage((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (
        block.type === type ? { ...block, props: updater(block.props) } : block
      )),
    }))
  }

  function updateHero(field, value) {
    updateBlock('hero', (props) => ({ ...props, [field]: value }))
  }

  function updateShowcase(field, value) {
    updateBlock('workProjectShowcase', (props) => ({ ...props, [field]: value }))
  }

  function updateFeaturedItem(index, patch) {
    updateBlock('workProjectShowcase', (props) => ({
      ...props,
      items: props.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }))
  }

  function addProject(project) {
    updateBlock('workProjectShowcase', (props) => ({
      ...props,
      items: [
        ...props.items,
        {
          projectId: project.id,
          description: project.description || '',
          challenge: '',
          systemArchitecture: '',
          deliveryValue: '',
          status: 'draft',
        },
      ],
    }))
    setMessage(`Added “${project.title}” as a draft Work entry. Its description was copied once from Projects.`)
  }

  function removeProject(index) {
    const item = featuredItems[index]
    const title = projectsById.get(item?.projectId)?.title || item?.projectId || 'this project'
    if (!window.confirm(`Remove “${title}” from Work? The Project and its images will not be deleted.`)) return
    updateShowcase('items', featuredItems.filter((_, itemIndex) => itemIndex !== index))
  }

  function moveProject(index, direction) {
    const target = index + direction
    if (target < 0 || target >= featuredItems.length) return
    const items = [...featuredItems]
    ;[items[index], items[target]] = [items[target], items[index]]
    updateShowcase('items', items)
  }

  function resetDescription(index) {
    const item = featuredItems[index]
    const project = projectsById.get(item.projectId)
    if (!project) return
    if (!window.confirm('Replace the independent Work description with the Project’s current description?')) return
    updateFeaturedItem(index, { description: project.description || '' })
    setMessage(`Reset the Work description for “${project.title}”. Save Work to persist it.`)
  }

  async function savePage() {
    if (isReadOnly) return
    setIsSaving(true)
    setMessage('Saving Work content…')
    try {
      const saved = await adminApi.put('/api/admin/pages/work', page)
      setPage(normalizePage(saved))
      setMessage(`Work content saved at ${new Date().toLocaleTimeString()}.`)
    } catch (error) {
      const detail = error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      setMessage(detail ? `${error.message} (${detail})` : error.message || 'Work content could not be saved.')
    } finally {
      setIsSaving(false)
    }
  }

  function restorePage(restored) {
    setPage(normalizePage(restored))
    setShowHistory(false)
    setMessage('Work content restored. Review the page and save any further changes.')
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-teal">Pages</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Work</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Select existing Projects, order their presentation, and maintain Work-specific narrative. Images remain managed exclusively under Projects.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setShowHistory((current) => !current)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {showHistory ? 'Hide History' : 'Version History'}
          </button>
          <button type="button" onClick={loadContent} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RotateCw size={16} /> Refresh
          </button>
          <button type="button" onClick={savePage} disabled={isSaving || isReadOnly} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Save size={16} /> {isSaving ? 'Saving…' : 'Save Work'}
          </button>
        </div>
      </div>

      <div className={`rounded-lg border px-4 py-3 text-sm ${isReadOnly ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700'}`}>{message}</div>

      {showHistory ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <VersionHistoryPanel contentType="pages" contentId="work" onRestored={restorePage} />
        </div>
      ) : null}

      <Section title="Page settings" description="Control the Work page title and publication status.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Page title" value={page.title} onChange={(value) => setPage((current) => ({ ...current, title: value }))} />
          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            Page status
            <select value={page.status} onChange={(event) => setPage((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-teal">
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
          </label>
        </div>
      </Section>

      <Section title="Work hero" description="Introductory wording and calls to action shown above the selected projects.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Eyebrow" value={hero?.props?.eyebrow} onChange={(value) => updateHero('eyebrow', value)} />
          <Field label="Heading" value={hero?.props?.heading} onChange={(value) => updateHero('heading', value)} />
          <div className="md:col-span-2"><Field label="Description" type="textarea" rows={3} value={hero?.props?.subheading} onChange={(value) => updateHero('subheading', value)} /></div>
          <Field label="Primary CTA label" value={hero?.props?.primaryCta?.label} onChange={(value) => updateHero('primaryCta', { ...hero.props.primaryCta, label: value })} />
          <Field label="Primary CTA path" value={hero?.props?.primaryCta?.href} onChange={(value) => updateHero('primaryCta', { ...hero.props.primaryCta, href: value })} />
          <Field label="Secondary CTA label" value={hero?.props?.secondaryCta?.label} onChange={(value) => updateHero('secondaryCta', { ...hero.props.secondaryCta, label: value })} />
          <Field label="Secondary CTA path" value={hero?.props?.secondaryCta?.href} onChange={(value) => updateHero('secondaryCta', { ...hero.props.secondaryCta, href: value })} />
        </div>
      </Section>

      <Section
        title="Selected Projects"
        description="Each entry links to its Project title, stack, links, cover, and full ordered gallery. Only the narrative below is owned by Work."
        action={<Link to="/admin/content/projects" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-teal hover:underline"><Image size={16} /> Manage Project images</Link>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Section heading" value={showcase?.props?.heading} onChange={(value) => updateShowcase('heading', value)} />
          <Field label="Section description" value={showcase?.props?.subheading} onChange={(value) => updateShowcase('subheading', value)} />
        </div>

        <div className="mt-6 space-y-4">
          {featuredItems.map((item, index) => {
            const project = projectsById.get(item.projectId)
            const cover = imageSource(project)
            return (
              <article key={item.projectId} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                  <div className="h-28 w-full flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white lg:w-44">
                    {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No cover</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-teal">Featured project {index + 1}</p>
                        <h3 className="mt-1 text-lg font-semibold text-slate-950">{project?.title || `Missing project: ${item.projectId}`}</h3>
                        <p className="mt-1 text-xs text-slate-500">{project?.type || 'Unknown type'} · {mediaCount(project)} image(s) · Project status: {project?.status || 'missing'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => moveProject(index, -1)} disabled={index === 0} aria-label={`Move ${project?.title || item.projectId} up`} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 disabled:opacity-35"><ChevronUp size={16} /></button>
                        <button type="button" onClick={() => moveProject(index, 1)} disabled={index === featuredItems.length - 1} aria-label={`Move ${project?.title || item.projectId} down`} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 disabled:opacity-35"><ChevronDown size={16} /></button>
                        <button type="button" onClick={() => removeProject(index)} aria-label={`Remove ${project?.title || item.projectId} from Work`} className="rounded-lg border border-rose-200 bg-white p-2 text-rose-600 hover:bg-rose-50"><Trash2 size={16} /></button>
                      </div>
                    </div>

                    {!project ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">This referenced Project no longer exists. Remove it before saving.</p> : null}
                    {project?.status !== 'published' ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This Project is not published. Its Work entry must remain a draft.</p> : null}

                    <div className="mt-4 grid gap-4">
                      <Field label="Work description" type="textarea" rows={4} value={item.description} onChange={(value) => updateFeaturedItem(index, { description: value })} help="Copied from Projects only when first selected. Later Project edits do not overwrite this wording." />
                      <div>
                        <button type="button" onClick={() => resetDescription(index)} disabled={!project} className="text-xs font-semibold text-brand-teal hover:underline disabled:opacity-40">Reset from current Project description</button>
                      </div>
                      <Field label="Challenge" type="textarea" rows={4} value={item.challenge} onChange={(value) => updateFeaturedItem(index, { challenge: value })} />
                      <Field label="System Architecture" type="textarea" rows={4} value={item.systemArchitecture} onChange={(value) => updateFeaturedItem(index, { systemArchitecture: value })} />
                      <Field label="Delivery Value" type="textarea" rows={4} value={item.deliveryValue} onChange={(value) => updateFeaturedItem(index, { deliveryValue: value })} />
                      <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                        Work entry status
                        <select value={item.status || 'draft'} onChange={(event) => updateFeaturedItem(index, { status: event.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-teal">
                          <option value="draft">Draft</option>
                          <option value="published" disabled={project?.status !== 'published'}>Published</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
          {featuredItems.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">No Projects selected for Work yet.</p> : null}
        </div>

        <div className="mt-7 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><Plus size={17} className="text-brand-teal" /><h3 className="font-semibold text-slate-950">Add an existing Project</h3></div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2">
            <Search size={16} className="text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, type, ID, or technology" className="w-full border-0 bg-transparent text-sm outline-none" />
          </div>
          <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {availableProjects.map((project) => (
              <button key={project.id} type="button" onClick={() => addProject(project)} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition hover:border-brand-teal/40 hover:bg-brand-mint/20">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-brand-teal"><Briefcase size={18} /></span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">{project.title}</span>
                  <span className="block text-xs text-slate-500">{project.type} · {mediaCount(project)} image(s) · {project.status}</span>
                </span>
              </button>
            ))}
            {availableProjects.length === 0 ? <p className="p-4 text-sm text-slate-500">No available Projects match this search.</p> : null}
          </div>
        </div>
      </Section>

      <Section title="Case studies" description="Wording for the published case-study collection below selected Projects.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Section heading" value={caseStudies?.props?.heading} onChange={(value) => updateBlock('featuredCaseStudies', (props) => ({ ...props, heading: value }))} />
          <Field label="Section description" value={caseStudies?.props?.subheading} onChange={(value) => updateBlock('featuredCaseStudies', (props) => ({ ...props, subheading: value }))} />
        </div>
      </Section>

      <Section title="Final call to action" description="Closing conversion message at the bottom of Work.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Heading" value={cta?.props?.heading} onChange={(value) => updateBlock('cta', (props) => ({ ...props, heading: value }))} />
          <Field label="Button label" value={cta?.props?.primaryCta?.label} onChange={(value) => updateBlock('cta', (props) => ({ ...props, primaryCta: { ...props.primaryCta, label: value } }))} />
          <div className="md:col-span-2"><Field label="Description" type="textarea" rows={3} value={cta?.props?.body} onChange={(value) => updateBlock('cta', (props) => ({ ...props, body: value }))} /></div>
          <Field label="Button path" value={cta?.props?.primaryCta?.href} onChange={(value) => updateBlock('cta', (props) => ({ ...props, primaryCta: { ...props.primaryCta, href: value } }))} />
        </div>
      </Section>
    </div>
  )
}
