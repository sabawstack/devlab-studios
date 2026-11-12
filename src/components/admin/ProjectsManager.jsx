import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Image,
  Plus,
  RotateCw,
  Save,
  Search,
  Trash2,
} from '../icons/icons'
import { portfolioItems } from '../../data/portfolio'
import { validateAndConvertToWebP } from '../../utils/imageUpload'
import VersionHistoryPanel from '../../admin-app/pages/VersionHistoryPanel'
import GalleryImageRow from './projects/GalleryImageRow'
import ThumbnailPicker from './projects/ThumbnailPicker'
import { uploadPendingGalleryImages } from './projects/projectImageUpload'
import ProjectEditorialFields from './projects/ProjectEditorialFields'

const PAGE_SIZE = 6

const emptyProject = {
  id: '',
  title: '',
  description: '',
  techStackText: '',
  liveUrl: '#',
  sourceUrl: '#',
  galleryImages: [],
  type: 'Automation',
  sortOrder: 999,
  status: 'published',
  slug: '',
  clientType: '',
  outcomeStatements: [],
  systemDiagramId: '',
  evidenceNote: '',
}

function deriveFilenameFromUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''

  try {
    const normalized = new URL(value)
    return normalized.pathname.split('/').filter(Boolean).pop() || ''
  } catch {
    return value.split('/').filter(Boolean).pop() || ''
  }
}

function toFormProject(project) {
  return {
    ...emptyProject,
    ...project,
    galleryImages: Array.isArray(project.galleryImages)
      ? project.galleryImages
          .filter((item) => item?.url)
          .map((item, index) => ({
            id: item.id || `${project.id || 'project'}-gallery-${index + 1}`,
            url: item.url,
            filename: item.filename || deriveFilenameFromUrl(item.url),
            altText: item.altText || '',
            sortOrder: Number(item.sortOrder) || index + 1,
            isThumbnail: Boolean(item.isThumbnail),
            pending: false,
            file: null,
          }))
      : [],
    techStackText: Array.isArray(project.techStack) ? project.techStack.join(', ') : '',
  }
}

function toPayload(form) {
  return {
    id: form.id.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    techStack: form.techStackText.split(',').map((item) => item.trim()).filter(Boolean),
    liveUrl: form.liveUrl.trim() || '#',
    sourceUrl: form.sourceUrl.trim() || '#',
    galleryImages: Array.isArray(form.galleryImages)
      ? form.galleryImages
          .filter((item) => String(item?.url || '').trim())
          .map((item, index) => ({
            id: String(item.id || `${form.id || 'project'}-gallery-${index + 1}`),
            url: String(item.url || '').trim(),
            filename: String(item.filename || '').trim() || deriveFilenameFromUrl(item.url),
            altText: String(item.altText || '').trim(),
            sortOrder: index + 1,
            isThumbnail: Boolean(item.isThumbnail),
          }))
      : [],
    type: form.type,
    sortOrder: Number(form.sortOrder) || 999,
    status: form.status,
    slug: String(form.slug || '').trim(),
    clientType: form.clientType || '',
    outcomeStatements: (form.outcomeStatements || []).map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3),
    systemDiagramId: form.systemDiagramId || '',
    evidenceNote: String(form.evidenceNote || '').trim(),
  }
}

function badgeClass(value) {
  if (value === 'Website') return 'bg-sky-50 text-sky-700 ring-sky-200'
  if (value === 'draft') return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
}

function normalizeValue(value) {
  return String(value ?? '').toLowerCase()
}

export default function ProjectsManager() {
  const [searchParams] = useSearchParams()
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState(emptyProject)
  const [status, setStatus] = useState('Loading admin data...')
  const [isSaving, setIsSaving] = useState(false)
  const [saveStage, setSaveStage] = useState(null)
  const [isReadOnlyPreview, setIsReadOnlyPreview] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [currentPage, setCurrentPage] = useState(1)
  const [showHistory, setShowHistory] = useState(false)

  const loadStaticPreview = useCallback((reason) => {
    const staticProjects = portfolioItems

    setProjects(staticProjects)
    setSelectedProject(staticProjects[0] ? toFormProject(staticProjects[0]) : emptyProject)
    setIsReadOnlyPreview(true)
    setCurrentPage(1)
    setStatus(`${reason} Showing static project fallback in read-only preview mode.`)
  }, [])

  const loadProjects = useCallback(async ({ preserveStatus = false } = {}) => {
    try {
      const response = await fetch('/api/admin/projects')
      if (response.status === 401) {
        setStatus('Admin API is protected. Configure Cloudflare Access for /admin and /api/admin/*, then sign in with the allowed email.')
        return
      }
      if (response.status === 503) {
        const payload = await response.json()
        loadStaticPreview(payload.error)
        return
      }
      if (!response.ok) {
        loadStaticPreview(`Unable to load projects (${response.status}).`)
        return
      }

      const data = await response.json()
      setProjects(data)
      setSelectedProject((current) => {
        if (!current.id) return data[0] ? toFormProject(data[0]) : emptyProject
        const match = data.find((project) => project.id === current.id)
        return match ? toFormProject(match) : data[0] ? toFormProject(data[0]) : emptyProject
      })
      setIsReadOnlyPreview(false)
      setCurrentPage(1)
      if (!preserveStatus) {
        setStatus(`Loaded ${data.length} project record(s).`)
      }
    } catch {
      loadStaticPreview('Unable to reach the admin API.')
    }
  }, [loadStaticPreview])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const appliedProjectIdRef = useRef(null)

  useEffect(() => {
    const requestedId = searchParams.get('projectId')
    if (!requestedId || !projects.length) return
    if (appliedProjectIdRef.current === requestedId) return
    const match = projects.find((project) => project.id === requestedId)
    if (match) {
      appliedProjectIdRef.current = requestedId
      setSelectedProject(toFormProject(match))
      document.getElementById('project-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [searchParams, projects])

  async function saveProject(event) {
    event.preventDefault()
    if (isReadOnlyPreview) {
      setStatus('Read-only preview mode. Configure Cloudflare Worker, Access, D1, and R2 to save changes.')
      return
    }

    setIsSaving(true)
    setSaveStage('uploading')
    setStatus('Uploading staged images...')

    const pendingBlobUrls = (selectedProject.galleryImages || [])
      .filter((item) => item.pending && item.url)
      .map((item) => item.url)

    let uploadedGalleryImages
    try {
      uploadedGalleryImages = await uploadPendingGalleryImages(selectedProject.galleryImages, (fileName) => {
        setStatus(`Uploading ${fileName}...`)
      })
    } catch (error) {
      setStatus(error.message || 'Image upload failed. The project was not saved.')
      setIsSaving(false)
      setSaveStage(null)
      return
    }

    setSaveStage('saving')
    setStatus('Saving project...')

    const payload = toPayload({ ...selectedProject, galleryImages: uploadedGalleryImages })
    const method = projects.some((project) => project.id === payload.id) ? 'PUT' : 'POST'
    const url = method === 'PUT' ? `/api/admin/projects/${payload.id}` : '/api/admin/projects'

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()
      if (!response.ok) {
        setStatus(data.error || `Save failed (${response.status}).`)
        return
      }

      setSelectedProject(toFormProject(data))
      pendingBlobUrls.forEach((blobUrl) => URL.revokeObjectURL(blobUrl))
      await loadProjects({ preserveStatus: true })
      setStatus(`Project saved at ${new Date().toLocaleTimeString()}.`)
    } catch {
      setStatus('Project save failed.')
    } finally {
      setIsSaving(false)
      setSaveStage(null)
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject.id) return
    if (isReadOnlyPreview) {
      setStatus('Read-only preview mode. Configure the admin API before deleting projects.')
      return
    }

    setStatus('Deleting project...')

    try {
      const response = await fetch(`/api/admin/projects/${selectedProject.id}`, { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        setStatus(data.error || `Delete failed (${response.status}).`)
        return
      }

      revokeCurrentPendingImageUrls()
      setSelectedProject(emptyProject)
      await loadProjects({ preserveStatus: true })
      setStatus(`Project deleted at ${new Date().toLocaleTimeString()}.`)
    } catch {
      setStatus('Project delete failed.')
    }
  }

  async function handleVersionRestored(restored) {
    if (hasPendingImages && !window.confirm('You have unsaved image changes — restore anyway?')) return
    revokeCurrentPendingImageUrls()
    setShowHistory(false)
    setSelectedProject(toFormProject(restored))
    await loadProjects({ preserveStatus: true })
    setStatus(`Project restored to a previous version at ${new Date().toLocaleTimeString()}.`)
  }

  async function addGalleryFiles(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    if (isReadOnlyPreview) {
      setStatus('Read-only preview mode. Configure R2 and the admin API before adding images.')
      event.target.value = ''
      return
    }

    try {
      const staged = []
      for (const file of files) {
        setStatus(`Validating ${file.name}...`)
        const prepared = await validateAndConvertToWebP(file)
        staged.push({
          id: crypto.randomUUID(),
          url: URL.createObjectURL(prepared.file),
          filename: prepared.file.name,
          altText: '',
          isThumbnail: false,
          pending: true,
          file: prepared.file,
        })
      }

      setSelectedProject((current) => {
        const nextImages = [...(current.galleryImages || []), ...staged].map((item, index) => ({
          ...item,
          sortOrder: index + 1,
        }))
        return { ...current, galleryImages: nextImages }
      })
      setStatus(`${staged.length} image(s) staged. Save the project to upload and persist them.`)
    } catch (error) {
      setStatus(error.message || 'Image staging failed.')
    } finally {
      event.target.value = ''
    }
  }

  async function replaceGalleryImage(index, file) {
    if (isReadOnlyPreview) {
      setStatus('Read-only preview mode. Configure R2 and the admin API before replacing images.')
      return
    }

    try {
      setStatus(`Validating ${file.name}...`)
      const prepared = await validateAndConvertToWebP(file)

      setSelectedProject((current) => ({
        ...current,
        galleryImages: (current.galleryImages || []).map((item, itemIndex) => {
          if (itemIndex !== index) return item
          if (item.pending && item.url) URL.revokeObjectURL(item.url)
          return { ...item, url: URL.createObjectURL(prepared.file), filename: prepared.file.name, pending: true, file: prepared.file }
        }),
      }))
      setStatus(`Replacement staged for slide ${index + 1}. Save the project to persist it.`)
    } catch (error) {
      setStatus(error.message || 'Image staging failed.')
    }
  }

  function selectThumbnail(id) {
    setSelectedProject((current) => ({
      ...current,
      galleryImages: (current.galleryImages || []).map((item) => ({ ...item, isThumbnail: item.id === id })),
    }))
    setStatus('Thumbnail selection updated. Save the project to persist it.')
  }

  function clearThumbnail() {
    setSelectedProject((current) => ({
      ...current,
      galleryImages: (current.galleryImages || []).map((item) => ({ ...item, isThumbnail: false })),
    }))
    setStatus('Thumbnail cleared — the logo will show until a new one is selected. Save the project to persist it.')
  }

  function updateGalleryImage(index, updates) {
    setSelectedProject((current) => ({
      ...current,
      galleryImages: (current.galleryImages || []).map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...updates } : item
      )),
    }))
  }

  function removeGalleryImage(index) {
    setSelectedProject((current) => {
      const removed = (current.galleryImages || [])[index]
      if (removed?.pending && removed.url) URL.revokeObjectURL(removed.url)

      return {
        ...current,
        galleryImages: (current.galleryImages || [])
          .filter((_, itemIndex) => itemIndex !== index)
          .map((item, itemIndex) => ({
            ...item,
            sortOrder: itemIndex + 1,
          })),
      }
    })
    setStatus('Gallery image removed. Save the project to persist the change.')
  }

  function moveGalleryImage(index, direction) {
    setSelectedProject((current) => {
      const galleryImages = [...(current.galleryImages || [])]
      const targetIndex = index + direction
      if (targetIndex < 0 || targetIndex >= galleryImages.length) return current

      const [item] = galleryImages.splice(index, 1)
      galleryImages.splice(targetIndex, 0, item)

      return {
        ...current,
        galleryImages: galleryImages.map((galleryItem, galleryIndex) => ({
          ...galleryItem,
          sortOrder: galleryIndex + 1,
        })),
      }
    })
    setStatus('Gallery order updated. Save the project to persist the change.')
  }

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)),
    [projects],
  )

  const filteredProjects = useMemo(() => {
    const query = normalizeValue(searchTerm).trim()

    return sortedProjects.filter((project) => {
      if (typeFilter !== 'All' && project.type !== typeFilter) return false
      if (!query) return true

      const haystack = [
        project.title,
        project.id,
        project.type,
        ...(Array.isArray(project.techStack) ? project.techStack : []),
      ]
        .map(normalizeValue)
        .join(' ')

      return haystack.includes(query)
    })
  }, [searchTerm, sortedProjects, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedProjects = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return filteredProjects.slice(start, start + PAGE_SIZE)
  }, [currentPage, filteredProjects])

  const totals = useMemo(() => {
    const draft = projects.filter((project) => project.status === 'draft').length
    const websites = projects.filter((project) => project.type === 'Website').length
    const automations = projects.filter((project) => project.type === 'Automation').length

    return { draft, websites, automations }
  }, [projects])

  const hasPendingImages = (selectedProject.galleryImages || []).some((item) => item.pending)

  function revokeCurrentPendingImageUrls() {
    for (const item of selectedProject.galleryImages || []) {
      if (item.pending && item.url) URL.revokeObjectURL(item.url)
    }
  }

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!hasPendingImages) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasPendingImages])

  const previewImage = selectedProject.galleryImages.find((image) => image.isThumbnail)?.url || ''

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Total Projects</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{projects.length}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Automation</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{totals.automations}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Website</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{totals.websites}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Draft</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{totals.draft}</p>
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        {status}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <section className="flex min-h-[760px] min-w-0 flex-col rounded-md border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Projects</h2>
                <p className="text-sm text-slate-500">{filteredProjects.length} matching record(s)</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${isReadOnlyPreview ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                {isReadOnlyPreview ? 'Read-only preview' : 'Connected'}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="relative block">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                    setCurrentPage(1)
                  }}
                  placeholder="Search title, id, or tech"
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-slate-500"
                />
              </label>

              <select
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value)
                  setCurrentPage(1)
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500"
              >
                <option value="All">All types</option>
                <option value="Automation">Automation</option>
                <option value="Website">Website</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {paginatedProjects.map((project) => {
                const isActive = selectedProject.id === project.id

                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => {
                      if (hasPendingImages && !window.confirm('You have unsaved image changes — leave anyway?')) return
                      revokeCurrentPendingImageUrls()
                      setSelectedProject(toFormProject(project))
                      setShowHistory(false)
                    }}
                    className={`block w-full rounded-md border px-3 py-3 text-left transition ${
                      isActive
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{project.title}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{project.id}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${badgeClass(project.type)}`}>
                        {project.type}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                      <span>Order {project.sortOrder}</span>
                      <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${badgeClass(project.status)}`}>
                        {project.status}
                      </span>
                    </div>
                  </button>
                )
              })}

              {paginatedProjects.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                  No projects match the current search and filter.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-sm text-slate-500">
              Page {currentPage} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={16} />
                Prev
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </section>

        <form id="project-editor" onSubmit={saveProject} className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Editor</h2>
              <p className="text-sm text-slate-500">Update metadata, links, ordering, and project media.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (hasPendingImages && !window.confirm('You have unsaved image changes — refresh anyway?')) return
                  revokeCurrentPendingImageUrls()
                  loadProjects()
                }}
                className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <RotateCw size={16} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => {
                  if (hasPendingImages && !window.confirm('You have unsaved image changes — leave anyway?')) return
                  revokeCurrentPendingImageUrls()
                  setSelectedProject(emptyProject)
                  setShowHistory(false)
                  if (isReadOnlyPreview) {
                    setStatus('Read-only preview mode. New records can be created after D1 and the admin API are configured.')
                  }
                }}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <Plus size={16} />
                New Project
              </button>
              {selectedProject.id && projects.some((project) => project.id === selectedProject.id) ? (
                <button
                  type="button"
                  onClick={() => setShowHistory((value) => !value)}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  {showHistory ? 'Hide History' : 'Version History'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={deleteSelectedProject}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          </div>

          {showHistory && selectedProject.id ? (
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <VersionHistoryPanel contentType="projects" contentId={selectedProject.id} onRestored={handleVersionRestored} />
            </div>
          ) : null}

          <div className="grid min-w-0 gap-6 px-5 py-5 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
            <div className="grid min-w-0 gap-4">
              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                ID
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                  value={selectedProject.id}
                  onChange={(event) => setSelectedProject({ ...selectedProject, id: event.target.value })}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Title
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                  value={selectedProject.title}
                  onChange={(event) => setSelectedProject({ ...selectedProject, title: event.target.value })}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Description
                <textarea
                  className="min-h-32 rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                  value={selectedProject.description}
                  onChange={(event) => setSelectedProject({ ...selectedProject, description: event.target.value })}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                Tags / Tech Stack
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                  value={selectedProject.techStackText}
                  onChange={(event) => setSelectedProject({ ...selectedProject, techStackText: event.target.value })}
                  placeholder="n8n, OpenAI API, Google Sheets"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Type
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                    value={selectedProject.type}
                    onChange={(event) => setSelectedProject({ ...selectedProject, type: event.target.value })}
                  >
                    <option>Automation</option>
                    <option>Website</option>
                  </select>
                </label>

                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Status
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                    value={selectedProject.status}
                    onChange={(event) => setSelectedProject({ ...selectedProject, status: event.target.value })}
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              </div>

              <ProjectEditorialFields project={selectedProject} onChange={setSelectedProject} />

              <div className="grid gap-4 md:grid-cols-3">
                <label className="grid gap-1.5 text-sm font-semibold text-slate-800">
                  Sort Order
                  <input
                    type="number"
                    className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                    value={selectedProject.sortOrder}
                    onChange={(event) => setSelectedProject({ ...selectedProject, sortOrder: event.target.value })}
                  />
                </label>

                <label className="grid gap-1.5 text-sm font-semibold text-slate-800 md:col-span-2">
                  Live URL
                  <input
                    className="rounded-md border border-slate-300 px-3 py-2 text-slate-800 outline-none transition focus:border-slate-500"
                    value={selectedProject.liveUrl}
                    onChange={(event) => setSelectedProject({ ...selectedProject, liveUrl: event.target.value })}
                  />
                </label>
              </div>

              <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Gallery Images</p>
                    <p className="text-xs text-slate-500">
                      Add carousel images here, then pick the thumbnail in the sidebar.
                    </p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                    <Image size={16} />
                    Add Gallery Images
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={addGalleryFiles}
                      disabled={isReadOnlyPreview}
                    />
                  </label>
                </div>

                {selectedProject.galleryImages?.length ? (
                  <div className="grid gap-3">
                    {selectedProject.galleryImages.map((galleryImage, index) => (
                      <GalleryImageRow
                        key={galleryImage.id || `${galleryImage.url}-${index}`}
                        item={galleryImage}
                        index={index}
                        total={selectedProject.galleryImages.length}
                        onUpdateAltText={(rowIndex, value) => updateGalleryImage(rowIndex, { altText: value })}
                        onReplace={replaceGalleryImage}
                        onRemove={removeGalleryImage}
                        onMove={moveGalleryImage}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-500">
                    No gallery images yet. Add images for the expandable project carousel.
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3">
                <button
                  type="submit"
                  disabled={isSaving || isReadOnlyPreview}
                  className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save size={16} />
                  {saveStage === 'uploading' ? 'Uploading images…' : saveStage === 'saving' ? 'Saving project…' : 'Save Project'}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>

            <aside className="grid min-w-0 content-start gap-4 border-t border-slate-200 pt-5 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
              <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Selected Record</p>
                <p className="mt-2 break-words text-sm font-semibold text-slate-950 [overflow-wrap:anywhere]">{selectedProject.title || 'New project'}</p>
                <p className="mt-1 break-words text-xs text-slate-500 [overflow-wrap:anywhere]">{selectedProject.id || 'No ID set yet'}</p>
              </div>

              {previewImage ? (
                <div className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <img
                    src={previewImage}
                    alt={`${selectedProject.title || 'Project'} preview`}
                    className="h-56 w-full max-w-full object-cover"
                  />
                </div>
              ) : (
                <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
                  No project image selected.
                </div>
              )}

              <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Thumbnail</p>
                <ThumbnailPicker
                  galleryImages={selectedProject.galleryImages}
                  onSelect={selectThumbnail}
                  onClear={clearThumbnail}
                />
              </div>

              <div className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Gallery Summary</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">
                  {selectedProject.galleryImages?.length || 0} gallery image(s)
                </p>
                <p className="mt-1 break-words text-xs text-slate-500">
                  Public project cards use the thumbnail above and expand into a carousel from these images.
                </p>
              </div>
            </aside>
          </div>
        </form>
      </div>
    </>
  )
}
