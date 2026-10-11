import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

// Client-side SVG from a URL this app built itself (never raw user input), so
// injecting the library's markup is safe. Same approach as the operator app's
// PublicLinkQRCode, copied here because that app is retired in Phase 5.
export default function QrCode({ url, size = 176 }) {
  const [markup, setMarkup] = useState(null)
  useEffect(() => {
    let ignore = false
    QRCode.toString(url, { type: 'svg', width: size, margin: 2, color: { dark: '#0b1426', light: '#ffffff' } })
      .then((svg) => { if (!ignore) setMarkup(svg) })
      .catch(() => {})
    return () => { ignore = true }
  }, [url, size])
  // Fixed square box that never shrinks: inside a flex row next to text, a
  // shrinkable box squashed the SVG sideways and distorted the modules.
  const box = { width: size, height: size }
  if (!markup) return <div style={box} className="shrink-0 rounded-xl bg-white/10" aria-hidden="true" />
  return (
    <div
      role="img"
      aria-label="QR code for the player board"
      style={box}
      className="shrink-0 overflow-hidden rounded-xl bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
