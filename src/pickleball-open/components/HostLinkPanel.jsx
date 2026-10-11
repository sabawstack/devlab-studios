import { useState } from 'react'
import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { hostLink, viewerLink } from '../lib/hostKeys'
import QrCode from './QrCode.jsx'
import { Button, Panel } from './ui.jsx'

export default function HostLinkPanel({ code, hostKey, name }) {
  const origin = window.location.origin
  const host = hostLink(origin, code, hostKey)
  const viewer = viewerLink(origin, code)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(host)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: `Host link: ${name}`, text: 'My host link (keep private)', url: host }).catch(() => {})
    } else {
      await copy()
    }
  }

  return (
    <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-5 px-4 py-8 md:grid-cols-2 md:py-14">
      <div className="md:col-span-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Session is live</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight md:text-4xl">Two links. Keep the first one to yourself.</h1>
      </div>
      <Panel className="border-2 border-pickle-neon">
        <h2 className="text-lg font-bold">Your host link</h2>
        <p className="mt-1 text-sm text-mist">Full control. This device remembers it; open it on another phone to host from there.</p>
        <p className="mt-3 truncate rounded-lg bg-ink px-3 py-2 font-mono text-xs text-mist">{viewer}#host=••••••••</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</Button>
          <Button variant="ghost" onClick={share}>Send to myself</Button>
        </div>
        <p className="mt-3 text-xs text-mist">Lose it on a new phone and it can't be recovered, so save it somewhere now.</p>
      </Panel>
      <Panel className="flex items-center gap-4">
        <QrCode url={viewer} size={150} />
        <div>
          <h2 className="text-lg font-bold">Player board</h2>
          <p className="mt-1 text-sm text-mist">Show or print this. Players see courts, who's next and standings. View only.</p>
          <p className="mt-2 text-xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
        </div>
      </Panel>
      <a href={`/pickleball/s/${code}#host=${hostKey}`} className="md:col-span-2 inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">
        I saved it — go to courts
      </a>
    </div>
  )
}
