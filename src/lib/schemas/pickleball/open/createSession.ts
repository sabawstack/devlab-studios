import { z } from 'zod'

export const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  hostDisplayName: z.string().trim().min(1).max(40),
  location: z.string().trim().max(120).nullable().optional(),
  courtCount: z.number().int().min(1).max(16),
  settings: z.object({
    // Phase 1 ships paddle stack only (spec §14); later phases widen this literal.
    mode: z.literal('PADDLE_STACK'),
    target: z.union([z.literal(11), z.literal(15), z.literal(21)]),
    scoringStyle: z.enum(['SIDEOUT', 'RALLY']),
  }),
  players: z.array(z.object({
    name: z.string().max(200),
    skill: z.number().min(1).max(8).nullable().optional(),
    duprId: z.string().regex(/^[A-Za-z0-9]{6}$/).nullable().optional(),
  })).max(128),
  turnstileToken: z.string().max(2048).optional(),
})

export type CreateSessionBody = z.infer<typeof createSessionSchema>
