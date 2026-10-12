import { z } from 'zod'
import { stackingModeSchema, tournamentFormatSchema } from './commands'

export const createSessionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  hostDisplayName: z.string().trim().min(1).max(40),
  location: z.string().trim().max(120).nullable().optional(),
  courtCount: z.number().int().min(1).max(16),
  settings: z.object({
    mode: stackingModeSchema,
    target: z.union([z.literal(11), z.literal(15), z.literal(21)]),
    scoringStyle: z.enum(['SIDEOUT', 'RALLY']),
    // Optional: older clients send no value and get the default (on).
    selfCheckIn: z.boolean().optional(),
  }),
  players: z.array(z.object({
    name: z.string().max(200),
    skill: z.number().min(1).max(8).nullable().optional(),
    duprId: z.string().regex(/^[A-Za-z0-9]{6}$/).nullable().optional(),
  })).max(128),
  // Optional: an older client sends neither and gets open play.
  kind: z.enum(['OPEN_PLAY', 'TOURNAMENT']).optional(),
  tournament: z.object({ format: tournamentFormatSchema }).optional(),
  turnstileToken: z.string().max(2048).optional(),
}).superRefine((body, ctx) => {
  // A tournament needs its format; open play must not carry one.
  const isTournament = body.kind === 'TOURNAMENT'
  if (isTournament && !body.tournament) ctx.addIssue({ code: 'custom', path: ['tournament'], message: 'A tournament needs a format.' })
  if (!isTournament && body.tournament) ctx.addIssue({ code: 'custom', path: ['tournament'], message: 'Only a tournament takes a format.' })
})

export type CreateSessionBody = z.infer<typeof createSessionSchema>
