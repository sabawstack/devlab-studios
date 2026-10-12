import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { adminApi } from '../lib/adminApi'
import { REPLACE_ALL_REGISTRY } from '../lib/fieldDescriptors'
import SchemaForm from '../components/SchemaForm'
import VersionHistoryPanel from './VersionHistoryPanel'

function ReplaceAllCollectionPage() {
  const { type } = useParams()
  const config = REPLACE_ALL_REGISTRY[type]
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading')
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

  function updateItem(index, next) {
    setItems((current) => current.map((item, i) => (i === index ? next : item)))
  }

  function addItem() {
    setItems((current) => [...current, { ...config.emptyItem }])
  }

  function removeItem(index) {
    setItems((current) => current.filter((_, i) => i !== index))
  }

  function moveItem(index, direction) {
    setItems((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSaveAll() {
    setStatus('saving')
    setMessage(null)
    try {
      const saved = await adminApi.put(config.apiPath, items)
      setItems(saved)
      setStatus('ready')
      setMessage({ type: 'success', text: 'Saved.' })
    } catch (error) {
      setStatus('ready')
      const detail = error.issues?.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      setMessage({ type: 'error', text: detail ? `${error.message} (${detail})` : error.message })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{config.label}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {showHistory ? 'Hide History' : 'Version History'}
          </button>
          {/* Both stay disabled until the collection has loaded. Before that,
              an added item is overwritten when the fetch lands, and Save All
              would replace the whole collection with an empty list. */}
          <button type="button" onClick={addItem} disabled={status !== 'ready'} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            Add {config.label.replace(/s$/, '')}
          </button>
          <button type="button" onClick={handleSaveAll} disabled={status !== 'ready'} className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60">
            {status === 'saving' ? 'Saving…' : 'Save All'}
          </button>
        </div>
      </div>

      {message ? (
        <p className={message.type === 'success' ? 'text-sm text-emerald-700' : 'text-sm text-rose-600'}>{message.text}</p>
      ) : null}

      {showHistory ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <VersionHistoryPanel contentType={type} contentId={null} onRestored={setItems} />
        </div>
      ) : null}

      {status === 'loading' ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {status === 'error' ? <p className="text-sm text-rose-600">Could not load {config.label.toLowerCase()}.</p> : null}

      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.id || index} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">#{index + 1}</span>
              <div className="flex gap-2 text-xs font-semibold text-slate-500">
                <button type="button" onClick={() => moveItem(index, -1)} className="hover:text-slate-800">Up</button>
                <button type="button" onClick={() => moveItem(index, 1)} className="hover:text-slate-800">Down</button>
                <button type="button" onClick={() => removeItem(index)} className="text-rose-600 hover:text-rose-800">Remove</button>
              </div>
            </div>
            <SchemaForm fields={config.fields} value={item} onChange={(next) => updateItem(index, next)} idPrefix={`item-${item.id || index}`} />
          </div>
        ))}
        {!items.length && status === 'ready' ? <p className="text-sm text-slate-500">Nothing here yet — add one above.</p> : null}
      </div>
    </div>
  )
}

export default ReplaceAllCollectionPage
