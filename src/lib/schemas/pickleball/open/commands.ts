import { z } from 'zod'

const id = z.string().min(1).max(64)
const side = z.enum(['A', 'B'])
const score = z.number().int().min(0).max(99).nullable()
export const stackingModeSchema = z.enum(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])
export const tournamentFormatSchema = z.enum(['ROUND_ROBIN', 'POOL_TO_BRACKET', 'SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION'])
const rule = z.object({ kind: z.enum(['TOGETHER', 'APART']), playerIds: z.tuple([id, id]) })

const draftEdit = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SWAP_PLAYERS'), playerIds: z.tuple([id, id]) }),
  z.object({ kind: z.literal('SWAP_PAIRS'), entrantIds: z.tuple([id, id]) }),
  z.object({ kind: z.literal('MOVE_PAIR'), entrantId: id, poolLabel: z.string().regex(/^[A-H]$/) }),
  z.object({ kind: z.literal('SET_OPPONENT'), fixtureId: id, side, entrantId: id }),
])

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
  z.object({ type: z.literal('SET_MODE'), mode: stackingModeSchema }),
  z.object({ type: z.literal('SET_SELF_CHECK_IN'), enabled: z.boolean() }),
  z.object({ type: z.literal('SET_PLAYER_SKILL'), playerId: id, skill: z.number().min(1).max(8).nullable() }),
  // DUPR IDs are 6 letters or digits (spec §9.3); null clears one. Host only: captains never get it.
  z.object({ type: z.literal('SET_PLAYER_DUPR_ID'), playerId: id, duprId: z.string().trim().regex(/^[A-Za-z0-9]{6}$/).nullable() }),
  z.object({ type: z.literal('ADD_RULE'), rule }),
  z.object({ type: z.literal('REMOVE_RULE'), rule }),
  // Tournaments (spec §6). Generate and edit the draft, start, then the two running edits.
  z.object({
    type: z.literal('GENERATE_DRAW'), format: tournamentFormatSchema,
    pairing: z.enum(['RANDOM', 'BALANCED', 'MANUAL']), seeding: z.enum(['RANDOM', 'BY_SKILL', 'MANUAL']),
  }),
  z.object({ type: z.literal('EDIT_DRAW'), edit: draftEdit }),
  z.object({ type: z.literal('START_TOURNAMENT') }),
  z.object({ type: z.literal('SUBSTITUTE_PLAYER'), entrantId: id, outPlayerId: id, inPlayerId: id }),
  z.object({ type: z.literal('SWAP_OPPONENTS'), fixtureId: id, side, otherFixtureId: id, otherSide: side }),
])

export const commandEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  command: commandSchema,
})

export type OpenCommand = z.infer<typeof commandSchema>
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>
