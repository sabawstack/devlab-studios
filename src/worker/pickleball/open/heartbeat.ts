import { HEARTBEAT_PING, HEARTBEAT_PONG } from '../../../lib/pickleball/open/realtime'

/**
 * PB-REALTIME-01: the runtime answers every socket's "ping" with "pong" by
 * itself (hibernation auto-response), so a client can tell a live socket from
 * a dead one on a quiet session without waking the Durable Object. Returns
 * false where the API does not exist (unit tests outside workerd).
 */
export function enableHeartbeat(ctx: DurableObjectState): boolean {
  if (typeof WebSocketRequestResponsePair === 'undefined' || typeof ctx.setWebSocketAutoResponse !== 'function') return false
  ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT_PING, HEARTBEAT_PONG))
  return true
}
