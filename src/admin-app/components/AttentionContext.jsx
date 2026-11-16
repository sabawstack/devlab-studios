import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { adminApi } from '../lib/adminApi'
import { ATTENTION_SOURCES, inquiryAttention, leadCrmAttention, mailboxAttention } from '../lib/attention'

const AttentionContext = createContext(null)
const idle = { state: 'loading', value: null }

/**
 * "Needs attention" for the navigation and Home (ADMIN-03, ADMIN-04): three
 * existing endpoints, fetched in parallel, each with its own loading and
 * failure state, so one failing area never blanks the others.
 */
export function AttentionProvider({ children }) {
  const [inquiries, setInquiries] = useState(idle)
  const [leadCrm, setLeadCrm] = useState(idle)
  const [mailbox, setMailbox] = useState(idle)

  const load = useCallback(() => {
    let live = true
    const run = (fetcher, toValue, set) => {
      set((current) => ({ ...current, state: current.value ? 'refreshing' : 'loading' }))
      fetcher()
        .then((data) => live && set({ state: 'ready', value: toValue(data) }))
        .catch(() => live && set({ state: 'error', value: null }))
    }
    run(() => Promise.all([adminApi.get(ATTENTION_SOURCES.inquiries.newInquiries), adminApi.get(ATTENTION_SOURCES.inquiries.failedDeliveries)]),
      ([fresh, failed]) => inquiryAttention(fresh, failed), setInquiries)
    run(() => adminApi.get(ATTENTION_SOURCES.leadCrm), leadCrmAttention, setLeadCrm)
    run(() => adminApi.get(ATTENTION_SOURCES.mailbox), mailboxAttention, setMailbox)
    return () => {
      live = false
    }
  }, [])

  useEffect(() => load(), [load])
  const value = useMemo(() => ({ inquiries, leadCrm, mailbox, reload: load }), [inquiries, leadCrm, mailbox, load])
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAttention() {
  return useContext(AttentionContext) ?? { inquiries: idle, leadCrm: idle, mailbox: idle, reload: () => {} }
}

/** A count beside a navigation entry; words for screen readers, nothing when zero or unknown. */
export function AttentionCount({ count, label, id }) {
  if (!count) return null
  return (
    // Hidden from the link's name (so "Mailbox" stays "Mailbox"); read as its description through aria-describedby.
    <span id={id} aria-hidden="true" className="ml-auto rounded-full bg-[var(--ws-sidebar-ink)] px-2 py-0.5 text-[0.7rem] font-bold text-[var(--ws-sidebar)]">
      {count}<span className="sr-only"> {label}</span>
    </span>
  )
}
