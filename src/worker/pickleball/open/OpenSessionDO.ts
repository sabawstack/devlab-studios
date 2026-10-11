// One instance per open session, addressed by idFromName(publicCode). D1 is
// the source of truth (spec §3.2); this object serializes commands, keeps
// the session in memory between them, writes only the rows a command
// changed, and broadcasts to hibernating sockets. Memory is updated only
// AFTER the D1 batch succeeds, so a failed write leaves nothing half-applied.
import { DurableObject } from 'cloudflare:workers'
import { commandEnvelopeSchema } from '../../../lib/schemas/pickleball/open/commands'
import { applyCommand, finalizeCommand } from '../../../lib/pickleball/open/reducer'
import { resultsCsv } from '../../../lib/pickleball/open/resultsCsv'
import { constantTimeEqual } from '../../../lib/pickleball/open/secrets'
import { toHostSnapshot, toViewerSnapshot, type HostSnapshot, type ViewerSnapshot } from '../../../lib/pickleball/open/snapshot'
import type { OpenSessionState } from '../../../lib/pickleball/open/types'
import { sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
  deleteOpenSession, findIdempotentResponse, loadOpenSession, persistDiff,
} from '../../repositories/pickleball/open/openSessions'

export type DoResult<T> = { status: number; body: T | { error: string }; retryAfterSeconds?: number }
type Loaded = { state: OpenSessionState; hostKeyHash: string }
type Attachment = { code: string; role: 'viewer' | 'host' }

const IDEMPOTENCY_TTL_MS = 10 * 60_000
const GONE = 4404
// Spec §10: 120 commands per minute per session. Counted here, after the host
// key is checked, so strangers holding only the public code cannot use up the
// host's allowance (they are limited per IP at the route instead). In memory is
// enough: one object serves the whole session, and a flood keeps it awake.
const COMMAND_LIMIT = 120
const COMMAND_WINDOW_MS = 60_000

export class OpenSessionDO extends DurableObject<Env> {
  private loaded: Loaded | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private commandTimes: number[] = []

  /** Counts one authorized command; returns the seconds to wait when over the limit. */
  private commandRetryAfter(nowMs: number): number {
    this.commandTimes = this.commandTimes.filter((t) => t > nowMs - COMMAND_WINDOW_MS)
    if (this.commandTimes.length >= COMMAND_LIMIT) {
      return Math.max(1, Math.ceil((this.commandTimes[0] + COMMAND_WINDOW_MS - nowMs) / 1000))
    }
    this.commandTimes = [...this.commandTimes, nowMs]
    return 0
  }

  /** Runs fn after every earlier call has settled: one command at a time, even across awaits. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async load(code: string): Promise<Loaded | null> {
    // A request routed to the wrong coordinator must never load (or cache) another session's state.
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return null
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    this.loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    return this.loaded
  }

  private async isHost(loaded: Loaded, hostKey: string | null): Promise<boolean> {
    if (!hostKey) return false
    return constantTimeEqual(await sha256Base64Url(hostKey), loaded.hostKeyHash)
  }

  private async authorized(code: string, hostKey: string | null): Promise<Loaded | DoResult<never>> {
    const loaded = await this.load(code)
    if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
    if (!(await this.isHost(loaded, hostKey))) return { status: 403, body: { error: 'Only the host can do that.' } }
    return loaded
  }

  async viewer(code: string): Promise<ViewerSnapshot | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      return loaded ? toViewerSnapshot(loaded.state) : null
    })
  }

  async host(code: string, hostKey: string | null): Promise<DoResult<HostSnapshot>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      return 'state' in auth ? { status: 200, body: toHostSnapshot(auth.state) } : auth
    })
  }

  async command(code: string, hostKey: string | null, envelope: unknown): Promise<DoResult<{ version: number; host: HostSnapshot }>> {
    return this.serial(async () => {
      const parsed = commandEnvelopeSchema.safeParse(envelope)
      if (!parsed.success) return { status: 400, body: { error: 'That request was not understood.' } }
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const retryAfterSeconds = this.commandRetryAfter(Date.now())
      if (retryAfterSeconds > 0) return { status: 429, body: { error: 'Slow down a little and try again.' }, retryAfterSeconds }
      const db = this.env.PICKLEBALL_DB
      const prior = await findIdempotentResponse(db, auth.state.id, parsed.data.idempotencyKey)
      if (prior) {
        // Only {status, version} is stored (a host snapshot near the caps would crowd D1's row limit);
        // the replay answers with the session as it is now, which is what the caller needs anyway.
        const stored = JSON.parse(prior) as { status: number; version?: number; body?: { version?: number } }
        const version = stored.version ?? stored.body?.version ?? auth.state.version
        return { status: stored.status, body: { version, host: toHostSnapshot(auth.state) } }
      }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID() }
      const result = applyCommand(auth.state, parsed.data.command, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }

      const next = finalizeCommand(result.state, ctx)
      const response: DoResult<{ version: number; host: HostSnapshot }> = { status: 200, body: { version: next.version, host: toHostSnapshot(next) } }
      await persistDiff(db, auth.state, next, {
        key: parsed.data.idempotencyKey,
        responseJson: JSON.stringify({ status: 200, version: next.version }),
        now,
        cutoff: new Date(Date.parse(now) - IDEMPOTENCY_TTL_MS).toISOString(),
      })
      this.loaded = { ...auth, state: next }
      this.broadcast()
      return response
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

  private broadcast(): void {
    if (!this.loaded) return
    const viewer = JSON.stringify({ type: 'VIEWER', payload: toViewerSnapshot(this.loaded.state) })
    const host = JSON.stringify({ type: 'HOST', payload: toHostSnapshot(this.loaded.state) })
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      try {
        ws.send(attachment?.role === 'host' ? host : viewer)
      } catch {
        // a socket mid-close; it is dropped by the runtime
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 400 })
    const code = request.headers.get('X-Open-Code') ?? ''
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return new Response('Coordinator mismatch.', { status: 400 })
    const snapshot = await this.viewer(code)
    if (!snapshot) return new Response('Session not found.', { status: 404 })

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ code, role: 'viewer' } satisfies Attachment)
    server.send(JSON.stringify({ type: 'VIEWER', payload: snapshot }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    let parsed: { type?: string; hostKey?: unknown }
    try {
      parsed = JSON.parse(String(message))
    } catch {
      return
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return

    if (parsed.type === 'AUTH' && typeof parsed.hostKey === 'string') {
      try {
        const result = await this.host(attachment.code, parsed.hostKey)
        if (result.status === 200) {
          ws.serializeAttachment({ code: attachment.code, role: 'host' } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'HOST', payload: result.body }))
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
        }
      } catch (error) {
        this.logWsError(error, attachment.code, 'AUTH')
        try {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
        } catch {
          // socket already closed
        }
      }
      return
    }

    if (parsed.type === 'RESYNC') {
      try {
        if (attachment.role === 'host') {
          const loaded = await this.serial(() => this.load(attachment.code))
          if (loaded) ws.send(JSON.stringify({ type: 'HOST', payload: toHostSnapshot(loaded.state) }))
        } else {
          const snapshot = await this.viewer(attachment.code)
          if (snapshot) ws.send(JSON.stringify({ type: 'VIEWER', payload: snapshot }))
        }
      } catch (error) {
        // a failed resync is retried by the client's next RESYNC
        this.logWsError(error, attachment.code, 'RESYNC')
      }
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
