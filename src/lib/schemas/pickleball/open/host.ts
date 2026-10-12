import { z } from 'zod'
import { normalizeTimeZone } from '../../../pickleball/open/dupr/export'

const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)

/** The env-gated test login (spec §13): stands in for Google's verified profile. */
export const testLoginSchema = z.object({
  email,
  name: z.string().trim().min(1).max(80).optional(),
  marketingOptIn: z.boolean().optional(),
})

/**
 * A DUPR Club ID as the host types it: letters, digits and dashes, 3 to 20
 * long. DUPR does not publish its format, so this only keeps junk out; it is
 * shown back in the export email and never sent to DUPR by us.
 */
export const DUPR_CLUB_ID_PATTERN = /^[A-Za-z0-9-]{3,20}$/

/** PATCH /api/pickleball/open/host/me: either field, or both. */
export const hostProfilePatchSchema = z.object({
  duprClubId: z.string().trim().regex(DUPR_CLUB_ID_PATTERN).nullable().optional(),
  marketingOptIn: z.boolean().optional(),
}).refine((patch) => patch.duprClubId !== undefined || patch.marketingOptIn !== undefined)

/** POST /api/pickleball/open/s/{code}/dupr-export. The zone is the host's device's, for game dates. */
export const duprExportRequestSchema = z.object({
  timeZone: z.string().max(64).refine((zone) => normalizeTimeZone(zone) === zone).optional(),
})

export type HostProfilePatch = z.infer<typeof hostProfilePatchSchema>
