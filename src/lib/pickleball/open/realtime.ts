// Heartbeat frames for the live board (PB-REALTIME-01). The Durable Object
// registers this pair with ctx.setWebSocketAutoResponse, so the Workers runtime
// answers a ping itself, without waking a hibernating Durable Object or
// charging its duration (developers.cloudflare.com/durable-objects/api/state/,
// "setWebSocketAutoResponse", updated 2026-09-30). Plain strings, not JSON, so
// they can never be mistaken for a command or a snapshot. Each is far below the
// documented 2,048-character limit.
export const HEARTBEAT_PING = 'ping'
export const HEARTBEAT_PONG = 'pong'
