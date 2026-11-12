import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Icons from '../icons/icons'
import {
  ChevronDown,
  ChevronUp,
  Plus,
  RotateCw,
  Save,
  Trash2,
} from '../icons/icons'
import { servicesContent } from '../../data/servicesContent'
import { resourcesContent } from '../../data/resourcesContent'
import { getStaticProfileContent } from '../../data/profileContent'
import { validateAndConvertToWebP } from '../../utils/imageUpload'
import ArticleEditorialFields from './ArticleEditorialFields'
import PreviewDraftButton from '../../admin-app/components/PreviewDraftButton'

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinLines(items) {
  return Array.isArray(items) ? items.join('\n') : ''
}

const ICON_GROUPS = [
  {
    label: 'Automation',
    items: ['Zap', 'Robot', 'Webhook', 'Workflow', 'Settings', 'Wrench', 'Clock', 'Sparkles'],
  },
  {
    label: 'Data & Systems',
    items: ['Database', 'Cpu', 'Server', 'Network', 'Globe', 'Boxes', 'FolderOpen', 'FileText'],
  },
  {
    label: 'Business & Ops',
    items: ['Briefcase', 'Building2', 'ClipboardList', 'ChartColumn', 'ChartPie', 'Lightbulb', 'Shield', 'ShieldCheck'],
  },
  {
    label: 'Communication & Growth',
    items: ['MessageSquare', 'MessageCircle', 'Mail', 'Megaphone', 'Phone', 'Calendar', 'Link2', 'ArrowRight'],
  },
  {
    label: 'People & Profile',
    items: ['User', 'Users', 'UserCheck', 'GraduationCap', 'Trophy', 'BadgeCheck', 'HeartHandshake'],
  },
  {
    label: 'Technical & Utility',
    items: ['Code2', 'Laptop', 'Search', 'Download', 'Image', 'Home', 'Info', 'TrendingUp'],
  },
]

const ICON_OPTIONS = ICON_GROUPS.flatMap((group) => group.items)

function IconPicker({ label = 'Icon', value, onChange }) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const selectedValue = ICON_OPTIONS.includes(value) ? value : ICON_OPTIONS[0]
  const selectedIconName = selectedValue
  const SelectedIcon = Icons[selectedIconName]
  const normalizedQuery = query.trim().toLowerCase()
  const filteredGroups = ICON_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((iconName) => iconName.toLowerCase().includes(normalizedQuery)),
    }))
    .filter((group) => group.items.length > 0)

  useEffect(() => {
    if (!isOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  return (
    <div className="grid gap-2 text-sm font-semibold text-slate-800">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex min-h-[48px] items-center justify-between gap-3 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-slate-50"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            {SelectedIcon ? <SelectedIcon size={18} /> : null}
          </span>
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-slate-900">{selectedIconName}</span>
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">Change icon</span>
          </span>
        </span>
        <ChevronDown size={16} className="text-slate-500" />
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Select icon"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false)
            }
          }}
        >
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Icon Picker</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">Choose an icon</h3>
                <p className="mt-1 text-sm text-slate-500">Search and select from grouped visual options.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50"
                aria-label="Close icon picker"
              >
                <Icons.X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
                <div className="grid gap-3">
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Search Icons
                    <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm">
                      <Icons.Search size={16} className="text-slate-400" />
                      <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search icon name"
                        className="w-full border-0 bg-transparent text-sm font-normal text-slate-800 outline-none"
                        autoFocus
                      />
                    </div>
                  </label>

                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700">
                      {SelectedIcon ? <SelectedIcon size={18} /> : null}
                    </span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected</p>
                      <p className="text-sm font-semibold text-slate-900">{selectedIconName}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-5">

              <div className="grid gap-5">
                {filteredGroups.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm font-medium text-slate-500">
                    No icons match "{query}".
                  </div>
                ) : (
                  filteredGroups.map((group) => (
                    <div key={group.label} className="grid gap-2.5">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{group.label}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {group.items.map((iconName) => {
                          const Icon = Icons[iconName]
                          const isSelected = selectedValue === iconName

                          return (
                            <button
                              key={iconName}
                              type="button"
                              onClick={() => {
                                onChange(iconName)
                                setIsOpen(false)
                              }}
                              className={`flex min-h-[84px] flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-center text-xs font-semibold transition ${
                                isSelected
                                  ? 'border-slate-900 bg-slate-900 text-white'
                                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                              }`}
                              title={iconName}
                            >
                              {Icon ? <Icon size={18} /> : null}
                              <span className="leading-tight">{iconName}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function hasMeaningfulContent(contentType, data) {
  if (!data) return false
  if (contentType === 'services') return Array.isArray(data.solutionGroups) && data.solutionGroups.length > 0
  if (contentType === 'resources') {
    return (Array.isArray(data.posts) && data.posts.length > 0)
      || (Array.isArray(data.guides) && data.guides.length > 0)
  }
  if (contentType === 'profile') {
    return Boolean(data.about?.name)
      || (Array.isArray(data.experiences) && data.experiences.length > 0)
      || (Array.isArray(data.skills?.technical) && data.skills.technical.length > 0)
  }
  return false
}

function getConfig(contentType) {
  if (contentType === 'services') {
    return {
      title: 'Services Content',
      subtitle: 'Manage solution categories, delivery steps, and service FAQ content.',
      endpoint: '/api/admin/content/services',
      createDefault: () => deepClone(servicesContent),
    }
  }

  if (contentType === 'resources') {
    return {
      title: 'Insight Articles',
      subtitle: 'Manage feed posts, long-form guides, and automation readiness playbook items.',
      endpoint: '/api/admin/content/resources',
      createDefault: () => deepClone(resourcesContent),
    }
  }

  return {
    title: 'Profile Content',
    subtitle: 'Manage founder profile copy, experience, skills, tools, and workflow characteristics.',
    endpoint: '/api/admin/content/profile',
    createDefault: () => deepClone(getStaticProfileContent()),
  }
}

function moveItem(items, index, direction) {
  const next = [...items]
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= next.length) return items
  const [item] = next.splice(index, 1)
  next.splice(targetIndex, 0, item)
  return next
}

function slugifyValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createEmptyResourcePost(postCount = 0) {
  return {
    id: makeId('resource-post'),
    slug: '',
    title: '',
    summary: '',
    category: '',
    contentType: 'guide',
    icon: 'Lightbulb',
    points: [],
    tags: [],
    body: '',
    coverImageUrl: '',
    authorName: 'DevLab Studios',
    publishedAt: '',
    readingTimeMinutes: 5,
    isFeatured: false,
    sortOrder: (postCount + 1) * 10,
    status: 'draft',
    audience: '',
    problemTag: '',
    heroVisualId: '',
    seoTitle: '',
    seoDescription: '',
    ogVariant: '',
  }
}

function getResourceMediaFolder(post) {
  const folderName = slugifyValue(post?.slug || post?.id || post?.title || 'draft-post') || 'draft-post'
  return `resources/${folderName}`
}

function resourceStatusClass(status) {
  return status === 'draft'
    ? 'bg-amber-50 text-amber-700 ring-amber-200'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
}

function resourceTypeClass(contentType) {
  if (contentType === 'news') return 'bg-sky-50 text-sky-700 ring-sky-200'
  if (contentType === 'insight') return 'bg-violet-50 text-violet-700 ring-violet-200'
  return 'bg-slate-100 text-slate-700 ring-slate-200'
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

function ArrayTextArea({ label, value, onChange, placeholder, rows = 4 }) {
  return (
    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
      {label}
      <textarea
        rows={rows}
        value={joinLines(value)}
        onChange={(event) => onChange(splitLines(event.target.value))}
        placeholder={placeholder}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
      />
    </label>
  )
}

function ServicesEditor({ value, onChange }) {
  const solutionGroups = value.solutionGroups || []
  const processSteps = value.processSteps || []
  const faqs = value.faqs || []

  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Solution Categories"
          description="Service group cards shown on the public Services page."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                solutionGroups: [
                  ...solutionGroups,
                  {
                    id: makeId('service-group'),
                    eyebrow: '',
                    title: '',
                    description: '',
                    icon: 'Settings',
                    capabilities: [],
                    projectIds: [],
                    sortOrder: (solutionGroups.length + 1) * 10,
                    status: 'published',
                  },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Category
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {solutionGroups.map((group, index) => (
            <article key={group.id} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">Category {index + 1}</p>
                <RowActions
                  onMoveUp={() => onChange({ ...value, solutionGroups: moveItem(solutionGroups, index, -1) })}
                  onMoveDown={() => onChange({ ...value, solutionGroups: moveItem(solutionGroups, index, 1) })}
                  onRemove={() => onChange({ ...value, solutionGroups: solutionGroups.filter((_, itemIndex) => itemIndex !== index) })}
                  disableUp={index === 0}
                  disableDown={index === solutionGroups.length - 1}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  ID
                  <input
                    value={group.id}
                    onChange={(event) => onChange({
                      ...value,
                      solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item),
                    })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
                <IconPicker
                  label="Icon"
                  value={group.icon}
                  onChange={(icon) => onChange({
                    ...value,
                    solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, icon } : item),
                  })}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Eyebrow
                  <input
                    value={group.eyebrow}
                    onChange={(event) => onChange({
                      ...value,
                      solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, eyebrow: event.target.value } : item),
                    })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Title
                  <input
                    value={group.title}
                    onChange={(event) => onChange({
                      ...value,
                      solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item),
                    })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
              </div>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Description
                <textarea
                  rows={3}
                  value={group.description}
                  onChange={(event) => onChange({
                    ...value,
                    solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item),
                  })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <ArrayTextArea
                  label="Capabilities"
                  value={group.capabilities}
                  onChange={(capabilities) => onChange({
                    ...value,
                    solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, capabilities } : item),
                  })}
                  placeholder="One capability per line"
                />
                <ArrayTextArea
                  label="Related Project IDs"
                  value={group.projectIds}
                  onChange={(projectIds) => onChange({
                    ...value,
                    solutionGroups: solutionGroups.map((item, itemIndex) => itemIndex === index ? { ...item, projectIds } : item),
                  })}
                  placeholder="One project ID per line"
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Delivery Steps"
          description="Process cards shown in the Services hero."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                processSteps: [
                  ...processSteps,
                  { id: makeId('process-step'), title: '', description: '', icon: 'Settings', sortOrder: (processSteps.length + 1) * 10 },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Step
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {processSteps.map((step, index) => (
            <article key={step.id} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">Step {index + 1}</p>
                <RowActions
                  onMoveUp={() => onChange({ ...value, processSteps: moveItem(processSteps, index, -1) })}
                  onMoveDown={() => onChange({ ...value, processSteps: moveItem(processSteps, index, 1) })}
                  onRemove={() => onChange({ ...value, processSteps: processSteps.filter((_, itemIndex) => itemIndex !== index) })}
                  disableUp={index === 0}
                  disableDown={index === processSteps.length - 1}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  ID
                  <input
                    value={step.id}
                    onChange={(event) => onChange({
                      ...value,
                      processSteps: processSteps.map((item, itemIndex) => itemIndex === index ? { ...item, id: event.target.value } : item),
                    })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Title
                  <input
                    value={step.title}
                    onChange={(event) => onChange({
                      ...value,
                      processSteps: processSteps.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item),
                    })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
                <IconPicker
                  label="Icon"
                  value={step.icon}
                  onChange={(icon) => onChange({
                    ...value,
                    processSteps: processSteps.map((item, itemIndex) => itemIndex === index ? { ...item, icon } : item),
                  })}
                />
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Description
                <textarea
                  rows={3}
                  value={step.description}
                  onChange={(event) => onChange({
                    ...value,
                    processSteps: processSteps.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item),
                  })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Service FAQ"
          description="Questions and answers rendered at the bottom of the Services page."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                faqs: [
                  ...faqs,
                  { id: makeId('services-faq'), question: '', answer: '', sortOrder: (faqs.length + 1) * 10, status: 'published' },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add FAQ
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {faqs.map((faq, index) => (
            <article key={faq.id} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">FAQ {index + 1}</p>
                <RowActions
                  onMoveUp={() => onChange({ ...value, faqs: moveItem(faqs, index, -1) })}
                  onMoveDown={() => onChange({ ...value, faqs: moveItem(faqs, index, 1) })}
                  onRemove={() => onChange({ ...value, faqs: faqs.filter((_, itemIndex) => itemIndex !== index) })}
                  disableUp={index === 0}
                  disableDown={index === faqs.length - 1}
                />
              </div>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Question
                <input
                  value={faq.question}
                  onChange={(event) => onChange({
                    ...value,
                    faqs: faqs.map((item, itemIndex) => itemIndex === index ? { ...item, question: event.target.value } : item),
                  })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Answer
                <textarea
                  rows={4}
                  value={faq.answer}
                  onChange={(event) => onChange({
                    ...value,
                    faqs: faqs.map((item, itemIndex) => itemIndex === index ? { ...item, answer: event.target.value } : item),
                  })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ResourcesEditor({ value, onChange, onSave, onStatusChange, isSaving, isReadOnlyPreview }) {
  const posts = useMemo(() => value.posts || value.guides || [], [value.guides, value.posts])
  const playbook = useMemo(() => value.playbook || [], [value.playbook])
  const [selectedPostId, setSelectedPostId] = useState(posts[0]?.id || '')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [typeFilter, setTypeFilter] = useState('All')
  const [isUploadingCover, setIsUploadingCover] = useState(false)

  useEffect(() => {
    if (!posts.length) {
      setSelectedPostId('')
      return
    }

    if (!posts.some((post) => post.id === selectedPostId)) {
      setSelectedPostId(posts[0].id)
    }
  }, [posts, selectedPostId])

  const selectedPost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) || null,
    [posts, selectedPostId],
  )

  const filteredPosts = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    return posts.filter((post) => {
      const matchesQuery = !query || [
        post.title,
        post.slug,
        post.category,
        post.authorName,
        ...(Array.isArray(post.tags) ? post.tags : []),
      ]
        .filter(Boolean)
        .some((item) => String(item).toLowerCase().includes(query))

      const matchesStatus = statusFilter === 'All' || (post.status || 'draft') === statusFilter
      const matchesType = typeFilter === 'All' || (post.contentType || 'guide') === typeFilter
      return matchesQuery && matchesStatus && matchesType
    })
  }, [posts, searchTerm, statusFilter, typeFilter])

  function updatePost(postId, updater) {
    onChange({
      ...value,
      posts: posts.map((post) => {
        if (post.id !== postId) return post
        return typeof updater === 'function' ? updater(post) : { ...post, ...updater }
      }),
    })
  }

  function addPost() {
    const nextPost = createEmptyResourcePost(posts.length)
    onChange({
      ...value,
      posts: [nextPost, ...posts],
    })
    setSelectedPostId(nextPost.id)
    onStatusChange?.('New resource draft created. Add the article content and save when ready.')
  }

  function removeSelectedPost() {
    if (!selectedPost) return

    const nextPosts = posts.filter((post) => post.id !== selectedPost.id)
    onChange({ ...value, posts: nextPosts })
    setSelectedPostId(nextPosts[0]?.id || '')
    onStatusChange?.('Resource post removed from the editor. Save content to persist the change.')
  }

  async function uploadCoverImage(event) {
    const [file] = Array.from(event.target.files || [])
    if (!file || !selectedPost) return
    if (isReadOnlyPreview) {
      onStatusChange?.('Read-only preview mode. Configure D1, R2, and the admin API before uploading cover images.')
      event.target.value = ''
      return
    }

    try {
      setIsUploadingCover(true)
      onStatusChange?.(`Validating ${file.name} and converting it to WebP...`)
      const prepared = await validateAndConvertToWebP(file, {
        maxWidth: 2200,
        maxHeight: 1400,
        minWidth: 320,
        minHeight: 180,
      })

      const formData = new FormData()
      formData.append('folder', getResourceMediaFolder(selectedPost))
      formData.append('file', prepared.file)

      onStatusChange?.(`Uploading ${prepared.file.name} to R2...`)
      const response = await fetch('/api/admin/media', {
        method: 'POST',
        body: formData,
      })
      const data = await response.json()
      if (!response.ok) {
        onStatusChange?.(data.error || `Cover upload failed (${response.status}).`)
        return
      }

      updatePost(selectedPost.id, { coverImageUrl: data.url })
      onStatusChange?.(`Cover image uploaded for "${selectedPost.title || selectedPost.id}". Save content to persist it.`)
    } catch (error) {
      onStatusChange?.(error.message || 'Cover image upload failed.')
    } finally {
      setIsUploadingCover(false)
      event.target.value = ''
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Resource Feed Posts"
          description="Feed entries and detail articles shown on the public Insights page."
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addPost}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Plus size={16} />
                Add Post
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={isSaving}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={16} />
                {isSaving ? 'Saving...' : 'Save Insights'}
              </button>
            </div>
          )}
        />
        <div className="grid gap-5 px-5 py-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Post Library</p>
                  <p className="text-xs uppercase tracking-[0.12em] text-slate-500">
                    {filteredPosts.length} of {posts.length} post(s)
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                  isReadOnlyPreview ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                }`}>
                  {isReadOnlyPreview ? 'Read-only preview' : 'Connected'}
                </span>
              </div>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Search posts
                  <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2">
                    <Icons.Search size={16} className="text-slate-400" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Title, slug, category, or tag"
                      className="w-full border-0 bg-transparent text-sm font-normal text-slate-800 outline-none"
                    />
                  </div>
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Status
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-500"
                    >
                      {['All', 'published', 'draft'].map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    Type
                    <select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-500"
                    >
                      {['All', 'guide', 'news', 'insight'].map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            <div className="grid max-h-[1120px] gap-3 overflow-y-auto pr-1">
              {filteredPosts.length ? (
                filteredPosts.map((post) => {
                  const isSelected = post.id === selectedPost?.id

                  return (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => setSelectedPostId(post.id)}
                      className={`grid gap-3 rounded-md border p-4 text-left transition ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)]'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className={`text-sm font-semibold ${isSelected ? 'text-white' : 'text-slate-950'}`}>
                            {post.title || 'Untitled draft'}
                          </p>
                          <p className={`mt-1 text-xs ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                            /resources/{post.slug || 'set-a-slug'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                            isSelected
                              ? 'bg-white/10 text-white ring-white/20'
                              : resourceTypeClass(post.contentType || 'guide')
                          }`}>
                            {post.contentType || 'guide'}
                          </span>
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                            isSelected
                              ? 'bg-white/10 text-white ring-white/20'
                              : resourceStatusClass(post.status || 'draft')
                          }`}>
                            {post.status || 'draft'}
                          </span>
                        </div>
                      </div>

                      <div className={`flex flex-wrap items-center gap-2 text-xs ${isSelected ? 'text-slate-200' : 'text-slate-500'}`}>
                        {post.category ? <span>{post.category}</span> : null}
                        {post.authorName ? <span>{post.authorName}</span> : null}
                        {post.publishedAt ? <span>{post.publishedAt}</span> : null}
                      </div>
                    </button>
                  )
                })
              ) : (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm font-medium text-slate-500">
                  No posts match the current filters.
                </div>
              )}
            </div>
          </div>

          {selectedPost ? (
            <article className="grid gap-5 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Post editor</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-950">
                    {selectedPost.title || 'Untitled draft'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Public path: <span className="font-mono text-slate-700">/insights/{selectedPost.slug || 'set-a-slug'}</span>
                  </p>
                  {selectedPost.slug ? <div className="mt-2"><PreviewDraftButton type="article" id={selectedPost.slug} /></div> : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${resourceTypeClass(selectedPost.contentType || 'guide')}`}>
                    {selectedPost.contentType || 'guide'}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${resourceStatusClass(selectedPost.status || 'draft')}`}>
                    {selectedPost.status || 'draft'}
                  </span>
                  <RowActions
                    onMoveUp={() => {
                      const index = posts.findIndex((post) => post.id === selectedPost.id)
                      onChange({ ...value, posts: moveItem(posts, index, -1) })
                      onStatusChange?.('Post order updated. Save resources to persist the change.')
                    }}
                    onMoveDown={() => {
                      const index = posts.findIndex((post) => post.id === selectedPost.id)
                      onChange({ ...value, posts: moveItem(posts, index, 1) })
                      onStatusChange?.('Post order updated. Save resources to persist the change.')
                    }}
                    onRemove={removeSelectedPost}
                    disableUp={posts.findIndex((post) => post.id === selectedPost.id) === 0}
                    disableDown={posts.findIndex((post) => post.id === selectedPost.id) === posts.length - 1}
                  />
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                Draft posts stay in CMS only. Published posts appear in the public Insights feed after you save.
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="grid gap-4">
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      ID
                      <input
                        value={selectedPost.id}
                        onChange={(event) => updatePost(selectedPost.id, { id: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Slug
                      <input
                        value={selectedPost.slug || ''}
                        onChange={(event) => updatePost(selectedPost.id, { slug: slugifyValue(event.target.value) })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Category
                      <input
                        value={selectedPost.category}
                        onChange={(event) => updatePost(selectedPost.id, { category: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Content Type
                      <select
                        value={selectedPost.contentType || 'guide'}
                        onChange={(event) => updatePost(selectedPost.id, { contentType: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      >
                        {['guide', 'news', 'insight'].map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                    Title
                    <input
                      value={selectedPost.title}
                      onChange={(event) => updatePost(selectedPost.id, (post) => {
                        const nextTitle = event.target.value
                        return {
                          ...post,
                          title: nextTitle,
                          slug: post.slug || slugifyValue(nextTitle),
                        }
                      })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  </label>

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                    Summary
                    <textarea
                      rows={3}
                      value={selectedPost.summary}
                      onChange={(event) => updatePost(selectedPost.id, { summary: event.target.value })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  </label>

                  <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                    Article Body
                    <textarea
                      rows={18}
                      value={selectedPost.body || ''}
                      onChange={(event) => updatePost(selectedPost.id, { body: event.target.value })}
                      placeholder="Use plain paragraphs, ## headings, and - bullet lines."
                      className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ArrayTextArea
                      label="Key Points"
                      value={selectedPost.points}
                      onChange={(points) => updatePost(selectedPost.id, { points })}
                      placeholder="One point per line"
                    />
                    <ArrayTextArea
                      label="Tags"
                      value={selectedPost.tags || []}
                      onChange={(tags) => updatePost(selectedPost.id, { tags })}
                      placeholder="One tag per line"
                    />
                  </div>
                </div>

                <aside className="grid gap-4">
                  <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">Publishing</p>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Status
                      <select
                        value={selectedPost.status || 'draft'}
                        onChange={(event) => updatePost(selectedPost.id, { status: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      >
                        {['draft', 'published'].map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Published Date
                      <input
                        type="date"
                        value={selectedPost.publishedAt || ''}
                        onChange={(event) => updatePost(selectedPost.id, { publishedAt: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Reading Time (min)
                      <input
                        type="number"
                        min="1"
                        value={selectedPost.readingTimeMinutes ?? ''}
                        onChange={(event) => updatePost(selectedPost.id, {
                          readingTimeMinutes: event.target.value ? Number(event.target.value) : null,
                        })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Sort Order
                      <input
                        type="number"
                        value={selectedPost.sortOrder ?? ((posts.findIndex((post) => post.id === selectedPost.id) + 1) * 10)}
                        onChange={(event) => updatePost(selectedPost.id, {
                          sortOrder: Number(event.target.value || 0),
                        })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>

                    <label className="flex items-center gap-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedPost.isFeatured)}
                        onChange={(event) => updatePost(selectedPost.id, { isFeatured: event.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Featured Post
                    </label>
                  </div>

                  <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-950">Post Meta</p>

                    <IconPicker
                      label="Icon"
                      value={selectedPost.icon}
                      onChange={(icon) => updatePost(selectedPost.id, { icon })}
                    />

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Author
                      <input
                        value={selectedPost.authorName || ''}
                        onChange={(event) => updatePost(selectedPost.id, { authorName: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>
                  </div>

                  <ArticleEditorialFields post={selectedPost} onChange={(changes) => updatePost(selectedPost.id, changes)} />

                  <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Cover Image</p>
                        <p className="text-xs text-slate-500">Upload from admin. File is converted to WebP and stored in R2 for this post.</p>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      {selectedPost.coverImageUrl ? (
                        <img
                          src={selectedPost.coverImageUrl}
                          alt={selectedPost.title || 'Resource cover'}
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-500">
                          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500">
                            <Icons.Image size={20} />
                          </span>
                          <p>No cover image uploaded yet.</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <label className={`inline-flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white transition ${
                        isUploadingCover
                          ? 'cursor-wait bg-slate-400'
                          : 'bg-slate-900 hover:bg-slate-800'
                      }`}>
                        <Icons.Image size={16} />
                        {isUploadingCover ? 'Uploading...' : 'Upload Cover Image'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/avif"
                          onChange={uploadCoverImage}
                          className="hidden"
                          disabled={isUploadingCover}
                        />
                      </label>

                      {selectedPost.coverImageUrl ? (
                        <button
                          type="button"
                          onClick={() => {
                            updatePost(selectedPost.id, { coverImageUrl: '' })
                            onStatusChange?.('Cover image cleared. Save resources to persist the change.')
                          }}
                          className="inline-flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          <Trash2 size={16} />
                          Remove Cover
                        </button>
                      ) : null}
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      R2 folder: <span className="font-mono text-slate-800">{getResourceMediaFolder(selectedPost)}</span>
                    </div>

                    <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                      Stored Cover URL
                      <input
                        value={selectedPost.coverImageUrl || ''}
                        onChange={(event) => updatePost(selectedPost.id, { coverImageUrl: event.target.value })}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                      />
                    </label>
                  </div>
                </aside>
              </div>
            </article>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 text-center text-sm font-medium text-slate-500">
              Add a resource post to start editing the feed.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader title="Automation Readiness Playbook" description="Checklist bullets shown in the Insights hero panel." />
        <div className="px-5 py-5">
          <ArrayTextArea
            label="Playbook Items"
            value={playbook}
            onChange={(nextPlaybook) => onChange({ ...value, playbook: nextPlaybook })}
            placeholder="One checklist item per line"
            rows={6}
          />
        </div>
      </section>
    </div>
  )
}

function ProfileEditor({ value, onChange }) {
  const about = value.about || {}
  const experiences = value.experiences || []
  const tools = value.tools || []
  const workflowPatterns = value.workflowPatterns || []
  const systemCharacteristics = value.systemCharacteristics || []

  return (
    <div className="grid gap-6">
      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader title="About Profile" description="Core founder bio, contact, education, and credential content." />
        <div className="grid gap-4 px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['name', 'Name'],
              ['role', 'Role'],
              ['location', 'Location'],
              ['email', 'Email'],
              ['phone', 'Phone'],
              ['dateOfBirth', 'Date of Birth'],
              ['resumeLink', 'Resume Link'],
            ].map(([key, label]) => (
              <label key={key} className="grid gap-1.5 text-sm font-semibold text-slate-800">
                {label}
                <input
                  value={about[key] || ''}
                  onChange={(event) => onChange({ ...value, about: { ...about, [key]: event.target.value } })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>
            ))}
          </div>

          <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
            About
            <textarea
              rows={5}
              value={about.about || ''}
              onChange={(event) => onChange({ ...value, about: { ...about, about: event.target.value } })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
            />
          </label>

          <div className="grid gap-4 xl:grid-cols-3">
            <ArrayTextArea
              label="Education"
              value={(about.education || []).map((item) => `${item.program} | ${item.school} | ${item.years}`)}
              onChange={(items) => onChange({
                ...value,
                about: {
                  ...about,
                  education: items.map((item, index) => {
                    const [program = '', school = '', years = ''] = item.split('|').map((part) => part.trim())
                    return { id: `education-${index + 1}`, program, school, years }
                  }),
                },
              })}
              placeholder="Program | School | Years"
              rows={5}
            />
            <ArrayTextArea
              label="Achievements & Responsibilities"
              value={(about.achievementsAndResponsibilities || []).map((item) => `${item.title} | ${item.details}`)}
              onChange={(items) => onChange({
                ...value,
                about: {
                  ...about,
                  achievementsAndResponsibilities: items.map((item, index) => {
                    const [title = '', details = ''] = item.split('|').map((part) => part.trim())
                    return { id: `achievement-${index + 1}`, title, details }
                  }),
                },
              })}
              placeholder="Title | Details"
              rows={5}
            />
            <ArrayTextArea
              label="Certificates & Licenses"
              value={(about.certificatesAndLicenses || []).map((item) => `${item.name} | ${item.issuer || ''} | ${item.date || ''}`)}
              onChange={(items) => onChange({
                ...value,
                about: {
                  ...about,
                  certificatesAndLicenses: items.map((item) => {
                    const [name = '', issuer = '', date = ''] = item.split('|').map((part) => part.trim())
                    return { name, issuer: issuer || null, date: date || null }
                  }),
                },
              })}
              placeholder="Name | Issuer | Date"
              rows={5}
            />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Experience"
          description="Experience cards on the Profile page."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                experiences: [
                  ...experiences,
                  { id: makeId('experience'), title: '', role: '', company: '', dates: '', bullets: [], imageUrl: '', sortOrder: (experiences.length + 1) * 10, status: 'published' },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Experience
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {experiences.map((experience, index) => (
            <article key={experience.id} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">Experience {index + 1}</p>
                <RowActions
                  onMoveUp={() => onChange({ ...value, experiences: moveItem(experiences, index, -1) })}
                  onMoveDown={() => onChange({ ...value, experiences: moveItem(experiences, index, 1) })}
                  onRemove={() => onChange({ ...value, experiences: experiences.filter((_, itemIndex) => itemIndex !== index) })}
                  disableUp={index === 0}
                  disableDown={index === experiences.length - 1}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ['id', 'ID'],
                  ['title', 'Section Label'],
                  ['role', 'Role'],
                  ['company', 'Company'],
                  ['dates', 'Dates'],
                  ['imageUrl', 'Image URL'],
                ].map(([key, label]) => (
                  <label key={key} className="grid gap-1.5 text-sm font-semibold text-slate-800">
                    {label}
                    <input
                      value={experience[key] || ''}
                      onChange={(event) => onChange({
                        ...value,
                        experiences: experiences.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: event.target.value } : item),
                      })}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                    />
                  </label>
                ))}
              </div>
              <ArrayTextArea
                label="Bullets"
                value={experience.bullets}
                onChange={(bullets) => onChange({
                  ...value,
                  experiences: experiences.map((item, itemIndex) => itemIndex === index ? { ...item, bullets } : item),
                })}
                placeholder="One bullet per line"
                rows={6}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader title="Skills" description="Technical and personal skill badges shown on the Profile page." />
        <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
          <ArrayTextArea
            label="Technical Skills"
            value={value.skills?.technical || []}
            onChange={(technical) => onChange({ ...value, skills: { ...(value.skills || {}), technical } })}
            placeholder="One technical skill per line"
            rows={8}
          />
          <ArrayTextArea
            label="Personal Skills"
            value={value.skills?.personal || []}
            onChange={(personal) => onChange({ ...value, skills: { ...(value.skills || {}), personal } })}
            placeholder="One personal skill per line"
            rows={8}
          />
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Core Tools"
          description="Structured tools data for profile/system capability surfaces."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                tools: [
                  ...tools,
                  { id: makeId('tool'), key: makeId('tool'), label: '', icon: 'Wrench', sortOrder: (tools.length + 1) * 10, status: 'published' },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Tool
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {tools.map((tool, index) => (
            <article key={tool.id || tool.key} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Label
                <input
                  value={tool.label || ''}
                  onChange={(event) => onChange({
                    ...value,
                    tools: tools.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
                  })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
              <RowActions
                onMoveUp={() => onChange({ ...value, tools: moveItem(tools, index, -1) })}
                onMoveDown={() => onChange({ ...value, tools: moveItem(tools, index, 1) })}
                onRemove={() => onChange({ ...value, tools: tools.filter((_, itemIndex) => itemIndex !== index) })}
                disableUp={index === 0}
                disableDown={index === tools.length - 1}
              />
              <div className="md:col-span-2">
                <IconPicker
                  label="Icon"
                  value={tool.icon || ''}
                  onChange={(icon) => onChange({
                    ...value,
                    tools: tools.map((item, itemIndex) => itemIndex === index ? { ...item, icon } : item),
                  })}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="Workflow Patterns"
          description="Short capability statements used in systems/workflow content."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                workflowPatterns: [
                  ...workflowPatterns,
                  { id: makeId('pattern'), key: makeId('pattern'), label: '', icon: 'Settings', sortOrder: (workflowPatterns.length + 1) * 10, status: 'published' },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Pattern
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {workflowPatterns.map((item, index) => (
            <article key={item.id || item.key} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Label
                <input
                  value={item.label || ''}
                  onChange={(event) => onChange({
                    ...value,
                    workflowPatterns: workflowPatterns.map((pattern, itemIndex) => itemIndex === index ? { ...pattern, label: event.target.value } : pattern),
                  })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
              <RowActions
                onMoveUp={() => onChange({ ...value, workflowPatterns: moveItem(workflowPatterns, index, -1) })}
                onMoveDown={() => onChange({ ...value, workflowPatterns: moveItem(workflowPatterns, index, 1) })}
                onRemove={() => onChange({ ...value, workflowPatterns: workflowPatterns.filter((_, itemIndex) => itemIndex !== index) })}
                disableUp={index === 0}
                disableDown={index === workflowPatterns.length - 1}
              />
              <div className="md:col-span-2">
                <IconPicker
                  label="Icon"
                  value={item.icon || ''}
                  onChange={(icon) => onChange({
                    ...value,
                    workflowPatterns: workflowPatterns.map((pattern, itemIndex) => itemIndex === index ? { ...pattern, icon } : pattern),
                  })}
                />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-slate-200 bg-white">
        <SectionHeader
          title="System Characteristics"
          description="Concise system-quality traits used in profile/system capability surfaces."
          action={(
            <button
              type="button"
              onClick={() => onChange({
                ...value,
                systemCharacteristics: [
                  ...systemCharacteristics,
                  { id: makeId('characteristic'), key: makeId('characteristic'), label: '', icon: 'Shield', sortOrder: (systemCharacteristics.length + 1) * 10, status: 'published' },
                ],
              })}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Plus size={16} />
              Add Characteristic
            </button>
          )}
        />
        <div className="grid gap-4 px-5 py-5">
          {systemCharacteristics.map((item, index) => (
            <article key={item.id || item.key} className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Label
                <input
                  value={item.label || ''}
                  onChange={(event) => onChange({
                    ...value,
                    systemCharacteristics: systemCharacteristics.map((characteristic, itemIndex) => itemIndex === index ? { ...characteristic, label: event.target.value } : characteristic),
                  })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-normal text-slate-800 outline-none transition focus:border-slate-500"
                  />
                </label>
              <RowActions
                onMoveUp={() => onChange({ ...value, systemCharacteristics: moveItem(systemCharacteristics, index, -1) })}
                onMoveDown={() => onChange({ ...value, systemCharacteristics: moveItem(systemCharacteristics, index, 1) })}
                onRemove={() => onChange({ ...value, systemCharacteristics: systemCharacteristics.filter((_, itemIndex) => itemIndex !== index) })}
                disableUp={index === 0}
                disableDown={index === systemCharacteristics.length - 1}
              />
              <div className="md:col-span-2">
                <IconPicker
                  label="Icon"
                  value={item.icon || ''}
                  onChange={(icon) => onChange({
                    ...value,
                    systemCharacteristics: systemCharacteristics.map((characteristic, itemIndex) => itemIndex === index ? { ...characteristic, icon } : characteristic),
                  })}
                />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function ContentManager({ contentType }) {
  const config = useMemo(() => getConfig(contentType), [contentType])
  const [value, setValue] = useState(config.createDefault())
  const [status, setStatus] = useState('Loading content...')
  const [isSaving, setIsSaving] = useState(false)
  const [isReadOnlyPreview, setIsReadOnlyPreview] = useState(false)

  const loadContent = useCallback(async ({ preserveStatus = false } = {}) => {
    try {
      const response = await fetch(config.endpoint)
      if (response.status === 401) {
        setIsReadOnlyPreview(true)
        setStatus('Admin API is protected. Sign in through Cloudflare Access before editing content.')
        return
      }
      if (response.status === 503) {
        const payload = await response.json()
        setValue(config.createDefault())
        setIsReadOnlyPreview(true)
        setStatus(`${payload.error} Loaded static fallback. Save to seed D1.`)
        return
      }
      if (!response.ok) {
        setValue(config.createDefault())
        setIsReadOnlyPreview(true)
        setStatus(`Unable to load ${config.title.toLowerCase()} (${response.status}). Loaded static fallback.`)
        return
      }

      const data = await response.json()
      const nextValue = hasMeaningfulContent(contentType, data) ? data : config.createDefault()
      setValue(deepClone(nextValue))
      setIsReadOnlyPreview(false)

      if (!preserveStatus) {
        setStatus(
          hasMeaningfulContent(contentType, data)
            ? `Loaded ${config.title.toLowerCase()} from D1.`
            : `No ${config.title.toLowerCase()} stored in D1 yet. Loaded static fallback; save to persist it.`,
        )
      }
    } catch {
      setValue(config.createDefault())
      setIsReadOnlyPreview(true)
      setStatus(`Unable to reach the ${config.title.toLowerCase()} API. Loaded static fallback.`)
    }
  }, [config, contentType])

  useEffect(() => {
    loadContent()
  }, [loadContent])

  async function saveContent() {
    if (isReadOnlyPreview) {
      setStatus('Read-only preview mode. Configure Cloudflare Access, D1, and the admin API before saving CMS content.')
      return
    }

    setIsSaving(true)
    setStatus(`Saving ${config.title.toLowerCase()}...`)

    try {
      const response = await fetch(config.endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      })

      const data = await response.json()
      if (!response.ok) {
        setStatus(data.error || `Save failed (${response.status}).`)
        return
      }

      setValue(deepClone(data))
      setStatus(`${config.title} saved at ${new Date().toLocaleTimeString()}.`)
    } catch {
      setStatus(`${config.title} save failed.`)
    } finally {
      setIsSaving(false)
    }
  }

  const stats = useMemo(() => {
    if (contentType === 'services') {
      return [
        { label: 'Categories', value: value.solutionGroups?.length || 0 },
        { label: 'Process Steps', value: value.processSteps?.length || 0 },
        { label: 'FAQ', value: value.faqs?.length || 0 },
      ]
    }

    if (contentType === 'resources') {
      return [
        { label: 'Posts', value: value.posts?.length || value.guides?.length || 0 },
        { label: 'Featured', value: (value.posts || value.guides || []).filter((item) => item.isFeatured).length },
        { label: 'Playbook Items', value: value.playbook?.length || 0 },
      ]
    }

    return [
      { label: 'Experiences', value: value.experiences?.length || 0 },
      { label: 'Technical Skills', value: value.skills?.technical?.length || 0 },
      { label: 'Personal Skills', value: value.skills?.personal?.length || 0 },
      { label: 'Tools', value: value.tools?.length || 0 },
    ]
  }, [contentType, value])

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-md border border-slate-200 bg-white px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{config.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{config.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => loadContent()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RotateCw size={16} />
            Refresh
          </button>
          <button
            type="button"
            onClick={saveContent}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={16} />
            Save Content
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      {contentType === 'services' ? <ServicesEditor value={value} onChange={setValue} /> : null}
      {contentType === 'resources' ? (
        <ResourcesEditor
          value={value}
          onChange={setValue}
          onSave={saveContent}
          onStatusChange={setStatus}
          isSaving={isSaving}
          isReadOnlyPreview={isReadOnlyPreview}
        />
      ) : null}
      {contentType === 'profile' ? <ProfileEditor value={value} onChange={setValue} /> : null}
    </div>
  )
}
