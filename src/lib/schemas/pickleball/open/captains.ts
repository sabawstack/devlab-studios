import { z } from 'zod'

export const createCaptainSchema = z.object({
  courtId: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
})
