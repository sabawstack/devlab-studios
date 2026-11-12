import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../lib/adminApi'

/**
 * Admin logins (audit CMS-04 / SEC-02): give a collaborator their own login
 * instead of sharing yours. Everyone has the same access. Removing a login
 * signs it out on its next request. The bootstrap login from the Worker
 * secrets is listed but managed there.
 */
function AdminLoginsPanel({ minPasswordLength = 12 }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ email: '', password: '' })
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    adminApi.get('/api/admin/credentials').then(setData).catch((error) => setStatus({ tone: 'error', message: error.message }))
  }, [])
  useEffect(load, [load])

  async function add(event) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await adminApi.post('/api/admin/credentials', form)
      setForm({ email: '', password: '' })
      setStatus({ tone: 'ok', message: `Added ${form.email}. Share the password with them securely.` })
      load()
    } catch (error) {
      setStatus({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  async function remove(email) {
    if (!window.confirm(`Remove the login for ${email}? They are signed out on their next request.`)) return
    setBusy(true)
    setStatus(null)
    try {
      await adminApi.delete(`/api/admin/credentials?email=${encodeURIComponent(email)}`)
      setStatus({ tone: 'ok', message: `Removed ${email}.` })
      load()
    } catch (error) {
      setStatus({ tone: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500'
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="admin-logins-heading">
      <div>
        <h2 id="admin-logins-heading" className="text-lg font-semibold text-slate-900">Admin logins</h2>
        <p className="mt-1 text-sm text-slate-500">Everyone listed here has full CMS access.</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {(data?.logins || []).map((login) => (
          <li key={login.email} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {login.email}
              {login.email === data.currentEmail ? <span className="ml-2 text-xs text-slate-500">(you)</span> : null}
              {login.source !== 'cms' ? <span className="ml-2 text-xs text-slate-500">(bootstrap)</span> : null}
            </span>
            {login.source === 'cms' && login.email !== data.currentEmail ? (
              <button type="button" disabled={busy} onClick={() => remove(login.email)} className="text-sm font-semibold text-rose-700 hover:underline disabled:opacity-50">
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          Email
          <input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={input} autoComplete="off" />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-slate-800">
          Password
          <input type="password" required minLength={minPasswordLength} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={input} autoComplete="new-password" />
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-brand-teal px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Add login</button>
      </form>
      {status ? <p role="status" className={`text-sm ${status.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{status.message}</p> : null}
    </section>
  )
}

export default AdminLoginsPanel
