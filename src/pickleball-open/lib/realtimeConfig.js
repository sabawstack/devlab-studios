// Every timing the live board uses, in one place (PB-REALTIME-01). These are
// client defaults, not promises: docs/pickleball/realtime.md records what was
// measured with them.
export const REALTIME = {
  /** Poll the snapshot this often while the socket is down. */
  pollMs: 5000,
  /** Send a heartbeat ping this often on an open socket (answered by the runtime, never the Durable Object). */
  heartbeatMs: 10_000,
  /** No pong (or any frame) this long after a ping or a RESYNC: the socket is dead; drop it and reconnect. */
  replyTimeoutMs: 5000,
  /** Data older than this since the last server contact is shown as "last known", never as live. */
  staleMs: 25_000,
  /** Reconnect backoff: 1, 2, 4, then every 8 seconds. */
  reconnectBaseMs: 1000,
  reconnectMaxMs: 8000,
}

/** True when the server was heard from recently enough to call the board live. */
export function isFresh(lastContactAt, now, staleMs = REALTIME.staleMs) {
  return typeof lastContactAt === 'number' && now - lastContactAt < staleMs
}
