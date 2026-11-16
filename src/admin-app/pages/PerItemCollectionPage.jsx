import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminApi } from '../lib/adminApi'
import { PER_ITEM_REGISTRY } from '../lib/fieldDescriptors'
import SchemaForm from '../components/SchemaForm'
import VersionHistoryPanel from './VersionHistoryPanel'
import { confirmAction } from '../primitives/confirm'

function PerItemCollectionPage() {
  const { type } = useParams()
  const config = PER_ITEM_REGISTRY[type]
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
  const [selected, setSelected] = useState(null)
  const [message, setMessage] = useState(null)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    if (!config) return
    let ignore = false
    adminApi
      .get(config.apiPath)
      .then((data) => {
        if (!ignore) {
          setItems(data)
          setStatus('ready')
        }
      })
      .catch(() => !ignore && setStatus('error'))
    return () => {
      ignore = true
    }
  }, [config])

  if (!config) return <p className="text-rose-600">Unknown collection type: {type}</p>

  function selectItem(item) {
    setSelected(item)
    setMessage(null)
    setShowHistory(false)
  }

  function startNew() {
    setSelected({ ...config.emptyItem })
    setMessage(null)
    setShowHistory(false)
  }

  async function handleSave() {
    setMessage(null)
    try {
      const saved = await adminApi.post(config.apiPath, selected)
      setItems((current) => {
        const exists = current.some((item) => item.id === saved.id)
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved]
      })
      setSelected(saved)
      setMessage({ type: 'success', text: 'Saved.' })
    } catch (error) {
      const detail = error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      setMessage({ type: 'error', text: detail ? `${error.message} (${detail})` : error.message })
    }
  }

  async function handleDelete() {
    if (!selected?.id) return
    if (!(await confirmAction({ title: 'Delete this item?', body: 'This cannot be undone.', confirmLabel: 'Delete item', danger: true }))) return
    await adminApi.delete(`${config.apiPath}/${selected.id}`)
    setItems((current) => current.filter((item) => item.id !== selected.id))
    setSelected(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{config.label}</h1>
        <button type="button" onClick={startNew} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
          Add New
        </button>
      </div>

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load {config.label.toLowerCase()}.</p> : null}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectItem(item)}
              className={`block w-full rounded-lg border px-3 py-2 text-left text-sm ${selected?.id === item.id ? 'border-brand-teal bg-brand-mint/40 font-semibold text-brand-ink' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
            >
              {config.itemLabel ? config.itemLabel(item) : item.id}
            </button>
          ))}
          {!items.length && status === 'ready' ? <p className="text-sm text-slate-500">Nothing here yet.</p> : null}
        </div>

        <div>
          {selected ? (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <SchemaForm fields={config.fields} value={selected} onChange={setSelected} idPrefix={`item-${selected.id || 'new'}`} />

              {message ? <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p> : null}

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleSave} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                  Save
                </button>
                {selected.id ? (
                  <>
                    <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      {showHistory ? 'Hide History' : 'Version History'}
                    </button>
                    <button type="button" onClick={handleDelete} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                      Delete
                    </button>
                  </>
                ) : null}
              </div>

              {showHistory && selected.id ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <VersionHistoryPanel contentType={type} contentId={selected.id} onRestored={setSelected} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">Select an item to edit, or add a new one.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default PerItemCollectionPage
