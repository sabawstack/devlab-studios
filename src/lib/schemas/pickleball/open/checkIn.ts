import { z } from 'zod'

// Anonymous input: shapes only. Names are cleaned, and skill and DUPR ID
// checked with friendly messages, by applyCheckIn (checkIn.ts).
export const checkInSchema = z.object({
  name: z.string().max(200),
  skill: z.number().nullable().optional(),
  duprId: z.string().max(20).nullable().optional(),
})
