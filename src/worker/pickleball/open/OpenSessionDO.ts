// One instance per open session, addressed by idFromName(publicCode). D1 is
// the source of truth (spec §3.2); this object serializes commands, keeps
// the session in memory between them, writes only the rows a command
// changed, and broadcasts to hibernating sockets. Memory is updated only
// AFTER the D1 batch succeeds, so a failed write leaves nothing half-applied.
import { DurableObject } from 'cloudflare:workers'
import { createCaptainSchema } from '../../../lib/schemas/pickleball/open/captains'
import { checkInSchema } from '../../../lib/schemas/pickleball/open/checkIn'
import { commandEnvelopeSchema } from '../../../lib/schemas/pickleball/open/commands'
import { captainLabel, captainRefusal, findCaptain } from '../../../lib/pickleball/open/captains'
import { applyCheckIn } from '../../../lib/pickleball/open/checkIn'
import { buildDuprEmail, duprFilename, type DuprEmail } from '../../../lib/pickleball/open/dupr/email'
import { buildDuprExport, localDate, normalizeTimeZone, type DuprSkip } from '../../../lib/pickleball/open/dupr/export'
import { claimStateFor, DUPR_EXPORT_LIMIT, exportsLeft, exportWindowStart, limitMessage, nextExportAt, secondsUntilNextExport, type ClaimState } from '../../../lib/pickleball/open/dupr/policy'
import { applyCommand, finalizeCommand, touch } from '../../../lib/pickleball/open/reducer'
import { resultsCsv } from '../../../lib/pickleball/open/resultsCsv'
import { constantTimeEqual } from '../../../lib/pickleball/open/secrets'
import {
  hostCourts, toCaptainSnapshot, toHostSnapshot, toViewerSnapshot, type CaptainSnapshot, type HostSnapshot, type ViewerSnapshot,
} from '../../../lib/pickleball/open/snapshot'
import { LIMITS, type CaptainRecord, type OpenSessionState } from '../../../lib/pickleball/open/types'
import { randomBase64Url, randomInt, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
  deleteOpenSession, findIdempotentResponse, insertCaptain, loadOpenSession, persistDiff, revokeCaptain as revokeCaptainRow,
  type LoadedSession,
} from '../../repositories/pickleball/open/openSessions'
import {
  claimSession, deleteDuprExport, insertDuprExport, insertHostKey, loadHostAccess, recentDuprExports, reopenRefusal, type HostAccess,
} from '../../repositories/pickleball/open/hostAccess'

export type DoResult<T> = { status: number; body: T | { error: string }; retryAfterSeconds?: number }
export interface Credentials { hostKey: string | null; captainKey: string | null }
export type CommandBody = { version: number; host?: HostSnapshot; captain?: CaptainSnapshot }
export interface CheckInBody { playerId: string; name: string; alreadyCheckedIn: boolean }
export interface CaptainLinkBody { captainId: string; label: string; captainKey: string; host: HostSnapshot }
/** The host's DUPR panel (spec §9): never part of any snapshot, so viewers and captains never get it. */
export interface DuprStatusBody {
  claim: ClaimState
  exported: number
  skipped: DuprSkip[]
  missingIds: Array<{ id: string; name: string }>
  /** Players in a game left out because two of them share a DUPR ID. */
  sharedIds: Array<{ id: string; name: string }>
  exportsLeft: number
  exportLimit: number
  /** When an export frees up again, once none are left today; otherwise null. */
  nextExportAt: string | null
}

/** A reserved export, ready to send. The reservation counts toward the limit until released. */
export interface DuprPrepared {
  exportId: string
  csv: string
  filename: string
  email: DuprEmail
  exported: number
  skipped: number
  exportsLeft: number
}

/** The session plus who, beyond the original host key, may act as its host (spec §9.2, §9.5). */
type Cached = LoadedSession & { access: HostAccess }

type Actor = { role: 'host' } | { role: 'captain'; captain: CaptainRecord }
/** A socket's message allowance: messages in the current window, when it began, and AUTH attempts over the socket's life. */
type SocketBudget = { windowStart: number; count: number; auths: number }
/**
 * extraKey: a host socket signed in with an extra host link, which deleting the account revokes.
 * budget lives here, not in memory, so it survives hibernation.
 */
type Attachment = { code: string; role: 'viewer' | 'host' | 'captain'; captainId?: string; extraKey?: boolean; budget?: SocketBudget }
/** The serialized frames for one (state, captains) pair; built on first need and reused until either changes. */
type Frames = {
  state: OpenSessionState
  captains: readonly CaptainRecord[]
  parts: { viewer: ViewerSnapshot; courts: ReturnType<typeof hostCourts> }
  viewer: string
  host: string | null
  perCaptain: Map<string, string>
}
type Identified = { role: 'host'; extraKey: boolean; payload: HostSnapshot } | { role: 'captain'; captainId: string; payload: CaptainSnapshot }

const IDEMPOTENCY_TTL_MS = 10 * 60_000
const NOTHING_TO_EXPORT = 'No game can go to DUPR yet. Every game with a valid score (no tie, a team reached 6) and four different DUPR IDs goes in.'
const GONE = 4404
// Spec §10: 120 commands per minute per session. Counted here, after the host
// or captain key is checked, so strangers holding only the public code cannot
// use up the session's allowance (they are limited per IP at the route instead).
// In memory is enough: one object serves the whole session, and a flood keeps it awake.
const COMMAND_LIMIT = 120
const COMMAND_WINDOW_MS = 60_000
// Self check-in is anonymous: 60 per 5 minutes per session caps a flood of
// junk names well before the 128-player cap, while a real crowd arriving at
// once still fits (the route also limits each address).
const CHECK_IN_LIMIT = 60
const CHECK_IN_WINDOW_MS = 5 * 60_000
// WebSocket abuse limits. Every broadcast is one send per socket, so the count
// is capped per session: 300 is a packed club night (players, a TV per court,
// captains, the host) with room to spare. A real client sends one small AUTH
// per socket and nothing else, so anything beyond these is a misbehaving or
// hostile client and the socket is closed.
export const MAX_SOCKETS = 300
export const MAX_WS_MESSAGE_BYTES = 4096
export const WS_MESSAGE_LIMIT = 10
export const WS_MESSAGE_WINDOW_MS = 10_000
export const WS_AUTH_LIMIT = 5
const WS_POLICY_VIOLATION = 1008
const WS_TOO_BIG = 1009

/** Counts one message against a socket's budget; `over` once it is past either limit. */
export function spendBudget(budget: SocketBudget | undefined, isAuth: boolean, nowMs: number): { budget: SocketBudget; over: boolean } {
  const fresh = !budget || nowMs - budget.windowStart >= WS_MESSAGE_WINDOW_MS
  const base = fresh ? { windowStart: nowMs, count: 0, auths: budget?.auths ?? 0 } : budget
  const next = { windowStart: base.windowStart, count: base.count + 1, auths: base.auths + (isAuth ? 1 : 0) }
  return { budget: next, over: next.count > WS_MESSAGE_LIMIT || next.auths > WS_AUTH_LIMIT }
}

/** Byte length of a WebSocket message, without decoding a binary one. */
function messageBytes(message: ArrayBuffer | string): number {
  if (typeof message !== 'string') return message.byteLength
  // UTF-16 length is a lower bound on UTF-8 bytes and ×3 an upper one: only encode when it could matter.
  if (message.length * 3 <= MAX_WS_MESSAGE_BYTES) return message.length
  return message.length > MAX_WS_MESSAGE_BYTES ? message.length : new TextEncoder().encode(message).byteLength
}

/** Sliding-window counter: the kept times, and the seconds to wait (0 when this call is allowed and counted). */
function windowRetryAfter(times: readonly number[], limit: number, windowMs: number, nowMs: number): { times: number[]; retryAfter: number } {
  const recent = times.filter((t) => t > nowMs - windowMs)
  if (recent.length >= limit) return { times: recent, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - nowMs) / 1000)) }
  return { times: [...recent, nowMs], retryAfter: 0 }
}

export class OpenSessionDO extends DurableObject<Env> {
  private loaded: Cached | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private commandTimes: number[] = []
  private checkInTimes: number[] = []
  private frames: Frames | null = null

  /** The serialized snapshots for this state; rebuilt only when the state or captains changed (both are replaced, never mutated). */
  private framesFor(loaded: Cached): Frames {
    if (this.frames && this.frames.state === loaded.state && this.frames.captains === loaded.captains) return this.frames
    const parts = { viewer: toViewerSnapshot(loaded.state), courts: hostCourts(loaded.state) }
    this.frames = {
      state: loaded.state, captains: loaded.captains, parts,
      viewer: JSON.stringify({ type: 'VIEWER', payload: parts.viewer }), host: null, perCaptain: new Map(),
    }
    return this.frames
  }

  private hostFrame(frames: Frames): string {
    frames.host ??= JSON.stringify({ type: 'HOST', payload: toHostSnapshot(frames.state, frames.captains, frames.parts) })
    return frames.host
  }

  private captainFrame(frames: Frames, captain: CaptainRecord): string {
    const cached = frames.perCaptain.get(captain.id)
    if (cached) return cached
    const message = JSON.stringify({ type: 'CAPTAIN', payload: toCaptainSnapshot(frames.state, captain, frames.parts) })
    frames.perCaptain.set(captain.id, message)
    return message
  }

  /** Runs fn after every earlier call has settled: one command at a time, even across awaits. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async load(code: string): Promise<Cached | null> {
    // A request routed to the wrong coordinator must never load (or cache) another session's state.
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return null
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    const loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    this.loaded = loaded ? { ...loaded, access: await loadHostAccess(this.env.PICKLEBALL_DB, loaded.state.id) } : null
    return this.loaded
  }

  /** Which host key this is: the original, an extra host link minted by reopen(), or none. Every hash is compared, so timing says nothing. */
  private async hostKeyKind(loaded: Cached, hostKey: string | null): Promise<'original' | 'extra' | null> {
    if (!hostKey) return null
    const hash = await sha256Base64Url(hostKey)
    const original = constantTimeEqual(hash, loaded.hostKeyHash)
    const extra = loaded.access.extraKeyHashes.reduce((match, known) => constantTimeEqual(hash, known) || match, false)
    return original ? 'original' : extra ? 'extra' : null
  }

  private async isHost(loaded: Cached, hostKey: string | null): Promise<boolean> {
    return (await this.hostKeyKind(loaded, hostKey)) !== null
  }

  /** Host first; otherwise a live (unrevoked) captain link. Revocation is immediate: captains are checked from memory on every call. */
  private async actorFor(loaded: Cached, credentials: Credentials): Promise<Actor | null> {
    if (await this.isHost(loaded, credentials.hostKey)) return { role: 'host' }
    if (!credentials.captainKey) return null
    const captain = findCaptain(loaded.captains, await sha256Base64Url(credentials.captainKey))
    return captain ? { role: 'captain', captain } : null
  }

  private async authorized(code: string, hostKey: string | null): Promise<Cached | DoResult<never>> {
    const loaded = await this.load(code)
    if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
    if (!(await this.isHost(loaded, hostKey))) return { status: 403, body: { error: 'Only the host can do that.' } }
    return loaded
  }

  private snapshotFor(actor: Actor, state: OpenSessionState, captains: readonly CaptainRecord[]): Pick<CommandBody, 'host' | 'captain'> {
    return actor.role === 'host' ? { host: toHostSnapshot(state, captains) } : { captain: toCaptainSnapshot(state, actor.captain) }
  }

  async viewer(code: string): Promise<ViewerSnapshot | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      return loaded ? this.framesFor(loaded).parts.viewer : null
    })
  }

  async host(code: string, hostKey: string | null): Promise<DoResult<HostSnapshot>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      return 'state' in auth ? { status: 200, body: toHostSnapshot(auth.state, auth.captains) } : auth
    })
  }

  async captain(code: string, captainKey: string | null): Promise<DoResult<CaptainSnapshot>> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const actor = await this.actorFor(loaded, { hostKey: null, captainKey })
      if (actor?.role !== 'captain') return { status: 403, body: { error: 'This captain link is no longer valid.' } }
      return { status: 200, body: toCaptainSnapshot(loaded.state, actor.captain) }
    })
  }

  async command(code: string, credentials: Credentials, envelope: unknown): Promise<DoResult<CommandBody>> {
    // The route already validated the (size-capped) body; this re-check runs outside the queue,
    // so a malformed call never holds up real commands.
    const parsed = commandEnvelopeSchema.safeParse(envelope)
    if (!parsed.success) return { status: 400, body: { error: 'That request was not understood.' } }
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const actor = await this.actorFor(loaded, credentials)
      if (!actor) {
        const captainOnly = credentials.captainKey !== null && credentials.hostKey === null
        return { status: 403, body: { error: captainOnly ? 'This captain link is no longer valid.' : 'Only the host can do that.' } }
      }
      if (actor.role === 'captain') {
        const refusal = captainRefusal(parsed.data.command, actor.captain, loaded.state)
        if (refusal) return { status: 403, body: { error: refusal } }
      }
      const limit = windowRetryAfter(this.commandTimes, COMMAND_LIMIT, COMMAND_WINDOW_MS, Date.now())
      this.commandTimes = limit.times
      if (limit.retryAfter > 0) return { status: 429, body: { error: 'Slow down a little and try again.' }, retryAfterSeconds: limit.retryAfter }
      const db = this.env.PICKLEBALL_DB
      const prior = await findIdempotentResponse(db, loaded.state.id, parsed.data.idempotencyKey)
      if (prior) {
        // Only {status, version} is stored (a snapshot near the caps would crowd D1's row limit);
        // the replay answers with the session as it is now, which is what the caller needs anyway.
        const stored = JSON.parse(prior) as { status: number; version?: number; body?: { version?: number } }
        const version = stored.version ?? stored.body?.version ?? loaded.state.version
        return { status: stored.status, body: { version, ...this.snapshotFor(actor, loaded.state, loaded.captains) } }
      }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID(), actor: actor.role === 'captain' ? actor.captain.label : 'Host', random: randomInt }
      const result = applyCommand(loaded.state, parsed.data.command, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }

      const next = finalizeCommand(result.state, ctx)
      await persistDiff(db, loaded.state, next, {
        key: parsed.data.idempotencyKey,
        responseJson: JSON.stringify({ status: 200, version: next.version }),
        now,
        cutoff: new Date(Date.parse(now) - IDEMPOTENCY_TTL_MS).toISOString(),
      })
      this.loaded = { ...loaded, state: next }
      this.broadcast()
      return { status: 200, body: { version: next.version, ...this.snapshotFor(actor, next, loaded.captains) } }
    })
  }

  async checkIn(code: string, body: unknown): Promise<DoResult<CheckInBody>> {
    const parsed = checkInSchema.safeParse(body)
    if (!parsed.success) return { status: 400, body: { error: 'Check your details and try again.' } }
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID() }
      const entry = { name: parsed.data.name, skill: parsed.data.skill ?? null, duprId: parsed.data.duprId ?? null }
      const result = applyCheckIn(loaded.state, entry, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }
      const answer = { playerId: result.playerId, name: result.name, alreadyCheckedIn: result.alreadyCheckedIn }
      // A name already on the list and playing changes nothing, so it costs none of the
      // session's allowance: repeating it cannot lock real arrivals out (only the per-IP limit applies).
      if (result.alreadyCheckedIn) return { status: 200, body: answer }

      // Only a check-in that adds a player or brings one back from a break is counted.
      const limit = windowRetryAfter(this.checkInTimes, CHECK_IN_LIMIT, CHECK_IN_WINDOW_MS, Date.now())
      this.checkInTimes = limit.times
      if (limit.retryAfter > 0) return { status: 429, body: { error: 'Lots of people are checking in. Try again in a minute.' }, retryAfterSeconds: limit.retryAfter }

      const next = finalizeCommand(result.state, ctx)
      await persistDiff(this.env.PICKLEBALL_DB, loaded.state, next, null)
      this.loaded = { ...loaded, state: next }
      this.broadcast()
      return { status: 201, body: answer }
    })
  }

  async createCaptain(code: string, hostKey: string | null, body: unknown): Promise<DoResult<CaptainLinkBody>> {
    const parsed = createCaptainSchema.safeParse(body)
    if (!parsed.success) return { status: 400, body: { error: 'Pick a court for the captain.' } }
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const court = auth.state.courts.find((c) => c.id === parsed.data.courtId)
      if (!court) return { status: 404, body: { error: 'Court not found.' } }
      if (auth.captains.length >= LIMITS.maxCaptains) return { status: 409, body: { error: `A session can have at most ${LIMITS.maxCaptains} captain links.` } }

      const now = new Date().toISOString()
      const captainKey = randomBase64Url(16)
      const captain: CaptainRecord = {
        id: crypto.randomUUID(), label: captainLabel(auth.state, court.id, auth.captains, parsed.data.label),
        courtId: court.id, keyHash: await sha256Base64Url(captainKey), createdAt: now,
      }
      const next = touch(auth.state, now)
      await insertCaptain(this.env.PICKLEBALL_DB, next, captain)
      const captains = [...auth.captains, captain]
      this.loaded = { ...auth, state: next, captains }
      this.broadcast()
      return { status: 201, body: { captainId: captain.id, label: captain.label, captainKey, host: toHostSnapshot(next, captains) } }
    })
  }

  async revokeCaptain(code: string, hostKey: string | null, captainId: string): Promise<DoResult<{ revoked: true; host: HostSnapshot }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      // Unknown or already revoked: nothing is written, versioned or broadcast.
      if (!auth.captains.some((c) => c.id === captainId)) return { status: 404, body: { error: 'That captain link was not found.' } }
      const now = new Date().toISOString()
      const next = touch(auth.state, now)
      await revokeCaptainRow(this.env.PICKLEBALL_DB, next, captainId, now)
      const captains = auth.captains.filter((c) => c.id !== captainId)
      this.loaded = { ...auth, state: next, captains }
      this.broadcast()
      return { status: 200, body: { revoked: true, host: toHostSnapshot(next, captains) } }
    })
  }

  async results(code: string, hostKey: string | null): Promise<DoResult<{ csv: string; filename: string }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const slug = auth.state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'
      return { status: 200, body: { csv: resultsCsv(auth.state), filename: `${slug}-${auth.state.createdAt.slice(0, 10)}-results.csv` } }
    })
  }

  async remove(code: string, hostKey: string | null): Promise<DoResult<{ deleted: true }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      await deleteOpenSession(this.env.PICKLEBALL_DB, auth.state.id)
      this.closeAll()
      return { status: 200, body: { deleted: true } }
    })
  }

  /** The host's DUPR panel: claim, what would be exported and why games are left out, exports left today. */
  async duprStatus(code: string, hostKey: string | null, hostId: string | null, timeZone: string): Promise<DoResult<DuprStatusBody>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const preview = buildDuprExport(auth.state, { timeZone: normalizeTimeZone(timeZone) })
      const sent = await recentDuprExports(this.env.PICKLEBALL_DB, auth.state.id, exportWindowStart(new Date().toISOString()))
      return {
        status: 200,
        body: {
          claim: claimStateFor(auth.access.hostId, hostId), exported: preview.exported, skipped: preview.skipped,
          missingIds: preview.missingIds, sharedIds: preview.sharedIds, exportsLeft: exportsLeft(sent), exportLimit: DUPR_EXPORT_LIMIT, nextExportAt: nextExportAt(sent),
        },
      }
    })
  }

  /** Links the session to a signed-in host: once, and only for whoever holds the host key (spec §9.2). */
  async claim(code: string, hostKey: string | null, hostId: string): Promise<DoResult<{ claim: ClaimState }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const current = claimStateFor(auth.access.hostId, hostId)
      if (current === 'MINE') return { status: 200, body: { claim: current } }
      if (current === 'OTHER') return { status: 409, body: { error: 'This session is already linked to another Google account.' } }
      if (!(await claimSession(this.env.PICKLEBALL_DB, auth.state.id, hostId))) {
        return { status: 409, body: { error: 'Your sign-in has ended. Sign in again and retry.' } }
      }
      this.loaded = { ...auth, access: { ...auth.access, hostId } }
      return { status: 200, body: { claim: 'MINE' } }
    })
  }

  /** A fresh host link for the account that claimed this session: the lost-link recovery path (spec §9.5). */
  async reopen(code: string, hostId: string): Promise<DoResult<{ hostKey: string }>> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const refusal = reopenRefusal(loaded.access, hostId)
      if (refusal) return { status: refusal.status, body: { error: refusal.error } }
      const hostKey = randomBase64Url(16)
      const keyHash = await sha256Base64Url(hostKey)
      await insertHostKey(this.env.PICKLEBALL_DB, { id: crypto.randomUUID(), sessionId: loaded.state.id, keyHash, createdAt: new Date().toISOString() })
      this.loaded = { ...loaded, access: { ...loaded.access, extraKeyHashes: [...loaded.access.extraKeyHashes, keyHash] } }
      return { status: 201, body: { hostKey } }
    })
  }

  /**
   * Builds the export and reserves one of the day's 5 (spec §9.6). Only the
   * account the session is linked to may export it. The route sends the email
   * and calls releaseDuprExport if sending failed, so a failure costs nothing.
   */
  async prepareDuprExport(
    code: string, hostKey: string | null, host: { id: string; displayName: string; duprClubId: string }, timeZone: string,
  ): Promise<DoResult<DuprPrepared>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const claim = claimStateFor(auth.access.hostId, host.id)
      if (claim === 'UNCLAIMED') return { status: 409, body: { error: 'Link this session to your Google account first.' } }
      if (claim === 'OTHER') return { status: 403, body: { error: 'Only the Google account this session is linked to can export it.' } }
      const zone = normalizeTimeZone(timeZone)
      const preview = buildDuprExport(auth.state, { timeZone: zone })
      if (!preview.exported) return { status: 409, body: { error: NOTHING_TO_EXPORT } }
      const now = new Date().toISOString()
      const sent = await recentDuprExports(this.env.PICKLEBALL_DB, auth.state.id, exportWindowStart(now))
      if (!exportsLeft(sent)) return { status: 429, body: { error: limitMessage(sent, now) }, retryAfterSeconds: secondsUntilNextExport(sent, now) }
      const date = localDate(auth.state.createdAt, zone)
      const body: DuprPrepared = {
        exportId: crypto.randomUUID(), csv: preview.csv, filename: duprFilename(auth.state.name, date),
        email: buildDuprEmail({
          hostName: host.displayName, sessionName: auth.state.name, date, clubId: host.duprClubId,
          exported: preview.exported, skipped: preview.skipped,
        }),
        exported: preview.exported, skipped: preview.skipped.length, exportsLeft: exportsLeft(sent) - 1,
      }
      // Reserved last, once everything that could throw has run: nothing is held for an export that never left here.
      await insertDuprExport(this.env.PICKLEBALL_DB, {
        id: body.exportId, sessionId: auth.state.id, sentAt: now, gameCount: preview.exported, skippedCount: preview.skipped.length,
      })
      return { status: 200, body }
    })
  }

  /** Gives back a reserved export whose email could not be sent. */
  async releaseDuprExport(code: string, hostKey: string | null, exportId: string): Promise<void> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if ('state' in auth) await deleteDuprExport(this.env.PICKLEBALL_DB, auth.state.id, exportId)
    })
  }

  /**
   * After an account is deleted (D1 already unlinked the session and deleted
   * its extra host links): drop both from memory too, and turn every socket
   * signed in with an extra host link back into a viewer. The original host
   * key keeps working.
   */
  async forgetHost(hostId: string): Promise<void> {
    return this.serial(async () => {
      if (this.loaded?.access.hostId === hostId) this.loaded = { ...this.loaded, access: { hostId: null, extraKeyHashes: [] } }
      const viewer = this.loaded ? this.framesFor(this.loaded).viewer : null
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Attachment | null
        if (attachment?.role !== 'host' || !attachment.extraKey) continue
        try {
          ws.serializeAttachment({ code: attachment.code, role: 'viewer', budget: attachment.budget } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
          if (viewer) ws.send(viewer)
        } catch {
          // a socket mid-close; it is dropped by the runtime
        }
      }
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
  async evict(): Promise<void> {
    return this.serial(async () => this.closeAll())
  }

  private closeAll(): void {
    this.loaded = null
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(GONE, 'Session ended')
      } catch {
        // already closing
      }
    }
  }

  /**
   * Sends every socket the snapshot for its role. Each snapshot is built at most
   * once per pass. A captain socket whose link was revoked is turned back into a
   * viewer here, in the same pass, and told so (CAPTAIN_REVOKED) before it gets
   * the public board.
   */
  private broadcast(): void {
    if (!this.loaded) return
    const { captains } = this.loaded
    // Built once per state and shared by this pass and every RESYNC until the next change.
    const frames = this.framesFor(this.loaded)
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      try {
        if (attachment?.role === 'host') {
          ws.send(this.hostFrame(frames))
          continue
        }
        if (attachment?.role === 'captain' && attachment.captainId) {
          const captain = captains.find((c) => c.id === attachment.captainId)
          if (captain) {
            ws.send(this.captainFrame(frames, captain))
            continue
          }
          ws.serializeAttachment({ code: attachment.code, role: 'viewer', budget: attachment.budget } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'CAPTAIN_REVOKED' }))
        }
        ws.send(frames.viewer)
      } catch {
        // a socket mid-close; it is dropped by the runtime
      }
    }
  }

  /** Who a socket's AUTH message proves it is, with their snapshot; null when the key is not valid. */
  private async identify(code: string, credentials: Credentials): Promise<Identified | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return null
      const actor = await this.actorFor(loaded, credentials)
      if (!actor) return null
      return actor.role === 'host'
        ? { role: 'host', extraKey: (await this.hostKeyKind(loaded, credentials.hostKey)) === 'extra', payload: toHostSnapshot(loaded.state, loaded.captains) }
        : { role: 'captain', captainId: actor.captain.id, payload: toCaptainSnapshot(loaded.state, actor.captain) }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 400 })
    const code = request.headers.get('X-Open-Code') ?? ''
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return new Response('Coordinator mismatch.', { status: 400 })
    // Every broadcast is one send per socket: past the cap, new sockets are refused (the client keeps polling and retries).
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) {
      return new Response('Too many connections to this session. Try again shortly.', { status: 429, headers: { 'Retry-After': '30' } })
    }
    const viewer = await this.serial(async () => {
      const loaded = await this.load(code)
      return loaded ? this.framesFor(loaded).viewer : null
    })
    if (!viewer) return new Response('Session not found.', { status: 404 })

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ code, role: 'viewer' } satisfies Attachment)
    server.send(viewer)
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Closes a socket for breaking the message rules; it may already be closing. */
  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason)
    } catch {
      // already closing
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // Dropped before JSON.parse: a real client only ever sends a ~100-byte AUTH.
    if (messageBytes(message) > MAX_WS_MESSAGE_BYTES) {
      this.closeSocket(ws, WS_TOO_BIG, 'Message too large')
      return
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return
    let parsed: { type?: string; hostKey?: unknown; captainKey?: unknown }
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message))
    } catch {
      parsed = {}
    }
    // Every message counts, junk included; AUTH also has a per-socket lifetime cap.
    const spent = spendBudget(attachment.budget, parsed?.type === 'AUTH', Date.now())
    if (spent.over) {
      this.closeSocket(ws, WS_POLICY_VIOLATION, 'Too many messages')
      return
    }
    const current: Attachment = { ...attachment, budget: spent.budget }
    ws.serializeAttachment(current)

    if (parsed?.type === 'AUTH') {
      await this.authenticateSocket(ws, current, parsed)
      return
    }
    if (parsed?.type === 'RESYNC') await this.resyncSocket(ws, current)
  }

  private async authenticateSocket(ws: WebSocket, attachment: Attachment, parsed: { hostKey?: unknown; captainKey?: unknown }): Promise<void> {
    const credentials: Credentials = {
      hostKey: typeof parsed.hostKey === 'string' && parsed.hostKey.length <= 128 ? parsed.hostKey : null,
      captainKey: typeof parsed.captainKey === 'string' && parsed.captainKey.length <= 128 ? parsed.captainKey : null,
    }
    try {
      const who = await this.identify(attachment.code, credentials)
      if (who?.role === 'host') {
        ws.serializeAttachment({ code: attachment.code, role: 'host', budget: attachment.budget, ...(who.extraKey ? { extraKey: true } : {}) } satisfies Attachment)
        ws.send(JSON.stringify({ type: 'HOST', payload: who.payload }))
      } else if (who?.role === 'captain') {
        ws.serializeAttachment({ code: attachment.code, role: 'captain', captainId: who.captainId, budget: attachment.budget } satisfies Attachment)
        ws.send(JSON.stringify({ type: 'CAPTAIN', payload: who.payload }))
      } else {
        ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
      }
    } catch (error) {
      this.logWsError(error, attachment.code, 'AUTH')
      // Not a refused key: the client keeps it and retries (AUTH_FAILED would make it forget the key).
      try {
        ws.send(JSON.stringify({ type: 'AUTH_ERROR' }))
      } catch {
        // socket already closed
      }
    }
  }

  /** The socket's current snapshot, from the frames cached for this state (nothing is rebuilt per RESYNC). */
  private async resyncSocket(ws: WebSocket, attachment: Attachment): Promise<void> {
    try {
      const loaded = await this.serial(() => this.load(attachment.code))
      if (!loaded) return
      const frames = this.framesFor(loaded)
      if (attachment.role === 'host') {
        ws.send(this.hostFrame(frames))
        return
      }
      const captain = attachment.role === 'captain' ? loaded.captains.find((c) => c.id === attachment.captainId) : undefined
      ws.send(captain ? this.captainFrame(frames, captain) : frames.viewer)
    } catch (error) {
      // a failed resync is retried by the client's next RESYNC
      this.logWsError(error, attachment.code, 'RESYNC')
    }
  }

  private logWsError(error: unknown, code: string, messageType: string): void {
    console.log(JSON.stringify({ event: 'pickleball_open.ws_error', code, messageType, error: error instanceof Error ? error.message : 'unknown' }))
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are reserved and cannot be echoed back; anything else is.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // already closed
    }
  }
}
