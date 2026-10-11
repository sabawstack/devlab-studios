const VARIANTS = {
  primary: 'bg-brand text-white hover:bg-[#3a00d6]',
  neon: 'bg-pickle-neon text-ink hover:brightness-95',
  ghost: 'border border-navy-700 text-white hover:bg-navy-900',
  quiet: 'text-pickle-neon hover:underline',
  danger: 'border border-rose-400/60 text-rose-200 hover:bg-rose-500/10',
}

/** @param {{ variant?: keyof typeof VARIANTS, className?: string } & import('react').ButtonHTMLAttributes<HTMLButtonElement>} props */
export function Button({ variant = 'primary', className = '', type = 'button', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pickle-neon disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  )
}

export function Panel({ className = '', as: Tag = 'div', ...props }) {
  return <Tag className={`rounded-2xl bg-navy-900 p-4 ${className}`} {...props} />
}

export function Dot({ side }) {
  return <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${side === 'A' ? 'bg-pickle-neon' : 'bg-pickle-teamb'}`} />
}

export function TeamNames({ side, names, emphasis = [] }) {
  return (
    <div className="flex items-center gap-2">
      <Dot side={side} />
      <span className="sr-only">{side === 'A' ? 'Team A:' : 'Team B:'}</span>
      <span>
        {names.map((name, index) => (
          <span key={name}>
            {index > 0 && <span className="text-mist"> · </span>}
            <span className={emphasis.includes(name) ? 'font-bold text-pickle-neon' : ''}>{name}</span>
          </span>
        ))}
      </span>
    </div>
  )
}

/** Bottom sheet on phones, centred panel from md up (spec §11). */
export function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 md:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-flip max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-navy-950 p-5 shadow-elevated md:max-w-lg md:rounded-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 rounded-xl text-mist hover:bg-navy-900">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
