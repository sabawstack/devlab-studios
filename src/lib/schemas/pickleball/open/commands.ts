import { z } from 'zod'

const id = z.string().min(1).max(64)
const side = z.enum(['A', 'B'])
const score = z.number().int().min(0).max(99).nullable()

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ADD_PLAYERS'), names: z.array(z.string().max(200)).min(1).max(128) }),
  z.object({ type: z.literal('SET_PLAYER_STATUS'), playerId: id, status: z.enum(['ACTIVE', 'BREAK', 'LEFT']) }),
  z.object({ type: z.literal('RENAME_PLAYER'), playerId: id, name: z.string().max(200) }),
  z.object({ type: z.literal('SET_COURT_ENABLED'), courtId: id, enabled: z.boolean() }),
  z.object({ type: z.literal('EDIT_PROPOSAL'), matchId: id, teamA: z.tuple([id, id]), teamB: z.tuple([id, id]) }),
  z.object({ type: z.literal('SKIP_PROPOSAL'), matchId: id }),
  z.object({ type: z.literal('START_MATCH'), matchId: id }),
  z.object({ type: z.literal('RECORD_RESULT'), matchId: id, winner: side, scoreA: score, scoreB: score }),
  z.object({ type: z.literal('UNDO_RESULT'), matchId: id }),
  z.object({ type: z.literal('EDIT_RESULT'), matchId: id, winner: side, scoreA: score, scoreB: score }),
  z.object({ type: z.literal('ABANDON_MATCH'), matchId: id }),
  z.object({ type: z.literal('END_SESSION') }),
])

export const commandEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  command: commandSchema,
})

export type OpenCommand = z.infer<typeof commandSchema>
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>
