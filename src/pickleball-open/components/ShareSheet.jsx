import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { checkInLink, tvLink, viewerLink } from '../lib/hostKeys'
import QrCode from './QrCode.jsx'
import { Button, Sheet } from './ui.jsx'

/** The board QR, and the check-in QR while self check-in is on (spec §4.2, §7). */
export default function ShareSheet({ code, selfCheckIn, onToggleCheckIn, onClose }) {
  const origin = window.location.origin
  return (
    <Sheet title="Share" onClose={onClose}>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col items-center gap-3 text-center">
          <h3 className="font-bold">Player board</h3>
          <QrCode url={viewerLink(origin, code)} size={200} />
          <p className="text-2xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
          <p className="text-sm text-mist">Players scan this to follow courts and standings. It can't change anything.</p>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <h3 className="font-bold">Check in</h3>
          {selfCheckIn ? (
            <>
              <QrCode url={checkInLink(origin, code)} size={200} label="QR code for self check-in" />
              <p className="text-sm text-mist">New arrivals scan this and type their own name. They join level with whoever has played least.</p>
            </>
          ) : (
            <p className="text-sm text-mist">Self check-in is off. Only you can add players.</p>
          )}
          <Button variant={selfCheckIn ? 'ghost' : 'neon'} onClick={onToggleCheckIn}>
            {selfCheckIn ? 'Turn self check-in off' : 'Turn self check-in on'}
          </Button>
        </div>
      </div>
      <a href={tvLink(origin, code)} target="_blank" rel="noopener" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-navy-700 px-4 font-semibold hover:bg-navy-900">Open the TV board</a>
    </Sheet>
  )
}
