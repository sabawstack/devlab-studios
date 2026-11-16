import { useEffect, useState } from 'react'
import { decompressReport, parseDmarcReport } from '../../../mailbox/inbound/dmarcReport.js'
import { adminFetch } from '../../lib/adminApi'

/**
 * Renders a DMARC aggregate report instead of leaving it as a zip to download.
 *
 * PARSED HERE, IN THE BROWSER, RATHER THAN AT INGEST. The obvious alternative
 * was to parse on arrival and store the result, and that is the better shape
 * once anyone wants trends across weeks. It is the worse shape today: it needs
 * a migration, and it would leave every report already in the folder — the only
 * ones that exist — still unreadable unless something reprocessed them.
 * Browsers have DecompressionStream exactly as Workers do, so the same parser
 * runs unchanged, and every stored report becomes readable at once.
 *
 * The bytes are fetched by the PARENT, not by an iframe, for the reason the
 * inline-image path documents: the admin session cookie is SameSite=Strict.
 *
 * WHAT THIS SCREEN IS FOR. On almost every day the answer is "our own server,
 * everything passed", and the report is noise. It earns its place on the day it
 * is not — so anything failing is stated first, in the strongest terms the
 * layout allows, and the reassuring case is kept quiet.
 *
 * @param {{ attachment: object }} props
 */
function DmarcReportView({ attachment }) {
  const [report, setReport] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!attachment?.id) return undefined
    let cancelled = false

    async function load() {
      try {
        const response = await adminFetch(`/api/admin/mailbox/attachments/${attachment.id}`, {
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`Could not read the report (${response.status}).`)

        const bytes = new Uint8Array(await response.arrayBuffer())
        const xml = await decompressReport(bytes, attachment)
        if (!cancelled) setReport(parseDmarcReport(xml))
      } catch (caught) {
        if (!cancelled) setError(caught.message)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [attachment])

  if (error) {
    return (
      <p className="text-xs text-amber-700">
        This report could not be read ({error}) — download the original to inspect it.
      </p>
    )
  }

  if (!report) return <p className="text-xs text-slate-500">Reading report…</p>

  const failing = report.failingMessages > 0

  return (
    <div className="space-y-3 text-sm">
      <div
        className={`rounded border px-3 py-2 ${
          failing ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}
      >
        {failing ? (
          <>
            <p className="font-semibold">
              {report.failingMessages} of {report.messages} messages did not pass DMARC.
            </p>
            <p className="mt-1 text-xs">
              Either someone sent mail using this domain, or one of our own sending paths is misconfigured. Check the
              source addresses below against what should be sending as us.
            </p>
          </>
        ) : (
          <p>
            All {report.messages} message{report.messages === 1 ? '' : 's'} passed, from known sources.
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
        <dt className="font-semibold text-slate-500">Reported by</dt>
        <dd>{report.org ?? 'unknown'}</dd>
        <dt className="font-semibold text-slate-500">Covering</dt>
        <dd>
          {report.begin ? new Date(report.begin).toLocaleString() : '?'} —{' '}
          {report.end ? new Date(report.end).toLocaleString() : '?'}
        </dd>
        <dt className="font-semibold text-slate-500">Domain</dt>
        <dd>{report.domain ?? '—'}</dd>
        <dt className="font-semibold text-slate-500">Policy they applied</dt>
        {/*
          The policy the RECEIVER saw, which is not necessarily the one we think
          we published — a DNS edit that did not propagate shows up here first.
        */}
        <dd>
          p={report.policy.p ?? '?'} · adkim={report.policy.adkim ?? '?'} · aspf={report.policy.aspf ?? '?'} · pct=
          {report.policy.pct ?? '?'}
        </dd>
      </dl>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-1 pr-2 font-semibold">Source</th>
            <th className="py-1 pr-2 font-semibold">Messages</th>
            <th className="py-1 pr-2 font-semibold">DKIM</th>
            <th className="py-1 pr-2 font-semibold">SPF</th>
            <th className="py-1 font-semibold">Disposition</th>
          </tr>
        </thead>
        <tbody>
          {report.records.map((record, index) => {
            const passed = record.dkim === 'pass' || record.spf === 'pass'
            return (
              <tr key={`${record.sourceIp}-${index}`} className="border-b border-slate-100">
                <td className={`py-1 pr-2 font-mono ${passed ? 'text-slate-700' : 'font-semibold text-rose-800'}`}>
                  {record.sourceIp ?? 'unknown'}
                </td>
                <td className="py-1 pr-2">{record.count}</td>
                <td className={`py-1 pr-2 ${record.dkim === 'pass' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {record.dkim ?? '—'}
                  {record.dkimSelector ? <span className="text-slate-400"> ({record.dkimSelector})</span> : null}
                </td>
                <td className={`py-1 pr-2 ${record.spf === 'pass' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {record.spf ?? '—'}
                </td>
                <td className="py-1">{record.disposition ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default DmarcReportView
