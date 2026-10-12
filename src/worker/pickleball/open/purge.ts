import { purgeExpiredHostLogins } from '../../repositories/pickleball/open/hosts'
import { purgeExpiredOpenSessions } from '../../repositories/pickleball/open/openSessions'

const BATCH = 500
const MAX_BATCHES = 20

/** Deletes every open session past its 7-day expiry (spec §8). Returns how many were purged. */
export async function runOpenSessionPurge(
  env: Pick<Env, 'PICKLEBALL_DB' | 'OPEN_SESSION'>,
  { now }: { now: Date },
): Promise<number> {
  let total = 0
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const codes = await purgeExpiredOpenSessions(env.PICKLEBALL_DB, now.toISOString(), BATCH)
    total += codes.length
    // Close any sockets still attached; the rows are already gone, so a
    // failure here only means a viewer keeps a stale screen until it reconnects.
    await Promise.allSettled(codes.map((code) => env.OPEN_SESSION.get(env.OPEN_SESSION.idFromName(code)).evict()))
    if (codes.length < BATCH) break
  }
  return total
}

/**
 * Removes expired host logins (30 days after sign-in). Host accounts
 * themselves never expire (spec §3.2); only "Delete my account" removes one.
 */
export async function runHostLoginPurge(env: Pick<Env, 'PICKLEBALL_DB'>, { now }: { now: Date }): Promise<number> {
  return purgeExpiredHostLogins(env.PICKLEBALL_DB, now.toISOString())
}
