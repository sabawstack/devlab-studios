import { useEffect, useState } from 'react'

const UNDO_MS = 120_000

export default function UndoToast({ label, savedAt, onUndo, onDismiss }) {
  const [left, setLeft] = useState(() => UNDO_MS - (Date.now() - savedAt))
  useEffect(() => {
    const timer = setInterval(() => setLeft(UNDO_MS - (Date.now() - savedAt)), 1000)
    return () => clearInterval(timer)
  }, [savedAt])
  useEffect(() => { if (left <= 0) onDismiss() }, [left, onDismiss])
  const seconds = Math.max(0, Math.ceil(left / 1000))
  return (
    <div role="status" className="fixed inset-x-3 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-white px-4 py-3 text-ink shadow-elevated lg:bottom-6">
      <span className="flex-1 text-sm font-semibold">{label}</span>
      <button type="button" onClick={onUndo} className="min-h-11 rounded-lg bg-ink px-3 font-bold text-pickle-neon">
        Undo · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
      </button>
    </div>
  )
}
