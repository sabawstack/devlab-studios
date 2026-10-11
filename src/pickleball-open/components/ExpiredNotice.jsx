// src/pickleball-open/components/ExpiredNotice.jsx
import ExpiredCourtArt from '../../components/pickleball/art/ExpiredCourtArt.jsx'

export default function ExpiredNotice() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="pb-anim w-56 text-mist"><ExpiredCourtArt className="w-full" /></div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Game, set, done</p>
      <h1 className="text-3xl font-bold leading-tight">This session has ended and its results were deleted.</h1>
      <p className="text-mist">Sessions are deleted from the live service 7 days after the last change to them. That's how it stays free and keeps names private.</p>
      <a href="/pickleball/new" className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand text-lg font-bold text-white hover:bg-[#3a00d6]">Start your own session</a>
      <a href="/pickleball/how-it-works" className="text-sm text-pickle-neon hover:underline">How it works</a>
    </main>
  )
}
