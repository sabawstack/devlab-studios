# Free Open Play — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the rest of open play to the free, no-login tool: three more stacking modes (winners play winners with the shuffle, by standing, balanced teams), chosen at create time and switchable mid-session; keep-together / keep-apart rules; a live fairness panel; QR self check-in; per-court captain links; and a TV board.

**Architecture:** The engine stays pure in `src/lib/pickleball/open/`. Every mode receives one `ModeInput` (the paddle-stack queue with the sit-out guard already applied, partner history and the active rules) and picks its four through one rule-aware `pickFour`. So the sit-out guard and keep-together/apart hold in every mode by construction. Rules and the self-check-in switch live in `settings_json`, which a new `normalizeSettings` reads, so sessions stored by Phase 1 load unchanged. Migration `0017` adds `open_captains` (per-captain SHA-256 key hash) and `open_matches.recorded_by`. `OpenSessionDO` gains three things: an actor model (host or captain), anonymous check-in with per-session limits, and captain-aware broadcasts. New screens: `/pickleball/s/[code]/check-in` and `/pickleball/s/[code]/tv`.

**Tech Stack:**
- Astro 7 (server output) on Cloudflare Workers
- D1, Durable Objects
- React 19 islands, Tailwind
- Zod 4
- Vitest 4, including `node:sqlite` for repository tests
- Playwright (`worker` project for `tests/e2e/pickleball/**`)

**Spec:** `docs/superpowers/specs/2026-10-11-pickleball-free-open-play-design.md`. Phase 2 is the second row of §14. Read §1 (success criteria), §3.3, §3.4, §5.2, §5.4, §5.5, §7, §10, §11 and §13 before starting. The Phase 1 plan (`docs/superpowers/plans/2026-10-11-pickleball-free-open-play-phase1.md`) shows the format and what already exists. **The current code is the source of truth where it differs from that plan.**

## Global Constraints

- **The engine stays pure.** Nothing under `src/lib/pickleball/open/` does I/O. Every new behaviour there gets a vitest test.
- **Sit-out guard in every mode:** with up to 12 available players per enabled court, no available player sits out more than 2 consecutive rounds. A round is one started game per enabled court. Pinned by the property tests in `modes/modes.property.test.ts` for all four modes.
- **Keep-together / keep-apart are hard constraints** in every mode. If no four fits, the court is left unproposed and the host sees why. Rules are never broken silently.
- **A mode switch applies to the next proposal only.** Nothing proposed or in progress is rewritten.
- **Captains** hold a per-captain secret: 16 random bytes, base64url, in the fragment `#cap=…`, sent as `X-Captain-Key` or in a WebSocket `AUTH` message. Only its SHA-256 (base64url) is stored. A captain is scoped to one court, and revocation takes effect on the very next request or broadcast.
- **The viewer snapshot is an allowlist** (`snapshot.ts`). It never carries skill, DUPR IDs, captain labels or hashes, rules, or any secret. Neither does the captain snapshot.
- **Rate limits** (spec §10, plus Phase 2):
  - commands: 120 per minute per session (authorized host or captain);
  - host and captain routes: 120 per minute per IP (`hostIpLimited`);
  - self check-in: 30 per 10 minutes per IP (`open-checkin-ip`), and 60 per 5 minutes per session in the DO.
- **Caps per session:** 16 courts, 128 players, 2,000 matches, 32 rules, 32 captain links. Names ≤ 40 characters, cleaned by `cleanName`.
- **CHECK constraints cannot be widened on D1** (`docs/pickleball/architecture.md`, "Schema constraint"). `0017` adds no enum CHECK. `recorded_by` is free text by design. `ALTER TABLE … ADD COLUMN` is safe; never rebuild a table.
- **Copy rule:** a public page (`/pickleball`, `/pickleball/how-it-works`, `/pickleball/rotation`) may claim only shipped code. Each feature's guide and landing copy lands in the task that ships it. In the same task, remove its banned words from `tests/e2e/pickleball/pickleball-public-pages.spec.js`:
  - remove `winners vs winners` in Task 9;
  - remove `captain` in Task 12;
  - remove `tv mode` in Task 13.
  - These stay banned: *tournament, bracket, dupr, sign in, opi, performance index, rally-by-rally, mexicano*.
  - The mode is called **"Winners play winners"** everywhere. Never write "vs" in `/pickleball` or `/pickleball/how-it-works` copy: the comparative-language test there fails on `\bvs\.?\s`.
- **Palette and motion** (spec §11): DevLab tokens plus `pickle-neon` `#c6ff2e` and `pickle-teamb` `#8d9bff`.
  - Animate with CSS keyframes only (reuse `pb-step`, `pb-bob`, `pb-fade-cycle`, `pb-pulse` in `src/styles/pickleball-open.css`).
  - Animate only `transform` and `opacity`.
  - Everything stops under `prefers-reduced-motion`.
  - Art components ship no JavaScript (no `client:*`), set `aria-hidden="true"`, and sit in a `data-testid="pb-artwork"` container.
- **Responsive:** every new screen works from 390 px to 1920 px with no horizontal page scroll. The TV board fits 1–16 courts on 1920×1080 and 1280×720 with no scrolling at all.
- **Lint:** `eslint-plugin-react-hooks` 7 is on. Never call `setState` synchronously in an effect body.
- **Per commit:**
  - Add one line under `### Added` (or `### Changed`) in `CHANGELOG.md`'s `[Unreleased]`, in the same commit (`AGENTS.md`).
  - Commit subjects are lowercase after the type.
  - Phase 2 is a **MINOR** release, but this plan bumps no version. The release happens later with the user.
- **Before any push:** run `npm run typecheck && npm run build && npm run test:unit`, then the full Playwright suite (`npx playwright test`). Pickleball specs run in the `worker` project.

## Review Focus

1. **Sessions already stored by Phase 1.** At deploy, preview (and later production) D1 holds sessions whose `settings_json` lacks `selfCheckIn`/`rules` and whose matches have no `recorded_by`. They must load with defaults and diff clean (no phantom writes), and keep accepting commands. Pinned in Task 1 ("a session stored before Phase 2 … loads with defaults and diffs clean").
2. **A captain link after the host turns it off**, with the captain's page and WebSocket still open. It must stop working on the next request: commands get 403, and the open page drops to the public board with a notice. A live link must also never act on another court or run a host command. Pinned in Task 11 (`captainRefusal` unit tests) and Task 12 (e2e "turning a captain link off works at once").
3. **Switching mode mid-session.** The proposal already on a court, and any game in progress, must stay exactly as they are; only the next proposal uses the new mode. Pinned in Task 6 (reducer test) and Task 8 (e2e: the court card text is unchanged after the switch).
4. **Rules that strand someone or stall a court.**
   - A keep-together player whose partner is on break must still play.
   - A rule set no four can satisfy must leave the court unproposed with a visible reason, not an unexplained empty court.
   - Pinned in Task 2 (unit), Task 7 (host snapshot `blocked`) and Task 8 (e2e court message).
5. **Self check-in from a crowd.**
   - The same name typed twice (different case, emoji, list numbering) is one player.
   - Check-in when it is off is refused (403).
   - The 61st check-in into one session within 5 minutes is refused (429), even from different addresses.
   - Nothing private reaches the board.
   - Pinned in Task 10 (unit + e2e).

---

## Decisions recorded for this phase (not to be reopened)

From the owner and the spec:
- **Winners play winners**: tags `W`/`L`/`N` come from each player's last finished game. Take 4 oldest-waiting `W`, else 4 `L`, else from `L ∪ N`, else paddle-stack order. Two intact previous teams are **shuffled** (A1+B1 vs A2+B2), choosing the shuffle with fewer repeats. If the four aren't two intact teams, the paddle-stack split is used.
- **By standing**: rank by session standings (win rate, then points-won share); take a window of 4 adjacent ranks containing the longest-waiting player; play 1st+4th vs 2nd+3rd.
- **Balanced**: paddle-stack selection, then the split with the smallest summed-strength gap; repeated partners break ties.
- The host sees all four modes, each with a one-line explanation, at create time, and can switch mid-session with `SET_MODE`.
- Captain links: 16-byte secret, SHA-256 stored, `#cap=…`, host can create and revoke; revocation is immediate.
- QR self check-in: separate link/QR; name plus optional skill 1–5 and DUPR ID; host can turn it off; rate-limited per IP and per session; the roster cleaning rules apply.
- TV: `/pickleball/s/[code]/tv`, large type, 1–16 courts, readable from about 5 m, same allowlisted viewer snapshot.

Resolved by this plan where the spec was silent or ambiguous:
1. **Due window.** Winners/losers and by-standing choose only among the *players most due to play*: the forced sit-outs plus the next players in paddle-stack order, 8 in all (`DUE_WINDOW`). Choosing from the whole queue lets winners or the top of the table go straight back on, which breaks the §1 sit-out guarantee. This was verified by simulation: 4 modes × 16 roster/court shapes × 25 seeds × 40 rounds, max sit-out 2.
2. **By-standing window choice.** Ranks are taken among due players only. A window must seat every forced player (the guard outranks the standings). Among valid windows: fewest games played in the window, then fewest repeated partners, then fewest repeated opponents, then the higher-ranked window. If no window qualifies: forced players first, then the nearest ranks.
3. **N tag.** A player is `N` if they have no finished game, or became available again after it (back from a break, or out of an abandoned game: "players return untagged", §5.1).
4. **Keep-together scope.**
   - A pair is enforced only while **both** players are `ACTIVE`. If one is on break or has left, the other plays normally; if the partner is busy, the player waits for them.
   - A player can have at most one keep-together partner, and a pair can't be both together and apart.
   - At most 32 rules.
   - A host **edit** that breaks a rule is refused with the rule in words (409) rather than silently allowed.
   - Rules live in `settings_json` (spec §3.2 lists constraints there); no new table.
5. **Balanced strength.** The entered skill is used as-is: self-reported 1–5, or a number the host typed (e.g. a DUPR rating), up to 8. Otherwise `1 + 4 × today's win rate`, otherwise 3. No rating is ever fetched from anywhere. The 3-split brute force is written in `balanced.ts` rather than importing `balanceTeams`, which is typed to OPI candidates and is retired in Phase 5.
6. **Captain scope.** A link is bound to **one court**. It may `START_MATCH`, `RECORD_RESULT`, `UNDO_RESULT`, `EDIT_RESULT`, `EDIT_PROPOSAL` and `SKIP_PROPOSAL` on that court only (§3.3 says record and undo; §5.4 adds proposal edits "on their court"). Abandon and everything else is host-only.
7. **"Already saved by …"** (§3.4) needs to know who saved: `open_matches.recorded_by` ('Host' or the captain's label) is added in `0017`.
8. **Captain links are REST, not commands.** The secret must be returned exactly once, and idempotent replays store only `{status, version}`. So create and revoke are `POST …/captains` and `DELETE …/captains/{id}`; both still bump the version and reset the 7-day clock. A revoked row keeps `revoked_at` and is purged with its session.
9. **Self check-in defaults ON** at create (spec: "the host can turn it off"), and Phase 1 sessions load with it ON.
   - A name already `ACTIVE` answers 200 `alreadyCheckedIn` (idempotent, safe for retries).
   - A name on break or left is brought back with `returnLevel`, without touching their stored details.
   - Check-in skill is a whole number 1–5; CSV and host edits keep 1–8.
   - No Turnstile on check-in (friction at the court; spec §10 doesn't ask for it).
   - The per-IP limit is generous because a venue's players often share one Wi-Fi address.
10. **"Sit-out spread"** (§5.5) is max − min games played among **ACTIVE** players. A player on a long break would otherwise inflate it, and `returnLevel` levels them on return anyway.
11. **The viewer snapshot gains `fairness`** (names and numbers only) so the TV can show it, and `settings.selfCheckIn` so the board can offer the check-in link.
12. **TV "auto-rotating"** (§7) means the side panel alternates standings and recent results every 15 s. All courts are always on screen, since up to 16 fit. Below 768 px the side panel is hidden (the TV board isn't for phones; the regular board is).
13. **Balanced teams has no partner-rotation bound.** Spec §5.2 puts skill balance first, so the "partners repeat rarely" property excludes it. Its tie-break is unit-tested instead.

## File map

| File | Responsibility | Task |
|---|---|---|
| `migrations/pickleball/0017_open_captains.sql` | `open_captains`, `open_matches.recorded_by` | 1 |
| `src/lib/pickleball/open/types.ts` | `PairRule`, `selfCheckIn`, `rules`, `recordedBy`, `actor`, `CaptainRecord`, limits | 1 |
| `src/lib/pickleball/open/settings.ts` | `normalizeSettings`, `STACKING_MODES` | 1 |
| `src/worker/repositories/pickleball/open/openSessions.ts` | `recorded_by`, normalized settings, captains load/insert/revoke | 1 |
| `src/lib/pickleball/open/rules.ts` | `activeRules`, `pickFour`, `honoursTogether`, `keepsRules`, `ruleViolation` | 2 |
| `src/lib/pickleball/open/modes/paddleStack.ts` | `ModeInput`, `allSplits`, `bestSplit`, `splitTeams`, costs | 2 |
| `src/lib/pickleball/open/propose.ts` | mode dispatch, `proposalBlocker` | 2–5 |
| `src/lib/pickleball/open/testing/simulate.ts` | test-only round simulator | 2 |
| `src/lib/pickleball/open/modes/shared.ts` | `DUE_WINDOW`, `dueWindow`, `lastGames`, `setKey` | 3 |
| `src/lib/pickleball/open/modes/winnersLosers.ts` | winners play winners, shuffle | 3 |
| `src/lib/pickleball/open/modes/byStanding.ts` | by standing | 4 |
| `src/lib/pickleball/open/modes/balanced.ts` | balanced teams, `strength` | 5 |
| `src/lib/pickleball/open/modes/info.ts` | `MODE_INFO`, `MODE_ORDER` (labels and one-liners) | 5 |
| `src/lib/pickleball/open/rotationExample.ts` | per-mode build-time example | 5 |
| `src/lib/pickleball/open/reducer.ts` | `SET_MODE`, rules, check-in switch, skill, `touch` | 1, 6 |
| `src/lib/schemas/pickleball/open/{commands,createSession}.ts` | new commands, four modes at create | 6 |
| `src/lib/pickleball/open/fairness.ts` | `fairnessSummary` | 7 |
| `src/lib/pickleball/open/snapshot.ts` | fairness, `blocked`, captains, `toCaptainSnapshot` | 7 |
| `src/pickleball-open/components/{ModePicker,RulesPanel,FairnessPanel}.jsx` | console UI | 8 |
| `src/components/pickleball/art/{WinnersShuffle,StandingWindow,BalancedSplit}Art.jsx` | mode diagrams | 9 |
| `src/lib/pickleball/open/checkIn.ts`, `src/lib/schemas/pickleball/open/checkIn.ts` | self check-in | 10 |
| `src/pickleball-open/CheckInApp.jsx`, `src/pages/pickleball/s/[code]/check-in.astro`, `src/pages/api/pickleball/open/s/[code]/check-in.ts` | check-in page and route | 10 |
| `src/pickleball-open/components/ShareSheet.jsx`, `src/pickleball-open/lib/me.js` | share sheet, "I'm …" storage | 10 |
| `src/lib/pickleball/open/captains.ts`, `src/lib/schemas/pickleball/open/captains.ts` | captain scope and labels | 11 |
| `src/worker/pickleball/open/OpenSessionDO.ts`, `routeHelpers.ts` | actors, captains, check-in | 10, 11 |
| `src/pages/api/pickleball/open/s/[code]/{captain,captains,captains/[captainId]}.ts` | captain routes | 11 |
| `src/pickleball-open/components/{CaptainConsole,CaptainsSheet}.jsx`, `src/pickleball-open/lib/captainKeys.js` | captain UI | 12 |
| `src/pickleball-open/TvBoard.jsx`, `src/pickleball-open/lib/tvLayout.js`, `src/pages/pickleball/s/[code]/tv.astro` | TV board | 13 |
| `tests/e2e/pickleball/open-play.spec.js`, `tests/e2e/pickleball/pickleball-public-pages.spec.js` | e2e | 8–13 |

---

### Task 1: Settings, `recordedBy`, migration 0017 and the repository

**Files:**
- Create: `migrations/pickleball/0017_open_captains.sql`
- Create: `src/lib/pickleball/open/settings.ts`, `src/lib/pickleball/open/settings.test.ts`
- Modify: `src/lib/pickleball/open/types.ts` (whole file below)
- Modify: `src/lib/pickleball/open/create.ts`, `src/lib/pickleball/open/propose.ts` (one line), `src/lib/pickleball/open/testing/fixtures.ts` (one line), `src/lib/pickleball/open/reducer.ts` (recordedBy, `touch`)
- Modify: `src/worker/repositories/pickleball/open/openSessions.ts`, `src/worker/repositories/pickleball/open/openSessions.test.ts`
- Create: `src/worker/repositories/pickleball/open/openSessions.phase2.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Phase 1's `OpenSessionState`, `diffState`, `buildInitialState`, `applyCommand`, `finalizeCommand`, `createSqliteD1`.
- Produces:
  - `type RuleKind = 'TOGETHER' | 'APART'`, `interface PairRule { kind: RuleKind; playerIds: readonly [string, string] }`
  - `SessionSettings` gains `selfCheckIn: boolean; rules: readonly PairRule[]`
  - `OpenMatch` gains `recordedBy: string | null`
  - `CommandContext` gains `actor?: string`
  - `interface CaptainRecord { id; label; courtId; keyHash; createdAt }` (all `string`)
  - `LIMITS.maxRules = 32`, `LIMITS.maxCaptains = 32`
  - `normalizeSettings(raw: unknown): SessionSettings` (fixed key order: `mode, target, scoringStyle, selfCheckIn, rules`), `STACKING_MODES`
  - `touch(state: OpenSessionState, now: string): OpenSessionState` (reducer.ts)
  - Repository:
    - `interface LoadedSession { state; hostKeyHash: string; captains: CaptainRecord[] }`, returned by `loadOpenSession`;
    - `insertCaptain(db, next: OpenSessionState, captain: CaptainRecord): Promise<void>`;
    - `revokeCaptain(db, next: OpenSessionState, captainId: string, now: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/settings.test.ts
import { describe, expect, it } from 'vitest'
import { normalizeSettings } from './settings'
import { DEFAULT_SETTINGS } from './types'

describe('normalizeSettings', () => {
  it('fills fields a Phase 1 session never stored, in a fixed key order', () => {
    const legacy = normalizeSettings({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY' })
    expect(legacy).toEqual({ mode: 'PADDLE_STACK', target: 15, scoringStyle: 'RALLY', selfCheckIn: true, rules: [] })
    expect(Object.keys(legacy)).toEqual(['mode', 'target', 'scoringStyle', 'selfCheckIn', 'rules'])
  })

  it('keeps valid rules and drops malformed ones', () => {
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      rules: [
        { kind: 'TOGETHER', playerIds: ['a', 'b'] },
        { kind: 'APART', playerIds: ['a', 'a'] },
        { kind: 'NEVER', playerIds: ['a', 'c'] },
        { kind: 'APART', playerIds: ['c'] },
        'junk',
      ],
    })
    expect(settings.rules).toEqual([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }])
  })

  it('falls back to defaults for unknown values and non-objects', () => {
    expect(normalizeSettings({ mode: 'KING_OF_THE_COURT', target: 9, selfCheckIn: 'yes' })).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })
})
```

```ts
// src/worker/repositories/pickleball/open/openSessions.phase2.test.ts
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './testing/sqliteD1'
import { createOpenSession, insertCaptain, loadOpenSession, persistDiff, purgeExpiredOpenSessions, revokeCaptain } from './openSessions'
import { buildInitialState } from '../../../../lib/pickleball/open/create'
import { applyCommand, finalizeCommand, touch } from '../../../../lib/pickleball/open/reducer'
import { DEFAULT_SETTINGS, type CaptainRecord } from '../../../../lib/pickleball/open/types'

const MIGRATIONS = ['migrations/pickleball/0016_open_sessions.sql', 'migrations/pickleball/0017_open_captains.sql']
const NOW = '2026-10-11T10:00:00.000Z'

function fresh(code = 'ABCDE23456') {
  let n = 0
  return buildInitialState({
    name: 'Sunday', hostDisplayName: 'Mike', location: null, courtCount: 2, settings: DEFAULT_SETTINGS,
    players: ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan'].map((name) => ({ name, skill: null, duprId: null })),
  }, { now: NOW, newId: () => `${code}-${(n += 1)}`, publicCode: code, sessionId: `sess-${code}` })
}

const captainFor = (courtId: string, id = 'cap-1'): CaptainRecord => ({ id, label: 'Court 1 captain', courtId, keyHash: `hash-${id}`, createdAt: NOW })

describe('Phase 2 repository', () => {
  it('a session stored before Phase 2 (old settings, no recorded_by) loads with defaults and diffs clean', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    raw.prepare(`UPDATE open_sessions SET settings_json = '{"mode":"PADDLE_STACK","target":11,"scoringStyle":"SIDEOUT"}'`).run()
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.state.settings).toEqual({ mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules: [] })
    expect(loaded?.state.matches.every((m) => m.recordedBy === null)).toBe(true)
    expect(loaded?.captains).toEqual([])
    // Still accepts a command after the deploy.
    const ctx = { now: '2026-10-11T10:05:00.000Z', newId: () => 'later' }
    const result = applyCommand(loaded!.state, { type: 'START_MATCH', matchId: loaded!.state.matches[0].id }, ctx)
    expect(result.ok).toBe(true)
  })

  it('stores who saved a result through persistDiff, and a reload equals memory', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const ctx = { now: '2026-10-11T10:15:00.000Z', newId: () => 'next', actor: 'Court 1 captain' }
    const saved = applyCommand(state, { type: 'RECORD_RESULT', matchId: state.matches[0].id, winner: 'A', scoreA: 11, scoreB: 6 }, ctx)
    if (!saved.ok) throw new Error(saved.error)
    const next = finalizeCommand(saved.state, ctx)
    await persistDiff(d1, state, next, null)
    const loaded = await loadOpenSession(d1, 'ABCDE23456', ctx.now)
    expect(loaded?.state).toEqual(next)
    expect(loaded?.state.matches.find((m) => m.id === state.matches[0].id)?.recordedBy).toBe('Court 1 captain')
  })

  it('adds and revokes captain links; a revoked link no longer loads', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    const later = touch(state, '2026-10-11T11:00:00.000Z')
    await insertCaptain(d1, later, captainFor(state.courts[0].id))
    const loaded = await loadOpenSession(d1, 'ABCDE23456', NOW)
    expect(loaded?.captains).toEqual([captainFor(state.courts[0].id)])
    expect(loaded?.state.version).toBe(later.version)
    expect(await revokeCaptain(d1, touch(later, '2026-10-11T11:05:00.000Z'), 'cap-1', '2026-10-11T11:05:00.000Z')).toBe(true)
    expect(await revokeCaptain(d1, touch(later, '2026-10-11T11:06:00.000Z'), 'cap-1', '2026-10-11T11:06:00.000Z')).toBe(false)
    expect((await loadOpenSession(d1, 'ABCDE23456', NOW))?.captains).toEqual([])
  })

  it('the purge removes captain links with their session', async () => {
    const { d1, raw } = createSqliteD1(MIGRATIONS)
    const state = fresh()
    await createOpenSession(d1, state, 'hash')
    await insertCaptain(d1, state, captainFor(state.courts[0].id))
    await purgeExpiredOpenSessions(d1, '2026-10-19T00:00:00.000Z')
    expect((raw.prepare('SELECT COUNT(*) AS n FROM open_captains').get() as { n: number }).n).toBe(0)
  })

  it('a captain key hash is unique across sessions', async () => {
    const { d1 } = createSqliteD1(MIGRATIONS)
    const a = fresh('AAAAA22222')
    const b = fresh('BBBBB33333')
    await createOpenSession(d1, a, 'h1')
    await createOpenSession(d1, b, 'h2')
    await insertCaptain(d1, a, captainFor(a.courts[0].id, 'x'))
    await expect(insertCaptain(d1, b, { ...captainFor(b.courts[0].id, 'y'), keyHash: 'hash-x' })).rejects.toThrow(/UNIQUE/)
  })
})
```

Append to `src/lib/pickleball/open/reducer.test.ts` (inside the file, after the existing `describe` blocks; reuse its imports, adding `at` and `court` from `./testing/fixtures` if they are not imported yet):

```ts
describe('who saved a result', () => {
  it('a second save says who saved it first, and undo clears it', () => {
    let n = 0
    const ctx = (minute: number, actor?: string) => ({ now: at(minute), newId: () => `w${(n += 1)}`, actor })
    const base = finalizeCommand(sessionState({ courts: [court('c1', 1)], players: ['a', 'b', 'c', 'd', 'e'].map((id, i) => player(id, { position: i })) }), ctx(0))
    const match = base.matches[0]
    const saved = applyCommand(base, { type: 'RECORD_RESULT', matchId: match.id, winner: 'A', scoreA: 11, scoreB: 4 }, ctx(5, 'Court 1 captain'))
    if (!saved.ok) throw new Error(saved.error)
    expect(saved.state.matches.find((m) => m.id === match.id)?.recordedBy).toBe('Court 1 captain')
    const again = applyCommand(saved.state, { type: 'RECORD_RESULT', matchId: match.id, winner: 'B', scoreA: 4, scoreB: 11 }, ctx(6))
    expect(again).toMatchObject({ ok: false, status: 409, error: 'This game was already saved by Court 1 captain.' })
    const undone = applyCommand(saved.state, { type: 'UNDO_RESULT', matchId: match.id }, ctx(6))
    expect(undone.ok && undone.state.matches.find((m) => m.id === match.id)).toMatchObject({ status: 'IN_PROGRESS', recordedBy: null })
  })

  it('a save without an actor is recorded as the host', () => {
    const base = finalizeCommand(sessionState({ players: ['a', 'b', 'c', 'd'].map((id) => player(id)) }), { now: at(0), newId: () => 'm1' })
    const saved = applyCommand(base, { type: 'RECORD_RESULT', matchId: 'm1', winner: 'A', scoreA: 11, scoreB: 2 }, { now: at(3), newId: () => 'x' })
    expect(saved.ok && saved.state.matches[0].recordedBy).toBe('Host')
  })
})
```

In `src/worker/repositories/pickleball/open/openSessions.test.ts`, run the existing tests against both migrations. Replace

```ts
const MIGRATION = 'migrations/pickleball/0016_open_sessions.sql'
```

with

```ts
const MIGRATION = ['migrations/pickleball/0016_open_sessions.sql', 'migrations/pickleball/0017_open_captains.sql']
```

and every `createSqliteD1([MIGRATION])` in that file with `createSqliteD1(MIGRATION)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/settings.test.ts src/worker/repositories/pickleball/open src/lib/pickleball/open/reducer.test.ts`
Expected: FAIL. `./settings` cannot be resolved, `0017_open_captains.sql` is missing (ENOENT), and `insertCaptain`/`touch` are not exported.

- [ ] **Step 3: Write the migration**

```sql
-- migrations/pickleball/0017_open_captains.sql
-- Free open play, Phase 2 (spec 2026-10-11-pickleball-free-open-play-design.md §3.2, §3.3).
--
-- open_captains: one row per court-captain link. Only the SHA-256 of the
-- link's secret is stored. A revoked link keeps its row (revoked_at set) so
-- the host's history makes sense; everything cascades from open_sessions, so
-- the 7-day purge still removes it.
--
-- open_matches.recorded_by: who saved a result ('Host' or a captain's label),
-- so a second save can say "Already saved by Court 2 captain" (spec §3.4).
-- ADD COLUMN is safe on D1; only table rebuilds are not. No CHECK here: the
-- value is free text by design, so there is nothing to widen later.

CREATE TABLE open_captains (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES open_sessions(id) ON DELETE CASCADE,
  court_id   TEXT NOT NULL REFERENCES open_courts(id) ON DELETE CASCADE,
  key_hash   TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_open_captains_session ON open_captains(session_id);

ALTER TABLE open_matches ADD COLUMN recorded_by TEXT;
```

- [ ] **Step 4: Write the types and settings**

Replace `src/lib/pickleball/open/types.ts` with:

```ts
export type StackingMode = 'PADDLE_STACK' | 'WINNERS_LOSERS' | 'BY_STANDING' | 'BALANCED'
export type TargetPoints = 11 | 15 | 21
export type ScoringStyle = 'SIDEOUT' | 'RALLY'
export type RuleKind = 'TOGETHER' | 'APART'

/** A host-set hard constraint (spec §5.4): always partners, or never on the same court. */
export interface PairRule {
  kind: RuleKind
  playerIds: readonly [string, string]
}

export interface SessionSettings {
  mode: StackingMode
  target: TargetPoints
  scoringStyle: ScoringStyle
  /** Players may add themselves from the check-in link (spec §4.2). */
  selfCheckIn: boolean
  rules: readonly PairRule[]
}

export type PlayerStatus = 'ACTIVE' | 'BREAK' | 'LEFT'

export interface OpenPlayer {
  id: string
  name: string
  skill: number | null
  duprId: string | null
  status: PlayerStatus
  /** Games credited on arrival so a late player starts level (spec §4.4). */
  gamesOffset: number
  joinedAt: string
  /** When the player last became available to play. */
  waitingSince: string
  position: number
}

export interface OpenCourt {
  id: string
  label: string
  position: number
  enabled: boolean
}

export type MatchStatus = 'PROPOSED' | 'IN_PROGRESS' | 'FINISHED' | 'ABANDONED'
export type Team = readonly [string, string]
export type Side = 'A' | 'B'

export interface OpenMatch {
  id: string
  courtId: string
  seq: number
  status: MatchStatus
  teamA: Team
  teamB: Team
  scoreA: number | null
  scoreB: number | null
  winner: Side | null
  proposedAt: string
  startedAt: string | null
  finishedAt: string | null
  /** Who saved the result: 'Host' or a captain's label. Null until saved. */
  recordedBy: string | null
}

export type SessionStatus = 'ACTIVE' | 'ENDED'

export interface OpenSessionState {
  id: string
  publicCode: string
  kind: 'OPEN_PLAY' | 'TOURNAMENT'
  name: string
  hostDisplayName: string
  location: string | null
  status: SessionStatus
  settings: SessionSettings
  players: readonly OpenPlayer[]
  courts: readonly OpenCourt[]
  matches: readonly OpenMatch[]
  version: number
  createdAt: string
  lastActivityAt: string
  expiresAt: string
}

export interface CommandContext {
  now: string
  newId: () => string
  /** Who is acting: 'Host' or a captain's label. Treated as 'Host' when absent. */
  actor?: string
}

/** A court captain link (spec §3.3). Only the SHA-256 of its secret is kept. */
export interface CaptainRecord {
  id: string
  label: string
  courtId: string
  keyHash: string
  createdAt: string
}

export const LIMITS = {
  maxCourts: 16,
  maxPlayers: 128,
  maxMatches: 2000,
  maxNameLength: 40,
  undoWindowMs: 120_000,
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  maxRules: 32,
  maxCaptains: 32,
} as const

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: 'PADDLE_STACK',
  target: 11,
  scoringStyle: 'SIDEOUT',
  selfCheckIn: true,
  rules: [],
}

export function addMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString()
}
```

Create `src/lib/pickleball/open/settings.ts`:

```ts
// Settings are stored as JSON (open_sessions.settings_json). Sessions created
// before a field existed load without it, so every read goes through this:
// one canonical shape, with a fixed key order (diffState compares JSON).
import { DEFAULT_SETTINGS, type PairRule, type SessionSettings, type StackingMode } from './types'

export const STACKING_MODES: readonly StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

function isPairRule(value: unknown): value is PairRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as { kind?: unknown; playerIds?: unknown }
  return (rule.kind === 'TOGETHER' || rule.kind === 'APART')
    && Array.isArray(rule.playerIds) && rule.playerIds.length === 2
    && rule.playerIds.every((id) => typeof id === 'string' && id.length > 0)
    && rule.playerIds[0] !== rule.playerIds[1]
}

export function normalizeSettings(raw: unknown): SessionSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    mode: STACKING_MODES.includes(value.mode as StackingMode) ? (value.mode as StackingMode) : DEFAULT_SETTINGS.mode,
    target: value.target === 15 || value.target === 21 ? value.target : 11,
    scoringStyle: value.scoringStyle === 'RALLY' ? 'RALLY' : 'SIDEOUT',
    selfCheckIn: typeof value.selfCheckIn === 'boolean' ? value.selfCheckIn : DEFAULT_SETTINGS.selfCheckIn,
    rules: Array.isArray(value.rules)
      ? value.rules.filter(isPairRule).map((rule) => ({ kind: rule.kind, playerIds: [rule.playerIds[0], rule.playerIds[1]] as const }))
      : [],
  }
}
```

- [ ] **Step 5: Thread `recordedBy` through the engine**

`src/lib/pickleball/open/propose.ts`, in `addProposal`, change

```ts
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null,
```

to

```ts
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null, recordedBy: null,
```

`src/lib/pickleball/open/testing/fixtures.ts`, in `finished(...)`, change

```ts
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10),
```

to

```ts
    proposedAt: at(minute), startedAt: at(minute), finishedAt: at(minute + 10), recordedBy: 'Host',
```

`src/lib/pickleball/open/reducer.ts`, in `recordResult`, replace

```ts
  if (!editing && match.status === 'FINISHED') return fail(409, 'This game was already saved.')
```

with

```ts
  if (!editing && match.status === 'FINISHED') {
    return fail(409, match.recordedBy ? `This game was already saved by ${match.recordedBy}.` : 'This game was already saved.')
  }
```

and

```ts
    startedAt: match.startedAt ?? ctx.now, finishedAt: editing ? match.finishedAt : ctx.now,
  }
```

with

```ts
    startedAt: match.startedAt ?? ctx.now, finishedAt: editing ? match.finishedAt : ctx.now, recordedBy: ctx.actor ?? 'Host',
  }
```

In `undoResult`, replace

```ts
  return ok(withMatch(cleared, { ...match, status: 'IN_PROGRESS', winner: null, scoreA: null, scoreB: null, finishedAt: null }))
```

with

```ts
  return ok(withMatch(cleared, { ...match, status: 'IN_PROGRESS', winner: null, scoreA: null, scoreB: null, finishedAt: null, recordedBy: null }))
```

Replace `finalizeCommand` at the end of the file with:

```ts
/** Bump the version and push expiry out 7 days (spec §8). */
export function touch(state: OpenSessionState, now: string): OpenSessionState {
  return { ...state, version: state.version + 1, lastActivityAt: now, expiresAt: addMs(now, LIMITS.retentionMs) }
}

/** Every successful command: touch, then fill free courts. */
export function finalizeCommand(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return fillProposals(touch(state, ctx.now), ctx)
}
```

- [ ] **Step 6: Normalize settings at create**

In `src/lib/pickleball/open/create.ts`, add `import { normalizeSettings } from './settings'` under the `./roster` import. Then change the `settings` field of `CreateSessionInput` to

```ts
  /** Rules are always empty at creation: they name player ids, which do not exist yet. */
  settings: Pick<SessionSettings, 'mode' | 'target' | 'scoringStyle'> & { selfCheckIn?: boolean }
```

and in `buildInitialState` replace `settings: input.settings,` with

```ts
    settings: normalizeSettings({ ...input.settings, rules: [] }),
```

- [ ] **Step 7: Update the repository**

In `src/worker/repositories/pickleball/open/openSessions.ts`:

Imports become:

```ts
import { diffState } from '../../../../lib/pickleball/open/diff'
import { normalizeSettings } from '../../../../lib/pickleball/open/settings'
import type { CaptainRecord, OpenCourt, OpenMatch, OpenPlayer, OpenSessionState, Team } from '../../../../lib/pickleball/open/types'
```

Replace the `MatchRow` interface with the version below, and add `CaptainRow` and `LoadedSession` after it:

```ts
interface MatchRow {
  id: string; court_id: string; seq: number; status: OpenMatch['status']; team_a_json: string; team_b_json: string
  score_a: number | null; score_b: number | null; winner: OpenMatch['winner']; proposed_at: string
  started_at: string | null; finished_at: string | null; recorded_by: string | null
}
interface CaptainRow { id: string; court_id: string; key_hash: string; label: string; created_at: string }

export interface LoadedSession {
  state: OpenSessionState
  hostKeyHash: string
  /** Live (unrevoked) captain links, oldest first. */
  captains: CaptainRecord[]
}
```

Replace `UPSERT_MATCH` and `matchStatement`:

```ts
const UPSERT_MATCH = `INSERT INTO open_matches (id, session_id, court_id, seq, status, team_a_json, team_b_json, score_a, score_b, winner, fixture_id, proposed_at, started_at, finished_at, recorded_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status, team_a_json = excluded.team_a_json, team_b_json = excluded.team_b_json,
    score_a = excluded.score_a, score_b = excluded.score_b, winner = excluded.winner, started_at = excluded.started_at,
    finished_at = excluded.finished_at, recorded_by = excluded.recorded_by`
```

```ts
function matchStatement(db: D1Database, sessionId: string, m: OpenMatch): D1PreparedStatement {
  return db.prepare(UPSERT_MATCH).bind(
    m.id, sessionId, m.courtId, m.seq, m.status, JSON.stringify(m.teamA), JSON.stringify(m.teamB),
    m.scoreA, m.scoreB, m.winner, m.proposedAt, m.startedAt, m.finishedAt, m.recordedBy,
  )
}
```

Replace `loadOpenSession` (keep the comment above it about key order):

```ts
export async function loadOpenSession(db: D1Database, code: string, nowIso: string): Promise<LoadedSession | null> {
  const session = await db.prepare('SELECT * FROM open_sessions WHERE public_code = ? AND expires_at > ?').bind(code, nowIso).first<SessionRow>()
  if (!session) return null
  const [players, courts, matches, captains] = await Promise.all([
    db.prepare('SELECT * FROM open_players WHERE session_id = ? ORDER BY position').bind(session.id).all<PlayerRow>(),
    db.prepare('SELECT * FROM open_courts WHERE session_id = ? ORDER BY position').bind(session.id).all<CourtRow>(),
    db.prepare('SELECT * FROM open_matches WHERE session_id = ? ORDER BY seq').bind(session.id).all<MatchRow>(),
    db.prepare('SELECT * FROM open_captains WHERE session_id = ? AND revoked_at IS NULL ORDER BY created_at, id').bind(session.id).all<CaptainRow>(),
  ])
  return {
    hostKeyHash: session.host_key_hash,
    captains: captains.results.map((c) => ({ id: c.id, label: c.label, courtId: c.court_id, keyHash: c.key_hash, createdAt: c.created_at })),
    state: {
      id: session.id, publicCode: session.public_code, kind: session.kind, name: session.name,
      hostDisplayName: session.host_display_name, location: session.location, status: session.status,
      // Sessions from before a settings field existed load with its default (settings.ts).
      settings: normalizeSettings(JSON.parse(session.settings_json)), version: session.version, createdAt: session.created_at,
      lastActivityAt: session.last_activity_at, expiresAt: session.expires_at,
      players: players.results.map((p) => ({
        id: p.id, name: p.name, skill: p.skill, duprId: p.dupr_id, status: p.status, gamesOffset: p.games_offset,
        joinedAt: p.joined_at, waitingSince: p.waiting_since, position: p.position,
      })),
      courts: courts.results.map((c) => ({ id: c.id, label: c.label, position: c.position, enabled: c.enabled === 1 })),
      matches: matches.results.map((m) => ({
        id: m.id, courtId: m.court_id, seq: m.seq, status: m.status,
        teamA: JSON.parse(m.team_a_json) as Team, teamB: JSON.parse(m.team_b_json) as Team,
        scoreA: m.score_a, scoreB: m.score_b, winner: m.winner, proposedAt: m.proposed_at,
        startedAt: m.started_at, finishedAt: m.finished_at, recordedBy: m.recorded_by,
      })),
    },
  }
}
```

Add after `loadOpenSession`:

```ts
/** Adds a captain link and touches the session, in one batch. */
export async function insertCaptain(db: D1Database, next: OpenSessionState, captain: CaptainRecord): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO open_captains (id, session_id, court_id, key_hash, label, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)')
      .bind(captain.id, next.id, captain.courtId, captain.keyHash, captain.label, captain.createdAt),
    sessionUpdate(db, next),
  ])
}

/** Revokes a captain link and touches the session, in one batch. False when no live link had that id. */
export async function revokeCaptain(db: D1Database, next: OpenSessionState, captainId: string, now: string): Promise<boolean> {
  const [revoked] = await db.batch([
    db.prepare('UPDATE open_captains SET revoked_at = ? WHERE id = ? AND session_id = ? AND revoked_at IS NULL').bind(now, captainId, next.id),
    sessionUpdate(db, next),
  ])
  return (revoked?.meta.changes ?? 0) > 0
}
```

`OpenSessionDO.ts` compiles unchanged: its `Loaded` type is a subset of `LoadedSession`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open src/worker/repositories/pickleball/open`
Expected: PASS, including every Phase 1 test.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 9: Commit**

Add under `### Added` in `CHANGELOG.md`'s `[Unreleased]`:

```markdown
- Open play: migration `0017` adds court-captain links (`open_captains`, key hash only) and records who saved each result; settings gain self check-in and keep-together/keep-apart rules, and sessions stored before this load with defaults.
```

```bash
git add migrations/pickleball/0017_open_captains.sql src/lib/pickleball/open src/worker/repositories/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): store captains, who saved each result, and phase 2 settings"
```

---

### Task 2: Keep-together / keep-apart engine, the shared mode interface, and the simulator

**Files:**
- Create: `src/lib/pickleball/open/rules.ts`, `src/lib/pickleball/open/rules.test.ts`
- Modify: `src/lib/pickleball/open/modes/paddleStack.ts` (whole file below)
- Modify: `src/lib/pickleball/open/propose.ts` (whole file below)
- Create: `src/lib/pickleball/open/testing/simulate.ts`
- Create: `src/lib/pickleball/open/modes/modes.property.test.ts`
- Modify: `src/lib/pickleball/open/propose.test.ts` (remove the moved property block)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `pairKey`, `PartnerHistory`, `QueueEntry`, `queueOrder`, `pairingHistory` (fairness.ts); `PairRule`, `StackingMode` (Task 1).
- Produces:
  - `interface ActiveRules { partnerOf: ReadonlyMap<string, string>; apart: ReadonlySet<string> }`, `NO_RULES`, `SEARCH_UNITS = 20`
  - `activeRules(state): ActiveRules`
  - `pickFour(order: readonly string[], rules: ActiveRules, exclude?: readonly string[], available?: ReadonlySet<string>): string[] | null`
  - `honoursTogether(teamA: Team, teamB: Team, rules): boolean`, `keepsRules(teamA, teamB, rules): boolean`
  - `ruleViolation(teamA, teamB, state): string | null`
  - `interface ModeInput { state; queue: readonly QueueEntry[]; history: PartnerHistory; rules: ActiveRules; exclude?: readonly string[] }`
  - `type ModeProposer = (input: ModeInput) => Proposal | null`
  - `allSplits(four): Proposal[]`, `partnerCost(p, history): number`, `opponentCost(p, history): number`
  - `bestSplit(candidates, history, rules?): Proposal | null`, `splitTeams(four, history, rules?): Proposal`, `proposePaddleStack(input: ModeInput)`
  - `proposalBlocker(state): string | null`
  - Test-only:
    - `simulate(options: SimulationOptions): SimulationResult`, where `SimulationOptions` is `{ players, courts, rounds, seed, mode?, rules?, skills? }` and `SimulationResult` is `{ state, maxSatOut, rounds: OpenMatch[][] }`;
    - `mulberry32(seed)`, `ctxAt(minute)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/rules.test.ts
import { describe, expect, it } from 'vitest'
import { activeRules, keepsRules, NO_RULES, pickFour, ruleViolation } from './rules'
import { fillProposals, proposalBlocker, proposeForCourt } from './propose'
import { at, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, type OpenPlayer, type PairRule } from './types'

function withRules(rules: PairRule[], ids = ['a', 'b', 'c', 'd', 'e', 'f'], overrides: Record<string, Partial<OpenPlayer>> = {}) {
  return sessionState({
    settings: { ...DEFAULT_SETTINGS, rules },
    players: ids.map((id, i) => player(id, { position: i, ...overrides[id] })),
  })
}

describe('activeRules', () => {
  it('pairs keep-together partners only while both are active', () => {
    const rules: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['a', 'b'] }, { kind: 'TOGETHER', playerIds: ['c', 'd'] }]
    const active = activeRules(withRules(rules, undefined, { d: { status: 'BREAK' } }))
    expect(active.partnerOf.get('a')).toBe('b')
    expect(active.partnerOf.get('b')).toBe('a')
    expect(active.partnerOf.has('c')).toBe(false)
  })
})

describe('pickFour', () => {
  const rules = (list: PairRule[]) => activeRules(withRules(list))

  it('takes the first four in order when no rule applies', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], NO_RULES)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('brings a keep-together partner in at the first member’s place', () => {
    expect(pickFour(['a', 'b', 'c', 'e', 'f', 'd'], rules([{ kind: 'TOGETHER', playerIds: ['b', 'd'] }]))).toEqual(['a', 'b', 'd', 'c'])
  })

  it('never seats a keep-apart pair together', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules([{ kind: 'APART', playerIds: ['a', 'c'] }]))).toEqual(['a', 'b', 'd', 'e'])
  })

  it('backtracks when the greedy choice leaves one seat for a pair', () => {
    // a + (b,c) leaves one seat that (d,e) cannot fill; (b,c) + (d,e) works.
    const list: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['b', 'c'] }, { kind: 'TOGETHER', playerIds: ['d', 'e'] }]
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules(list))).toEqual(['b', 'c', 'd', 'e'])
  })

  it('skips a player whose partner is busy, so they wait for them', () => {
    const list: PairRule[] = [{ kind: 'TOGETHER', playerIds: ['a', 'f'] }]
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], rules(list))).toEqual(['b', 'c', 'd', 'e'])
  })

  it('returns null when no four keeps the rules', () => {
    expect(pickFour(['a', 'b', 'c', 'd'], rules([{ kind: 'APART', playerIds: ['a', 'b'] }]))).toBeNull()
  })

  it('Skip offers another four, or the same four when there is no other', () => {
    expect(pickFour(['a', 'b', 'c', 'd', 'e'], NO_RULES, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'e'])
    expect(pickFour(['a', 'b', 'c', 'd'], NO_RULES, ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('keepsRules / ruleViolation', () => {
  it('names the rule a host edit would break', () => {
    const state = withRules([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }])
    expect(ruleViolation(['a', 'c'], ['b', 'e'], state)).toBe('a and b always play together. Remove that rule first.')
    expect(ruleViolation(['a', 'b'], ['c', 'd'], state)).toBe('c and d are kept apart. Remove that rule first.')
    expect(ruleViolation(['a', 'b'], ['c', 'e'], state)).toBeNull()
    expect(keepsRules(['a', 'b'], ['c', 'e'], activeRules(state))).toBe(true)
  })
})

describe('proposals with rules', () => {
  it('a player whose keep-together partner is on break still plays', () => {
    const state = withRules([{ kind: 'TOGETHER', playerIds: ['a', 'b'] }], ['a', 'b', 'c', 'd', 'e'], { b: { status: 'BREAK' } })
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['a', 'c', 'd', 'e'])
  })

  it('leaves the court unproposed, with a reason, rather than break a rule', () => {
    const state = withRules([{ kind: 'APART', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }], ['a', 'b', 'c', 'd'])
    const filled = fillProposals(state, { now: at(1), newId: () => 'm1' })
    expect(filled.matches).toHaveLength(0)
    expect(proposalBlocker(filled)).toMatch(/keep-together and keep-apart rules/)
    expect(proposalBlocker(withRules([], ['a', 'b', 'c']))).toBeNull()
  })
})
```

```ts
// src/lib/pickleball/open/modes/modes.property.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { simulate } from '../testing/simulate'
import type { PairRule, StackingMode } from '../types'

// Each mode task appends its mode here.
const MODES: StackingMode[] = ['PADDLE_STACK']

describe('paddle stack (property)', () => {
  it.each([[5, 1], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8]])(
    'with %i players on %i courts, games played never spread by more than 1 after each round',
    (players, courts) => {
      for (const seed of [1, 2, 3]) {
        const { state } = simulate({ players, courts, rounds: 30, seed })
        const games = state.players.map((p) => state.matches.filter((m) => m.status === 'FINISHED' && (m.teamA.includes(p.id) || m.teamB.includes(p.id))).length)
        expect(Math.max(...games) - Math.min(...games)).toBeLessThanOrEqual(1)
      }
    },
    30_000,
  )
})

describe.each(MODES)('%s (property)', (mode) => {
  it.each([[5, 1], [8, 2], [12, 1], [14, 3], [20, 2], [24, 2], [40, 4], [96, 8]])(
    'with %i players on %i courts nobody is on two courts at once',
    (players, courts) => {
      for (const seed of [1, 2, 3]) {
        for (const round of simulate({ players, courts, rounds: 20, seed, mode, skills: true }).rounds) {
          const seated = round.flatMap((m) => [...m.teamA, ...m.teamB])
          expect(new Set(seated).size).toBe(seated.length)
        }
      }
    },
    30_000,
  )

  it.each([[12, 1], [14, 3], [24, 2], [36, 3], [96, 8]])(
    'with ≤ 12 players per court (%i on %i), nobody sits out more than 2 rounds in a row',
    (players, courts) => {
      for (const seed of [1, 2, 3, 4, 5]) {
        expect(simulate({ players, courts, rounds: 30, seed, mode, skills: true }).maxSatOut).toBeLessThanOrEqual(2)
      }
    },
    30_000,
  )

  it('never breaks a keep-together or keep-apart rule, and nobody is starved', () => {
    const rules: PairRule[] = [
      { kind: 'TOGETHER', playerIds: ['p0', 'p1'] },
      { kind: 'TOGETHER', playerIds: ['p4', 'p7'] },
      { kind: 'APART', playerIds: ['p2', 'p3'] },
      { kind: 'APART', playerIds: ['p0', 'p5'] },
      { kind: 'APART', playerIds: ['p7', 'p9'] },
    ]
    for (const seed of [1, 2, 3, 4]) {
      const { rounds } = simulate({ players: 14, courts: 3, rounds: 25, seed, mode, rules })
      for (const match of rounds.flat()) {
        const four = [...match.teamA, ...match.teamB]
        for (const rule of rules) {
          const [a, b] = rule.playerIds
          if (rule.kind === 'APART') expect(four.includes(a) && four.includes(b), `${a} and ${b} on one court`).toBe(false)
          else if (four.includes(a) || four.includes(b)) {
            const team = match.teamA.includes(a) ? match.teamA : match.teamB
            expect(team.includes(b), `${a} without ${b}`).toBe(true)
          }
        }
      }
      const games = new Map<string, number>()
      for (const match of rounds.flat()) for (const id of [...match.teamA, ...match.teamB]) games.set(id, (games.get(id) ?? 0) + 1)
      expect(games.size).toBe(14)
    }
  })

  // Balanced deliberately ranks skill balance above partner rotation (spec §5.2:
  // repeated partners only break ties), so it has no repeat bound here.
  it.runIf(mode !== 'BALANCED')('partners repeat only rarely over a long session', () => {
    const { rounds } = simulate({ players: 16, courts: 2, rounds: 12, seed: 9, mode, skills: true })
    const counts = new Map<string, number>()
    for (const m of rounds.flat()) for (const team of [m.teamA, m.teamB]) counts.set(pairKey(...team), (counts.get(pairKey(...team)) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(mode === 'BY_STANDING' ? 3 : 2)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/rules.test.ts src/lib/pickleball/open/modes/modes.property.test.ts`
Expected: FAIL. `./rules` and `../testing/simulate` cannot be resolved, and `proposalBlocker` is not exported.

- [ ] **Step 3: Write `rules.ts`**

```ts
// src/lib/pickleball/open/rules.ts
// Keep-together / keep-apart (spec §5.4). Every mode picks its four through
// pickFour and splits through honoursTogether, so no mode can break a rule:
// when no four fits, the court is left unproposed and proposalBlocker says why.
import { pairKey } from './fairness'
import type { OpenSessionState, PairRule, Team } from './types'

export interface ActiveRules {
  /** Keep-together partner of each player, only while BOTH are ACTIVE (not on break, not left). */
  partnerOf: ReadonlyMap<string, string>
  /** pairKey of every keep-apart pair. */
  apart: ReadonlySet<string>
}

export const NO_RULES: ActiveRules = { partnerOf: new Map(), apart: new Set() }

/** Only units among the first SEARCH_UNITS candidates are searched: C(20, 4) = 4,845 combinations at most. */
export const SEARCH_UNITS = 20

export function activeRules(state: OpenSessionState): ActiveRules {
  const active = new Set(state.players.filter((p) => p.status === 'ACTIVE').map((p) => p.id))
  const partnerOf = new Map<string, string>()
  const apart = new Set<string>()
  for (const rule of state.settings.rules) {
    const [a, b] = rule.playerIds
    if (rule.kind === 'APART') apart.add(pairKey(a, b))
    else if (active.has(a) && active.has(b)) {
      partnerOf.set(a, b)
      partnerOf.set(b, a)
    }
  }
  return { partnerOf, apart }
}

function setKey(ids: readonly string[]): string {
  return [...ids].sort().join('|')
}

function clashes(unit: readonly string[], chosen: readonly string[], rules: ActiveRules): boolean {
  return unit.some((x) => chosen.some((y) => rules.apart.has(pairKey(x, y))))
}

/**
 * The first four players, in `order`'s preference, that keep every rule: a
 * keep-together pair joins as one unit (at its first member's place), a player
 * whose partner is not available waits, and no keep-apart pair shares the four.
 * `exclude` (Skip) asks for any other four; if there is none, the same four is
 * offered again rather than leaving the court empty.
 */
export function pickFour(
  order: readonly string[],
  rules: ActiveRules,
  exclude?: readonly string[],
  available: ReadonlySet<string> = new Set(order),
): string[] | null {
  const units: string[][] = []
  const placed = new Set<string>()
  for (const id of order) {
    if (placed.has(id)) continue
    const partner = rules.partnerOf.get(id)
    if (partner !== undefined && !available.has(partner)) continue
    const unit = partner === undefined ? [id] : [id, partner]
    unit.forEach((x) => placed.add(x))
    units.push(unit)
  }
  const pool = units.slice(0, SEARCH_UNITS)
  const banned = exclude ? setKey(exclude) : null
  const search = (start: number, chosen: string[], skip: string | null): string[] | null => {
    if (chosen.length === 4) return skip !== null && setKey(chosen) === skip ? null : chosen
    for (let i = start; i < pool.length; i += 1) {
      const unit = pool[i]
      if (chosen.length + unit.length > 4 || clashes(unit, chosen, rules)) continue
      const found = search(i + 1, [...chosen, ...unit], skip)
      if (found) return found
    }
    return null
  }
  return search(0, [], banned) ?? (banned === null ? null : search(0, [], null))
}

/** True when no keep-together pair in these teams is split across the net. */
export function honoursTogether(teamA: Team, teamB: Team, rules: ActiveRules): boolean {
  return [teamA, teamB].every((team) => team.every((id) => {
    const partner = rules.partnerOf.get(id)
    return partner === undefined || team.includes(partner)
  }))
}

/** True when this lineup keeps every active rule (used for host edits). */
export function keepsRules(teamA: Team, teamB: Team, rules: ActiveRules): boolean {
  const four = [...teamA, ...teamB]
  const apartOk = four.every((x, i) => four.slice(i + 1).every((y) => !rules.apart.has(pairKey(x, y))))
  return apartOk && honoursTogether(teamA, teamB, rules)
}

/** The rule a lineup breaks, in words, for the host; null when it breaks none. */
export function ruleViolation(teamA: Team, teamB: Team, state: OpenSessionState): string | null {
  const rules = activeRules(state)
  if (keepsRules(teamA, teamB, rules)) return null
  const name = (id: string) => state.players.find((p) => p.id === id)?.name ?? 'A player'
  const four = new Set([...teamA, ...teamB])
  const broken = state.settings.rules.find((rule: PairRule) => {
    const [a, b] = rule.playerIds
    if (rule.kind === 'APART') return four.has(a) && four.has(b)
    if (rules.partnerOf.get(a) !== b || (!four.has(a) && !four.has(b))) return false
    return !(teamA.includes(a) && teamA.includes(b)) && !(teamB.includes(a) && teamB.includes(b))
  })
  if (!broken) return 'That lineup breaks a keep-together or keep-apart rule.'
  const [a, b] = broken.playerIds
  return broken.kind === 'APART'
    ? `${name(a)} and ${name(b)} are kept apart. Remove that rule first.`
    : `${name(a)} and ${name(b)} always play together. Remove that rule first.`
}
```

- [ ] **Step 4: Rewrite `modes/paddleStack.ts` on the shared interface**

```ts
// src/lib/pickleball/open/modes/paddleStack.ts
import { pairKey, type PartnerHistory, type QueueEntry } from '../fairness'
import { honoursTogether, NO_RULES, pickFour, type ActiveRules } from '../rules'
import type { OpenSessionState, Team } from '../types'

export interface Proposal {
  teamA: Team
  teamB: Team
}

/** What every mode receives (built once per proposal by propose.ts). */
export interface ModeInput {
  state: OpenSessionState
  /** Available players in paddle-stack order: forced sit-outs first (spec §5.2 rule 1). */
  queue: readonly QueueEntry[]
  history: PartnerHistory
  rules: ActiveRules
  /** Skip: the four just rejected. */
  exclude?: readonly string[]
}

export type ModeProposer = (input: ModeInput) => Proposal | null

/** The three ways to split four players into two teams. */
export function allSplits(four: readonly string[]): Proposal[] {
  const [a, b, c, d] = four
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ]
}

export function partnerCost(p: Proposal, history: PartnerHistory): number {
  return (history.partners.get(pairKey(...p.teamA)) ?? 0) + (history.partners.get(pairKey(...p.teamB)) ?? 0)
}

export function opponentCost(p: Proposal, history: PartnerHistory): number {
  return p.teamA.reduce((sum, x) => sum + p.teamB.reduce((s, y) => s + (history.opponents.get(pairKey(x, y)) ?? 0), 0), 0)
}

/**
 * The candidate with the fewest repeated partners; opponent repeats only break
 * ties (strict lexicographic, so a repeated partnership never beats a split that
 * avoids it). Candidates that would split a keep-together pair are dropped.
 * Returns null only when every candidate breaks a rule.
 */
export function bestSplit(candidates: readonly Proposal[], history: PartnerHistory, rules: ActiveRules = NO_RULES): Proposal | null {
  const scored = candidates
    .filter((p) => honoursTogether(p.teamA, p.teamB, rules))
    .map((proposal) => ({ proposal, partner: partnerCost(proposal, history), opponent: opponentCost(proposal, history) }))
  if (!scored.length) return null
  return scored.reduce((best, next) => (
    next.partner < best.partner || (next.partner === best.partner && next.opponent < best.opponent) ? next : best
  )).proposal
}

export function splitTeams(four: readonly string[], history: PartnerHistory, rules: ActiveRules = NO_RULES): Proposal {
  return bestSplit(allSplits(four), history, rules) ?? allSplits(four)[0]
}

export function proposePaddleStack({ queue, history, rules, exclude }: ModeInput): Proposal | null {
  const four = pickFour(queue.map((entry) => entry.player.id), rules, exclude)
  return four ? splitTeams(four, history, rules) : null
}
```

- [ ] **Step 5: Rewrite `propose.ts` with a mode table and the blocker**

```ts
// src/lib/pickleball/open/propose.ts
import { pairingHistory, queueOrder } from './fairness'
import { proposePaddleStack, type ModeProposer, type Proposal } from './modes/paddleStack'
import { activeRules } from './rules'
import { LIMITS, type CommandContext, type OpenSessionState, type StackingMode } from './types'

// Tasks 3–5 add one entry each; Task 5 makes this a total Record.
const PROPOSERS: Partial<Record<StackingMode, ModeProposer>> = {
  PADDLE_STACK: proposePaddleStack,
}

/**
 * Runs the session's current mode (spec §5.2). The sit-out guard is inside
 * queueOrder (forced players first), and every mode picks through pickFour, so
 * keep-together/keep-apart can never be broken: no fitting four means null.
 */
export function proposeForCourt(state: OpenSessionState, exclude?: readonly string[]): Proposal | null {
  if (state.status !== 'ACTIVE' || state.matches.length >= LIMITS.maxMatches) return null
  const queue = queueOrder(state)
  if (queue.length < 4) return null
  const proposer = PROPOSERS[state.settings.mode]
  if (!proposer) throw new Error(`Stacking mode ${state.settings.mode} is not available yet.`)
  return proposer({ state, queue, history: pairingHistory(state.matches), rules: activeRules(state), exclude })
}

/** Why a free court has no proposal, when the reason is not simply "fewer than 4 waiting". */
export function proposalBlocker(state: OpenSessionState): string | null {
  if (state.status !== 'ACTIVE') return null
  if (state.matches.length >= LIMITS.maxMatches) return `This session has reached ${LIMITS.maxMatches} games.`
  if (queueOrder(state).length < 4) return null
  return proposeForCourt(state)
    ? null
    : 'No four waiting players fit the keep-together and keep-apart rules. Change a rule, or wait for the next game to end.'
}

export function addProposal(state: OpenSessionState, courtId: string, proposal: Proposal, ctx: CommandContext): OpenSessionState {
  const seq = state.matches.reduce((max, m) => Math.max(max, m.seq), 0) + 1
  return {
    ...state,
    matches: [
      ...state.matches,
      {
        id: ctx.newId(), courtId, seq, status: 'PROPOSED', teamA: proposal.teamA, teamB: proposal.teamB,
        scoreA: null, scoreB: null, winner: null, proposedAt: ctx.now, startedAt: null, finishedAt: null, recordedBy: null,
      },
    ],
  }
}

function courtIsFree(state: OpenSessionState, courtId: string): boolean {
  return !state.matches.some((m) => m.courtId === courtId && (m.status === 'PROPOSED' || m.status === 'IN_PROGRESS'))
}

/** Proposes a match for every enabled court that has none (spec §5.2). */
export function fillProposals(state: OpenSessionState, ctx: CommandContext): OpenSessionState {
  return [...state.courts]
    .filter((c) => c.enabled)
    .sort((a, b) => a.position - b.position)
    .reduce((acc, court) => {
      if (!courtIsFree(acc, court.id)) return acc
      const proposal = proposeForCourt(acc)
      return proposal ? addProposal(acc, court.id, proposal, ctx) : acc
    }, state)
}
```

- [ ] **Step 6: Write the test-only simulator, and move the old property block onto it**

```ts
// src/lib/pickleball/open/testing/simulate.ts
// Test-only. Plays synchronous rounds through the real engine: every free
// court is proposed, every court starts, every court finishes with a random
// valid score. Never imported by application code.
import { fillProposals } from '../propose'
import { at, court, player, sessionState } from './fixtures'
import type { CommandContext, OpenMatch, OpenSessionState, PairRule, StackingMode } from '../types'

/** Deterministic PRNG so a failure is reproducible from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function ctxAt(minute: number): CommandContext {
  let n = 0
  return { now: at(minute), newId: () => `id-${minute}-${(n += 1)}` }
}

export interface SimulationOptions {
  players: number
  courts: number
  rounds: number
  seed: number
  mode?: StackingMode
  rules?: readonly PairRule[]
  /** Give players skills 1–5 in turn (for balanced teams). */
  skills?: boolean
}

export interface SimulationResult {
  state: OpenSessionState
  /** Most consecutive rounds any available player sat out. */
  maxSatOut: number
  /** Every round's games, as started. */
  rounds: OpenMatch[][]
}

export function simulate({ players, courts, rounds, seed, mode = 'PADDLE_STACK', rules = [], skills = false }: SimulationOptions): SimulationResult {
  const random = mulberry32(seed)
  let state: OpenSessionState = sessionState({
    settings: { mode, target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: true, rules },
    courts: Array.from({ length: courts }, (_, i) => court(`c${i}`, i + 1)),
    players: Array.from({ length: players }, (_, i) => player(`p${i}`, { position: i, skill: skills ? 1 + (i % 5) : null })),
  })
  let minute = 0
  let maxSatOut = 0
  const played: OpenMatch[][] = []
  const streak = new Map(state.players.map((p) => [p.id, 0]))
  for (let round = 0; round < rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctxAt(minute))
    minute += 1
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => (m.status === 'PROPOSED' ? { ...m, status: 'IN_PROGRESS', startedAt: at(minute) } : m)),
    }
    const live = state.matches.filter((m) => m.status === 'IN_PROGRESS')
    played.push(live)
    const playing = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
    for (const p of state.players) {
      const next = playing.has(p.id) ? 0 : (streak.get(p.id) ?? 0) + 1
      streak.set(p.id, next)
      maxSatOut = Math.max(maxSatOut, next)
    }
    minute += 10
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => {
        if (m.status !== 'IN_PROGRESS') return m
        const winner = random() < 0.5 ? 'A' : 'B'
        const loser = Math.floor(random() * 10)
        return {
          ...m, status: 'FINISHED', winner, finishedAt: at(minute), recordedBy: 'Host',
          scoreA: winner === 'A' ? 11 : loser, scoreB: winner === 'B' ? 11 : loser,
        }
      }),
      players: state.players.map((p) => (playing.has(p.id) ? { ...p, waitingSince: at(minute) } : p)),
    }
  }
  return { state, maxSatOut, rounds: played }
}
```

In `src/lib/pickleball/open/propose.test.ts`, delete:
- the `mulberry32` function;
- the `playRounds` function;
- the whole `describe('paddle stack fairness (property)', …)` block.

Those properties now live in `modes/modes.property.test.ts`, on the shared simulator. Remove imports that become unused (`pairKey`, `OpenMatch`). The `ctxAt` helper at the top of that file stays.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS (all Phase 1 tests too). The property file runs only `PADDLE_STACK` for now.

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```markdown
- Open play engine: keep-together and keep-apart rules are hard constraints for every way of picking players; a court that no four can fill without breaking one waits with a reason instead of breaking it.
```

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): rule-aware four-player picking shared by every stacking mode"
```

---
### Task 3: Winners play winners (shuffled)

**Files:**
- Create: `src/lib/pickleball/open/modes/shared.ts`
- Create: `src/lib/pickleball/open/modes/winnersLosers.ts`, `src/lib/pickleball/open/modes/winnersLosers.test.ts`
- Modify: `src/lib/pickleball/open/fairness.ts` (export `byWait`)
- Modify: `src/lib/pickleball/open/propose.ts` (one map entry), `src/lib/pickleball/open/modes/modes.property.test.ts` (one array entry)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - `ModeInput`, `allSplits`, `bestSplit`, `splitTeams`, `pickFour` (Task 2);
  - `byWait(a: QueueEntry, b: QueueEntry): number` (made public here).
- Produces:
  - `modes/shared.ts`:
    - `DUE_WINDOW = 8`, `dueWindow(queue: readonly QueueEntry[]): QueueEntry[]`;
    - `type ResultTag = 'W' | 'L' | 'N'`, `interface LastGame { tag: ResultTag; teammate: string | null }`;
    - `lastGames(state): Map<string, LastGame>`, `setKey(ids): string`.
  - `modes/winnersLosers.ts`:
    - `shuffledSplits(four, last: ReadonlyMap<string, LastGame>): Proposal[]`;
    - `proposeWinnersLosers(input: ModeInput): Proposal | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pickleball/open/modes/winnersLosers.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { proposeForCourt } from '../propose'
import { at, court, finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS, type OpenMatch } from '../types'
import { lastGames } from './shared'
import { shuffledSplits } from './winnersLosers'

const settings = { ...DEFAULT_SETTINGS, mode: 'WINNERS_LOSERS' as const }

/** Two finished courts: (A1,A2) beat (C1,C2) on c1; (B1,B2) beat (D1,D2) on c2. Everyone back at minute 20. */
function afterTwoCourts(extra: string[] = []) {
  const matches: OpenMatch[] = [
    { ...finished('m1', ['A1', 'A2'], ['C1', 'C2'], 'A', 11, 5, 5, 'c1'), finishedAt: at(20) },
    { ...finished('m2', ['B1', 'B2'], ['D1', 'D2'], 'A', 11, 7, 6, 'c2'), finishedAt: at(20) },
  ]
  const ids = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2']
  return sessionState({
    settings,
    courts: [court('c1', 1), court('c2', 2)],
    players: [
      ...ids.map((id, i) => player(id, { position: i, waitingSince: at(20) })),
      ...extra.map((id, i) => player(id, { position: 10 + i, waitingSince: at(0) })),
    ],
    matches,
  })
}

describe('winners play winners', () => {
  it('tags each player W, L or N from their last game', () => {
    const tags = lastGames(afterTwoCourts(['New']))
    expect(tags.get('A1')).toEqual({ tag: 'W', teammate: 'A2' })
    expect(tags.get('D2')).toEqual({ tag: 'L', teammate: 'D1' })
    expect(tags.get('New')).toEqual({ tag: 'N', teammate: null })
  })

  it('a player back from a break is untagged', () => {
    const state = afterTwoCourts()
    const rested = { ...state, players: state.players.map((p) => (p.id === 'A1' ? { ...p, waitingSince: at(40) } : p)) }
    expect(lastGames(rested).get('A1')?.tag).toBe('N')
  })

  it('puts the four winners together and shuffles them: earlier partners become opponents', () => {
    const p = proposeForCourt(afterTwoCourts())!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['A1', 'A2', 'B1', 'B2'])
    const teams = [pairKey(...p.teamA), pairKey(...p.teamB)]
    expect(teams).not.toContain(pairKey('A1', 'A2'))
    expect(teams).not.toContain(pairKey('B1', 'B2'))
  })

  it('then the four losers, shuffled the same way', () => {
    const state = afterTwoCourts()
    const winnersOn: OpenMatch = { ...finished('w', ['A1', 'B1'], ['A2', 'B2'], 'A', null, null, 21, 'c1'), status: 'PROPOSED', winner: null, finishedAt: null, recordedBy: null }
    const p = proposeForCourt({ ...state, matches: [...state.matches, winnersOn] })!
    expect([...p.teamA, ...p.teamB].sort()).toEqual(['C1', 'C2', 'D1', 'D2'])
    expect([pairKey(...p.teamA), pairKey(...p.teamB)]).not.toContain(pairKey('C1', 'C2'))
  })

  it('a player forced in by the sit-out guard plays even if untagged', () => {
    // On one court, the two games since minute 0 are two rounds sat out: Waited is forced.
    const state = { ...afterTwoCourts(['Waited']), courts: [court('c1', 1)] }
    const p = proposeForCourt(state)!
    expect([...p.teamA, ...p.teamB]).toContain('Waited')
  })

  it('shuffles only two intact earlier teams', () => {
    const tags = lastGames(afterTwoCourts())
    expect(shuffledSplits(['A1', 'A2', 'B1', 'B2'], tags)).toHaveLength(2)
    expect(shuffledSplits(['A1', 'A2', 'B1', 'C1'], tags)).toEqual([])
  })
})
```

In `src/lib/pickleball/open/modes/modes.property.test.ts`, change the mode list to

```ts
const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS']
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/modes`
Expected: FAIL. `./shared` and `./winnersLosers` cannot be resolved, and the `WINNERS_LOSERS` property tests throw "Stacking mode WINNERS_LOSERS is not available yet."

- [ ] **Step 3: Write the shared helpers and the mode**

In `src/lib/pickleball/open/fairness.ts`, change `function byWait(` to `export function byWait(`.

```ts
// src/lib/pickleball/open/modes/shared.ts
// Helpers shared by the modes other than paddle stack.
import type { QueueEntry } from '../fairness'
import type { OpenMatch, OpenSessionState } from '../types'

/**
 * The other modes choose among the players most due to play, not the whole
 * queue: the forced sit-outs plus the next players in paddle-stack order,
 * DUE_WINDOW in all. Choosing from everyone would let winners (or the top of
 * the standings) go straight back on while others wait, which breaks the
 * "no more than 2 rounds out in a row" guarantee (spec §1, §5.2).
 */
export const DUE_WINDOW = 8

export function dueWindow(queue: readonly QueueEntry[]): QueueEntry[] {
  const forced = queue.filter((entry) => entry.forced).length
  return queue.slice(0, Math.max(DUE_WINDOW, forced))
}

export type ResultTag = 'W' | 'L' | 'N'

export interface LastGame {
  tag: ResultTag
  /** Partner in that game, when the tag is W or L. */
  teammate: string | null
}

const UNTAGGED: LastGame = { tag: 'N', teammate: null }

/**
 * Each player's tag from their last finished game (spec §5.2): W or L; N when
 * they have none, or became available again after it (back from a break, or
 * out of an abandoned game: "players return untagged", §5.1).
 */
export function lastGames(state: OpenSessionState): Map<string, LastGame> {
  const finished = state.matches
    .filter((m): m is OpenMatch & { finishedAt: string } => m.status === 'FINISHED' && m.finishedAt !== null && m.winner !== null)
    .sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt) || a.seq - b.seq)
  const last = new Map<string, OpenMatch & { finishedAt: string }>()
  for (const m of finished) for (const id of [...m.teamA, ...m.teamB]) last.set(id, m)
  return new Map(state.players.map((p): [string, LastGame] => {
    const m = last.get(p.id)
    if (!m || Date.parse(m.finishedAt) < Date.parse(p.waitingSince)) return [p.id, UNTAGGED]
    const onA = m.teamA.includes(p.id)
    const team = onA ? m.teamA : m.teamB
    return [p.id, { tag: (m.winner === 'A') === onA ? 'W' : 'L', teammate: team[0] === p.id ? team[1] : team[0] }]
  }))
}

export function setKey(ids: readonly string[]): string {
  return [...ids].sort().join('|')
}
```

```ts
// src/lib/pickleball/open/modes/winnersLosers.ts
// Winners play winners, losers play losers (spec §5.2), with the shuffle the
// owner chose: two winning teams (A1,A2) and (B1,B2) play A1+B1 vs A2+B2, so
// previous partners become opponents. Same for losers.
import { byWait } from '../fairness'
import { pickFour } from '../rules'
import { allSplits, bestSplit, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { dueWindow, lastGames, setKey, type LastGame, type ResultTag } from './shared'

const POOLS: ReadonlyArray<readonly ResultTag[]> = [['W'], ['L'], ['L', 'N']]

/** The two shuffled splits when the four are two intact teams from their last games; otherwise none. */
export function shuffledSplits(four: readonly string[], last: ReadonlyMap<string, LastGame>): Proposal[] {
  const teammates = four.map((id) => last.get(id)?.teammate ?? null)
  if (teammates.some((mate) => mate === null || !four.includes(mate))) return []
  const previous = new Set(four.map((id, i) => setKey([id, teammates[i]!])))
  return allSplits(four).filter((p) => !previous.has(setKey(p.teamA)) && !previous.has(setKey(p.teamB)))
}

export function proposeWinnersLosers({ state, queue, history, rules, exclude }: ModeInput): Proposal | null {
  const last = lastGames(state)
  const due = dueWindow(queue)
  // The sit-out guard still applies: forced players come first in every pool.
  const forced = due.filter((e) => e.forced).map((e) => e.player.id)
  const available = new Set(queue.map((e) => e.player.id))
  const oldestFirst = due.filter((e) => !e.forced).sort(byWait)
  let four: string[] | null = null
  for (const pool of POOLS) {
    const members = oldestFirst.filter((e) => pool.includes(last.get(e.player.id)?.tag ?? 'N')).map((e) => e.player.id)
    if (forced.length + members.length < 4) continue
    four = pickFour([...forced, ...members], rules, exclude, available)
    if (four) break
  }
  four ??= pickFour(queue.map((e) => e.player.id), rules, exclude)
  if (!four) return null
  return bestSplit(shuffledSplits(four, last), history, rules) ?? splitTeams(four, history, rules)
}
```

In `src/lib/pickleball/open/propose.ts`, add `import { proposeWinnersLosers } from './modes/winnersLosers'` and the map entry:

```ts
const PROPOSERS: Partial<Record<StackingMode, ModeProposer>> = {
  PADDLE_STACK: proposePaddleStack,
  WINNERS_LOSERS: proposeWinnersLosers,
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS, including `WINNERS_LOSERS (property)`: no double-booking, sit-out ≤ 2, rules kept, partners ≤ 2.

- [ ] **Step 5: Commit**

```markdown
- Open play engine: "winners play winners" stacking: winners meet winners and losers meet losers, with the two pairs shuffled so last game's partners face each other; the sit-out guard and keep-together/apart still apply.
```

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): winners play winners stacking with the partner shuffle"
```

---

### Task 4: By standing

**Files:**
- Create: `src/lib/pickleball/open/modes/byStanding.ts`, `src/lib/pickleball/open/modes/byStanding.test.ts`
- Modify: `src/lib/pickleball/open/propose.ts` (one map entry), `src/lib/pickleball/open/modes/modes.property.test.ts` (one array entry)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - `computeStandings(players, matches): StandingRow[]` (Phase 1; ranked rows first, unranked last);
  - `dueWindow`, `setKey` (Task 3);
  - `keepsRules`, `pickFour` (Task 2);
  - `splitTeams`, `partnerCost`, `opponentCost` (Task 2).
- Produces: `proposeByStanding(input: ModeInput): Proposal | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pickleball/open/modes/byStanding.test.ts
import { describe, expect, it } from 'vitest'
import { proposeForCourt } from '../propose'
import { computeStandings } from '../standings'
import { at, court, finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS, type OpenMatch, type PairRule } from '../types'

/**
 * Two rounds on two courts. Standings afterwards:
 *   P1 2–0 (88%), P3 2–0 (75%), P2 2–0 (73%), P4 1–1, P5 1–1, P7 0–2, P6 0–2, P8 0–2.
 * Everyone came off court at minute 30 except P5, waiting since minute 25.
 */
function ranked(rules: PairRule[] = []) {
  const matches: OpenMatch[] = [
    finished('r1a', ['P1', 'P2'], ['P7', 'P8'], 'A', 11, 1, 1, 'c1'),
    finished('r1b', ['P3', 'P4'], ['P5', 'P6'], 'A', 11, 6, 2, 'c2'),
    finished('r2a', ['P1', 'P3'], ['P6', 'P8'], 'A', 11, 2, 15, 'c1'),
    finished('r2b', ['P2', 'P5'], ['P4', 'P7'], 'A', 11, 9, 16, 'c2'),
  ]
  return sessionState({
    settings: { ...DEFAULT_SETTINGS, mode: 'BY_STANDING', rules },
    courts: [court('c1', 1), court('c2', 2)],
    players: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].map((id, i) => player(id, { position: i, waitingSince: id === 'P5' ? at(25) : at(30) })),
    matches,
  })
}

describe('by standing', () => {
  it('ranks by win rate, then points won', () => {
    const state = ranked()
    expect(computeStandings(state.players, state.matches).map((r) => r.playerId)).toEqual(['P1', 'P3', 'P2', 'P4', 'P5', 'P7', 'P6', 'P8'])
  })

  it('plays a window of 4 adjacent ranks holding the longest-waiting player, 1st + 4th vs 2nd + 3rd', () => {
    // Every window holding P5 has the same games played and no repeated partners;
    // P5, P7, P6, P8 have opposed each other least, so that window wins.
    expect(proposeForCourt(ranked())).toEqual({ teamA: ['P5', 'P8'], teamB: ['P7', 'P6'] })
  })

  it('Skip moves to another window that still holds the longest-waiting player', () => {
    const p = proposeForCourt(ranked(), ['P5', 'P7', 'P6', 'P8'])!
    expect([...p.teamA, ...p.teamB]).toContain('P5')
    expect([...p.teamA, ...p.teamB].sort()).not.toEqual(['P5', 'P6', 'P7', 'P8'])
  })

  it('a keep-together pair is never split by the 1st + 4th rule', () => {
    const p = proposeForCourt(ranked([{ kind: 'TOGETHER', playerIds: ['P5', 'P7'] }]))!
    const team = p.teamA.includes('P5') ? p.teamA : p.teamB
    expect([...team].sort()).toEqual(['P5', 'P7'])
  })

  it('the sit-out guard outranks the standings', () => {
    const state = ranked()
    // On one court, the four games since minute 0 are four rounds: Bench must play.
    const withBench = { ...state, courts: [court('c1', 1)], players: [...state.players, player('Bench', { position: 20, waitingSince: at(0) })] }
    const p = proposeForCourt(withBench)!
    expect([...p.teamA, ...p.teamB]).toContain('Bench')
  })
})
```

In `modes.property.test.ts`: `const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/modes`
Expected: FAIL. The `BY_STANDING` proposals throw "not available yet".

- [ ] **Step 3: Write the mode**

```ts
// src/lib/pickleball/open/modes/byStanding.ts
// By standing (spec §5.2): rank the players due to play by today's standings,
// take the window of 4 adjacent ranks around the longest-waiting player, and
// play 1st + 4th against 2nd + 3rd.
import { byWait, type QueueEntry } from '../fairness'
import { keepsRules, pickFour } from '../rules'
import { computeStandings } from '../standings'
import { opponentCost, partnerCost, splitTeams, type ModeInput, type Proposal } from './paddleStack'
import { dueWindow, setKey } from './shared'

/** 1st + 4th vs 2nd + 3rd of a rank-ordered four; the paddle-stack split if that would part a keep-together pair. */
function standingSplit(ranked: readonly string[], input: ModeInput): Proposal {
  const proposal: Proposal = { teamA: [ranked[0], ranked[3]], teamB: [ranked[1], ranked[2]] }
  return keepsRules(proposal.teamA, proposal.teamB, input.rules) ? proposal : splitTeams(ranked, input.history, input.rules)
}

function lexicographic(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function proposeByStanding(input: ModeInput): Proposal | null {
  const { state, queue, history, rules, exclude } = input
  const due = dueWindow(queue)
  if (due.length < 4) return null
  const rows = computeStandings(state.players, state.matches)
  const rankOf = new Map(rows.map((row, index) => [row.playerId, index]))
  const rank = (id: string) => rankOf.get(id) ?? rows.length
  const ranked = [...due].sort((a, b) => rank(a.player.id) - rank(b.player.id) || byWait(a, b))
  const forced = due.filter((e) => e.forced).map((e) => e.player.id)
  const anchor: QueueEntry = due.find((e) => e.forced) ?? [...due].sort(byWait)[0]
  const at = ranked.indexOf(anchor)
  const banned = exclude ? setKey(exclude) : null

  let best: { ids: string[]; score: number[] } | null = null
  for (let start = Math.max(0, at - 3); start <= Math.min(at, ranked.length - 4); start += 1) {
    const window = ranked.slice(start, start + 4)
    const ids = window.map((e) => e.player.id)
    if (banned !== null && setKey(ids) === banned) continue
    // The sit-out guard outranks the standings: a window must seat every forced player.
    if (forced.slice(0, 4).some((id) => !ids.includes(id))) continue
    const proposal = standingSplit(ids, input)
    if (!keepsRules(proposal.teamA, proposal.teamB, rules)) continue
    const score = [
      window.reduce((sum, e) => sum + e.games, 0),
      partnerCost(proposal, history),
      opponentCost(proposal, history),
      start,
    ]
    if (!best || lexicographic(score, best.score) < 0) best = { ids, score }
  }
  if (best) return standingSplit(best.ids, input)

  // No window seats every forced player within the rules: forced players first,
  // then the nearest ranks to the anchor.
  const anchorRank = rank(anchor.player.id)
  const nearest = [...due].sort((a, b) => Number(b.forced) - Number(a.forced)
    || Math.abs(rank(a.player.id) - anchorRank) - Math.abs(rank(b.player.id) - anchorRank))
  const four = pickFour(nearest.map((e) => e.player.id), rules, exclude, new Set(queue.map((e) => e.player.id)))
    ?? pickFour(queue.map((e) => e.player.id), rules, exclude)
  if (!four) return null
  return standingSplit([...four].sort((a, b) => rank(a) - rank(b)), input)
}
```

In `propose.ts`, add `import { proposeByStanding } from './modes/byStanding'` and `BY_STANDING: proposeByStanding,` to `PROPOSERS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open`
Expected: PASS, including `BY_STANDING (property)` with sit-out ≤ 2.

- [ ] **Step 5: Commit**

```markdown
- Open play engine: "by standing" stacking: players close in today's standings play each other, 1st and 4th against 2nd and 3rd, without ever letting anyone sit out more than 2 rounds in a row.
```

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): by-standing stacking around the longest-waiting player"
```

---

### Task 5: Balanced teams, mode labels, and per-mode rotation examples

**Files:**
- Create: `src/lib/pickleball/open/modes/balanced.ts`, `src/lib/pickleball/open/modes/balanced.test.ts`
- Create: `src/lib/pickleball/open/modes/info.ts`
- Modify: `src/lib/pickleball/open/propose.ts` (make the mode table total)
- Modify: `src/lib/pickleball/open/rotationExample.ts`, `src/lib/pickleball/open/rotationExample.test.ts` (whole files below)
- Modify: `src/lib/pickleball/open/modes/modes.property.test.ts` (one array entry)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `computeStandings`, `StandingRow` (Phase 1); `pickFour`, `honoursTogether` (Task 2); `allSplits`, `partnerCost`, `opponentCost`, `splitTeams` (Task 2).
- Produces:
  - `NEUTRAL_STRENGTH = 3`, `strength(player?: OpenPlayer, row?: StandingRow): number`, `proposeBalanced(input)`.
  - `MODE_ORDER: readonly StackingMode[]` and `MODE_INFO: Record<StackingMode, { label: string; summary: string }>`. These are used by the create form, the console, the board, the TV and the public pages.
  - `rotationExample(rounds = 4, mode: StackingMode = 'PADDLE_STACK'): ExampleRound[]`. Each court entry also carries `winner: 'A' | 'B'` and `score: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/modes/balanced.test.ts
import { describe, expect, it } from 'vitest'
import { pairKey } from '../fairness'
import { proposeForCourt } from '../propose'
import { finished, player, sessionState } from '../testing/fixtures'
import { DEFAULT_SETTINGS } from '../types'
import { NEUTRAL_STRENGTH, strength } from './balanced'

const settings = { ...DEFAULT_SETTINGS, mode: 'BALANCED' as const }
const team = (p: { teamA: readonly string[]; teamB: readonly string[] }, id: string) => (p.teamA.includes(id) ? p.teamA : p.teamB)

describe('balanced', () => {
  it('uses the entered skill, then today’s win rate on a 1–5 scale, then neutral', () => {
    expect(strength(player('a', { skill: 4.5 }), undefined)).toBe(4.5)
    const row = { winRate: 0.75 } as Parameters<typeof strength>[1]
    expect(strength(player('b'), row)).toBe(4)
    expect(strength(player('c'), undefined)).toBe(NEUTRAL_STRENGTH)
  })

  it('pairs the strongest with the weakest so the summed skills are closest', () => {
    const state = sessionState({
      settings,
      players: [player('s5', { skill: 5, position: 1 }), player('s4', { skill: 4, position: 2 }), player('s2', { skill: 2, position: 3 }), player('s1', { skill: 1, position: 4 })],
    })
    expect([...team(proposeForCourt(state)!, 's5')].sort()).toEqual(['s1', 's5'])
  })

  it('breaks a tie in balance by avoiding a repeated partnership', () => {
    const state = sessionState({
      settings,
      players: ['a', 'b', 'c', 'd'].map((id, i) => player(id, { skill: 3, position: i })),
      matches: [finished('m1', ['a', 'b'], ['c', 'd'], 'A', 11, 4), finished('m2', ['a', 'c'], ['b', 'd'], 'A', 11, 4, 20)],
    })
    const p = proposeForCourt(state)!
    expect([pairKey(...p.teamA), pairKey(...p.teamB)].sort()).toEqual([pairKey('a', 'd'), pairKey('b', 'c')].sort())
  })

  it('a keep-together pair is kept even when another split balances better', () => {
    const state = sessionState({
      settings: { ...settings, rules: [{ kind: 'TOGETHER', playerIds: ['s5', 's4'] }] },
      players: [player('s5', { skill: 5, position: 1 }), player('s4', { skill: 4, position: 2 }), player('s2', { skill: 2, position: 3 }), player('s1', { skill: 1, position: 4 })],
    })
    expect([...team(proposeForCourt(state)!, 's5')].sort()).toEqual(['s4', 's5'])
  })
})
```

Replace `src/lib/pickleball/open/rotationExample.test.ts`:

```ts
// src/lib/pickleball/open/rotationExample.test.ts
import { describe, expect, it } from 'vitest'
import { rotationExample } from './rotationExample'
import type { StackingMode } from './types'

describe('rotationExample', () => {
  it.each<StackingMode>(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])(
    '%s: 14 players on 3 courts, 12 play each round, 2 sit out, nobody sits out twice in a row',
    (mode) => {
      const rounds = rotationExample(4, mode)
      expect(rounds).toHaveLength(4)
      for (const round of rounds) {
        expect(round.courts).toHaveLength(3)
        expect(round.sittingOut).toHaveLength(2)
      }
      for (let i = 1; i < rounds.length; i += 1) {
        for (const name of rounds[i].sittingOut) expect(rounds[i - 1].sittingOut).not.toContain(name)
      }
    },
  )

  it('winners play winners: round 2 has a court of four round-1 winners, previous partners split', () => {
    const [first, second] = rotationExample(2, 'WINNERS_LOSERS')
    const winningTeams = first.courts.map((c) => (c.winner === 'A' ? c.teamA : c.teamB))
    const winners = new Set(winningTeams.flat())
    const allWinners = second.courts.find((c) => [...c.teamA, ...c.teamB].every((name) => winners.has(name)))
    expect(allWinners).toBeDefined()
    for (const pair of winningTeams) {
      expect([allWinners!.teamA, allWinners!.teamB].some((t) => pair.every((name) => t.includes(name)))).toBe(false)
    }
  })
})
```

In `modes.property.test.ts`: `const MODES: StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open`
Expected: FAIL. `./balanced` cannot be resolved, `rotationExample` takes no mode, and `BALANCED` throws.

- [ ] **Step 3: Write the mode, the labels, the total table and the examples**

```ts
// src/lib/pickleball/open/modes/balanced.ts
// Balanced (spec §5.2): paddle-stack picks the four; the split minimises the
// difference in summed strength, and repeated partners break ties.
import { honoursTogether, pickFour } from '../rules'
import { computeStandings, type StandingRow } from '../standings'
import type { OpenPlayer } from '../types'
import { allSplits, opponentCost, partnerCost, splitTeams, type ModeInput, type Proposal } from './paddleStack'

/** The middle of the 1–5 self-report scale. */
export const NEUTRAL_STRENGTH = 3
const EPSILON = 1e-9

/**
 * The skill entered for the player (self-reported 1–5 at check-in, or a number
 * the host typed, such as a DUPR rating, up to 8); else today's win rate mapped
 * onto 1–5; else neutral. No rating is ever looked up anywhere.
 */
export function strength(player: OpenPlayer | undefined, row: StandingRow | undefined): number {
  if (player?.skill != null) return player.skill
  if (row?.winRate != null) return 1 + 4 * row.winRate
  return NEUTRAL_STRENGTH
}

export function proposeBalanced({ state, queue, history, rules, exclude }: ModeInput): Proposal | null {
  const four = pickFour(queue.map((e) => e.player.id), rules, exclude)
  if (!four) return null
  const rows = new Map(computeStandings(state.players, state.matches).map((row) => [row.playerId, row]))
  const power = (id: string) => strength(state.players.find((p) => p.id === id), rows.get(id))
  const scored = allSplits(four)
    .filter((p) => honoursTogether(p.teamA, p.teamB, rules))
    .map((proposal) => ({
      proposal,
      gap: Math.abs(power(proposal.teamA[0]) + power(proposal.teamA[1]) - power(proposal.teamB[0]) - power(proposal.teamB[1])),
      partner: partnerCost(proposal, history),
      opponent: opponentCost(proposal, history),
    }))
  if (!scored.length) return splitTeams(four, history, rules)
  return scored.reduce((best, next) => {
    if (next.gap < best.gap - EPSILON) return next
    if (next.gap > best.gap + EPSILON) return best
    return next.partner < best.partner || (next.partner === best.partner && next.opponent < best.opponent) ? next : best
  }).proposal
}
```

```ts
// src/lib/pickleball/open/modes/info.ts
// One name and one line per stacking mode, shared by the create form, the
// host console, the board, the TV and the public pages, so they never
// describe a mode differently. Public-page copy rule: no "vs" (the
// comparative-language check on /pickleball/how-it-works would flag it).
import type { StackingMode } from '../types'

export const MODE_ORDER: readonly StackingMode[] = ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']

export const MODE_INFO: Record<StackingMode, { label: string; summary: string }> = {
  PADDLE_STACK: {
    label: 'Paddle stack',
    summary: 'Fewest games first, then longest wait. Partners rotate.',
  },
  WINNERS_LOSERS: {
    label: 'Winners play winners',
    summary: 'Winners meet winners and losers meet losers, and last game’s partners end up on opposite sides.',
  },
  BY_STANDING: {
    label: 'By standing',
    summary: 'Players close in today’s standings play each other: 1st and 4th against 2nd and 3rd.',
  },
  BALANCED: {
    label: 'Balanced teams',
    summary: 'Teams are split so their skill adds up as evenly as possible.',
  },
}
```

In `propose.ts`, import `proposeBalanced` and make the table total, removing the throw:

```ts
import { proposeBalanced } from './modes/balanced'
```

```ts
const PROPOSERS: Record<StackingMode, ModeProposer> = {
  PADDLE_STACK: proposePaddleStack,
  WINNERS_LOSERS: proposeWinnersLosers,
  BY_STANDING: proposeByStanding,
  BALANCED: proposeBalanced,
}
```

and in `proposeForCourt` replace the two `proposer` lines with:

```ts
  return PROPOSERS[state.settings.mode]({ state, queue, history: pairingHistory(state.matches), rules: activeRules(state), exclude })
```

Replace `src/lib/pickleball/open/rotationExample.ts`:

```ts
// src/lib/pickleball/open/rotationExample.ts
// The /pickleball/rotation page's worked examples are COMPUTED by the real
// engine at build time (spec §11), so the explanation can never describe a
// rotation the app does not actually produce.
import { fillProposals } from './propose'
import { DEFAULT_SETTINGS, type OpenMatch, type OpenSessionState, type StackingMode } from './types'

export interface ExampleRound {
  round: number
  courts: Array<{ label: string; teamA: string[]; teamB: string[]; winner: 'A' | 'B'; score: string }>
  sittingOut: string[]
}

const NAMES = ['Ana', 'Ben', 'Carlo', 'Dina', 'Eli', 'Fay', 'Gio', 'Hana', 'Ivan', 'Jun', 'Kat', 'Leo', 'Mia', 'Nico']
const SKILLS = [5, 4, 4, 3, 3, 3, 2, 2, 4, 3, 2, 5, 3, 1]
const T0 = Date.parse('2026-01-01T09:00:00.000Z')
const iso = (minute: number) => new Date(T0 + minute * 60_000).toISOString()

export function rotationExample(rounds = 4, mode: StackingMode = 'PADDLE_STACK'): ExampleRound[] {
  let n = 0
  const ctx = (minute: number) => ({ now: iso(minute), newId: () => `x${(n += 1)}` })
  let state: OpenSessionState = {
    id: 'example', publicCode: 'EXAMPLE234', kind: 'OPEN_PLAY', name: 'Example', hostDisplayName: 'Host', location: null,
    status: 'ACTIVE', settings: { ...DEFAULT_SETTINGS, mode }, version: 1, createdAt: iso(0), lastActivityAt: iso(0), expiresAt: iso(10_000),
    players: NAMES.map((name, i) => ({
      id: name, name, skill: mode === 'BALANCED' ? SKILLS[i] : null, duprId: null, status: 'ACTIVE',
      gamesOffset: 0, joinedAt: iso(0), waitingSince: iso(0), position: i + 1,
    })),
    courts: [1, 2, 3].map((p) => ({ id: `c${p}`, label: `Court ${p}`, position: p, enabled: true })),
    matches: [],
  }
  const out: ExampleRound[] = []
  let minute = 0
  for (let round = 1; round <= rounds; round += 1) {
    minute += 1
    state = fillProposals(state, ctx(minute))
    const live = state.matches.filter((m) => m.status === 'PROPOSED')
    const seated = new Set(live.flatMap((m) => [...m.teamA, ...m.teamB]))
    minute += 12
    const results = live.map((m) => ({ id: m.id, winner: (m.seq % 2 ? 'A' : 'B') as 'A' | 'B', loser: 3 + (m.seq % 7) }))
    out.push({
      round,
      courts: live.map((m) => {
        const r = results.find((x) => x.id === m.id)!
        return { label: state.courts.find((c) => c.id === m.courtId)!.label, teamA: [...m.teamA], teamB: [...m.teamB], winner: r.winner, score: `11–${r.loser}` }
      }),
      sittingOut: NAMES.filter((name) => !seated.has(name)),
    })
    state = {
      ...state,
      matches: state.matches.map((m): OpenMatch => {
        const r = results.find((x) => x.id === m.id)
        if (!r) return m
        return {
          ...m, status: 'FINISHED', startedAt: iso(minute - 11), finishedAt: iso(minute), recordedBy: 'Host', winner: r.winner,
          scoreA: r.winner === 'A' ? 11 : r.loser, scoreB: r.winner === 'B' ? 11 : r.loser,
        }
      }),
      players: state.players.map((p) => (seated.has(p.id) ? { ...p, waitingSince: iso(minute) } : p)),
    }
  }
  return out
}
```

`src/pages/pickleball/rotation.astro` still calls `rotationExample()`, so paddle stack by default, and keeps building. Task 9 adds the per-mode examples to the page.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open && npm run typecheck`
Expected: PASS, and 0 type errors. The property file now runs all four modes. `it.runIf` skips the partner-repeat bound for `BALANCED` (shown as 1 skipped).

- [ ] **Step 5: Commit**

```markdown
- Open play engine: "balanced teams" stacking splits each four so summed skill is as even as possible (entered skill, else today's win rate, else neutral), with repeated partners breaking ties. All four modes share one set of names and one-line explanations.
```

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): balanced teams stacking and per-mode rotation examples"
```

---

### Task 6: Commands and schemas: mode switch, rules, check-in switch, skill

**Files:**
- Modify: `src/lib/schemas/pickleball/open/commands.ts`, `src/lib/schemas/pickleball/open/createSession.ts` (whole files below)
- Create: `src/lib/schemas/pickleball/open/createSession.test.ts`
- Modify: `src/lib/pickleball/open/reducer.ts`
- Create: `src/lib/pickleball/open/reducer.phase2.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `activeRules`, `keepsRules`, `ruleViolation` (Task 2), `pairKey`, `LIMITS.maxRules` (Task 1).
- Produces:
  - Command types:
    - `{ type: 'SET_MODE'; mode: StackingMode }`
    - `{ type: 'SET_SELF_CHECK_IN'; enabled: boolean }`
    - `{ type: 'SET_PLAYER_SKILL'; playerId: string; skill: number | null }` (1–8, rounded to 0.01)
    - `{ type: 'ADD_RULE'; rule: { kind: 'TOGETHER' | 'APART'; playerIds: [string, string] } }`
    - `{ type: 'REMOVE_RULE'; rule }`
  - `stackingModeSchema`.
  - `createSessionSchema.settings` accepts all four modes and an optional `selfCheckIn`.
  - `reducer.ts` exports `minActiveGames(state, exceptId?)` and `returnLevel(state, target, ctx)` (used by check-in in Task 10).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/reducer.phase2.test.ts
import { describe, expect, it } from 'vitest'
import { applyCommand, finalizeCommand } from './reducer'
import { at, court, player, sessionState } from './testing/fixtures'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import type { CommandContext, OpenSessionState } from './types'

let n = 0
const ctx = (minute: number, actor?: string): CommandContext => ({ now: at(minute), newId: () => `n${(n += 1)}`, actor })

function run(state: OpenSessionState, command: OpenCommand, minute = 1): OpenSessionState {
  const result = applyCommand(state, command, ctx(minute))
  if (!result.ok) throw new Error(result.error)
  return finalizeCommand(result.state, ctx(minute))
}

function fail(state: OpenSessionState, command: OpenCommand) {
  const result = applyCommand(state, command, ctx(1))
  if (result.ok) throw new Error('expected a failure')
  return result
}

function twoCourts(): OpenSessionState {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id, i) => player(id, { position: i })),
  })
  return finalizeCommand(base, ctx(0))
}

describe('SET_MODE', () => {
  it('changes the mode for the next proposal only: nothing proposed or playing is rewritten', () => {
    const start = twoCourts()
    const [first, second] = start.matches
    const started = run(start, { type: 'START_MATCH', matchId: first.id })
    const switched = run(started, { type: 'SET_MODE', mode: 'WINNERS_LOSERS' }, 2)
    expect(switched.settings.mode).toBe('WINNERS_LOSERS')
    expect(switched.matches.find((m) => m.id === first.id)).toMatchObject({ status: 'IN_PROGRESS', teamA: first.teamA, teamB: first.teamB })
    expect(switched.matches.find((m) => m.id === second.id)).toMatchObject({ status: 'PROPOSED', teamA: second.teamA, teamB: second.teamB })
    const saved = run(switched, { type: 'RECORD_RESULT', matchId: first.id, winner: 'A', scoreA: 11, scoreB: 3 }, 12)
    expect(saved.matches.filter((m) => m.status === 'PROPOSED')).toHaveLength(2)
  })
})

describe('keep-together / keep-apart rules', () => {
  it('adding a rule withdraws a proposal that breaks it, and the court is proposed again within the rule', () => {
    const start = twoCourts()
    const proposed = start.matches[0]
    const [x] = proposed.teamA
    const outsider = 'j'
    const next = run(start, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: [x, outsider] } })
    expect(next.matches.some((m) => m.id === proposed.id)).toBe(false)
    for (const m of next.matches.filter((match) => match.status === 'PROPOSED')) {
      const four = [...m.teamA, ...m.teamB]
      if (four.includes(x) || four.includes(outsider)) {
        const team = m.teamA.includes(x) ? m.teamA : m.teamB
        expect(team).toContain(outsider)
      }
    }
  })

  it('refuses contradictions, second partners, players who left; a repeat is harmless', () => {
    const together = run(twoCourts(), { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'b'] } })
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['b', 'a'] } }).error).toBe('b and a already have the opposite rule. Remove it first.')
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'c'] } }).error).toBe('a already has a keep-together partner.')
    expect(fail(together, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['c', 'c'] } }).status).toBe(400)
    const left = run(together, { type: 'SET_PLAYER_STATUS', playerId: 'j', status: 'LEFT' })
    expect(fail(left, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['c', 'j'] } }).error).toBe('j has left the session.')
    const again = applyCommand(together, { type: 'ADD_RULE', rule: { kind: 'TOGETHER', playerIds: ['b', 'a'] } }, ctx(2))
    expect(again.ok && again.state.settings.rules).toHaveLength(1)
  })

  it('removes a rule regardless of player order, and 404s an unknown one', () => {
    const apart = run(twoCourts(), { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } })
    expect(run(apart, { type: 'REMOVE_RULE', rule: { kind: 'APART', playerIds: ['b', 'a'] } }).settings.rules).toEqual([])
    expect(fail(apart, { type: 'REMOVE_RULE', rule: { kind: 'TOGETHER', playerIds: ['a', 'b'] } }).status).toBe(404)
  })

  it('a host edit that breaks a rule is refused with the rule in words', () => {
    const oneCourt = finalizeCommand(sessionState({ players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, { position: i })) }), ctx(0))
    const start = run(oneCourt, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } })
    const match = start.matches.find((m) => m.status === 'PROPOSED')!
    const result = fail(start, { type: 'EDIT_PROPOSAL', matchId: match.id, teamA: ['a', 'b'], teamB: ['c', 'd'] })
    expect(result).toMatchObject({ status: 409, error: 'a and b are kept apart. Remove that rule first.' })
  })

  it('caps rules at 32 per session', () => {
    const many = Array.from({ length: 32 }, (_, i) => ({ kind: 'APART' as const, playerIds: [`x${i}`, `y${i}`] as const }))
    const full = { ...twoCourts(), settings: { ...twoCourts().settings, rules: many } }
    expect(fail(full, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } }).error).toBe('A session can have at most 32 rules.')
  })
})

describe('settings commands', () => {
  it('turns self check-in off and on, and sets a skill rounded to 2 decimals', () => {
    const off = run(twoCourts(), { type: 'SET_SELF_CHECK_IN', enabled: false })
    expect(off.settings.selfCheckIn).toBe(false)
    const skilled = run(off, { type: 'SET_PLAYER_SKILL', playerId: 'a', skill: 3.456 })
    expect(skilled.players.find((p) => p.id === 'a')?.skill).toBe(3.46)
    expect(run(skilled, { type: 'SET_PLAYER_SKILL', playerId: 'a', skill: null }).players.find((p) => p.id === 'a')?.skill).toBeNull()
    expect(fail(skilled, { type: 'SET_PLAYER_SKILL', playerId: 'zz', skill: 2 }).status).toBe(404)
  })
})
```

```ts
// src/lib/schemas/pickleball/open/createSession.test.ts
import { describe, expect, it } from 'vitest'
import { commandSchema } from './commands'
import { createSessionSchema } from './createSession'

const base = { name: 'Sunday', hostDisplayName: 'Mike', courtCount: 2, players: [] }

describe('createSessionSchema', () => {
  it('accepts all four stacking modes and an optional self check-in switch', () => {
    for (const mode of ['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED']) {
      expect(createSessionSchema.safeParse({ ...base, settings: { mode, target: 11, scoringStyle: 'SIDEOUT' } }).success, mode).toBe(true)
    }
    expect(createSessionSchema.safeParse({ ...base, settings: { mode: 'BALANCED', target: 21, scoringStyle: 'RALLY', selfCheckIn: false } }).success).toBe(true)
    expect(createSessionSchema.safeParse({ ...base, settings: { mode: 'KING_OF_THE_COURT', target: 11, scoringStyle: 'SIDEOUT' } }).success).toBe(false)
  })
})

describe('commandSchema', () => {
  it('parses the Phase 2 commands and rejects bad shapes', () => {
    expect(commandSchema.safeParse({ type: 'SET_MODE', mode: 'BY_STANDING' }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'SET_MODE', mode: 'RANDOM' }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a'] } }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_PLAYER_SKILL', playerId: 'a', skill: 9 }).success).toBe(false)
    expect(commandSchema.safeParse({ type: 'SET_SELF_CHECK_IN', enabled: false }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/reducer.phase2.test.ts src/lib/schemas/pickleball/open`
Expected: FAIL. The new commands don't parse, and the create schema only accepts `PADDLE_STACK`.

- [ ] **Step 3: Widen the schemas**

Replace `src/lib/schemas/pickleball/open/commands.ts`:

```ts
import { z } from 'zod'

const id = z.string().min(1).max(64)
const side = z.enum(['A', 'B'])
const score = z.number().int().min(0).max(99).nullable()
export const stackingModeSchema = z.enum(['PADDLE_STACK', 'WINNERS_LOSERS', 'BY_STANDING', 'BALANCED'])
const rule = z.object({ kind: z.enum(['TOGETHER', 'APART']), playerIds: z.tuple([id, id]) })

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
  z.object({ type: z.literal('ADD_RULE'), rule }),
  z.object({ type: z.literal('REMOVE_RULE'), rule }),
])

export const commandEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  command: commandSchema,
})

export type OpenCommand = z.infer<typeof commandSchema>
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>
```

Replace `src/lib/schemas/pickleball/open/createSession.ts`:

```ts
import { z } from 'zod'
import { stackingModeSchema } from './commands'

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
  turnstileToken: z.string().max(2048).optional(),
})

export type CreateSessionBody = z.infer<typeof createSessionSchema>
```

The create route passes `parsed.data.settings` straight to `buildInitialState`, whose input type (Task 1) already accepts `selfCheckIn?`. No route change.

- [ ] **Step 4: Handle the commands in the reducer**

In `src/lib/pickleball/open/reducer.ts`:

Imports become:

```ts
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { busyPlayerIds, gamesPlayed, matchIncludes, pairKey } from './fairness'
import { addProposal, fillProposals, proposeForCourt } from './propose'
import { cleanName } from './roster'
import { activeRules, keepsRules, ruleViolation } from './rules'
import { validateResult } from './scoreValidation'
import { addMs, LIMITS, type CommandContext, type OpenMatch, type OpenPlayer, type OpenSessionState, type PairRule, type Team } from './types'
```

Export the two helpers check-in will reuse: change `function minActiveGames(` to `export function minActiveGames(` and `function returnLevel(` to `export function returnLevel(`.

In `editProposal`, replace the final `return ok(withMatch(state, { ...match, teamA, teamB }))` with:

```ts
  const violation = ruleViolation(teamA, teamB, state)
  if (violation) return fail(409, violation)
  return ok(withMatch(state, { ...match, teamA, teamB }))
}

function sameRule(a: PairRule, b: PairRule): boolean {
  return a.kind === b.kind && pairKey(...a.playerIds) === pairKey(...b.playerIds)
}

function withRules(state: OpenSessionState, rules: readonly PairRule[]): OpenSessionState {
  return { ...state, settings: { ...state.settings, rules } }
}

function addRule(state: OpenSessionState, rule: PairRule): CommandResult {
  const [a, b] = rule.playerIds
  if (a === b) return fail(400, 'Pick two different players.')
  const pa = state.players.find((p) => p.id === a)
  const pb = state.players.find((p) => p.id === b)
  if (!pa || !pb) return fail(404, 'Player not found.')
  const gone = [pa, pb].find((p) => p.status === 'LEFT')
  if (gone) return fail(409, `${gone.name} has left the session.`)
  const rules = state.settings.rules
  if (rules.some((r) => sameRule(r, rule))) return ok(state)
  if (rules.length >= LIMITS.maxRules) return fail(409, `A session can have at most ${LIMITS.maxRules} rules.`)
  if (rules.some((r) => pairKey(...r.playerIds) === pairKey(a, b))) {
    return fail(409, `${pa.name} and ${pb.name} already have the opposite rule. Remove it first.`)
  }
  if (rule.kind === 'TOGETHER') {
    const taken = [pa, pb].find((p) => rules.some((r) => r.kind === 'TOGETHER' && r.playerIds.includes(p.id)))
    if (taken) return fail(409, `${taken.name} already has a keep-together partner.`)
  }
  const next = withRules(state, [...rules, { kind: rule.kind, playerIds: [a, b] }])
  const active = activeRules(next)
  // A game not yet started that now breaks a rule is withdrawn; finalizeCommand proposes again.
  return ok(withoutMatches(next, (m) => m.status === 'PROPOSED' && !keepsRules(m.teamA, m.teamB, active)))
}

function removeRule(state: OpenSessionState, rule: PairRule): CommandResult {
  const rules = state.settings.rules
  if (!rules.some((r) => sameRule(r, rule))) return fail(404, 'That rule is not set.')
  return ok(withRules(state, rules.filter((r) => !sameRule(r, rule))))
}
```

(The closing `}` of `editProposal` is the first `}` in the block above. Do not leave a second one.)

In `applyCommand`, add these cases after `case 'END_SESSION': …`:

```ts
    case 'SET_MODE':
      // Applies to the next proposal only (spec §5.2): nothing proposed or playing is rewritten.
      return ok({ ...state, settings: { ...state.settings, mode: command.mode } })
    case 'SET_SELF_CHECK_IN':
      return ok({ ...state, settings: { ...state.settings, selfCheckIn: command.enabled } })
    case 'SET_PLAYER_SKILL': {
      const target = state.players.find((p) => p.id === command.playerId)
      if (!target) return fail(404, 'Player not found.')
      const skill = command.skill === null ? null : Math.round(command.skill * 100) / 100
      return ok(withPlayers(state, new Set([target.id]), { skill }))
    }
    case 'ADD_RULE':
      return addRule(state, command.rule)
    case 'REMOVE_RULE':
      return removeRule(state, command.rule)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib && npm run typecheck`
Expected: PASS, and 0 type errors (the `switch` in `applyCommand` stays exhaustive).

- [ ] **Step 6: Commit**

```markdown
- Open play API: the host can switch stacking mode mid-session (applies to the next game only), add and remove keep-together/keep-apart rules, turn self check-in on or off, and set a player's skill; sessions can be created in any of the four modes.
```

```bash
git add src/lib CHANGELOG.md
git commit -m "feat(pickleball): commands for mode switch, pair rules, check-in switch and skill"
```

---

### Task 7: Fairness summary and Phase 2 snapshots

**Files:**
- Modify: `src/lib/pickleball/open/fairness.ts` (append)
- Modify: `src/lib/pickleball/open/snapshot.ts` (whole file below)
- Create: `src/lib/pickleball/open/snapshot.phase2.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `proposalBlocker` (Task 2), `CaptainRecord` (Task 1).
- Produces:
  - `interface FairnessSummary { sitOutSpread: number; longestWait: { playerId; name; since; rounds } | null; repeatedPartners: number }`, `fairnessSummary(state)`.
  - `ViewerSnapshot.settings` is `{ target; mode: StackingMode; selfCheckIn: boolean }`, plus `ViewerSnapshot.fairness`.
  - `HostPlayer.waitingSince: string`; `HostCourt.blocked: string | null`; `HostSnapshot.fairness`; `HostSnapshot.captains: HostCaptain[]`.
  - `toHostSnapshot(state, captains: readonly CaptainRecord[] = [])`.
  - `type CaptainPlayer = Omit<HostPlayer, 'skill' | 'duprId'>`.
  - `interface CaptainSnapshot { viewer; captain: { id; label; courtId }; court: HostCourt; players: CaptainPlayer[]; finished: OpenMatch[]; settings: { mode; target; scoringStyle } }`, `toCaptainSnapshot(state, captain)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pickleball/open/snapshot.phase2.test.ts
import { describe, expect, it } from 'vitest'
import { fairnessSummary } from './fairness'
import { fillProposals } from './propose'
import { toCaptainSnapshot, toHostSnapshot, toViewerSnapshot } from './snapshot'
import { at, court, finished, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, type CaptainRecord } from './types'

const captain: CaptainRecord = { id: 'cap1', label: 'Court 1 captain', courtId: 'c1', keyHash: 'secret-hash-value', createdAt: at(0) }

function state() {
  const base = sessionState({
    courts: [court('c1', 1), court('c2', 2)],
    players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => player(id, { position: i, skill: 4, duprId: 'AB12C3', waitingSince: at(i) })),
    matches: [
      finished('m0', ['a', 'b'], ['c', 'd'], 'A', 11, 4, 1),
      finished('m1', ['a', 'b'], ['e', 'f'], 'B', 7, 11, 20),
    ],
  })
  return fillProposals(base, { now: at(40), newId: () => 'p1' })
}

describe('fairnessSummary', () => {
  it('reports the games spread and repeated partnerships', () => {
    const summary = fairnessSummary(state())
    expect(summary.sitOutSpread).toBe(1) // a and b have 2 games, the rest 1
    expect(summary.repeatedPartners).toBe(1) // a + b twice
  })

  it('names the longest-waiting available player', () => {
    const waiting = sessionState({ players: [player('x', { waitingSince: at(5) }), player('y', { waitingSince: at(2), name: 'Yan' })] })
    expect(fairnessSummary(waiting).longestWait).toMatchObject({ playerId: 'y', name: 'Yan', since: at(2), rounds: 0 })
    expect(fairnessSummary(sessionState()).longestWait).toBeNull()
  })

  it('ignores players on break for the spread', () => {
    const s = sessionState({
      players: [player('a'), player('b'), player('c', { status: 'BREAK' })],
      matches: [finished('m', ['a', 'b'], ['x', 'y'], 'A', 11, 3)],
    })
    expect(fairnessSummary(s).sitOutSpread).toBe(0)
  })
})

describe('Phase 2 snapshots', () => {
  it('the viewer gets fairness and the check-in switch, and still no secrets, skills, rules or captains', () => {
    const viewer = toViewerSnapshot({ ...state(), settings: { ...DEFAULT_SETTINGS, rules: [{ kind: 'APART', playerIds: ['a', 'b'] }] } })
    expect(viewer.settings).toEqual({ target: 11, mode: 'PADDLE_STACK', selfCheckIn: true })
    expect(viewer.fairness.repeatedPartners).toBe(1)
    const json = JSON.stringify(viewer)
    for (const banned of ['AB12C3', 'skill', 'captain', 'rules', 'hash']) expect(json).not.toContain(banned)
  })

  it('the host sees captains without their key hash, and why a court is empty', () => {
    const blocked = sessionState({
      settings: { ...DEFAULT_SETTINGS, rules: [{ kind: 'APART', playerIds: ['a', 'b'] }, { kind: 'APART', playerIds: ['c', 'd'] }] },
      players: ['a', 'b', 'c', 'd'].map((id) => player(id)),
    })
    const host = toHostSnapshot(blocked, [captain])
    expect(host.captains).toEqual([{ id: 'cap1', label: 'Court 1 captain', courtId: 'c1', courtLabel: 'Court 1', createdAt: at(0) }])
    expect(JSON.stringify(host)).not.toContain('secret-hash-value')
    expect(host.courts[0].blocked).toMatch(/keep-together and keep-apart/)
    expect(host.players[0]).toMatchObject({ waitingSince: blocked.players[0].waitingSince, skill: null })
  })

  it('a captain sees their court, players without skills or DUPR IDs, and only their court’s results', () => {
    const snap = toCaptainSnapshot(state(), captain)
    expect(snap.captain).toEqual({ id: 'cap1', label: 'Court 1 captain', courtId: 'c1' })
    expect(snap.court.id).toBe('c1')
    expect(snap.finished.every((m) => m.courtId === 'c1')).toBe(true)
    const json = JSON.stringify(snap)
    for (const banned of ['AB12C3', 'skill', 'duprId', 'secret-hash-value', 'rules']) expect(json).not.toContain(banned)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/pickleball/open/snapshot.phase2.test.ts`
Expected: FAIL. `fairnessSummary` and `toCaptainSnapshot` are not exported.

- [ ] **Step 3: Append `fairnessSummary` to `fairness.ts`**

```ts
export interface FairnessSummary {
  /** Spec §5.5 "sit-out spread": most minus fewest games among active players (on break or left excluded). */
  sitOutSpread: number
  /** The available player waiting longest, if anyone is waiting. */
  longestWait: { playerId: string; name: string; since: string; rounds: number } | null
  /** Partnerships played more than once, counting every repeat (A+B three times counts 2). */
  repeatedPartners: number
}

export function fairnessSummary(state: OpenSessionState): FairnessSummary {
  const games = state.players.filter((p) => p.status === 'ACTIVE').map((p) => gamesPlayed(p, state.matches))
  const longest = [...queueOrder(state)].sort(byWait)[0]
  const repeats = [...pairingHistory(state.matches).partners.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0)
  return {
    sitOutSpread: games.length ? Math.max(...games) - Math.min(...games) : 0,
    longestWait: longest
      ? { playerId: longest.player.id, name: longest.player.name, since: longest.player.waitingSince, rounds: longest.satOut }
      : null,
    repeatedPartners: repeats,
  }
}
```

- [ ] **Step 4: Replace `snapshot.ts`**

```ts
// src/lib/pickleball/open/snapshot.ts
// The viewer snapshot is an ALLOWLIST (spec §7): it is built field by field,
// never by spreading state, so a new column can never leak to the public
// board by accident. The captain snapshot is the same idea for one court.
import { busyPlayerIds, fairnessSummary, gamesPlayed, queueOrder, roundsSatOut, type FairnessSummary } from './fairness'
import { proposalBlocker } from './propose'
import { computeStandings, type StandingRow } from './standings'
import type { CaptainRecord, OpenMatch, OpenSessionState, Side, StackingMode } from './types'

export interface ViewerCourt {
  id: string
  label: string
  state: 'PLAYING' | 'UP_NEXT' | 'WAITING_FOR_PLAYERS' | 'OFF'
  teamA: string[]
  teamB: string[]
  startedAt: string | null
}

export interface ViewerSnapshot {
  code: string
  name: string
  hostDisplayName: string
  status: 'ACTIVE' | 'ENDED'
  expiresAt: string
  settings: { target: number; mode: StackingMode; selfCheckIn: boolean }
  version: number
  courts: ViewerCourt[]
  waiting: Array<{ id: string; name: string }>
  onBreak: Array<{ id: string; name: string }>
  roster: Array<{ id: string; name: string }>
  standings: StandingRow[]
  fairness: FairnessSummary
  recentResults: Array<{ matchId: string; courtLabel: string; teamA: string[]; teamB: string[]; scoreA: number | null; scoreB: number | null; winner: Side; finishedAt: string }>
}

export interface HostPlayer {
  id: string
  name: string
  status: 'ACTIVE' | 'BREAK' | 'LEFT'
  games: number
  satOut: number
  busy: boolean
  waitingSince: string
  skill: number | null
  duprId: string | null
}

export interface HostCourt {
  id: string
  label: string
  position: number
  enabled: boolean
  match: OpenMatch | null
  /** Why a free court has no proposal (a keep-together/apart rule), else null. */
  blocked: string | null
}

export interface HostCaptain {
  id: string
  label: string
  courtId: string
  courtLabel: string
  createdAt: string
}

export interface HostSnapshot {
  viewer: ViewerSnapshot
  players: HostPlayer[]
  courts: HostCourt[]
  finished: OpenMatch[]
  settings: OpenSessionState['settings']
  fairness: FairnessSummary
  captains: HostCaptain[]
}

export type CaptainPlayer = Omit<HostPlayer, 'skill' | 'duprId'>

export interface CaptainSnapshot {
  viewer: ViewerSnapshot
  captain: { id: string; label: string; courtId: string }
  court: HostCourt
  players: CaptainPlayer[]
  finished: OpenMatch[]
  settings: { mode: StackingMode; target: number; scoringStyle: OpenSessionState['settings']['scoringStyle'] }
}

function namesOf(state: OpenSessionState, ids: readonly string[]): string[] {
  return ids.map((id) => state.players.find((p) => p.id === id)?.name ?? '—')
}

function liveMatch(state: OpenSessionState, courtId: string): OpenMatch | null {
  return state.matches.find((m) => m.courtId === courtId && m.status === 'IN_PROGRESS')
    ?? state.matches.find((m) => m.courtId === courtId && m.status === 'PROPOSED')
    ?? null
}

export function toViewerSnapshot(state: OpenSessionState): ViewerSnapshot {
  const courts = [...state.courts].sort((a, b) => a.position - b.position)
  return {
    code: state.publicCode,
    name: state.name,
    hostDisplayName: state.hostDisplayName,
    status: state.status,
    expiresAt: state.expiresAt,
    settings: { target: state.settings.target, mode: state.settings.mode, selfCheckIn: state.settings.selfCheckIn },
    version: state.version,
    courts: courts.map((c) => {
      const match = c.enabled ? liveMatch(state, c.id) : null
      const courtState: ViewerCourt['state'] = !c.enabled ? 'OFF' : !match ? 'WAITING_FOR_PLAYERS' : match.status === 'IN_PROGRESS' ? 'PLAYING' : 'UP_NEXT'
      return {
        id: c.id, label: c.label, state: courtState,
        teamA: match ? namesOf(state, match.teamA) : [], teamB: match ? namesOf(state, match.teamB) : [],
        startedAt: match?.startedAt ?? null,
      }
    }),
    waiting: queueOrder(state).map((e) => ({ id: e.player.id, name: e.player.name })),
    onBreak: state.players.filter((p) => p.status === 'BREAK').map((p) => ({ id: p.id, name: p.name })),
    roster: state.players.filter((p) => p.status !== 'LEFT').map((p) => ({ id: p.id, name: p.name })),
    standings: computeStandings(state.players, state.matches),
    fairness: fairnessSummary(state),
    recentResults: state.matches
      .filter((m): m is OpenMatch & { winner: Side; finishedAt: string } => m.status === 'FINISHED' && m.winner !== null && m.finishedAt !== null)
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt) || b.seq - a.seq)
      .slice(0, 10)
      .map((m) => ({
        matchId: m.id, courtLabel: state.courts.find((c) => c.id === m.courtId)?.label ?? '',
        teamA: namesOf(state, m.teamA), teamB: namesOf(state, m.teamB),
        scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner, finishedAt: m.finishedAt,
      })),
  }
}

function hostCourts(state: OpenSessionState): HostCourt[] {
  const blocker = proposalBlocker(state)
  return [...state.courts].sort((a, b) => a.position - b.position).map((c) => {
    const match = c.enabled ? liveMatch(state, c.id) : null
    return { id: c.id, label: c.label, position: c.position, enabled: c.enabled, match, blocked: c.enabled && !match ? blocker : null }
  })
}

function captainPlayers(state: OpenSessionState): CaptainPlayer[] {
  const busy = busyPlayerIds(state.matches)
  return state.players.map((p) => ({
    id: p.id, name: p.name, status: p.status, games: gamesPlayed(p, state.matches),
    satOut: roundsSatOut(p, state), busy: busy.has(p.id), waitingSince: p.waitingSince,
  }))
}

export function toHostSnapshot(state: OpenSessionState, captains: readonly CaptainRecord[] = []): HostSnapshot {
  const viewer = toViewerSnapshot(state)
  return {
    viewer,
    players: captainPlayers(state).map((p, i) => ({ ...p, skill: state.players[i].skill, duprId: state.players[i].duprId })),
    courts: hostCourts(state),
    finished: state.matches.filter((m) => m.status === 'FINISHED').sort((a, b) => b.seq - a.seq),
    settings: state.settings,
    fairness: viewer.fairness,
    captains: captains.map((c) => ({
      id: c.id, label: c.label, courtId: c.courtId,
      courtLabel: state.courts.find((court) => court.id === c.courtId)?.label ?? '', createdAt: c.createdAt,
    })),
  }
}

export function toCaptainSnapshot(state: OpenSessionState, captain: CaptainRecord): CaptainSnapshot {
  const court = hostCourts(state).find((c) => c.id === captain.courtId)
    ?? { id: captain.courtId, label: '', position: 0, enabled: false, match: null, blocked: null }
  return {
    viewer: toViewerSnapshot(state),
    captain: { id: captain.id, label: captain.label, courtId: captain.courtId },
    court,
    players: captainPlayers(state),
    finished: state.matches.filter((m) => m.status === 'FINISHED' && m.courtId === captain.courtId).sort((a, b) => b.seq - a.seq),
    settings: { mode: state.settings.mode, target: state.settings.target, scoringStyle: state.settings.scoringStyle },
  }
}
```

`OpenSessionDO.ts` calls `toHostSnapshot(state)` and still compiles: `captains` defaults to `[]` until Task 11.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/pickleball/open && npm run typecheck`
Expected: PASS (the Phase 1 `snapshot.test.ts` too), and 0 type errors.

- [ ] **Step 6: Commit**

```markdown
- Open play board data: the public board and host console carry live fairness numbers (games spread, longest wait, repeat partners); the host sees why a court is waiting when the rules leave no fitting four. Nothing private is added to the public board.
```

```bash
git add src/lib/pickleball/open CHANGELOG.md
git commit -m "feat(pickleball): fairness summary, court blockers and captain snapshots"
```

---
### Task 8: Host console and create form: choose and switch the mode, rules, fairness panel, player rows

**Files:**
- Create: `src/pickleball-open/lib/useNow.js`, `src/pickleball-open/lib/useNow.test.js`
- Create: `src/pickleball-open/components/ModePicker.jsx`, `RulesPanel.jsx`, `FairnessPanel.jsx`
- Modify (whole files below): `src/pickleball-open/components/PlayersPanel.jsx`, `CourtCard.jsx`, `HostConsole.jsx`
- Modify: `src/pickleball-open/CreateSessionApp.jsx`, `src/pickleball-open/components/ViewerBoard.jsx`
- Modify: `tests/e2e/pickleball/open-play.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `MODE_INFO`, `MODE_ORDER` (Task 5); host snapshot fields `settings.mode`, `settings.rules`, `fairness`, `courts[].blocked`, `players[].waitingSince` (Task 7); commands `SET_MODE`, `ADD_RULE`, `REMOVE_RULE`, `SET_PLAYER_SKILL` (Task 6).
- Produces:
  - `minutesSince(iso, nowMs): number`, `useNow(intervalMs = 30_000): number`.
  - `ModePicker({ value, onChange, label? })` (named export) and default `ModeSheet({ mode, onPick, onClose })`.
  - `RulesPanel({ rules, players, send })`.
  - `FairnessPanel({ fairness, tv? })`, with root `data-testid="fairness"`.
  - `PlayersPanel` gains a `mode` prop.
  - `CourtCard` puts `data-testid="court-N"` on every state and shows `court.blocked`.
  - e2e helper `hostSnapshot(request, code, hostKey)` in `open-play.spec.js`.

- [ ] **Step 1: Write the failing tests**

```js
// src/pickleball-open/lib/useNow.test.js
import { describe, expect, it } from 'vitest'
import { minutesSince } from './useNow'

describe('minutesSince', () => {
  const now = Date.parse('2026-10-12T10:30:00.000Z')

  it('counts whole minutes', () => {
    expect(minutesSince('2026-10-12T10:00:00.000Z', now)).toBe(30)
    expect(minutesSince('2026-10-12T10:29:59.000Z', now)).toBe(0)
  })

  it('never goes negative or NaN', () => {
    expect(minutesSince('2026-10-12T11:00:00.000Z', now)).toBe(0)
    expect(minutesSince(null, now)).toBe(0)
    expect(minutesSince('not a date', now)).toBe(0)
  })
})
```

Append to `tests/e2e/pickleball/open-play.spec.js`. Add the helper after the existing `command(...)` function at the top of the file:

```js
async function hostSnapshot(request, code, hostKey) {
  const response = await request.get(`/api/pickleball/open/s/${code}/host`, { headers: { 'X-Host-Key': hostKey } })
  expect(response.status()).toBe(200)
  return response.json()
}
```

Then add at the end of the file:

```js
test.describe('stacking modes, rules and fairness', () => {
  test('the host picks a mode when creating a session and sees it on the console', async ({ page }) => {
    const ip = freshIp()
    await page.route('**/api/pickleball/open/sessions', (route) =>
      route.request().method() === 'POST'
        ? route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } })
        : route.continue(),
    )
    await page.goto('/pickleball/new')
    await page.getByLabel('Your name (shown as "Hosted by")').fill('Coach Mike')
    for (const label of ['Paddle stack', 'Winners play winners', 'By standing', 'Balanced teams']) {
      await expect(page.getByRole('radio', { name: new RegExp(`^${label}`) })).toBeVisible()
    }
    await page.getByRole('radio', { name: /^Winners play winners/ }).click()
    await expect(page.getByRole('radio', { name: /^Winners play winners/ })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: 'Next: add players' }).click()
    await page.getByLabel(/Paste names/).fill('Ana\nBen\nCarlo\nDina\nEli')
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 })
    await page.getByRole('button', { name: /^Start session/ }).click()
    await page.getByRole('link', { name: 'I saved it — go to courts' }).click()
    await expect(page.getByRole('button', { name: 'Mode: Winners play winners' })).toBeVisible()
  })

  test('switching mode mid-session leaves the proposed game alone and shows on the board', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toContainText('Up next')
    const before = await page.getByTestId('court-1').innerText()
    await page.getByRole('button', { name: 'Mode: Paddle stack' }).click()
    await page.getByRole('dialog', { name: 'Who plays next' }).getByRole('radio', { name: /^By standing/ }).click()
    await expect(page.getByRole('button', { name: 'Mode: By standing' })).toBeVisible()
    expect(await page.getByTestId('court-1').innerText()).toBe(before)
    expect((await hostSnapshot(request, code, hostKey)).settings.mode).toBe('BY_STANDING')
    const viewer = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(viewer.settings.mode).toBe('BY_STANDING')
  })

  test('a keep-together rule added on the console is kept by every proposal', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const rules = page.getByRole('region', { name: 'Keep together or apart' })
    await rules.getByRole('radio', { name: 'Keep together' }).click()
    await rules.getByLabel('First player').selectOption({ label: 'Ana' })
    await rules.getByLabel('Second player').selectOption({ label: 'Ivan' })
    await rules.getByRole('button', { name: 'Add rule' }).click()
    await expect(rules.getByText('Ana & Ivan: always partners')).toBeVisible()
    const host = await hostSnapshot(request, code, hostKey)
    const ana = host.players.find((p) => p.name === 'Ana').id
    const ivan = host.players.find((p) => p.name === 'Ivan').id
    for (const court of host.courts) {
      const m = court.match
      if (!m) continue
      const four = [...m.teamA, ...m.teamB]
      if (four.includes(ana) || four.includes(ivan)) expect(m.teamA.includes(ana) ? m.teamA : m.teamB).toContain(ivan)
    }
  })

  test('a rule no four can keep leaves the court waiting with a reason', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request, { courtCount: 1, players: ['Ana', 'Ben', 'Carlo', 'Dina'].map((name) => ({ name })) })
    const host = await hostSnapshot(request, code, hostKey)
    const id = (name) => host.players.find((p) => p.name === name).id
    expect((await command(request, code, hostKey, { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: [id('Ana'), id('Ben')] } })).status()).toBe(200)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await expect(page.getByTestId('court-1')).toContainText('No four waiting players fit the keep-together and keep-apart rules')
    expect((await command(request, code, hostKey, { type: 'REMOVE_RULE', rule: { kind: 'APART', playerIds: [id('Ana'), id('Ben')] } })).status()).toBe(200)
    await expect(page.getByTestId('court-1')).toContainText('Up next')
  })

  test('the fairness panel shows the games spread, the longest wait and repeat partners', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    const panel = page.getByTestId('fairness')
    for (const label of ['Games spread', 'Longest wait', 'Repeat partners']) await expect(panel).toContainText(label)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pickleball-open/lib/useNow.test.js`
Expected: FAIL, because `./useNow` cannot be resolved.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker -g "stacking modes, rules and fairness"`
Expected: FAIL. There is no mode radio on the create form, no "Mode:" button, no rules region and no fairness panel.

- [ ] **Step 3: Write the small modules**

```js
// src/pickleball-open/lib/useNow.js
import { useEffect, useState } from 'react'

/** Whole minutes from an ISO time to `now` (ms); 0 for a missing or future time. */
export function minutesSince(iso, now) {
  if (!iso) return 0
  const ms = now - Date.parse(iso)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : 0
}

/** The current time, refreshed every intervalMs, so "waiting 12 min" keeps counting between snapshots. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
```

```jsx
// src/pickleball-open/components/ModePicker.jsx
import { MODE_INFO, MODE_ORDER } from '../../lib/pickleball/open/modes/info'
import { Sheet } from './ui.jsx'

/** The four ways to pick who plays next, each with its one-line explanation (spec §5.2). */
export function ModePicker({ value, onChange, label = 'Who plays next' }) {
  return (
    <div className="grid gap-2" role="radiogroup" aria-label={label}>
      {MODE_ORDER.map((mode) => {
        const checked = mode === value
        return (
          <button key={mode} type="button" role="radio" aria-checked={checked} onClick={() => onChange(mode)}
            className={`min-h-14 rounded-2xl p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-pickle-neon ${checked ? 'bg-pickle-neon text-ink' : 'border border-navy-700 bg-navy-900 text-white hover:border-pickle-neon'}`}>
            <span className="block font-bold">{MODE_INFO[mode].label}</span>
            <span className={`block text-sm ${checked ? 'text-ink' : 'text-mist'}`}>{MODE_INFO[mode].summary}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Mid-session switch. The change applies from the next proposal only (spec §5.2). */
export default function ModeSheet({ mode, onPick, onClose }) {
  return (
    <Sheet title="Who plays next" onClose={onClose}>
      <ModePicker value={mode} onChange={onPick} />
      <p className="mt-4 text-sm text-mist">A change applies from the next game proposed. Games already proposed or on court stay as they are. Anyone who has sat out 2 rounds in a row still goes on next, in every mode.</p>
    </Sheet>
  )
}
```

```jsx
// src/pickleball-open/components/RulesPanel.jsx
import { useState } from 'react'
import { Button, Panel } from './ui.jsx'

const KIND_LABEL = { TOGETHER: 'always partners', APART: 'never on the same court' }
const SELECT = 'min-h-11 rounded-xl border border-navy-700 bg-navy-900 px-3 text-base text-white'

/** Keep-together / keep-apart (spec §5.4). Every mode keeps these as hard rules. */
export default function RulesPanel({ rules, players, send }) {
  const [kind, setKind] = useState('TOGETHER')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const present = players.filter((p) => p.status !== 'LEFT')
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? 'Someone who left'

  async function add(event) {
    event.preventDefault()
    if (!first || !second || first === second) return
    if (await send({ type: 'ADD_RULE', rule: { kind, playerIds: [first, second] } })) {
      setFirst('')
      setSecond('')
    }
  }

  return (
    <Panel as="section" aria-labelledby="rules-heading" className="grid gap-3">
      <h2 id="rules-heading" className="text-lg font-bold">Keep together or apart</h2>
      <p className="text-sm text-mist">Every way of picking players keeps these rules. If no game fits them, the court waits and says why.</p>
      <form onSubmit={add} className="grid gap-2">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rule">
          <Button role="radio" aria-checked={kind === 'TOGETHER'} variant={kind === 'TOGETHER' ? 'neon' : 'ghost'} onClick={() => setKind('TOGETHER')}>Keep together</Button>
          <Button role="radio" aria-checked={kind === 'APART'} variant={kind === 'APART' ? 'neon' : 'ghost'} onClick={() => setKind('APART')}>Keep apart</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-xs text-mist">First player
            <select value={first} onChange={(e) => setFirst(e.target.value)} className={SELECT}>
              <option value="">Pick…</option>
              {present.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-mist">Second player
            <select value={second} onChange={(e) => setSecond(e.target.value)} className={SELECT}>
              <option value="">Pick…</option>
              {present.filter((p) => p.id !== first).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
        <Button type="submit" variant="primary" disabled={!first || !second || first === second}>Add rule</Button>
      </form>
      {rules.length === 0 ? <p className="text-sm text-mist">No rules yet.</p> : (
        <ul className="grid gap-1.5" aria-label="Rules">
          {rules.map((rule) => {
            const text = `${nameOf(rule.playerIds[0])} & ${nameOf(rule.playerIds[1])}: ${KIND_LABEL[rule.kind]}`
            return (
              <li key={`${rule.kind}-${rule.playerIds.join('-')}`} className="flex items-center gap-2 rounded-xl bg-navy-800 px-3 py-2 text-sm">
                <span className="flex-1">{text}</span>
                <Button variant="quiet" className="!min-h-11 !px-2" aria-label={`Remove rule: ${text}`} onClick={() => send({ type: 'REMOVE_RULE', rule })}>Remove</Button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
```

```jsx
// src/pickleball-open/components/FairnessPanel.jsx
import { useId } from 'react'
import { minutesSince, useNow } from '../lib/useNow'

/** Spec §5.5: the live numbers that make rotation visible. Used on the host console and the TV. */
export default function FairnessPanel({ fairness, tv = false }) {
  const now = useNow()
  const headingId = useId()
  const wait = fairness.longestWait
  const rounds = wait?.rounds ? ` · ${wait.rounds} round${wait.rounds === 1 ? '' : 's'} out` : ''
  const tiles = [
    { label: 'Games spread', value: String(fairness.sitOutSpread), hint: 'most minus fewest games' },
    { label: 'Longest wait', value: wait ? `${minutesSince(wait.since, now)} min` : '—', hint: wait ? `${wait.name}${rounds}` : 'nobody waiting' },
    { label: 'Repeat partners', value: String(fairness.repeatedPartners), hint: 'pairs who partnered again' },
  ]
  return (
    <section aria-labelledby={headingId} className={tv ? 'grid gap-2' : 'rounded-2xl bg-navy-900 p-4'} data-testid="fairness">
      <h2 id={headingId} className={tv ? 'text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon' : 'text-lg font-bold'}>Fairness</h2>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0 rounded-xl bg-navy-800 p-3">
            <dt className={tv ? 'text-[clamp(0.8rem,1vw,1.25rem)] text-mist' : 'text-xs text-mist'}>{tile.label}</dt>
            <dd className={`font-bold ${tv ? 'text-[clamp(1.5rem,2.4vw,3rem)]' : 'text-2xl'}`}>{tile.value}</dd>
            <dd className={`truncate text-mist ${tv ? 'text-[clamp(0.8rem,1vw,1.25rem)]' : 'text-xs'}`}>{tile.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
```

- [ ] **Step 4: Replace `PlayersPanel.jsx` and `CourtCard.jsx`**

```jsx
// src/pickleball-open/components/PlayersPanel.jsx
import { useState } from 'react'
import { minutesSince, useNow } from '../lib/useNow'
import { Button } from './ui.jsx'

const STATUS_LABEL = { ACTIVE: 'Waiting', BREAK: 'On break', LEFT: 'Left' }
const SKILLS = [1, 2, 3, 4, 5]

/** Each row shows games, rounds sat out and the current wait (spec §5.5); skill is editable for balanced teams. */
export default function PlayersPanel({ players, waiting, playing, mode, send }) {
  const [names, setNames] = useState('')
  const now = useNow()
  const order = new Map(waiting.map((w, index) => [w.id, index + 1]))

  async function add(event) {
    event.preventDefault()
    const list = names.split(/[\n,]/).map((n) => n.trim()).filter(Boolean)
    if (list.length && (await send({ type: 'ADD_PLAYERS', names: list }))) setNames('')
  }

  function setSkill(player, value) {
    send({ type: 'SET_PLAYER_SKILL', playerId: player.id, skill: value === '' ? null : Number(value) })
  }

  return (
    <section aria-labelledby="players-heading" className="grid gap-3">
      <h2 id="players-heading" className="text-lg font-bold">Players ({players.filter((p) => p.status !== 'LEFT').length})</h2>
      <form onSubmit={add} className="flex gap-2">
        <label className="sr-only" htmlFor="add-players">Add players</label>
        <input id="add-players" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Add late arrivals (comma-separated)"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-navy-700 bg-navy-900 px-3 text-white placeholder:text-mist/70" />
        <Button type="submit" variant="neon">Add</Button>
      </form>
      <ul className="grid gap-1.5">
        {players.filter((p) => p.status !== 'LEFT').map((p) => {
          const onCourt = playing.has(p.id)
          const waitingNow = p.status === 'ACTIVE' && !p.busy
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-navy-900 px-3 py-2 text-[15px]">
              <span className="min-w-0 flex-1">{order.has(p.id) ? `${order.get(p.id)} · ` : ''}{p.name}</span>
              <span className="text-xs text-mist">
                {onCourt ? 'on court' : p.busy ? 'up next' : STATUS_LABEL[p.status]} · {p.games} games · sat out {p.satOut}
                {waitingNow ? ` · ${minutesSince(p.waitingSince, now)} min` : ''}
              </span>
              {mode === 'BALANCED' && (
                <select aria-label={`Skill for ${p.name}`} value={p.skill === null ? '' : String(p.skill)} onChange={(e) => setSkill(p, e.target.value)}
                  className="min-h-11 rounded-lg border border-navy-700 bg-navy-950 px-2 text-sm text-white">
                  <option value="">Skill –</option>
                  {p.skill !== null && !SKILLS.includes(p.skill) && <option value={String(p.skill)}>{p.skill}</option>}
                  {SKILLS.map((s) => <option key={s} value={String(s)}>Skill {s}</option>)}
                </select>
              )}
              {p.status === 'ACTIVE' && !onCourt && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'BREAK' })}>Break</Button>}
              {p.status === 'BREAK' && <Button variant="quiet" className="!min-h-11 !px-2 text-sm" onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'ACTIVE' })}>Back in</Button>}
              {!onCourt && <Button variant="quiet" className="!min-h-11 !px-2 text-sm text-mist" aria-label={`${p.name} left`} onClick={() => send({ type: 'SET_PLAYER_STATUS', playerId: p.id, status: 'LEFT' })}>Left</Button>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

```jsx
// src/pickleball-open/components/CourtCard.jsx
import { Button, TeamNames } from './ui.jsx'

function minutesSince(iso) {
  return iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : 0
}

export default function CourtCard({ court, nameOf, ended = false, onStart, onGameOver, onEdit }) {
  const match = court.match
  const testId = `court-${court.position}`
  if (!court.enabled) {
    return <article data-testid={testId} className="rounded-2xl border border-navy-800 p-4 text-mist"><h3 className="font-bold text-white">{court.label}</h3><p className="mt-2 text-sm">Off</p></article>
  }
  if (!match) {
    return (
      <article data-testid={testId} className="rounded-2xl border border-dashed border-navy-700 p-4">
        <h3 className="font-bold">{court.label}</h3>
        <p className={`mt-2 text-sm ${court.blocked && !ended ? 'text-amber-200' : 'text-mist'}`} role={court.blocked && !ended ? 'status' : undefined}>
          {ended ? 'Session ended' : court.blocked ?? 'Waiting for players. Fills automatically when the next game ends.'}
        </p>
      </article>
    )
  }
  const proposed = match.status === 'PROPOSED'
  return (
    <article key={match.id} className={`pb-flip flex flex-col gap-3 rounded-2xl p-4 ${proposed ? 'border-2 border-dashed border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid={testId}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-bold">{court.label}</h3>
        <span className={`text-xs ${proposed ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{proposed ? 'Up next' : `${minutesSince(match.startedAt)} min`}</span>
      </div>
      <div className="grid gap-1 text-[15px]">
        <TeamNames side="A" names={match.teamA.map(nameOf)} />
        <TeamNames side="B" names={match.teamB.map(nameOf)} />
      </div>
      {proposed ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="neon" onClick={() => onStart(match)}>Start</Button>
          <Button variant="ghost" onClick={() => onEdit(match)}>Edit</Button>
          <Button variant="quiet" className="col-span-2 !min-h-11 text-sm" onClick={() => onGameOver(match)}>Already played? Enter result</Button>
        </div>
      ) : (
        <Button variant="primary" onClick={() => onGameOver(match)}>Game over</Button>
      )}
    </article>
  )
}
```

- [ ] **Step 5: Replace `HostConsole.jsx`**

```jsx
// src/pickleball-open/components/HostConsole.jsx
import { useCallback, useMemo, useState } from 'react'
import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { MODE_INFO } from '../../lib/pickleball/open/modes/info'
import { deleteSession, downloadResults } from '../lib/api'
import { forgetHostedSession, viewerLink } from '../lib/hostKeys'
import { useCommandQueue } from '../lib/useCommandQueue'
import CourtCard from './CourtCard.jsx'
import EditMatchDialog from './EditMatchDialog.jsx'
import FairnessPanel from './FairnessPanel.jsx'
import GameOverDialog from './GameOverDialog.jsx'
import ModeSheet from './ModePicker.jsx'
import PlayersPanel from './PlayersPanel.jsx'
import QrCode from './QrCode.jsx'
import ResultsList from './ResultsList.jsx'
import RulesPanel from './RulesPanel.jsx'
import StandingsTable from './StandingsTable.jsx'
import UndoToast from './UndoToast.jsx'
import { Button, Panel, Sheet } from './ui.jsx'

const countLabel = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`

const TABS = [['courts', 'Courts'], ['players', 'Players'], ['results', 'Results']]
const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again."

/** A fetch that never reached the server throws a TypeError whose text means nothing to a host. */
function friendlyError(message) {
  return !message || /failed to fetch|networkerror|load failed|network request failed/i.test(message) ? OFFLINE_MESSAGE : message
}

export default function HostConsole({ code, hostKey, host, status, onHost }) {
  const { send, pending, error, clearError } = useCommandQueue(code, hostKey, onHost)
  const [tab, setTab] = useState('courts')
  const [dialog, setDialog] = useState(null)
  const [undo, setUndo] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [actionError, setActionError] = useState(null)
  const viewer = host.viewer
  const names = useMemo(() => new Map(host.players.map((p) => [p.id, p.name])), [host.players])
  const nameOf = useCallback((id) => names.get(id) ?? '—', [names])
  const courtLabel = useCallback((id) => host.courts.find((c) => c.id === id)?.label ?? '', [host.courts])
  const playing = useMemo(() => new Set(host.courts.flatMap((c) => (c.match?.status === 'IN_PROGRESS' ? [...c.match.teamA, ...c.match.teamB] : []))), [host.courts])
  const dismissUndo = useCallback(() => setUndo(null), [])

  async function save(match, result) {
    setDialog(null)
    const ok = await send({ type: 'RECORD_RESULT', matchId: match.id, ...result })
    if (ok) setUndo({ matchId: match.id, savedAt: Date.now(), label: `${courtLabel(match.courtId)} saved${result.scoreA === null ? '' : ` ${result.scoreA}–${result.scoreB}`}.` })
  }

  function pickMode(mode) {
    setDialog(null)
    if (mode !== host.settings.mode) send({ type: 'SET_MODE', mode })
  }

  async function download() {
    try {
      const { blob, filename } = await downloadResults(code, hostKey)
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: filename })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : 'Could not download the results. Try again.')
    }
  }

  function endSession() {
    if (!window.confirm('End this session? Courts stop getting new matches. Games in progress can still be saved.')) return
    send({ type: 'END_SESSION' })
  }

  async function remove() {
    if (!window.confirm('Delete this session and all its results now? This cannot be undone.')) return
    try {
      await deleteSession(code, hostKey)
    } catch (err) {
      setActionError(err instanceof Error && err.message ? err.message : 'Could not delete the session. Try again.')
      return
    }
    forgetHostedSession(code)
    window.location.assign('/pickleball')
  }

  const section = (key) => `${tab === key ? 'block' : 'hidden'} lg:block`

  return (
    <div className="mx-auto max-w-[1600px] px-3 pb-24 pt-3 sm:px-5 lg:pb-8">
      <header className="flex flex-wrap items-center gap-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold sm:text-2xl">{viewer.name}</h1>
          <p className="text-xs text-mist">
            {countLabel(host.players.filter((p) => p.status !== 'LEFT').length, 'player')} · {countLabel(host.courts.filter((c) => c.enabled).length, 'court')}
            {status !== 'open' && <span className="ml-2 text-amber-200">· Reconnecting…</span>}
            {pending > 0 && <span className="ml-2 text-amber-200">· Sending {pending}…</span>}
            {viewer.status === 'ENDED' && <span className="ml-2 text-pickle-neon">· Ended</span>}
          </p>
        </div>
        <Button variant="ghost" aria-haspopup="dialog" onClick={() => setDialog({ type: 'mode' })}>Mode: {MODE_INFO[host.settings.mode].label}</Button>
        <Button variant="neon" onClick={() => setDialog({ type: 'share' })}>Share board</Button>
        <div className="relative">
          <Button variant="ghost" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>More</Button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-2 grid w-56 gap-1 rounded-2xl bg-navy-950 p-2 shadow-elevated">
              <Button variant="ghost" onClick={() => { setMenuOpen(false); download() }}>Download results (CSV)</Button>
              {viewer.status === 'ACTIVE' && <Button variant="ghost" onClick={() => { setMenuOpen(false); endSession() }}>End session</Button>}
              <Button variant="danger" onClick={() => { setMenuOpen(false); remove() }}>Delete now</Button>
            </div>
          )}
        </div>
      </header>

      {(error || actionError) && (
        <p role="alert" className="my-2 flex items-center justify-between rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">
          {friendlyError(actionError ?? error)}<button type="button" onClick={() => { setActionError(null); clearError() }} className="ml-3 min-h-11 px-3 underline">OK</button>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <section className={section('courts')} aria-label="Courts">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
            {host.courts.map((court) => (
              <CourtCard key={court.id} court={court} nameOf={nameOf} ended={viewer.status === 'ENDED'}
                onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
                onGameOver={(match) => setDialog({ type: 'gameOver', match })}
                onEdit={(match) => setDialog({ type: 'edit', match })} />
            ))}
          </div>
          <Panel className="mt-4">
            <h2 className="font-bold">Waiting</h2>
            {viewer.waiting.length === 0 ? <p className="mt-1 text-sm text-mist">Everyone is on court.</p> : (
              <ol className="mt-2 flex flex-wrap gap-1.5 text-sm">
                {viewer.waiting.map((w, i) => <li key={w.id} className="rounded-full bg-navy-800 px-3 py-1">{i + 1} · {w.name}</li>)}
              </ol>
            )}
          </Panel>
          <div className="mt-4"><FairnessPanel fairness={host.fairness} /></div>
        </section>

        <aside className="grid content-start gap-5">
          <div className={`${section('players')} grid gap-5`}>
            <PlayersPanel players={host.players} waiting={viewer.waiting} playing={playing} mode={host.settings.mode} send={send} />
            <RulesPanel rules={host.settings.rules} players={host.players} send={send} />
          </div>
          <div className={section('results')}>
            <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={viewer.standings} /></Panel>
            <Panel className="mt-4"><h2 className="mb-2 text-lg font-bold">Results</h2>
              <ResultsList finished={host.finished} nameOf={nameOf} courtLabel={courtLabel} onEdit={(match) => setDialog({ type: 'editResult', match })} />
            </Panel>
          </div>
        </aside>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-navy-800 bg-ink lg:hidden" aria-label="Sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-current={tab === key} onClick={() => setTab(key)}
            className={`min-h-14 text-sm ${tab === key ? 'font-bold text-pickle-neon' : 'text-mist'}`}>{label}</button>
        ))}
      </nav>

      {dialog?.type === 'mode' && <ModeSheet mode={host.settings.mode} onPick={pickMode} onClose={() => setDialog(null)} />}
      {dialog?.type === 'gameOver' && (
        <GameOverDialog title={`${courtLabel(dialog.match.courtId)} · who won?`} match={dialog.match} nameOf={nameOf} settings={host.settings}
          onSave={(result) => save(dialog.match, result)}
          onAbandon={dialog.match.status === 'IN_PROGRESS' ? () => { setDialog(null); send({ type: 'ABANDON_MATCH', matchId: dialog.match.id }) } : null}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editResult' && (
        <GameOverDialog title="Edit result" match={dialog.match} nameOf={nameOf} settings={host.settings} initial={dialog.match}
          onSave={(result) => { setDialog(null); send({ type: 'EDIT_RESULT', matchId: dialog.match.id, ...result }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <EditMatchDialog match={dialog.match} players={host.players} nameOf={nameOf}
          onSave={(slots) => { setDialog(null); send({ type: 'EDIT_PROPOSAL', matchId: dialog.match.id, teamA: [slots[0], slots[1]], teamB: [slots[2], slots[3]] }) }}
          onSkip={() => { setDialog(null); send({ type: 'SKIP_PROPOSAL', matchId: dialog.match.id }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'share' && (
        <Sheet title="Player board" onClose={() => setDialog(null)}>
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCode url={viewerLink(window.location.origin, code)} size={220} />
            <p className="text-2xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
            <p className="text-sm text-mist">Players scan this to follow courts and standings. It can't change anything.</p>
          </div>
        </Sheet>
      )}
      {undo && (
        <UndoToast key={undo.savedAt} label={undo.label} savedAt={undo.savedAt} onDismiss={dismissUndo}
          onUndo={() => { setUndo(null); send({ type: 'UNDO_RESULT', matchId: undo.matchId }) }} />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Mode choice on the create form, mode label on the board**

`src/pickleball-open/CreateSessionApp.jsx`:

1. Add `import { ModePicker } from './components/ModePicker.jsx'` after the `HostLinkPanel` import.
2. Initial details state: `useState({ name: 'Open Play', hostDisplayName: '', courtCount: 4, target: 11, mode: 'PADDLE_STACK' })`.
3. In `start()`: `settings: { mode: details.mode, target: details.target, scoringStyle: 'SIDEOUT' },`.
4. Replace the whole `<Panel className="md:col-span-2"> … paddle stack … </Panel>` block with:

```jsx
          <Panel className="md:col-span-2">
            <p className="mb-3 font-semibold">Who plays next</p>
            <ModePicker value={details.mode} onChange={(mode) => update({ mode })} />
            <p className="mt-3 text-sm text-mist">You can switch any time during the session. Anyone who has sat out 2 rounds in a row goes on next, whichever you pick, and every proposed game can be edited before it starts.</p>
          </Panel>
```

`src/pickleball-open/components/ViewerBoard.jsx`:

1. Add `import { MODE_INFO } from '../../lib/pickleball/open/modes/info'` at the top.
2. Replace

```jsx
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {courtCount} court{courtCount === 1 ? '' : 's'}</p>
```

with

```jsx
          <p className="text-sm text-mist">Hosted by {viewer.hostDisplayName} · {courtCount} court{courtCount === 1 ? '' : 's'} · {MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}</p>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/pickleball-open && npm run lint && npm run typecheck`
Expected: PASS. Lint and typecheck report no errors.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker`
Expected: PASS, the whole file. The Phase 1 tests (including the 390/768/1280/1920 no-sideways-scroll checks) still pass with the wider header.

- [ ] **Step 8: Commit**

```markdown
- Open play host: choose how players are matched when creating a session (paddle stack, winners play winners, by standing, balanced teams, each explained in one line) and switch any time from the console; set keep-together/keep-apart rules; a fairness panel shows the games spread, longest wait and repeat partners; each player shows games, sit-outs and current wait, and skill can be set for balanced teams. The board shows the current mode.
```

```bash
git add src/pickleball-open tests/e2e/pickleball/open-play.spec.js CHANGELOG.md
git commit -m "feat(pickleball): pick and switch the stacking mode, pair rules and fairness panel"
```

---

### Task 9: Public pages: four ways to pick, rules and fairness, with a diagram per mode

**Files:**
- Create: `src/components/pickleball/art/WinnersShuffleArt.jsx`, `StandingWindowArt.jsx`, `BalancedSplitArt.jsx`
- Modify: `src/pages/pickleball/rotation.astro` (whole file below)
- Modify: `src/pages/pickleball/how-it-works.astro` (`steps` array and hero sentence)
- Modify: `src/pages/pickleball/index.astro` (`features` array)
- Modify: `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `MODE_INFO`, `MODE_ORDER`, `rotationExample(rounds, mode)` (Task 5).
- Produces: three decorative art components `({ className }) => <svg aria-hidden="true" …>`.

- [ ] **Step 1: Write the failing tests**

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`:

1. Rename the test title `claims only what Phase 1 ships (${path})` to `claims only shipped features (${path})`.
2. Remove `'winners vs winners'` from its banned list, so the list is `['tournament', 'bracket', 'dupr', 'captain', 'tv mode', 'sign in', 'opi', 'performance index', 'rally-by-rally', 'mexicano']`.
3. Add after the `the landing page pins its key promises` test:

```js
  test('the rotation page explains all four ways to pick the next game, each with a computed example', async ({ page }) => {
    await page.goto('/pickleball/rotation')
    for (const label of ['Paddle stack', 'Winners play winners', 'By standing', 'Balanced teams']) {
      const section = page.getByRole('region', { name: label })
      await expect(section).toBeVisible()
      await expect(section.getByRole('heading', { name: 'Round 1' })).toBeVisible()
    }
    const copy = await mainCopy(page)
    expect(copy).toContain('Keep-together and keep-apart rules are never broken')
    expect(copy).toContain('sat out 2 rounds in a row')
  })

  test('the guide and landing page describe the stacking modes and rules', async ({ page }) => {
    await page.goto('/pickleball/how-it-works')
    const guide = await mainCopy(page)
    for (const claim of ['Winners play winners', 'By standing', 'Balanced teams', 'Keep friends together']) expect(guide).toContain(claim)
    await page.goto('/pickleball')
    const landing = await mainCopy(page)
    for (const claim of ['winners play winners', 'Fairness you can see', 'Keep friends together']) expect(landing).toContain(claim)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js --project=worker -g "four ways|stacking modes and rules"`
Expected: FAIL, because the rotation page has no per-mode regions and the guide has no mode step.

- [ ] **Step 3: Write the three diagrams**

```jsx
// src/components/pickleball/art/WinnersShuffleArt.jsx
// Original, hand-authored SVG. Decorative. Two winning pairs (neon, violet)
// step onto one court split up, so each side has one player from each pair.
const PLAYERS = [
  { y: 50, fill: '#c6ff2e' },
  { y: 80, fill: '#8d9bff' },
  { y: 120, fill: '#c6ff2e' },
  { y: 150, fill: '#8d9bff' },
]

export default function WinnersShuffleArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <rect x="190" y="30" width="150" height="140" rx="8" fill="#3055d6" />
      <path d="M190 100h150" stroke="#fff" strokeWidth="3" />
      <rect x="200" y="40" width="130" height="120" stroke="#fff" strokeWidth="2" />
      <path d="M22 44v42M22 114v42" stroke="#7594fb" strokeWidth="2" strokeLinecap="round" />
      <path d="M58 44v42M58 114v42" stroke="#7594fb" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
      {PLAYERS.map(({ y, fill }, i) => (
        <g key={y} className="pb-step" style={{ animationDelay: `${i * 0.2}s`, '--pb-step-x': '200px' }}>
          <circle cx="40" cy={y} r="10" fill={fill} />
        </g>
      ))}
      <path d="M150 100h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/StandingWindowArt.jsx
// Original, hand-authored SVG. Decorative. A ladder of eight standings bars;
// a window of four neighbouring ranks lights up and plays together.
const BARS = [150, 136, 122, 108, 94, 80, 66, 52]

export default function StandingWindowArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      {BARS.map((width, i) => (
        <rect key={width} x="20" y={22 + i * 20} width={width} height="12" rx="6" fill={i >= 2 && i <= 5 ? '#c6ff2e' : '#3055d6'} />
      ))}
      <g className="pb-fade-cycle">
        <rect x="12" y="56" width="168" height="80" rx="10" stroke="#c6ff2e" strokeWidth="3" />
      </g>
      <path d="M192 96h30m-8-7 8 7-8 7" stroke="#c6ff2e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="236" y="40" width="110" height="112" rx="8" fill="#3055d6" />
      <path d="M236 96h110" stroke="#fff" strokeWidth="3" />
      <g className="pb-bob">
        <circle cx="266" cy="68" r="9" fill="#c6ff2e" />
        <circle cx="316" cy="68" r="9" fill="#c6ff2e" />
        <circle cx="266" cy="124" r="9" fill="#8d9bff" />
        <circle cx="316" cy="124" r="9" fill="#8d9bff" />
      </g>
    </svg>
  )
}
```

```jsx
// src/components/pickleball/art/BalancedSplitArt.jsx
// Original, hand-authored SVG. Decorative. A level scale: a strong and a
// newer player on each pan, so both teams weigh about the same.
export default function BalancedSplitArt({ className = '' }) {
  return (
    <svg viewBox="0 0 360 200" fill="none" className={className} aria-hidden="true">
      <path d="M180 60v110M140 172h80" stroke="#7594fb" strokeWidth="4" strokeLinecap="round" />
      <g className="pb-bob">
        <path d="M70 60h220" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <path d="M90 60l-30 50h60zM270 60l-30 50h60z" stroke="#7594fb" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="76" cy="96" r="13" fill="#c6ff2e" />
        <circle cx="104" cy="100" r="8" fill="#c6ff2e" />
        <circle cx="256" cy="100" r="8" fill="#8d9bff" />
        <circle cx="284" cy="96" r="13" fill="#8d9bff" />
      </g>
      <circle cx="180" cy="60" r="7" fill="#c6ff2e" />
    </svg>
  )
}
```

- [ ] **Step 4: Rewrite the rotation page**

```astro
---
// src/pages/pickleball/rotation.astro
import Layout from '../../layouts/Layout.astro'
import BalancedSplitArt from '../../components/pickleball/art/BalancedSplitArt.jsx'
import PaddleStackArt from '../../components/pickleball/art/PaddleStackArt.jsx'
import StandingWindowArt from '../../components/pickleball/art/StandingWindowArt.jsx'
import WinnersShuffleArt from '../../components/pickleball/art/WinnersShuffleArt.jsx'
import { loadPageSeo } from '../../lib/content/seo'
import { MODE_INFO, MODE_ORDER } from '../../lib/pickleball/open/modes/info'
import { rotationExample } from '../../lib/pickleball/open/rotationExample'
import '../../styles/pickleball-open.css'

// Every worked example below is computed by the real rotation engine when the
// page renders (spec §11), so it can never drift from what the app does.
const seo = await loadPageSeo('pickleball-rotation')
const ART = { PADDLE_STACK: PaddleStackArt, WINNERS_LOSERS: WinnersShuffleArt, BY_STANDING: StandingWindowArt, BALANCED: BalancedSplitArt }
const DETAIL = {
  PADDLE_STACK: 'The four who have played fewest games go on, longest wait first. The four are split so earlier partners are kept apart when another split allows it.',
  WINNERS_LOSERS: 'Each player carries the result of their last game. Four winners go on together, else four losers, else the rest. Two winning pairs are split up: each side gets one player from each pair, so last game’s partners face each other.',
  BY_STANDING: 'Players are ranked by today’s standings. The longest-waiting player and the three nearest in the table go on, the 1st and 4th of those four against the 2nd and 3rd.',
  BALANCED: 'The same four as paddle stack, split so each team’s skill adds up as evenly as possible. Skill is what the player or host entered, else today’s win rate. Repeat partners break ties.',
}
const modes = MODE_ORDER.map((mode) => ({ mode, ...MODE_INFO[mode], detail: DETAIL[mode], Art: ART[mode], rounds: rotationExample(2, mode) }))

const rules = [
  'Anyone who has sat out 2 rounds in a row goes on next, in every mode.',
  'Then each mode picks the rest of the four its own way (below).',
  'Keep-together and keep-apart rules are never broken: a court waits, and says why, rather than break one.',
  'A late arrival starts level with whoever has played least.',
  'The host can switch the mode at any time; it applies to the next game, never to one already on court.',
]
---
<Layout title="How fair rotation works: Devlab Pickleball" seo={seo}>
  <div class="mx-auto max-w-5xl px-4 py-10 md:py-16">
    <section class="grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
      <div>
        <p class="text-xs font-bold uppercase tracking-[0.14em] text-[#c6ff2e]">Rotation</p>
        <h1 class="mt-3 text-4xl font-bold leading-[1.1] text-white md:text-5xl">How fair rotation works</h1>
        <p class="mt-4 text-lg text-[#b5c4e1]">Whenever a court is free, the app picks the next four players with the same few rules, every time. The host chooses one of four ways to pick.</p>
      </div>
      <div class="pb-anim" data-testid="pb-artwork"><PaddleStackArt className="w-full" /></div>
    </section>

    <section class="mt-14" aria-labelledby="rules-heading">
      <h2 id="rules-heading" class="text-3xl font-bold text-white">The rules</h2>
      <ol class="mt-6 grid gap-3">
        {rules.map((rule, index) => (
          <li class="flex gap-4 rounded-2xl bg-[#11214d] p-5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#c6ff2e] font-bold text-[#0b1426]" aria-hidden="true">{index + 1}</span>
            <p class="self-center text-lg text-white">{rule}</p>
          </li>
        ))}
      </ol>
    </section>

    <section class="mt-14" aria-labelledby="modes-heading">
      <h2 id="modes-heading" class="text-3xl font-bold text-white">Four ways to pick the next game</h2>
      <p class="mt-3 max-w-2xl text-[#b5c4e1]">Each example is 14 players on 3 courts for two rounds, computed by the app's own engine. Twelve play each round and two sit out.</p>
      {modes.map(({ mode, label, summary, detail, Art, rounds }) => (
        <section class="mt-10 rounded-3xl border border-[#193480] p-5 md:p-8" aria-labelledby={`mode-${mode}`}>
          <div class="grid items-center gap-6 md:grid-cols-[1.4fr_1fr]">
            <div>
              <h3 id={`mode-${mode}`} class="text-2xl font-bold text-white">{label}</h3>
              <p class="mt-2 text-lg text-[#c6ff2e]">{summary}</p>
              <p class="mt-2 text-[#b5c4e1]">{detail}</p>
            </div>
            <div class="pb-anim mx-auto w-full max-w-[18rem]" data-testid="pb-artwork"><Art className="w-full" /></div>
          </div>
          <div class="mt-6 grid gap-4 sm:grid-cols-2">
            {rounds.map(({ round, courts, sittingOut }) => (
              <article class="rounded-2xl bg-[#0b1b34] p-4">
                <h4 class="text-lg font-bold text-white">Round {round}</h4>
                <ul class="mt-3 grid gap-2">
                  {courts.map(({ label: courtLabel, teamA, teamB, winner, score }) => (
                    <li class="rounded-xl bg-[#11214d] px-4 py-3 text-white">
                      <span class="block text-xs font-bold uppercase tracking-[0.1em] text-[#b5c4e1]">{courtLabel} · {score} to {winner === 'A' ? teamA.join(' & ') : teamB.join(' & ')}</span>
                      <span class="font-semibold text-[#c6ff2e]">{teamA.join(' & ')}</span>
                      <span class="text-[#b5c4e1]"> against </span>
                      <span class="font-semibold text-[#8d9bff]">{teamB.join(' & ')}</span>
                    </li>
                  ))}
                </ul>
                <p class="mt-3 text-[#b5c4e1]">Sitting out: {sittingOut.join(', ')}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
      <p class="mt-6 text-sm text-[#b5c4e1]">With up to 12 players per court, nobody sits out more than 2 rounds in a row, whichever way you pick. With more, the wait is shared evenly.</p>
    </section>

    <div class="mt-12">
      <a href="/pickleball/new" class="inline-flex min-h-12 items-center rounded-xl bg-[#4500ff] px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">Start a free session</a>
    </div>
  </div>
</Layout>
```

The heading order is h1 → h2 → h3 → h4 with no skipped level. Each mode's `<section aria-labelledby>` is the named `region` the e2e test looks up.

- [ ] **Step 5: Guide and landing copy**

`src/pages/pickleball/how-it-works.astro`: replace the `steps` array with

```js
const steps = [
  { title: 'Start a session', body: 'Open "Start a free session", name it, choose how many courts, what games go to (11, 15 or 21) and how players are matched. No account needed.' },
  { title: 'Choose who plays whom', body: 'Paddle stack puts whoever has played least on next. Winners play winners sends winners against winners and losers against losers, with last game’s partners split up. By standing matches players close in today’s standings. Balanced teams evens out skill. Switch any time from the console; the switch applies to the next game. Whichever you pick, anyone who has sat out 2 rounds in a row goes on next.' },
  { title: 'Add players', body: 'Paste your list or upload a CSV. Numbering, emoji and duplicates are removed.' },
  { title: 'Save your host link, share the board', body: 'Your host link controls the session; keep it. Show players the QR code for the view-only board.' },
  { title: 'Start the proposed game', body: 'Each free court shows the next four players. Tap Start, or tap Edit to swap anyone first. Players never belong to a court: whichever court frees first gets the next match.' },
  { title: 'Tap the result', body: 'When a game ends, tap Game over, pick the winner and the losing score. The winning score fills in, and the court gets its next match.' },
  { title: 'Late arrivals and breaks', body: 'Add players any time; they start level with whoever has played least. Put someone on a break and they are skipped until you bring them back.' },
  { title: 'Keep friends together, or apart', body: 'On the Players tab, set two players to always partner, or never share a court. Every way of matching keeps it; if no game fits, the court waits and says why. The fairness panel shows the games spread, the longest wait and repeat partners as you go.' },
  { title: 'Fix a mistake', body: 'Undo a save for 2 minutes, or edit any result later. Standings update straight away.' },
  { title: 'Finish up', body: 'End the session and download the results as a CSV. Everything is deleted 7 days after the last change, or delete it yourself any time.' },
]
```

and replace `Eight steps, from an empty session to downloaded results.` with `{steps.length} steps, from an empty session to downloaded results.`

`src/pages/pickleball/index.astro`: replace the `features` array with

```js
const features = [
  { title: 'Fair rotation, your way', body: 'Paddle stack (fewest games first), winners play winners, by standing or balanced teams. Pick one when you start and switch any time; whichever you pick, anyone who has sat out 2 rounds in a row goes on next.' },
  { title: 'Fairness you can see', body: 'The console shows the spread of games played, the longest current wait and how often partners repeat, live.' },
  { title: 'Keep friends together', body: 'Set two players to always partner, or never share a court. Every rotation keeps it, or the court waits and says why.' },
  { title: 'One person, every court', body: 'Up to 16 courts on one screen. Any proposed game can be edited before it starts, and a wrong score can be undone or fixed.' },
  { title: 'Free, with no sign-up', body: 'No accounts for the host or the players. Your host link is your key; the board link is view-only.' },
  { title: 'Private by default', body: 'Sessions are deleted from the live service 7 days after the last change to them. Download the results as a spreadsheet any time before then.' },
]
```

The landing copy contains "fewest games" (pinned by `the landing page pins its key promises`), and no page uses "vs".

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && npx playwright test tests/e2e/pickleball/pickleball-public-pages.spec.js --project=worker`
Expected: PASS, including these existing checks:
- the art guards: every `pb-artwork` SVG is `aria-hidden`, and no art ships JavaScript;
- reduced motion stops all animation;
- no horizontal scroll at 390 px;
- no comparative language on the guide.

- [ ] **Step 7: Commit**

```markdown
- Pickleball pages: the rotation page explains all four ways to pick the next game, each with a diagram and a two-round example computed by the real engine; the guide and landing page describe the modes, keep-together/keep-apart rules and the fairness panel.
```

```bash
git add src/components/pickleball/art src/pages/pickleball tests/e2e/pickleball/pickleball-public-pages.spec.js CHANGELOG.md
git commit -m "feat(pickleball): explain the four stacking modes on the public pages"
```

---
### Task 10: QR self check-in

**Files:**
- Create: `src/lib/pickleball/open/checkIn.ts`, `src/lib/pickleball/open/checkIn.test.ts`
- Create: `src/lib/schemas/pickleball/open/checkIn.ts`
- Modify: `src/worker/pickleball/open/OpenSessionDO.ts`, `src/worker/pickleball/open/routeHelpers.ts`
- Create: `src/pages/api/pickleball/open/s/[code]/check-in.ts`
- Create: `src/pages/pickleball/s/[code]/check-in.astro`, `src/pickleball-open/CheckInApp.jsx`
- Create: `src/pickleball-open/lib/me.js`, `src/pickleball-open/lib/me.test.js`, `src/pickleball-open/components/ShareSheet.jsx`
- Modify: `src/pickleball-open/lib/hostKeys.js`, `src/pickleball-open/lib/hostKeys.test.js`, `src/pickleball-open/lib/api.js`, `src/pickleball-open/components/QrCode.jsx`, `ViewerBoard.jsx`, `HostConsole.jsx`, `src/pickleball-open/CreateSessionApp.jsx`
- Modify: `src/pages/pickleball/how-it-works.astro`, `src/pages/pickleball/index.astro`
- Modify: `tests/e2e/pickleball/open-play.spec.js`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `minActiveGames`, `returnLevel` (Task 6), `cleanName` (Phase 1), `settings.selfCheckIn` (Task 1), `SET_SELF_CHECK_IN` (Task 6), `viewer.settings.selfCheckIn` (Task 7).
- Produces:
  - `interface CheckInEntry { name: string; skill: number | null; duprId: string | null }`.
  - `applyCheckIn(state, entry, ctx): CheckInResult`, where `CheckInResult` is either `{ ok: true; state; playerId; name; alreadyCheckedIn }` or `{ ok: false; status: 400 | 403 | 409; error }`.
  - `checkInSchema`.
  - DO method `checkIn(code, body: unknown): Promise<DoResult<CheckInBody>>`, with `CheckInBody = { playerId; name; alreadyCheckedIn }`. It returns 201 when added and 200 when already on the list.
  - `checkInIpLimited(env, request)`.
  - Route `POST /api/pickleball/open/s/{code}/check-in`; page `/pickleball/s/{code}/check-in`.
  - Client: `checkInLink(origin, code)`, `checkIn(code, body)`, `readMe(code)` / `writeMe(code, playerId)`, `ShareSheet({ code, selfCheckIn, onToggleCheckIn, onClose })`, `QrCode` gains a `label` prop.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/checkIn.test.ts
import { describe, expect, it } from 'vitest'
import { applyCheckIn } from './checkIn'
import { at, finished, player, sessionState } from './testing/fixtures'
import { DEFAULT_SETTINGS, LIMITS } from './types'

const ctx = { now: at(30), newId: () => 'new-player' }

describe('applyCheckIn', () => {
  it('adds a player level with whoever has played least, with their skill and DUPR ID', () => {
    const state = sessionState({
      players: [player('a', { position: 1 }), player('b', { position: 2 })],
      matches: [finished('m1', ['a', 'x'], ['y', 'z'], 'A', 11, 3)],
    })
    const result = applyCheckIn(state, { name: '  2. Ana 🎾 ', skill: 4, duprId: 'ab12c3' }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'new-player', name: 'Ana', alreadyCheckedIn: false })
    if (!result.ok) return
    expect(result.state.players.at(-1)).toMatchObject({ name: 'Ana', skill: 4, duprId: 'AB12C3', gamesOffset: 0, position: 3, status: 'ACTIVE' })
  })

  it('a second check-in under the same name (any case) changes nothing', () => {
    const state = sessionState({ players: [player('a', { name: 'Ana' })] })
    const result = applyCheckIn(state, { name: 'ANA', skill: null, duprId: null }, ctx)
    expect(result).toMatchObject({ ok: true, playerId: 'a', name: 'Ana', alreadyCheckedIn: true })
    expect(result.ok && result.state).toBe(state)
  })

  it('brings a player back from a break or after leaving, without touching their details', () => {
    const state = sessionState({ players: [player('a', { name: 'Ana', status: 'LEFT', skill: 2 })] })
    const result = applyCheckIn(state, { name: 'ana', skill: 5, duprId: null }, ctx)
    expect(result.ok && result.state.players[0]).toMatchObject({ status: 'ACTIVE', skill: 2, waitingSince: at(30) })
  })

  it('refuses when check-in is off, the session ended, the name is empty, or values are out of range', () => {
    const base = sessionState()
    expect(applyCheckIn({ ...base, settings: { ...DEFAULT_SETTINGS, selfCheckIn: false } }, { name: 'Ana', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 403 })
    expect(applyCheckIn({ ...base, status: 'ENDED' }, { name: 'Ana', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 409 })
    expect(applyCheckIn(base, { name: '🎾 ', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400, error: 'Enter your name.' })
    expect(applyCheckIn(base, { name: 'Ana', skill: 6, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400 })
    expect(applyCheckIn(base, { name: 'Ana', skill: 2.5, duprId: null }, ctx)).toMatchObject({ ok: false, status: 400 })
    expect(applyCheckIn(base, { name: 'Ana', skill: null, duprId: 'ABC' }, ctx)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a new name once the session is full', () => {
    const full = sessionState({ players: Array.from({ length: LIMITS.maxPlayers }, (_, i) => player(`p${i}`)) })
    expect(applyCheckIn(full, { name: 'Late', skill: null, duprId: null }, ctx)).toMatchObject({ ok: false, status: 409, error: 'This session is full.' })
  })
})
```

```js
// src/pickleball-open/lib/me.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMe, writeMe } from './me'

describe('me', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('remembers the picked player per session code', () => {
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    writeMe('ABCDE23456', 'p1')
    expect(readMe('ABCDE23456')).toBe('p1')
    expect(readMe('ZZZZZ22222')).toBe('')
  })

  it('never throws when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    expect(() => writeMe('ABCDE23456', 'p1')).not.toThrow()
    expect(readMe('ABCDE23456')).toBe('')
  })
})
```

Add to `src/pickleball-open/lib/hostKeys.test.js` (import `checkInLink` too):

```js
  it('builds the check-in link from the public code', () => {
    expect(checkInLink('https://x.test', 'ABCDE23456')).toBe('https://x.test/pickleball/s/ABCDE23456/check-in')
  })
```

Append to `tests/e2e/pickleball/open-play.spec.js`:

```js
test.describe('self check-in', () => {
  function selfCheckIn(request, code, data, ip = freshIp()) {
    return request.post(`/api/pickleball/open/s/${code}/check-in`, { headers: { 'cf-connecting-ip': ip }, data })
  }

  test('a player checks in once, a repeat is harmless, and the host can close check-in', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const first = await selfCheckIn(request, code, { name: ' 🎾 Zoe ', skill: 3, duprId: 'ab12c3' })
    expect(first.status()).toBe(201)
    const body = await first.json()
    expect(body).toMatchObject({ name: 'Zoe', alreadyCheckedIn: false })
    const again = await selfCheckIn(request, code, { name: 'ZOE' })
    expect(again.status()).toBe(200)
    expect(await again.json()).toMatchObject({ playerId: body.playerId, alreadyCheckedIn: true })
    expect((await selfCheckIn(request, code, { name: 'Yan', skill: 9 })).status()).toBe(400)

    const viewer = await (await request.get(`/api/pickleball/open/s/${code}/state`)).json()
    expect(viewer.roster.filter((p) => p.name === 'Zoe')).toHaveLength(1)
    expect(JSON.stringify(viewer)).not.toContain('AB12C3')

    expect((await command(request, code, hostKey, { type: 'SET_SELF_CHECK_IN', enabled: false })).status()).toBe(200)
    expect((await selfCheckIn(request, code, { name: 'Yuri' })).status()).toBe(403)
  })

  test('a session created with check-in off refuses it', async ({ request }) => {
    const { code } = await createSession(request, { settings: { mode: 'PADDLE_STACK', target: 11, scoringStyle: 'SIDEOUT', selfCheckIn: false } })
    expect((await selfCheckIn(request, code, { name: 'Zoe' })).status()).toBe(403)
  })

  test('a flood of check-ins into one session is cut off, even from many addresses', async ({ request }) => {
    const { code } = await createSession(request)
    const statuses = []
    for (let i = 0; i < 61; i += 1) statuses.push((await selfCheckIn(request, code, { name: `Walk-in ${i}` })).status())
    expect(statuses.slice(0, 60).every((s) => s === 201)).toBe(true)
    expect(statuses[60]).toBe(429)
  })

  test('the check-in page adds the player, and the board then knows who they are', async ({ page, request }) => {
    const { code } = await createSession(request)
    const ip = freshIp()
    await page.route('**/api/pickleball/open/s/*/check-in', (route) =>
      route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }))
    await page.goto(`/pickleball/s/${code}`)
    await page.getByRole('link', { name: 'Not on the list? Check in' }).click()
    await page.getByLabel('Your name').fill('Zoe')
    await page.getByLabel('Skill (optional)').selectOption('3')
    await page.getByRole('button', { name: 'Check in' }).click()
    await expect(page.getByRole('heading', { name: "You're in, Zoe." })).toBeVisible()
    await page.getByRole('link', { name: 'See the board' }).click()
    await expect(page.getByLabel("I'm…").locator('option:checked')).toHaveText('Zoe')
  })

  test('the host shares a check-in QR and can turn check-in off from the share sheet', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'Share board' }).click()
    const sheet = page.getByRole('dialog', { name: 'Share' })
    await expect(sheet.getByRole('img', { name: 'QR code for self check-in' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Turn self check-in off' }).click()
    await expect(sheet.getByText('Self check-in is off. Only you can add players.')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/checkIn.test.ts src/pickleball-open/lib`
Expected: FAIL. `./checkIn`, `./me` and `checkInLink` don't exist.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker -g "self check-in"`
Expected: FAIL, because `/check-in` returns 404.

- [ ] **Step 3: Write the engine piece and the schema**

```ts
// src/lib/pickleball/open/checkIn.ts
// QR self check-in (spec §4.2): an anonymous player adds themselves. The same
// cleaning as a pasted roster applies, and nothing here can touch anyone else
// beyond bringing a player with the same name back from a break.
import { minActiveGames, returnLevel } from './reducer'
import { cleanName } from './roster'
import { LIMITS, type CommandContext, type OpenPlayer, type OpenSessionState } from './types'

export interface CheckInEntry {
  name: string
  skill: number | null
  duprId: string | null
}

export type CheckInResult =
  | { ok: true; state: OpenSessionState; playerId: string; name: string; alreadyCheckedIn: boolean }
  | { ok: false; status: 400 | 403 | 409; error: string }

const DUPR_ID = /^[A-Z0-9]{6}$/

export function applyCheckIn(state: OpenSessionState, entry: CheckInEntry, ctx: CommandContext): CheckInResult {
  if (!state.settings.selfCheckIn) return { ok: false, status: 403, error: 'Check-in is closed for this session. Ask the host to add you.' }
  if (state.status === 'ENDED') return { ok: false, status: 409, error: 'This session has ended.' }
  const name = cleanName(entry.name)
  if (!name) return { ok: false, status: 400, error: 'Enter your name.' }
  if (entry.skill !== null && !(Number.isInteger(entry.skill) && entry.skill >= 1 && entry.skill <= 5)) {
    return { ok: false, status: 400, error: 'Skill is a whole number from 1 to 5.' }
  }
  const duprId = entry.duprId ? entry.duprId.trim().toUpperCase() : null
  if (duprId !== null && !DUPR_ID.test(duprId)) return { ok: false, status: 400, error: 'A DUPR ID is 6 letters or digits.' }

  const existing = state.players.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (existing?.status === 'ACTIVE') return { ok: true, state, playerId: existing.id, name: existing.name, alreadyCheckedIn: true }
  if (existing) return { ok: true, state: returnLevel(state, existing, ctx), playerId: existing.id, name: existing.name, alreadyCheckedIn: false }
  if (state.players.length >= LIMITS.maxPlayers) return { ok: false, status: 409, error: 'This session is full.' }

  const added: OpenPlayer = {
    id: ctx.newId(), name, skill: entry.skill, duprId, status: 'ACTIVE',
    gamesOffset: minActiveGames(state), joinedAt: ctx.now, waitingSince: ctx.now,
    position: state.players.reduce((max, p) => Math.max(max, p.position), 0) + 1,
  }
  return { ok: true, state: { ...state, players: [...state.players, added] }, playerId: added.id, name, alreadyCheckedIn: false }
}
```

```ts
// src/lib/schemas/pickleball/open/checkIn.ts
import { z } from 'zod'

// Anonymous input: shapes only. Names are cleaned, and skill and DUPR ID
// checked with friendly messages, by applyCheckIn (checkIn.ts).
export const checkInSchema = z.object({
  name: z.string().max(200),
  skill: z.number().nullable().optional(),
  duprId: z.string().max(20).nullable().optional(),
})
```

- [ ] **Step 4: Wire the DO, the route and the per-IP limit**

`src/worker/pickleball/open/OpenSessionDO.ts`:

Add the imports next to the existing ones:

```ts
import { checkInSchema } from '../../../lib/schemas/pickleball/open/checkIn'
import { applyCheckIn } from '../../../lib/pickleball/open/checkIn'
```

After the `COMMAND_WINDOW_MS` constant, add:

```ts
// Self check-in is anonymous: 60 per 5 minutes per session caps a flood of
// junk names well before the 128-player cap, while a real crowd arriving at
// once still fits (the route also limits each address).
const CHECK_IN_LIMIT = 60
const CHECK_IN_WINDOW_MS = 5 * 60_000

export interface CheckInBody { playerId: string; name: string; alreadyCheckedIn: boolean }
```

After `private commandTimes: number[] = []`, add the field and its limiter:

```ts
  private checkInTimes: number[] = []

  /** Counts one check-in attempt; returns the seconds to wait when over the per-session limit. */
  private checkInRetryAfter(nowMs: number): number {
    this.checkInTimes = this.checkInTimes.filter((t) => t > nowMs - CHECK_IN_WINDOW_MS)
    if (this.checkInTimes.length >= CHECK_IN_LIMIT) {
      return Math.max(1, Math.ceil((this.checkInTimes[0] + CHECK_IN_WINDOW_MS - nowMs) / 1000))
    }
    this.checkInTimes = [...this.checkInTimes, nowMs]
    return 0
  }
```

After the `command(...)` method, add:

```ts
  async checkIn(code: string, body: unknown): Promise<DoResult<CheckInBody>> {
    return this.serial(async () => {
      const parsed = checkInSchema.safeParse(body)
      if (!parsed.success) return { status: 400, body: { error: 'Check your details and try again.' } }
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const retryAfterSeconds = this.checkInRetryAfter(Date.now())
      if (retryAfterSeconds > 0) return { status: 429, body: { error: 'Lots of people are checking in. Try again in a minute.' }, retryAfterSeconds }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID() }
      const entry = { name: parsed.data.name, skill: parsed.data.skill ?? null, duprId: parsed.data.duprId ?? null }
      const result = applyCheckIn(loaded.state, entry, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }
      const answer = { playerId: result.playerId, name: result.name, alreadyCheckedIn: result.alreadyCheckedIn }
      if (result.alreadyCheckedIn) return { status: 200, body: answer }

      const next = finalizeCommand(result.state, ctx)
      await persistDiff(this.env.PICKLEBALL_DB, loaded.state, next, null)
      this.loaded = { ...loaded, state: next }
      this.broadcast()
      return { status: 201, body: answer }
    })
  }
```

`src/worker/pickleball/open/routeHelpers.ts`, append:

```ts
/**
 * Self check-in is anonymous, so each address is limited before the DO is
 * reached. 30 per 10 minutes, not fewer: a whole venue often shares one
 * address on its Wi-Fi. The DO adds a per-session cap on top.
 */
export async function checkInIpLimited(env: Env, request: Request): Promise<Response | null> {
  const rate = await checkRateLimit(env, 'open-checkin-ip', clientIp(request), { limit: 30, windowMs: 10 * 60_000 })
  return rate.limited ? rateLimitedResponse('Too many check-ins from this network. Try again in a few minutes.', rate.retryAfterSeconds) : null
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/check-in.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { checkInIpLimited, codeFrom, doResponse, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await checkInIpLimited(env, request)
    if (limited) {
      await request.arrayBuffer().catch(() => {})
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    return doResponse(await openSessionStub(env, code).checkIn(code, body))
  } catch (error) {
    return openErrorResponse(error, 'check-in')
  }
}
```

- [ ] **Step 5: Write the check-in page and the client pieces**

```astro
---
// src/pages/pickleball/s/[code]/check-in.astro
import PickleballAppShell from '../../../../layouts/PickleballAppShell.astro'
import CheckInApp from '../../../../pickleball-open/CheckInApp.jsx'
import { normalizePublicCode } from '../../../../lib/pickleball/open/codes'

const code = normalizePublicCode(Astro.params.code ?? '') ?? ''
---
<PickleballAppShell title="Check in — Devlab Pickleball">
  <CheckInApp code={code} client:only="react" />
</PickleballAppShell>
```

```jsx
// src/pickleball-open/CheckInApp.jsx
// QR self check-in (spec §4.2). Anonymous: a player types their own name and,
// if they like, a skill from 1 to 5 and a DUPR ID. Nothing but the name is required.
import { useState } from 'react'
import { checkIn } from './lib/api'
import { writeMe } from './lib/me'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import { Button, Panel } from './components/ui.jsx'

const field = 'w-full rounded-xl border border-navy-700 bg-navy-900 px-3 py-3 text-base text-white placeholder:text-mist/70 focus:border-pickle-neon focus:outline-none'
const MESSAGES = {
  403: 'Check-in is closed for this session. Ask the host to add you.',
  404: 'This session has ended or the link is wrong.',
  429: 'Lots of people are checking in right now. Try again in a minute.',
}

export default function CheckInApp({ code }) {
  const [form, setForm] = useState({ name: '', skill: '', duprId: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const update = (patch) => setForm((current) => ({ ...current, ...patch }))

  async function submit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await checkIn(code, {
        name: form.name,
        skill: form.skill ? Number(form.skill) : null,
        duprId: form.duprId.trim() || null,
      })
      writeMe(code, result.playerId)
      setDone(result)
    } catch (failure) {
      setError(MESSAGES[failure?.status] ?? (failure instanceof Error && failure.message ? failure.message : 'Something went wrong. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!code) return <ExpiredNotice />

  if (done) {
    return (
      <main className="mx-auto grid max-w-md gap-4 px-4 py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Checked in</p>
        <h1 className="text-3xl font-bold">{done.alreadyCheckedIn ? `${done.name} is already on the list.` : `You're in, ${done.name}.`}</h1>
        <p className="text-mist">The board shows when you're up. This phone remembers it's you.</p>
        <a href={`/pickleball/s/${code}`} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-lg font-bold text-white hover:bg-[#3a00d6]">See the board</a>
      </main>
    )
  }

  return (
    <main className="mx-auto grid max-w-md gap-5 px-4 py-10">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Open play</p>
        <h1 className="mt-2 text-3xl font-bold">Check in</h1>
        <p className="mt-1 text-mist">Type the name you want on the board. First names or nicknames are fine: the board is public.</p>
      </div>
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-sm text-mist">Your name
          <input required maxLength={40} autoComplete="given-name" className={field} value={form.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <Panel className="grid gap-3">
          <label className="grid gap-1.5 text-sm text-mist">Skill (optional)
            <select className={field} value={form.skill} onChange={(e) => update({ skill: e.target.value })}>
              <option value="">Skip</option>
              <option value="1">1 · New to the game</option>
              <option value="2">2 · Beginner</option>
              <option value="3">3 · Intermediate</option>
              <option value="4">4 · Advanced</option>
              <option value="5">5 · Expert</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm text-mist">DUPR ID (optional)
            <input maxLength={6} autoCapitalize="characters" className={`${field} font-mono uppercase`} value={form.duprId} onChange={(e) => update({ duprId: e.target.value })} />
          </label>
          <p className="text-xs text-mist">Only the host sees these. They are deleted with the session.</p>
        </Panel>
        {error && <p role="alert" className="rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
        <Button type="submit" variant="primary" className="text-lg" disabled={busy || !form.name.trim()}>{busy ? 'Checking in…' : 'Check in'}</Button>
      </form>
    </main>
  )
}
```

```js
// src/pickleball-open/lib/me.js
// "I'm …" on the board, remembered per session on this phone only (spec §7).
// Shared by the board and the check-in page, which sets it for the player.
const ME_KEY = (code) => `devlab-pickleball-me:${code}`

export function readMe(code) {
  try {
    return globalThis.localStorage?.getItem(ME_KEY(code)) ?? ''
  } catch {
    return ''
  }
}

export function writeMe(code, playerId) {
  try {
    globalThis.localStorage?.setItem(ME_KEY(code), playerId)
  } catch {
    // optional convenience: the board still works without it
  }
}
```

```jsx
// src/pickleball-open/components/ShareSheet.jsx
import { formatPublicCode } from '../../lib/pickleball/open/codes'
import { checkInLink, viewerLink } from '../lib/hostKeys'
import QrCode from './QrCode.jsx'
import { Button, Sheet } from './ui.jsx'

/** The board QR, and the check-in QR while self check-in is on (spec §4.2, §7). */
export default function ShareSheet({ code, selfCheckIn, onToggleCheckIn, onClose }) {
  const origin = window.location.origin
  return (
    <Sheet title="Share" onClose={onClose}>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col items-center gap-3 text-center">
          <h3 className="font-bold">Player board</h3>
          <QrCode url={viewerLink(origin, code)} size={200} />
          <p className="text-2xl font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
          <p className="text-sm text-mist">Players scan this to follow courts and standings. It can't change anything.</p>
        </div>
        <div className="flex flex-col items-center gap-3 text-center">
          <h3 className="font-bold">Check in</h3>
          {selfCheckIn ? (
            <>
              <QrCode url={checkInLink(origin, code)} size={200} label="QR code for self check-in" />
              <p className="text-sm text-mist">New arrivals scan this and type their own name. They join level with whoever has played least.</p>
            </>
          ) : (
            <p className="text-sm text-mist">Self check-in is off. Only you can add players.</p>
          )}
          <Button variant={selfCheckIn ? 'ghost' : 'neon'} onClick={onToggleCheckIn}>
            {selfCheckIn ? 'Turn self check-in off' : 'Turn self check-in on'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
```

`src/pickleball-open/lib/hostKeys.js`, append:

```js
export function checkInLink(origin, code) {
  return `${origin}/pickleball/s/${code}/check-in`
}
```

`src/pickleball-open/lib/api.js`, append:

```js
export async function checkIn(code, body) {
  return parse(await fetch(`${base(code)}/check-in`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }))
}
```

`src/pickleball-open/components/QrCode.jsx`: change the signature to `export default function QrCode({ url, size = 176, label = 'QR code for the player board' })`, and `aria-label="QR code for the player board"` to `aria-label={label}`.

`src/pickleball-open/components/ViewerBoard.jsx`:
1. Replace the local `ME_KEY`, `readMe` and `writeMe` definitions (lines 7–14) with `import { readMe, writeMe } from '../lib/me'` among the imports.
2. Directly after the `Hosted by …` paragraph, add:

```jsx
          {viewer.settings.selfCheckIn && viewer.status === 'ACTIVE' && (
            <a href={`/pickleball/s/${viewer.code}/check-in`} className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-pickle-neon underline underline-offset-4">Not on the list? Check in</a>
          )}
```

`src/pickleball-open/components/HostConsole.jsx`:
1. Delete `import { formatPublicCode } from '../../lib/pickleball/open/codes'` and `import QrCode from './QrCode.jsx'`.
2. Change `import { forgetHostedSession, viewerLink } from '../lib/hostKeys'` to `import { forgetHostedSession } from '../lib/hostKeys'`.
3. Change `import { Button, Panel, Sheet } from './ui.jsx'` to `import { Button, Panel } from './ui.jsx'`.
4. Add `import ShareSheet from './ShareSheet.jsx'`.
5. Replace the whole `{dialog?.type === 'share' && ( <Sheet title="Player board" …> … </Sheet> )}` block with:

```jsx
      {dialog?.type === 'share' && (
        <ShareSheet code={code} selfCheckIn={host.settings.selfCheckIn} onClose={() => setDialog(null)}
          onToggleCheckIn={() => send({ type: 'SET_SELF_CHECK_IN', enabled: !host.settings.selfCheckIn })} />
      )}
```

`src/pickleball-open/CreateSessionApp.jsx`:
1. Initial details state: add `selfCheckIn: true`.
2. In `start()`: `settings: { mode: details.mode, target: details.target, scoringStyle: 'SIDEOUT', selfCheckIn: details.selfCheckIn },`.
3. Right after the "Who plays next" `Panel`, add:

```jsx
          <label className="flex min-h-11 items-center gap-3 md:col-span-2">
            <input type="checkbox" className="h-5 w-5 accent-[#c6ff2e]" checked={details.selfCheckIn} onChange={(e) => update({ selfCheckIn: e.target.checked })} />
            <span>Let players check themselves in by QR <span className="text-sm text-mist">(you can turn this off any time)</span></span>
          </label>
```

- [ ] **Step 6: Guide and landing copy**

`src/pages/pickleball/how-it-works.astro`, in `steps`, replace the `Add players` entry with:

```js
  { title: 'Add players', body: 'Paste your list or upload a CSV. Numbering, emoji and duplicates are removed. Or show the check-in QR from Share: players type their own name, and a skill if they like, and join level with whoever has played least. Turn check-in off any time.' },
```

`src/pages/pickleball/index.astro`, in `steps`, replace the first entry's `body` with:

```js
'Paste a list from Reclub, WhatsApp or anywhere, or let players check themselves in by QR. Numbering, emoji and duplicates are cleaned up for you. Late arrivals can join any time.'
```

Neither mentions DUPR (still banned on public pages until Phase 4).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run && npm run lint && npm run typecheck`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball --project=worker`
Expected: PASS: the self check-in tests, the public-page copy guards, and everything earlier.

- [ ] **Step 8: Commit**

```markdown
- Open play: QR self check-in. Players scan a check-in code and type their own name (optional skill 1–5 and DUPR ID, seen only by the host) and join level with whoever has played least; the same name twice is one player. The host can turn it off from Share or at creation. Limited to 30 per 10 minutes per address and 60 per 5 minutes per session.
```

```bash
git add src tests/e2e/pickleball CHANGELOG.md
git commit -m "feat(pickleball): qr self check-in for open play"
```

---

### Task 11: Court captains, server side

**Files:**
- Create: `src/lib/pickleball/open/captains.ts`, `src/lib/pickleball/open/captains.test.ts`
- Create: `src/lib/schemas/pickleball/open/captains.ts`
- Modify: `src/worker/pickleball/open/OpenSessionDO.ts` (whole file below)
- Modify: `src/worker/pickleball/open/routeHelpers.ts`
- Modify: `src/pages/api/pickleball/open/s/[code]/commands.ts`
- Create: `src/pages/api/pickleball/open/s/[code]/captain.ts`, `src/pages/api/pickleball/open/s/[code]/captains.ts`, `src/pages/api/pickleball/open/s/[code]/captains/[captainId].ts`
- Modify: `tests/e2e/pickleball/open-play.spec.js`, `CHANGELOG.md`

**Interfaces:**
- Consumes:
  - `CaptainRecord`, `LoadedSession`, `insertCaptain`, `revokeCaptain`, `touch` (Task 1);
  - `toCaptainSnapshot`, `toHostSnapshot(state, captains)` (Task 7);
  - `applyCheckIn` (Task 10);
  - `constantTimeEqual` (Phase 1), `randomBase64Url`, `sha256Base64Url` (`webCrypto.js`).
- Produces:
  - `CAPTAIN_COMMANDS`;
  - `captainRefusal(command, captain, state): string | null`;
  - `captainLabel(state, courtId, existing, requested?): string`;
  - `findCaptain(captains, keyHash): CaptainRecord | null`;
  - `createCaptainSchema`.
  - DO:
    - `interface Credentials { hostKey: string | null; captainKey: string | null }`;
    - `command(code, credentials: Credentials, envelope)` answers `{ version, host? , captain? }`;
    - `captain(code, captainKey)`;
    - `createCaptain(code, hostKey, body)` returns 201 `{ captainId, label, captainKey, host }`;
    - `revokeCaptain(code, hostKey, captainId)` returns 200 `{ revoked: true, host }`.
  - WebSocket: `{type:'AUTH', captainKey}` answers `{type:'CAPTAIN', payload}`; on revoke the socket gets `{type:'CAPTAIN_REVOKED'}` and then viewer snapshots.
  - Routes:
    - `GET …/captain` (`X-Captain-Key`);
    - `POST …/captains` (`X-Host-Key`, body `{ courtId, label? }`);
    - `DELETE …/captains/{captainId}` (`X-Host-Key`);
    - `POST …/commands` accepts `X-Captain-Key`.
  - `captainKeyFrom(request)`, `credentialsFrom(request)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/pickleball/open/captains.test.ts
import { describe, expect, it } from 'vitest'
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { captainLabel, captainRefusal, findCaptain } from './captains'
import { court, finished, sessionState } from './testing/fixtures'
import type { CaptainRecord, OpenMatch } from './types'

const captain: CaptainRecord = { id: 'cap1', label: 'Court 1 captain', courtId: 'c1', keyHash: 'hash-1', createdAt: '2026-10-11T10:00:00.000Z' }
const onC1: OpenMatch = { ...finished('m1', ['a', 'b'], ['c', 'd'], 'A', null, null), status: 'PROPOSED', winner: null, finishedAt: null, recordedBy: null }
const onC2: OpenMatch = { ...onC1, id: 'm2', courtId: 'c2' }
const state = sessionState({ courts: [court('c1', 1), court('c2', 2)], matches: [onC1, onC2] })

describe('captainRefusal', () => {
  it('lets a captain start, edit, skip and score their own court', () => {
    for (const command of [
      { type: 'START_MATCH', matchId: 'm1' },
      { type: 'SKIP_PROPOSAL', matchId: 'm1' },
      { type: 'EDIT_PROPOSAL', matchId: 'm1', teamA: ['a', 'b'], teamB: ['c', 'd'] },
      { type: 'RECORD_RESULT', matchId: 'm1', winner: 'A', scoreA: 11, scoreB: 2 },
      { type: 'UNDO_RESULT', matchId: 'm1' },
      { type: 'EDIT_RESULT', matchId: 'm1', winner: 'B', scoreA: 2, scoreB: 11 },
    ] satisfies OpenCommand[]) {
      expect(captainRefusal(command, captain, state), command.type).toBeNull()
    }
  })

  it('refuses another court', () => {
    expect(captainRefusal({ type: 'START_MATCH', matchId: 'm2' }, captain, state)).toBe('This captain link only runs Court 1.')
  })

  it('refuses every host-only command', () => {
    for (const command of [
      { type: 'END_SESSION' },
      { type: 'ADD_PLAYERS', names: ['Zed'] },
      { type: 'SET_MODE', mode: 'BALANCED' },
      { type: 'ABANDON_MATCH', matchId: 'm1' },
      { type: 'SET_PLAYER_STATUS', playerId: 'a', status: 'LEFT' },
      { type: 'ADD_RULE', rule: { kind: 'APART', playerIds: ['a', 'b'] } },
      { type: 'SET_SELF_CHECK_IN', enabled: false },
    ] satisfies OpenCommand[]) {
      expect(captainRefusal(command, captain, state), command.type).toBe('Only the host can do that.')
    }
  })
})

describe('captainLabel / findCaptain', () => {
  it('names links after their court and numbers a second one', () => {
    expect(captainLabel(state, 'c1', [])).toBe('Court 1 captain')
    expect(captainLabel(state, 'c1', [captain])).toBe('Court 1 captain 2')
    expect(captainLabel(state, 'c1', [], '  Maria\u0007 ')).toBe('Maria')
  })

  it('finds a captain by key hash only', () => {
    expect(findCaptain([captain], 'hash-1')).toBe(captain)
    expect(findCaptain([captain], 'hash-2')).toBeNull()
    expect(findCaptain([], 'hash-1')).toBeNull()
  })
})
```

Append to `tests/e2e/pickleball/open-play.spec.js`:

```js
test.describe('court captains (API)', () => {
  async function makeCaptain(request, code, hostKey, courtId) {
    const response = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId } })
    expect(response.status()).toBe(201)
    return response.json()
  }
  function asCaptain(request, code, captainKey, cmd) {
    return request.post(`/api/pickleball/open/s/${code}/commands`, {
      headers: { 'X-Captain-Key': captainKey },
      data: { idempotencyKey: crypto.randomUUID(), command: cmd },
    })
  }

  test('a captain runs their own court and nothing else, and a second save says who saved it', async ({ request }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const [court1, court2] = host.courts
    const { captainKey, label } = await makeCaptain(request, code, hostKey, court1.id)
    expect(label).toBe('Court 1 captain')
    expect((await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: court1.match.id })).status()).toBe(200)

    const other = await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: court2.match.id })
    expect(other.status()).toBe(403)
    expect((await other.json()).error).toBe('This captain link only runs Court 1.')
    expect((await asCaptain(request, code, captainKey, { type: 'END_SESSION' })).status()).toBe(403)

    const saved = await asCaptain(request, code, captainKey, { type: 'RECORD_RESULT', matchId: court1.match.id, winner: 'A', scoreA: 11, scoreB: 6 })
    expect(saved.status()).toBe(200)
    expect((await saved.json()).captain.court.id).toBe(court1.id)
    const hostAgain = await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: court1.match.id, winner: 'B', scoreA: 6, scoreB: 11 })
    expect(hostAgain.status()).toBe(409)
    expect((await hostAgain.json()).error).toBe('This game was already saved by Court 1 captain.')

    const snapshot = await (await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).json()
    expect(JSON.stringify(snapshot)).not.toMatch(/skill|duprId|keyHash|key_hash/)
    const hostView = await hostSnapshot(request, code, hostKey)
    expect(hostView.captains.map((c) => c.label)).toEqual(['Court 1 captain'])
    expect(JSON.stringify(hostView)).not.toContain(captainKey)
  })

  test('a revoked captain link stops working at once; a stranger cannot make or revoke links', async ({ request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const { captainKey, captainId } = await makeCaptain(request, code, hostKey, host.courts[0].id)
    expect((await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': 'wrong-key-wrong-key' }, data: { courtId: host.courts[0].id } })).status()).toBe(403)
    expect((await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Captain-Key': captainKey }, data: { courtId: host.courts[0].id } })).status()).toBe(403)

    // A browser always sends Origin on DELETE; Astro's CSRF check rejects a bodyless request without one.
    const revoked = await request.delete(`/api/pickleball/open/s/${code}/captains/${captainId}`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(revoked.status()).toBe(200)
    const after = await asCaptain(request, code, captainKey, { type: 'START_MATCH', matchId: host.courts[0].match.id })
    expect(after.status()).toBe(403)
    expect((await after.json()).error).toBe('This captain link is no longer valid.')
    expect((await request.get(`/api/pickleball/open/s/${code}/captain`, { headers: { 'X-Captain-Key': captainKey } })).status()).toBe(403)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/pickleball/open/captains.test.ts`
Expected: FAIL, because `./captains` cannot be resolved.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker -g "court captains \\(API\\)"`
Expected: FAIL, because `POST …/captains` is 404.

- [ ] **Step 3: Write the pure scope rules and the schema**

```ts
// src/lib/pickleball/open/captains.ts
// Court captains (spec §3.3, §5.4): a per-captain secret link scoped to ONE
// court. A captain may start, edit or skip that court's proposal, and record,
// undo or edit its results. Everything else is the host's.
import type { OpenCommand } from '../../schemas/pickleball/open/commands'
import { cleanName } from './roster'
import { constantTimeEqual } from './secrets'
import type { CaptainRecord, OpenSessionState } from './types'

export const CAPTAIN_COMMANDS: ReadonlySet<OpenCommand['type']> = new Set<OpenCommand['type']>([
  'START_MATCH', 'RECORD_RESULT', 'UNDO_RESULT', 'EDIT_RESULT', 'EDIT_PROPOSAL', 'SKIP_PROPOSAL',
])

/** Why this captain may not run this command, or null when they may. */
export function captainRefusal(command: OpenCommand, captain: CaptainRecord, state: OpenSessionState): string | null {
  if (!CAPTAIN_COMMANDS.has(command.type) || !('matchId' in command)) return 'Only the host can do that.'
  const match = state.matches.find((m) => m.id === command.matchId)
  if (!match) return null // the reducer answers 404
  if (match.courtId === captain.courtId) return null
  const label = state.courts.find((c) => c.id === captain.courtId)?.label ?? 'your court'
  return `This captain link only runs ${label}.`
}

/** "Court 2 captain", then "Court 2 captain 2" for a second link to the same court. */
export function captainLabel(state: OpenSessionState, courtId: string, existing: readonly CaptainRecord[], requested?: string): string {
  const cleaned = requested ? cleanName(requested) : ''
  if (cleaned) return cleaned
  const base = `${state.courts.find((c) => c.id === courtId)?.label ?? 'Court'} captain`
  const sameCourt = existing.filter((c) => c.courtId === courtId).length
  return sameCourt ? `${base} ${sameCourt + 1}` : base
}

/** The live captain whose key hashes to keyHash. Compares every record in constant time. */
export function findCaptain(captains: readonly CaptainRecord[], keyHash: string): CaptainRecord | null {
  return captains.reduce<CaptainRecord | null>((found, c) => (constantTimeEqual(c.keyHash, keyHash) ? c : found), null)
}
```

```ts
// src/lib/schemas/pickleball/open/captains.ts
import { z } from 'zod'

export const createCaptainSchema = z.object({
  courtId: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
})
```

- [ ] **Step 4: Replace `OpenSessionDO.ts`**

This replaces Task 10's interim per-method limiters with one `windowRetryAfter` helper and adds the actor model. Keep the file under 600 lines (spec §3.5).

```ts
// src/worker/pickleball/open/OpenSessionDO.ts
// One instance per open session, addressed by idFromName(publicCode). D1 is
// the source of truth (spec §3.2); this object serializes commands, keeps
// the session in memory between them, writes only the rows a command
// changed, and broadcasts to hibernating sockets. Memory is updated only
// AFTER the D1 batch succeeds, so a failed write leaves nothing half-applied.
import { DurableObject } from 'cloudflare:workers'
import { createCaptainSchema } from '../../../lib/schemas/pickleball/open/captains'
import { checkInSchema } from '../../../lib/schemas/pickleball/open/checkIn'
import { commandEnvelopeSchema } from '../../../lib/schemas/pickleball/open/commands'
import { captainLabel, captainRefusal, findCaptain } from '../../../lib/pickleball/open/captains'
import { applyCheckIn } from '../../../lib/pickleball/open/checkIn'
import { applyCommand, finalizeCommand, touch } from '../../../lib/pickleball/open/reducer'
import { resultsCsv } from '../../../lib/pickleball/open/resultsCsv'
import { constantTimeEqual } from '../../../lib/pickleball/open/secrets'
import {
  toCaptainSnapshot, toHostSnapshot, toViewerSnapshot, type CaptainSnapshot, type HostSnapshot, type ViewerSnapshot,
} from '../../../lib/pickleball/open/snapshot'
import { LIMITS, type CaptainRecord, type OpenSessionState } from '../../../lib/pickleball/open/types'
import { randomBase64Url, sha256Base64Url } from '../../../lib/pickleball/webCrypto.js'
import {
  deleteOpenSession, findIdempotentResponse, insertCaptain, loadOpenSession, persistDiff, revokeCaptain as revokeCaptainRow,
  type LoadedSession,
} from '../../repositories/pickleball/open/openSessions'

export type DoResult<T> = { status: number; body: T | { error: string }; retryAfterSeconds?: number }
export interface Credentials { hostKey: string | null; captainKey: string | null }
export type CommandBody = { version: number; host?: HostSnapshot; captain?: CaptainSnapshot }
export interface CheckInBody { playerId: string; name: string; alreadyCheckedIn: boolean }
export interface CaptainLinkBody { captainId: string; label: string; captainKey: string; host: HostSnapshot }

type Actor = { role: 'host' } | { role: 'captain'; captain: CaptainRecord }
type Attachment = { code: string; role: 'viewer' | 'host' | 'captain'; captainId?: string }
type Identified = { role: 'host'; payload: HostSnapshot } | { role: 'captain'; captainId: string; payload: CaptainSnapshot }

const IDEMPOTENCY_TTL_MS = 10 * 60_000
const GONE = 4404
// Spec §10: 120 commands per minute per session. Counted here, after the key
// is checked, so strangers holding only the public code cannot use up the
// host's allowance (they are limited per IP at the route instead). In memory is
// enough: one object serves the whole session, and a flood keeps it awake.
const COMMAND_LIMIT = 120
const COMMAND_WINDOW_MS = 60_000
// Self check-in is anonymous: 60 per 5 minutes per session caps a flood of
// junk names well before the 128-player cap, while a real crowd arriving at
// once still fits (the route also limits each address).
const CHECK_IN_LIMIT = 60
const CHECK_IN_WINDOW_MS = 5 * 60_000

/** Sliding-window counter: the kept times, and the seconds to wait (0 when this call is allowed and counted). */
function windowRetryAfter(times: readonly number[], limit: number, windowMs: number, nowMs: number): { times: number[]; retryAfter: number } {
  const recent = times.filter((t) => t > nowMs - windowMs)
  if (recent.length >= limit) return { times: recent, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - nowMs) / 1000)) }
  return { times: [...recent, nowMs], retryAfter: 0 }
}

export class OpenSessionDO extends DurableObject<Env> {
  private loaded: LoadedSession | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private commandTimes: number[] = []
  private checkInTimes: number[] = []

  /** Runs fn after every earlier call has settled: one command at a time, even across awaits. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => undefined)
    return run
  }

  private async load(code: string): Promise<LoadedSession | null> {
    // A request routed to the wrong coordinator must never load (or cache) another session's state.
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return null
    const now = new Date().toISOString()
    if (this.loaded && this.loaded.state.publicCode === code && this.loaded.state.expiresAt > now) return this.loaded
    this.loaded = await loadOpenSession(this.env.PICKLEBALL_DB, code, now)
    return this.loaded
  }

  private async isHost(loaded: LoadedSession, hostKey: string | null): Promise<boolean> {
    if (!hostKey) return false
    return constantTimeEqual(await sha256Base64Url(hostKey), loaded.hostKeyHash)
  }

  /** Host first; otherwise a live (unrevoked) captain link. Revocation is immediate: captains are checked from memory on every call. */
  private async actorFor(loaded: LoadedSession, credentials: Credentials): Promise<Actor | null> {
    if (await this.isHost(loaded, credentials.hostKey)) return { role: 'host' }
    if (!credentials.captainKey) return null
    const captain = findCaptain(loaded.captains, await sha256Base64Url(credentials.captainKey))
    return captain ? { role: 'captain', captain } : null
  }

  private async authorized(code: string, hostKey: string | null): Promise<LoadedSession | DoResult<never>> {
    const loaded = await this.load(code)
    if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
    if (!(await this.isHost(loaded, hostKey))) return { status: 403, body: { error: 'Only the host can do that.' } }
    return loaded
  }

  private snapshotFor(actor: Actor, state: OpenSessionState, captains: readonly CaptainRecord[]): Pick<CommandBody, 'host' | 'captain'> {
    return actor.role === 'host' ? { host: toHostSnapshot(state, captains) } : { captain: toCaptainSnapshot(state, actor.captain) }
  }

  async viewer(code: string): Promise<ViewerSnapshot | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      return loaded ? toViewerSnapshot(loaded.state) : null
    })
  }

  async host(code: string, hostKey: string | null): Promise<DoResult<HostSnapshot>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      return 'state' in auth ? { status: 200, body: toHostSnapshot(auth.state, auth.captains) } : auth
    })
  }

  async captain(code: string, captainKey: string | null): Promise<DoResult<CaptainSnapshot>> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const actor = await this.actorFor(loaded, { hostKey: null, captainKey })
      if (actor?.role !== 'captain') return { status: 403, body: { error: 'This captain link is no longer valid.' } }
      return { status: 200, body: toCaptainSnapshot(loaded.state, actor.captain) }
    })
  }

  async command(code: string, credentials: Credentials, envelope: unknown): Promise<DoResult<CommandBody>> {
    return this.serial(async () => {
      const parsed = commandEnvelopeSchema.safeParse(envelope)
      if (!parsed.success) return { status: 400, body: { error: 'That request was not understood.' } }
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const actor = await this.actorFor(loaded, credentials)
      if (!actor) {
        const captainOnly = credentials.captainKey !== null && credentials.hostKey === null
        return { status: 403, body: { error: captainOnly ? 'This captain link is no longer valid.' : 'Only the host can do that.' } }
      }
      if (actor.role === 'captain') {
        const refusal = captainRefusal(parsed.data.command, actor.captain, loaded.state)
        if (refusal) return { status: 403, body: { error: refusal } }
      }
      const limit = windowRetryAfter(this.commandTimes, COMMAND_LIMIT, COMMAND_WINDOW_MS, Date.now())
      this.commandTimes = limit.times
      if (limit.retryAfter > 0) return { status: 429, body: { error: 'Slow down a little and try again.' }, retryAfterSeconds: limit.retryAfter }
      const db = this.env.PICKLEBALL_DB
      const prior = await findIdempotentResponse(db, loaded.state.id, parsed.data.idempotencyKey)
      if (prior) {
        // Only {status, version} is stored (a snapshot near the caps would crowd D1's row limit);
        // the replay answers with the session as it is now, which is what the caller needs anyway.
        const stored = JSON.parse(prior) as { status: number; version?: number; body?: { version?: number } }
        const version = stored.version ?? stored.body?.version ?? loaded.state.version
        return { status: stored.status, body: { version, ...this.snapshotFor(actor, loaded.state, loaded.captains) } }
      }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID(), actor: actor.role === 'captain' ? actor.captain.label : 'Host' }
      const result = applyCommand(loaded.state, parsed.data.command, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }

      const next = finalizeCommand(result.state, ctx)
      await persistDiff(db, loaded.state, next, {
        key: parsed.data.idempotencyKey,
        responseJson: JSON.stringify({ status: 200, version: next.version }),
        now,
        cutoff: new Date(Date.parse(now) - IDEMPOTENCY_TTL_MS).toISOString(),
      })
      this.loaded = { ...loaded, state: next }
      this.broadcast()
      return { status: 200, body: { version: next.version, ...this.snapshotFor(actor, next, loaded.captains) } }
    })
  }

  async checkIn(code: string, body: unknown): Promise<DoResult<CheckInBody>> {
    return this.serial(async () => {
      const parsed = checkInSchema.safeParse(body)
      if (!parsed.success) return { status: 400, body: { error: 'Check your details and try again.' } }
      const loaded = await this.load(code)
      if (!loaded) return { status: 404, body: { error: 'Session not found.' } }
      const limit = windowRetryAfter(this.checkInTimes, CHECK_IN_LIMIT, CHECK_IN_WINDOW_MS, Date.now())
      this.checkInTimes = limit.times
      if (limit.retryAfter > 0) return { status: 429, body: { error: 'Lots of people are checking in. Try again in a minute.' }, retryAfterSeconds: limit.retryAfter }

      const now = new Date().toISOString()
      const ctx = { now, newId: () => crypto.randomUUID() }
      const entry = { name: parsed.data.name, skill: parsed.data.skill ?? null, duprId: parsed.data.duprId ?? null }
      const result = applyCheckIn(loaded.state, entry, ctx)
      if (!result.ok) return { status: result.status, body: { error: result.error } }
      const answer = { playerId: result.playerId, name: result.name, alreadyCheckedIn: result.alreadyCheckedIn }
      if (result.alreadyCheckedIn) return { status: 200, body: answer }

      const next = finalizeCommand(result.state, ctx)
      await persistDiff(this.env.PICKLEBALL_DB, loaded.state, next, null)
      this.loaded = { ...loaded, state: next }
      this.broadcast()
      return { status: 201, body: answer }
    })
  }

  async createCaptain(code: string, hostKey: string | null, body: unknown): Promise<DoResult<CaptainLinkBody>> {
    return this.serial(async () => {
      const parsed = createCaptainSchema.safeParse(body)
      if (!parsed.success) return { status: 400, body: { error: 'Pick a court for the captain.' } }
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const court = auth.state.courts.find((c) => c.id === parsed.data.courtId)
      if (!court) return { status: 404, body: { error: 'Court not found.' } }
      if (auth.captains.length >= LIMITS.maxCaptains) return { status: 409, body: { error: `A session can have at most ${LIMITS.maxCaptains} captain links.` } }

      const now = new Date().toISOString()
      const captainKey = randomBase64Url(16)
      const captain: CaptainRecord = {
        id: crypto.randomUUID(), label: captainLabel(auth.state, court.id, auth.captains, parsed.data.label),
        courtId: court.id, keyHash: await sha256Base64Url(captainKey), createdAt: now,
      }
      const next = touch(auth.state, now)
      await insertCaptain(this.env.PICKLEBALL_DB, next, captain)
      const captains = [...auth.captains, captain]
      this.loaded = { ...auth, state: next, captains }
      this.broadcast()
      return { status: 201, body: { captainId: captain.id, label: captain.label, captainKey, host: toHostSnapshot(next, captains) } }
    })
  }

  async revokeCaptain(code: string, hostKey: string | null, captainId: string): Promise<DoResult<{ revoked: true; host: HostSnapshot }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      if (!auth.captains.some((c) => c.id === captainId)) return { status: 404, body: { error: 'That captain link was not found.' } }
      const now = new Date().toISOString()
      const next = touch(auth.state, now)
      await revokeCaptainRow(this.env.PICKLEBALL_DB, next, captainId, now)
      const captains = auth.captains.filter((c) => c.id !== captainId)
      this.loaded = { ...auth, state: next, captains }
      this.broadcast()
      return { status: 200, body: { revoked: true, host: toHostSnapshot(next, captains) } }
    })
  }

  async results(code: string, hostKey: string | null): Promise<DoResult<{ csv: string; filename: string }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      const slug = auth.state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session'
      return { status: 200, body: { csv: resultsCsv(auth.state), filename: `${slug}-${auth.state.createdAt.slice(0, 10)}-results.csv` } }
    })
  }

  async remove(code: string, hostKey: string | null): Promise<DoResult<{ deleted: true }>> {
    return this.serial(async () => {
      const auth = await this.authorized(code, hostKey)
      if (!('state' in auth)) return auth
      await deleteOpenSession(this.env.PICKLEBALL_DB, auth.state.id)
      this.closeAll()
      return { status: 200, body: { deleted: true } }
    })
  }

  /** Called by the purge cron after it deleted this session's rows. */
  async evict(): Promise<void> {
    return this.serial(async () => this.closeAll())
  }

  private closeAll(): void {
    this.loaded = null
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(GONE, 'Session ended')
      } catch {
        // already closing
      }
    }
  }

  /**
   * Sends every socket the snapshot for its role. A captain socket whose link
   * was revoked is turned back into a viewer here, in the same pass, and told
   * so (CAPTAIN_REVOKED) before it gets the public board.
   */
  private broadcast(): void {
    if (!this.loaded) return
    const { state, captains } = this.loaded
    const viewer = JSON.stringify({ type: 'VIEWER', payload: toViewerSnapshot(state) })
    const host = JSON.stringify({ type: 'HOST', payload: toHostSnapshot(state, captains) })
    const perCaptain = new Map<string, string>()
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      try {
        if (attachment?.role === 'host') {
          ws.send(host)
          continue
        }
        if (attachment?.role === 'captain' && attachment.captainId) {
          const captain = captains.find((c) => c.id === attachment.captainId)
          if (captain) {
            const message = perCaptain.get(captain.id) ?? JSON.stringify({ type: 'CAPTAIN', payload: toCaptainSnapshot(state, captain) })
            perCaptain.set(captain.id, message)
            ws.send(message)
            continue
          }
          ws.serializeAttachment({ code: attachment.code, role: 'viewer' } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'CAPTAIN_REVOKED' }))
        }
        ws.send(viewer)
      } catch {
        // a socket mid-close; it is dropped by the runtime
      }
    }
  }

  /** Who a socket's AUTH message proves it is, with their snapshot; null when the key is not valid. */
  private async identify(code: string, credentials: Credentials): Promise<Identified | null> {
    return this.serial(async () => {
      const loaded = await this.load(code)
      if (!loaded) return null
      const actor = await this.actorFor(loaded, credentials)
      if (!actor) return null
      return actor.role === 'host'
        ? { role: 'host', payload: toHostSnapshot(loaded.state, loaded.captains) }
        : { role: 'captain', captainId: actor.captain.id, payload: toCaptainSnapshot(loaded.state, actor.captain) }
    })
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket upgrade.', { status: 400 })
    const code = request.headers.get('X-Open-Code') ?? ''
    if (!this.ctx.id.equals(this.env.OPEN_SESSION.idFromName(code))) return new Response('Coordinator mismatch.', { status: 400 })
    const snapshot = await this.viewer(code)
    if (!snapshot) return new Response('Session not found.', { status: 404 })

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ code, role: 'viewer' } satisfies Attachment)
    server.send(JSON.stringify({ type: 'VIEWER', payload: snapshot }))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    let parsed: { type?: string; hostKey?: unknown; captainKey?: unknown }
    try {
      parsed = JSON.parse(String(message))
    } catch {
      return
    }
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) return

    if (parsed.type === 'AUTH') {
      const credentials: Credentials = {
        hostKey: typeof parsed.hostKey === 'string' && parsed.hostKey.length <= 128 ? parsed.hostKey : null,
        captainKey: typeof parsed.captainKey === 'string' && parsed.captainKey.length <= 128 ? parsed.captainKey : null,
      }
      try {
        const who = await this.identify(attachment.code, credentials)
        if (who?.role === 'host') {
          ws.serializeAttachment({ code: attachment.code, role: 'host' } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'HOST', payload: who.payload }))
        } else if (who?.role === 'captain') {
          ws.serializeAttachment({ code: attachment.code, role: 'captain', captainId: who.captainId } satisfies Attachment)
          ws.send(JSON.stringify({ type: 'CAPTAIN', payload: who.payload }))
        } else {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
        }
      } catch (error) {
        this.logWsError(error, attachment.code, 'AUTH')
        try {
          ws.send(JSON.stringify({ type: 'AUTH_FAILED' }))
        } catch {
          // socket already closed
        }
      }
      return
    }

    if (parsed.type === 'RESYNC') {
      try {
        const loaded = await this.serial(() => this.load(attachment.code))
        if (!loaded) return
        if (attachment.role === 'host') {
          ws.send(JSON.stringify({ type: 'HOST', payload: toHostSnapshot(loaded.state, loaded.captains) }))
          return
        }
        const captain = attachment.role === 'captain' ? loaded.captains.find((c) => c.id === attachment.captainId) : undefined
        if (captain) ws.send(JSON.stringify({ type: 'CAPTAIN', payload: toCaptainSnapshot(loaded.state, captain) }))
        else ws.send(JSON.stringify({ type: 'VIEWER', payload: toViewerSnapshot(loaded.state) }))
      } catch (error) {
        // a failed resync is retried by the client's next RESYNC
        this.logWsError(error, attachment.code, 'RESYNC')
      }
    }
  }

  private logWsError(error: unknown, code: string, messageType: string): void {
    console.log(JSON.stringify({ event: 'pickleball_open.ws_error', code, messageType, error: error instanceof Error ? error.message : 'unknown' }))
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1005/1006 are reserved and cannot be echoed back; anything else is.
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason)
    } catch {
      // already closed
    }
  }
}
```

- [ ] **Step 5: Route helpers and routes**

`src/worker/pickleball/open/routeHelpers.ts`:
1. Change `import type { DoResult } from './OpenSessionDO'` to `import type { Credentials, DoResult } from './OpenSessionDO'`.
2. Add after `hostKeyFrom`:

```ts
export function captainKeyFrom(request: Request): string | null {
  const key = request.headers.get('X-Captain-Key')
  return key && key.length <= 128 ? key : null
}

export function credentialsFrom(request: Request): Credentials {
  return { hostKey: hostKeyFrom(request), captainKey: captainKeyFrom(request) }
}
```

`src/pages/api/pickleball/open/s/[code]/commands.ts`:
1. Import `credentialsFrom` instead of `hostKeyFrom`.
2. Change the DO call to `openSessionStub(env, code).command(code, credentialsFrom(request), body)`.
3. Update the comment above it to "…counted in the DO after the host or captain key checks out."

```ts
// src/pages/api/pickleball/open/s/[code]/captain.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { captainKeyFrom, codeFrom, doResponse, hostIpLimited, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'

export const GET: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    if (!code) return notFound()
    return doResponse(await openSessionStub(env, code).captain(code, captainKeyFrom(request)))
  } catch (error) {
    return openErrorResponse(error, 'captain')
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/captains.ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../worker/pickleball/open/routeHelpers'
import { jsonResponse } from '../../../../../../worker/utils/responses.js'

export const POST: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) {
      await request.arrayBuffer().catch(() => {})
      return limited
    }
    const code = codeFrom(params)
    if (!code) {
      await request.arrayBuffer().catch(() => {})
      return notFound()
    }
    const body = await request.json().catch(() => null)
    if (body === null) return jsonResponse({ error: 'That request was not understood.' }, 400)
    return doResponse(await openSessionStub(env, code).createCaptain(code, hostKeyFrom(request), body))
  } catch (error) {
    return openErrorResponse(error, 'captains')
  }
}
```

```ts
// src/pages/api/pickleball/open/s/[code]/captains/[captainId].ts
import type { APIRoute } from 'astro'
import { getEnv } from '../../../../../../../lib/env'
import { codeFrom, doResponse, hostIpLimited, hostKeyFrom, notFound, openErrorResponse, openSessionStub } from '../../../../../../../worker/pickleball/open/routeHelpers'

export const DELETE: APIRoute = async ({ request, params }) => {
  const env = getEnv()
  try {
    const limited = await hostIpLimited(env, request)
    if (limited) return limited
    const code = codeFrom(params)
    const captainId = params.captainId ?? ''
    if (!code || !captainId || captainId.length > 64) return notFound()
    return doResponse(await openSessionStub(env, code).revokeCaptain(code, hostKeyFrom(request), captainId))
  } catch (error) {
    return openErrorResponse(error, 'captain-revoke')
  }
}
```

The client still sends only `X-Host-Key` until Task 12, which keeps working: `credentialsFrom` reads both headers.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball/open-play.spec.js --project=worker`
Expected: PASS: the captain API tests, plus every host test (the host path is unchanged).

- [ ] **Step 7: Commit**

```markdown
- Open play API: court-captain links. The host creates a link per court (`POST …/captains`, secret shown once, only its hash stored) and can turn it off (`DELETE …/captains/{id}`), effective on the very next request or live update. A captain can start, edit or skip that court's proposal and save, undo or fix its results, nothing else; a second save names who saved first.
```

```bash
git add src tests/e2e/pickleball/open-play.spec.js CHANGELOG.md
git commit -m "feat(pickleball): court captain links scoped to one court, revocable at once"
```

---
### Task 12: Court captains, client side

**Files:**
- Create: `src/pickleball-open/lib/captainKeys.js`, `src/pickleball-open/lib/captainKeys.test.js`
- Create: `src/pickleball-open/components/CaptainConsole.jsx`, `src/pickleball-open/components/CaptainsSheet.jsx`
- Modify (whole files below): `src/pickleball-open/lib/api.js`, `src/pickleball-open/lib/useCommandQueue.js`, `src/pickleball-open/lib/useOpenSession.js`, `src/pickleball-open/SessionApp.jsx`
- Modify: `src/pickleball-open/components/HostConsole.jsx`, `src/pickleball-open/components/ViewerBoard.jsx`
- Modify: `src/pages/pickleball/how-it-works.astro`, `src/pages/pickleball/index.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `tests/e2e/pickleball/open-play.spec.js`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the captain routes, the WebSocket messages, and `CaptainSnapshot` (Tasks 7, 11).
- Produces:
  - `captainKeys.js`: `captainKeyFromHash`, `rememberCaptainKey`, `captainKeyFor`, `forgetCaptainKey`, `captainLink`.
  - `api.js`: `authHeaders({ hostKey?, captainKey? })`, `fetchCaptain(code, captainKey)`, `postCommand(code, credentials, envelope)`, `createCaptainLink(code, hostKey, body)`, `revokeCaptainLink(code, hostKey, captainId)`.
  - `useCommandQueue(code, credentials, onSnapshot)`, where `onSnapshot` gets `result.host ?? result.captain`.
  - `useOpenSession(code, hostKey, { onRejected, captainKey })` returns `{ status, viewer, host, captain, captainRevoked, authFailed, setHost, setCaptain }`.
  - `CaptainConsole({ code, captainKey, snapshot, status, onSnapshot })`.
  - `CaptainsSheet({ code, hostKey, courts, captains, onHost, onClose })`.
  - `ViewerBoard` gains a `revokedCaptainLink` prop.

- [ ] **Step 1: Write the failing tests**

```js
// src/pickleball-open/lib/captainKeys.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captainKeyFor, captainKeyFromHash, captainLink, forgetCaptainKey, rememberCaptainKey } from './captainKeys'

describe('captain links', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the captain key from the fragment only', () => {
    expect(captainKeyFromHash('#cap=abc_DEF-123')).toBe('abc_DEF-123')
    expect(captainKeyFromHash('#x=1&cap=k2')).toBe('k2')
    expect(captainKeyFromHash('#host=k3')).toBeNull()
    expect(captainKeyFromHash('#cap=a/b')).toBeNull()
    expect(captainKeyFromHash('')).toBeNull()
  })

  it('builds the link with the key in the fragment', () => {
    expect(captainLink('https://x.test', 'ABCDE23456', 'k')).toBe('https://x.test/pickleball/s/ABCDE23456#cap=k')
  })

  it('remembers one key per session and forgets it on request', () => {
    const store = new Map()
    vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) })
    rememberCaptainKey('ABCDE23456', 'k1')
    rememberCaptainKey('ABCDE23456', 'k2')
    expect(captainKeyFor('ABCDE23456')).toBe('k2')
    forgetCaptainKey('ABCDE23456')
    expect(captainKeyFor('ABCDE23456')).toBeNull()
  })
})
```

Append to `tests/e2e/pickleball/open-play.spec.js`:

```js
test.describe('court captains (screens)', () => {
  test('the host makes a captain link on the console, and the captain saves a game from their phone', async ({ page, browser, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'More' }).click()
    await page.getByRole('button', { name: 'Court captains' }).click()
    await page.getByRole('button', { name: 'Make a link for Court 1' }).click()
    const link = await page.getByLabel('Captain link for Court 1').inputValue()
    expect(link).toContain('#cap=')

    const captainContext = await browser.newContext()
    const captain = await captainContext.newPage()
    await captain.goto(link)
    await expect(captain.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(captain.getByText('Court 1 captain')).toBeVisible()
    expect(captain.url()).not.toContain('#cap=')
    await expect(captain.getByTestId('court-2')).toHaveCount(0)
    await captain.getByTestId('court-1').getByRole('button', { name: 'Start' }).click()
    await captain.getByTestId('court-1').getByRole('button', { name: 'Game over' }).click()
    const dialog = captain.getByRole('dialog')
    await dialog.getByRole('radio').first().click()
    await dialog.getByRole('button', { name: '7', exact: true }).click()
    await dialog.getByRole('button', { name: 'Save 11–7' }).click()
    await expect(page.getByText('11–7').first()).toBeVisible()
    await captainContext.close()
  })

  test('turning a captain link off works at once, even with the captain page open', async ({ page, request, baseURL }) => {
    const { code, hostKey } = await createSession(request)
    const host = await hostSnapshot(request, code, hostKey)
    const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId: host.courts[0].id } })
    const { captainKey, captainId } = await made.json()
    await page.goto(`/pickleball/s/${code}#cap=${captainKey}`)
    await expect(page.getByText('Court 1 captain')).toBeVisible()
    const revoked = await request.delete(`/api/pickleball/open/s/${code}/captains/${captainId}`, { headers: { 'X-Host-Key': hostKey, Origin: baseURL } })
    expect(revoked.status()).toBe(200)
    await expect(page.getByText('This captain link was turned off by the host.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
    // Reopening the link later lands on the public board too.
    await page.goto(`/pickleball/s/${code}`)
    await expect(page.getByText('Walk on now').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toHaveCount(0)
  })
})
```

In `tests/e2e/pickleball/pickleball-public-pages.spec.js`:
1. Remove `'captain'` from the banned list.
2. Add `'Court captains'` to the landing claims in `the guide and landing page describe the stacking modes and rules`, and `'Hand a court to a captain'` to its guide claims.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pickleball-open/lib/captainKeys.test.js`
Expected: FAIL, because `./captainKeys` cannot be resolved.

Run: `npx playwright test tests/e2e/pickleball --project=worker -g "captains \\(screens\\)|describe the stacking"`
Expected: FAIL. There is no "Court captains" menu item, a `#cap=` link shows only the board, and the copy is missing.

- [ ] **Step 3: Write the captain key store and the client API**

```js
// src/pickleball-open/lib/captainKeys.js
// A court captain's key, like the host's, travels only in the URL fragment
// (#cap=…) and is kept in this browser's localStorage so a closed tab does not
// cost the captain their court (spec §3.3). Every access is guarded.
const STORAGE_KEY = 'devlab-pickleball-captain'
const MAX_REMEMBERED = 10

function read() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(value) ? value.filter((e) => e && typeof e.code === 'string' && typeof e.captainKey === 'string') : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_REMEMBERED)))
  } catch {
    // storage unavailable: the captain link itself still works
  }
}

export function captainKeyFromHash(hash) {
  const match = /(?:^#|&)cap=([A-Za-z0-9_-]+)(?:&|$)/.exec(hash || '')
  return match ? match[1] : null
}
export function rememberCaptainKey(code, captainKey) {
  write([{ code, captainKey }, ...read().filter((e) => e.code !== code)])
}
export function captainKeyFor(code) {
  return read().find((e) => e.code === code)?.captainKey ?? null
}
export function forgetCaptainKey(code) {
  write(read().filter((e) => e.code !== code))
}
export function captainLink(origin, code, captainKey) {
  return `${origin}/pickleball/s/${code}#cap=${captainKey}`
}
```

Replace `src/pickleball-open/lib/api.js`:

```js
// src/pickleball-open/lib/api.js
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function parse(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ApiError(body.error || 'Something went wrong. Try again.', response.status)
  return body
}

const base = (code) => `/api/pickleball/open/s/${code}`

/** Headers for whichever key this screen holds: the host's or a court captain's. */
export function authHeaders({ hostKey = null, captainKey = null } = {}) {
  return { ...(hostKey ? { 'X-Host-Key': hostKey } : {}), ...(captainKey ? { 'X-Captain-Key': captainKey } : {}) }
}

export async function createSession(input) {
  return parse(await fetch('/api/pickleball/open/sessions', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(input) }))
}
export async function fetchViewer(code) {
  return parse(await fetch(`${base(code)}/state`))
}
export async function fetchHost(code, hostKey) {
  return parse(await fetch(`${base(code)}/host`, { headers: authHeaders({ hostKey }) }))
}
export async function fetchCaptain(code, captainKey) {
  return parse(await fetch(`${base(code)}/captain`, { headers: authHeaders({ captainKey }) }))
}
export async function postCommand(code, credentials, envelope) {
  return parse(await fetch(`${base(code)}/commands`, { method: 'POST', headers: { ...JSON_HEADERS, ...authHeaders(credentials) }, body: JSON.stringify(envelope) }))
}
export async function checkIn(code, body) {
  return parse(await fetch(`${base(code)}/check-in`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }))
}
export async function createCaptainLink(code, hostKey, body) {
  return parse(await fetch(`${base(code)}/captains`, { method: 'POST', headers: { ...JSON_HEADERS, ...authHeaders({ hostKey }) }, body: JSON.stringify(body) }))
}
export async function revokeCaptainLink(code, hostKey, captainId) {
  return parse(await fetch(`${base(code)}/captains/${encodeURIComponent(captainId)}`, { method: 'DELETE', headers: authHeaders({ hostKey }) }))
}
export async function downloadResults(code, hostKey) {
  const response = await fetch(`${base(code)}/results.csv`, { headers: authHeaders({ hostKey }) })
  if (!response.ok) throw new ApiError('Could not download results.', response.status)
  const disposition = response.headers.get('Content-Disposition') || ''
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || 'results.csv'
  return { blob: await response.blob(), filename }
}
export async function deleteSession(code, hostKey) {
  return parse(await fetch(`${base(code)}/session`, { method: 'DELETE', headers: authHeaders({ hostKey }) }))
}
```

- [ ] **Step 4: Replace the two hooks**

```js
// src/pickleball-open/lib/useCommandQueue.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, postCommand } from './api'

const RETRY_MS = 3000

/**
 * Sends commands in order, as the host ({ hostKey }) or a court captain
 * ({ captainKey }). A network failure or 5xx keeps the command queued and
 * retries it with the SAME idempotency key, so a flaky court-side connection
 * can never apply a tap twice (spec §3.4). A 4xx is final and surfaces its
 * message. onSnapshot gets the host or captain snapshot from each answer.
 */
export function useCommandQueue(code, credentials, onSnapshot) {
  const queueRef = useRef([])
  const flushingRef = useRef(false)
  const latestRef = useRef({ code, credentials, onSnapshot })
  latestRef.current = { code, credentials, onSnapshot }
  const [pending, setPending] = useState(0)
  const [error, setError] = useState(null)

  const flush = useCallback(async () => {
    if (flushingRef.current) return
    flushingRef.current = true
    try {
      while (queueRef.current.length) {
        const item = queueRef.current[0]
        const { code: c, credentials: keys, onSnapshot: handle } = latestRef.current
        try {
          const result = await postCommand(c, keys, item.envelope)
          queueRef.current = queueRef.current.slice(1)
          item.resolve(true)
          try {
            handle(result.host ?? result.captain)
          } catch (handlerError) {
            console.error('Applying the snapshot failed', handlerError)
          }
        } catch (failure) {
          if (failure instanceof ApiError && failure.status < 500 && failure.status !== 429) {
            queueRef.current = queueRef.current.slice(1)
            setError(failure.message)
            item.resolve(false)
          } else {
            break
          }
        } finally {
          setPending(queueRef.current.length)
        }
      }
    } finally {
      flushingRef.current = false
    }
  }, [])

  const send = useCallback((command) => new Promise((resolve) => {
    queueRef.current = [...queueRef.current, { envelope: { idempotencyKey: crypto.randomUUID(), command }, resolve }]
    setPending(queueRef.current.length)
    flush()
  }), [flush])

  useEffect(() => {
    const timer = setInterval(() => {
      if (queueRef.current.length) flush()
    }, RETRY_MS)
    return () => {
      clearInterval(timer)
      const abandoned = queueRef.current
      queueRef.current = []
      abandoned.forEach((item) => item.resolve(false))
    }
  }, [flush])

  const clearError = useCallback(() => setError(null), [])

  return { send, pending, error, clearError }
}
```

```js
// src/pickleball-open/lib/useOpenSession.js
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCaptain, fetchHost, fetchViewer } from './api'

const POLL_MS = 5000
const GONE = 4404

/**
 * Live board state: WebSocket first, 5-second polling while it is down
 * (spec §3.4). With a host key the poll also fetches the host snapshot, and
 * with a captain key (and no host key) the captain's court snapshot, so both
 * consoles work even when the socket never connects.
 *
 * Snapshots can arrive out of order (a poll that left before a command but
 * landed after it), so anything older than the version already held is ignored.
 *
 * A captain link the host turned off (403 on poll, AUTH_FAILED, or
 * CAPTAIN_REVOKED on the socket) drops to the public board: captainRevoked.
 */
export function useOpenSession(code, hostKey, { onRejected, captainKey = null } = {}) {
  const [status, setStatus] = useState('connecting')
  const [viewer, setViewer] = useState(null)
  const [host, setHost] = useState(null)
  const [captain, setCaptain] = useState(null)
  // Every key the server refused, so a caller can switch keys without the new
  // one inheriting the old one's failure.
  const [rejectedKeys, setRejectedKeys] = useState([])
  const [revokedCaptainKeys, setRevokedCaptainKeys] = useState([])
  const versionRef = useRef(-1)
  const onRejectedRef = useRef(onRejected)
  useEffect(() => {
    onRejectedRef.current = onRejected
  }, [onRejected])

  /** True when this version is at least as new as anything already shown; records it. */
  const accept = useCallback((version) => {
    if (typeof version !== 'number') return true
    if (version < versionRef.current) return false
    versionRef.current = version
    return true
  }, [])

  const applyViewer = useCallback((snapshot) => {
    if (!snapshot || !accept(snapshot.version)) return
    setViewer(snapshot)
  }, [accept])

  const applyHost = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setHost(snapshot)
    setViewer(snapshot.viewer)
  }, [accept])

  const applyCaptain = useCallback((snapshot) => {
    if (!snapshot?.viewer || !accept(snapshot.viewer.version)) return
    setCaptain(snapshot)
    setViewer(snapshot.viewer)
  }, [accept])

  useEffect(() => {
    let socket = null
    let retryTimer = null
    let pollTimer = null
    let cancelled = false
    let ended = false
    let attempt = 0
    let hostDenied = false
    let captainDenied = false
    versionRef.current = -1

    function reject() {
      hostDenied = true
      setRejectedKeys((keys) => (keys.includes(hostKey) ? keys : [...keys, hostKey]))
      onRejectedRef.current?.(hostKey)
    }

    function revokeCaptain() {
      captainDenied = true
      setRevokedCaptainKeys((keys) => (keys.includes(captainKey) ? keys : [...keys, captainKey]))
    }

    function end() {
      ended = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      setStatus('not-found')
    }

    async function pollViewer() {
      try {
        const snapshot = await fetchViewer(code)
        if (!cancelled) applyViewer(snapshot)
        return true
      } catch (error) {
        if (!cancelled && error?.status === 404) end()
        return error?.status !== 404
      }
    }

    async function pollKeyed(fetchSnapshot, apply, onDenied) {
      try {
        const snapshot = await fetchSnapshot()
        if (!cancelled) apply(snapshot)
        return true
      } catch (error) {
        if (cancelled) return false
        if (error?.status === 404) {
          end()
          return false
        }
        if (error?.status === 403) onDenied()
        // 403 still shows the public board; anything else is retried by the next poll
        return pollViewer()
      }
    }

    const poll = () => {
      if (hostKey && !hostDenied) return pollKeyed(() => fetchHost(code, hostKey), applyHost, reject)
      if (!hostKey && captainKey && !captainDenied) return pollKeyed(() => fetchCaptain(code, captainKey), applyCaptain, revokeCaptain)
      return pollViewer()
    }

    function connect() {
      if (cancelled || ended) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/pickleball/rt/open/${code}`)
      socket.onopen = () => {
        attempt = 0
        clearInterval(pollTimer)
        setStatus('open')
        if (hostKey) socket.send(JSON.stringify({ type: 'AUTH', hostKey }))
        else if (captainKey && !captainDenied) socket.send(JSON.stringify({ type: 'AUTH', captainKey }))
      }
      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'VIEWER') applyViewer(message.payload)
        if (message.type === 'HOST') applyHost(message.payload)
        if (message.type === 'CAPTAIN') applyCaptain(message.payload)
        if (message.type === 'CAPTAIN_REVOKED') revokeCaptain()
        if (message.type === 'AUTH_FAILED') {
          if (hostKey) reject()
          else revokeCaptain()
        }
      }
      socket.onclose = (event) => {
        if (cancelled || ended) return
        if (event.code === GONE) {
          end()
          return
        }
        setStatus('reconnecting')
        clearInterval(pollTimer)
        pollTimer = setInterval(poll, POLL_MS)
        retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 8000))
        attempt += 1
      }
    }

    poll().then((found) => {
      if (found && !cancelled && !ended) connect()
    })

    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      clearInterval(pollTimer)
      socket?.close()
    }
  }, [code, hostKey, captainKey, applyHost, applyViewer, applyCaptain])

  return {
    status, viewer, host,
    captain: captainKey && !revokedCaptainKeys.includes(captainKey) ? captain : null,
    captainRevoked: Boolean(captainKey) && revokedCaptainKeys.includes(captainKey),
    authFailed: Boolean(hostKey) && rejectedKeys.includes(hostKey),
    setHost: applyHost,
    setCaptain: applyCaptain,
  }
}
```

Revoked captain keys are tracked in state (`revokedCaptainKeys`), like refused host keys, rather than reset inside the effect. `eslint-plugin-react-hooks` 7 forbids a synchronous `setState` in an effect body.

- [ ] **Step 5: Write the captain screens and wire them in**

```jsx
// src/pickleball-open/components/CaptainConsole.jsx
// A court captain's screen (spec §3.3, §5.4): one court, start / edit / skip
// its proposal, record, undo or edit its results. Nothing else.
import { useCallback, useMemo, useState } from 'react'
import { useCommandQueue } from '../lib/useCommandQueue'
import CourtCard from './CourtCard.jsx'
import EditMatchDialog from './EditMatchDialog.jsx'
import GameOverDialog from './GameOverDialog.jsx'
import ResultsList from './ResultsList.jsx'
import StandingsTable from './StandingsTable.jsx'
import UndoToast from './UndoToast.jsx'
import { Panel } from './ui.jsx'

export default function CaptainConsole({ code, captainKey, snapshot, status, onSnapshot }) {
  const credentials = useMemo(() => ({ captainKey }), [captainKey])
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onSnapshot)
  const [dialog, setDialog] = useState(null)
  const [undo, setUndo] = useState(null)
  const court = snapshot.court
  const names = useMemo(() => new Map(snapshot.players.map((p) => [p.id, p.name])), [snapshot.players])
  const nameOf = useCallback((id) => names.get(id) ?? '—', [names])
  const dismissUndo = useCallback(() => setUndo(null), [])
  const ended = snapshot.viewer.status === 'ENDED'

  async function save(match, result) {
    setDialog(null)
    const ok = await send({ type: 'RECORD_RESULT', matchId: match.id, ...result })
    if (ok) setUndo({ matchId: match.id, savedAt: Date.now(), label: `${court.label} saved ${result.scoreA}–${result.scoreB}.` })
  }

  return (
    <div className="mx-auto grid max-w-xl gap-4 px-3 pb-24 pt-3 sm:px-5">
      <header className="py-2">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-pickle-neon">Court captain</p>
        <h1 className="truncate text-2xl font-bold">{snapshot.viewer.name}</h1>
        <p className="text-sm text-mist">
          {snapshot.captain.label}
          {status !== 'open' && <span className="ml-2 text-amber-200">· Reconnecting…</span>}
          {pending > 0 && <span className="ml-2 text-amber-200">· Sending {pending}…</span>}
        </p>
      </header>

      {error && (
        <p role="alert" className="flex items-center justify-between rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">
          {error}<button type="button" onClick={clearError} className="ml-3 min-h-11 px-3 underline">OK</button>
        </p>
      )}

      <CourtCard court={court} nameOf={nameOf} ended={ended}
        onStart={(match) => send({ type: 'START_MATCH', matchId: match.id })}
        onGameOver={(match) => setDialog({ type: 'gameOver', match })}
        onEdit={(match) => setDialog({ type: 'edit', match })} />

      <Panel>
        <h2 className="mb-2 text-lg font-bold">Results on {court.label}</h2>
        <ResultsList finished={snapshot.finished} nameOf={nameOf} courtLabel={() => court.label} onEdit={(match) => setDialog({ type: 'editResult', match })} />
      </Panel>
      <Panel><h2 className="mb-2 text-lg font-bold">Standings</h2><StandingsTable rows={snapshot.viewer.standings} /></Panel>
      <p className="text-center text-xs text-mist">This link runs {court.label} only. The host can turn it off at any time.</p>

      {dialog?.type === 'gameOver' && (
        <GameOverDialog title={`${court.label} · who won?`} match={dialog.match} nameOf={nameOf} settings={snapshot.settings}
          onSave={(result) => save(dialog.match, result)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'editResult' && (
        <GameOverDialog title="Edit result" match={dialog.match} nameOf={nameOf} settings={snapshot.settings} initial={dialog.match}
          onSave={(result) => { setDialog(null); send({ type: 'EDIT_RESULT', matchId: dialog.match.id, ...result }) }}
          onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'edit' && (
        <EditMatchDialog match={dialog.match} players={snapshot.players} nameOf={nameOf}
          onSave={(slots) => { setDialog(null); send({ type: 'EDIT_PROPOSAL', matchId: dialog.match.id, teamA: [slots[0], slots[1]], teamB: [slots[2], slots[3]] }) }}
          onSkip={() => { setDialog(null); send({ type: 'SKIP_PROPOSAL', matchId: dialog.match.id }) }}
          onClose={() => setDialog(null)} />
      )}
      {undo && (
        <UndoToast key={undo.savedAt} label={undo.label} savedAt={undo.savedAt} onDismiss={dismissUndo}
          onUndo={() => { setUndo(null); send({ type: 'UNDO_RESULT', matchId: undo.matchId }) }} />
      )}
    </div>
  )
}
```

```jsx
// src/pickleball-open/components/CaptainsSheet.jsx
// The host makes and turns off court-captain links (spec §3.3). A new link's
// secret is shown once, here; the server keeps only its hash.
import { useState } from 'react'
import { createCaptainLink, revokeCaptainLink } from '../lib/api'
import { captainLink } from '../lib/captainKeys'
import { Button, Sheet } from './ui.jsx'

export default function CaptainsSheet({ code, hostKey, courts, captains, onHost, onClose }) {
  const [fresh, setFresh] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function make(court) {
    setError(null)
    setBusy(true)
    try {
      const result = await createCaptainLink(code, hostKey, { courtId: court.id })
      setFresh({ courtLabel: court.label, label: result.label, url: captainLink(window.location.origin, code, result.captainKey) })
      onHost(result.host)
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Could not make the link. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function turnOff(captain) {
    if (!window.confirm(`Turn off ${captain.label}'s link? It stops working straight away.`)) return
    setError(null)
    try {
      const result = await revokeCaptainLink(code, hostKey, captain.id)
      onHost(result.host)
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Could not turn the link off. Try again.')
    }
  }

  async function share() {
    if (!fresh) return
    try {
      if (navigator.share) await navigator.share({ title: fresh.label, text: `Captain link for ${fresh.courtLabel}`, url: fresh.url })
      else await navigator.clipboard.writeText(fresh.url)
    } catch {
      // the link stays on screen to copy by hand
    }
  }

  return (
    <Sheet title="Court captains" onClose={onClose}>
      <p className="text-sm text-mist">A captain link lets someone run one court from their own phone: start its games and save, undo or fix its results. Nothing else. Turn a link off and it stops working at once.</p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-500/15 px-4 py-3 text-rose-100">{error}</p>}
      {fresh && (
        <div className="mt-4 grid gap-2 rounded-2xl border-2 border-pickle-neon p-4">
          <p className="font-bold">{fresh.label}</p>
          <label className="grid gap-1 text-xs text-mist">Captain link for {fresh.courtLabel}
            <input readOnly value={fresh.url} onFocus={(event) => event.target.select()} className="w-full rounded-lg bg-ink px-3 py-2 font-mono text-xs text-white" />
          </label>
          <Button variant="neon" onClick={share}>Send link</Button>
          <p className="text-xs text-mist">Shown once. Send it now; you can always make another.</p>
        </div>
      )}
      <ul className="mt-4 grid gap-2">
        {courts.filter((court) => court.enabled).map((court) => {
          const links = captains.filter((c) => c.courtId === court.id)
          return (
            <li key={court.id} className="rounded-xl bg-navy-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{court.label}</span>
                <Button variant="ghost" disabled={busy} onClick={() => make(court)}>Make a link for {court.label}</Button>
              </div>
              {links.map((c) => (
                <div key={c.id} className="mt-2 flex items-center justify-between gap-2 text-sm">
                  <span className="text-mist">{c.label}</span>
                  <Button variant="danger" className="!min-h-11 !px-3" onClick={() => turnOff(c)} aria-label={`Turn off ${c.label}`}>Turn off</Button>
                </div>
              ))}
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
```

```jsx
// src/pickleball-open/SessionApp.jsx
import { useCallback, useEffect, useState } from 'react'
import { captainKeyFor, captainKeyFromHash, forgetCaptainKey, rememberCaptainKey } from './lib/captainKeys'
import { forgetHostedSession, hostedSessions, hostKeyFor, hostKeyFromHash, rememberHostedSession } from './lib/hostKeys'
import { useOpenSession } from './lib/useOpenSession'
import CaptainConsole from './components/CaptainConsole.jsx'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import HostConsole from './components/HostConsole.jsx'
import ViewerBoard from './components/ViewerBoard.jsx'

export default function SessionApp({ code }) {
  // Every key is read once, before anything is written: the saved host key is
  // the fallback if the link's key turns out to be wrong (a mistyped or stale
  // link must not cost the host the key this phone already had).
  const [keys] = useState(() => {
    const captainFragment = captainKeyFromHash(window.location.hash)
    return {
      fragment: hostKeyFromHash(window.location.hash),
      saved: hostKeyFor(code),
      captainFragment,
      captain: captainFragment ?? captainKeyFor(code),
    }
  })
  const [fellBack, setFellBack] = useState(false)
  const hostKey = keys.fragment && !fellBack ? keys.fragment : keys.saved
  const canFallBack = Boolean(keys.fragment && keys.saved && keys.saved !== keys.fragment && !fellBack)
  // A host key always wins: a host who opens a captain link still hosts.
  const captainKey = hostKey ? null : keys.captain

  const onRejected = useCallback((key) => {
    if (key === keys.fragment && keys.saved && keys.saved !== keys.fragment) setFellBack(true)
  }, [keys])
  const { status, viewer, host, captain, captainRevoked, authFailed, setHost, setCaptain } = useOpenSession(code, hostKey, { onRejected, captainKey })

  // Keys are removed from the address bar so they are never left on screen or
  // in a screenshot of the URL (spec §3.3), and saved straight away so closing
  // the tab before the board loads loses nothing.
  useEffect(() => {
    if (!keys.fragment && !keys.captainFragment) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    if (keys.fragment) {
      const previousName = hostedSessions().find((entry) => entry.code === code)?.name ?? ''
      rememberHostedSession({ code, hostKey: keys.fragment, name: previousName })
    }
    if (keys.captainFragment) rememberCaptainKey(code, keys.captainFragment)
  }, [keys, code])

  useEffect(() => {
    if (host && hostKey) rememberHostedSession({ code, hostKey, name: host.viewer.name })
  }, [host, hostKey, code])

  useEffect(() => {
    if (status === 'not-found' || authFailed) forgetHostedSession(code)
    if (status === 'not-found' || captainRevoked) forgetCaptainKey(code)
  }, [status, authFailed, captainRevoked, code])

  // The link's key was refused: put the saved key back (the link's key replaced it on open).
  useEffect(() => {
    if (fellBack) rememberHostedSession({ code, hostKey: keys.saved, name: hostedSessions().find((entry) => entry.code === code)?.name ?? '' })
  }, [fellBack, keys, code])

  if (!code || status === 'not-found') return <ExpiredNotice />
  if (host && hostKey && !authFailed) return <HostConsole code={code} hostKey={hostKey} host={host} status={status} onHost={setHost} />
  if (captain && captainKey) return <CaptainConsole code={code} captainKey={captainKey} snapshot={captain} status={status} onSnapshot={setCaptain} />
  if (!viewer) return <p className="p-8 text-center text-mist" role="status">Loading the board…</p>
  return <ViewerBoard viewer={viewer} status={status} invalidHostLink={authFailed && !canFallBack} revokedCaptainLink={captainRevoked} />
}
```

`src/pickleball-open/components/HostConsole.jsx`:
1. Add `import CaptainsSheet from './CaptainsSheet.jsx'`.
2. Replace `const { send, pending, error, clearError } = useCommandQueue(code, hostKey, onHost)` with

```jsx
  const credentials = useMemo(() => ({ hostKey }), [hostKey])
  const { send, pending, error, clearError } = useCommandQueue(code, credentials, onHost)
```

3. In the More menu, make this the first item:

```jsx
              <Button variant="ghost" onClick={() => { setMenuOpen(false); setDialog({ type: 'captains' }) }}>Court captains</Button>
```

4. Next to the other dialogs, add:

```jsx
      {dialog?.type === 'captains' && (
        <CaptainsSheet code={code} hostKey={hostKey} courts={host.courts} captains={host.captains} onHost={onHost} onClose={() => setDialog(null)} />
      )}
```

`src/pickleball-open/components/ViewerBoard.jsx`:
1. Change the signature to `export default function ViewerBoard({ viewer, status, invalidHostLink, revokedCaptainLink = false })`.
2. Add, directly above the `{invalidHostLink && …}` line:

```jsx
      {revokedCaptainLink && <p role="alert" className="rounded-xl bg-amber-400/15 px-4 py-3 text-amber-100">This captain link was turned off by the host. You're seeing the player board.</p>}
```

- [ ] **Step 6: Guide and landing copy**

`src/pages/pickleball/how-it-works.astro`, in `steps`, insert after the `Tap the result` entry:

```js
  { title: 'Hand a court to a captain', body: 'From More, make a captain link for a court and send it to a helper. On their own phone they can start that court’s games and save, undo or fix its results, nothing else. Turn the link off and it stops working at once.' },
```

`src/pages/pickleball/index.astro`, in `features`, insert after `One person, every court`:

```js
  { title: 'Court captains', body: 'Send a helper a link that runs one court from their own phone: start its games, save and fix its results. Turn it off and it stops working at once.' },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run && npm run lint && npm run typecheck`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball --project=worker`
Expected: PASS. This includes the earlier host tests, which now go through the credentials-based queue.

- [ ] **Step 8: Commit**

```markdown
- Open play: court captains on the host console (More → Court captains): make a link per court, send it, turn it off; the captain's phone shows just that court with Start, Game over, undo and edit, and drops to the public board the moment the link is turned off.
```

```bash
git add src tests/e2e/pickleball CHANGELOG.md
git commit -m "feat(pickleball): captain console and captain links on the host console"
```

---

### Task 13: TV board

**Files:**
- Create: `src/pickleball-open/lib/tvLayout.js`, `src/pickleball-open/lib/tvLayout.test.js`
- Create: `src/pickleball-open/TvBoard.jsx`, `src/pages/pickleball/s/[code]/tv.astro`
- Modify: `src/pickleball-open/lib/hostKeys.js`, `src/pickleball-open/lib/hostKeys.test.js`, `src/pickleball-open/components/ShareSheet.jsx`
- Modify: `src/pages/pickleball/how-it-works.astro`, `src/pages/pickleball/index.astro`, `tests/e2e/pickleball/pickleball-public-pages.spec.js`
- Modify: `tests/e2e/pickleball/open-play.spec.js`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `useOpenSession(code, null)` (viewer only), `FairnessPanel({ fairness, tv: true })` (Task 8), `QrCode` `label` (Task 10), `viewer.fairness` and `viewer.settings.selfCheckIn` (Task 7).
- Produces:
  - `tvColumns(courts): number`, `tvRows(courts): number`, `PANEL_MS`, `PANELS`.
  - `TvBoard({ code })`: each court carries `data-testid="tv-court"`, and the side panel is a region named `Standings` or `Recent results`.
  - `tvLink(origin, code)`; page `/pickleball/s/{code}/tv`.

- [ ] **Step 1: Write the failing tests**

```js
// src/pickleball-open/lib/tvLayout.test.js
import { describe, expect, it } from 'vitest'
import { tvColumns, tvRows } from './tvLayout'

describe('tv layout', () => {
  it('fits every court count from 1 to 16 in at most 4 columns and 4 rows', () => {
    for (let n = 1; n <= 16; n += 1) {
      expect(tvColumns(n), `${n} courts`).toBeLessThanOrEqual(4)
      expect(tvRows(n), `${n} courts`).toBeLessThanOrEqual(4)
      expect(tvColumns(n) * tvRows(n)).toBeGreaterThanOrEqual(n)
    }
  })

  it('uses a square-ish grid for common counts', () => {
    expect([1, 2, 3, 4, 6, 8, 9, 12, 16].map((n) => `${tvColumns(n)}x${tvRows(n)}`))
      .toEqual(['1x1', '2x1', '3x1', '2x2', '3x2', '4x2', '3x3', '4x3', '4x4'])
  })

  it('clamps nonsense to one court', () => {
    expect(tvColumns(0)).toBe(1)
    expect(tvColumns(Number.NaN)).toBe(1)
    expect(tvColumns(40)).toBe(4)
  })
})
```

Add to `hostKeys.test.js` (import `tvLink`):

```js
  it('builds the TV board link', () => {
    expect(tvLink('https://x.test', 'ABCDE23456')).toBe('https://x.test/pickleball/s/ABCDE23456/tv')
  })
```

Append to `tests/e2e/pickleball/open-play.spec.js`:

```js
test.describe('TV board', () => {
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    test(`16 courts fit a ${width}×${height} screen with no scrolling, in type readable across a hall`, async ({ page, request }) => {
      const { code } = await createSession(request, { courtCount: 16, players: Array.from({ length: 70 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      await page.setViewportSize({ width, height })
      await page.goto(`/pickleball/s/${code}/tv`)
      await expect(page.getByTestId('tv-court')).toHaveCount(16)
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.documentElement.scrollHeight <= window.innerHeight)
      expect(fits).toBe(true)
      if (height === 1080) {
        // About 5 m from a 1080p screen: names at least 24 px tall.
        const size = await page.getByTestId('tv-court').first().evaluate((el) => parseFloat(getComputedStyle(el.querySelector('p')).fontSize))
        expect(size).toBeGreaterThanOrEqual(24)
      }
    })
  }

  test('the TV shows the fairness panel and the check-in QR, and updates when a result is saved', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto(`/pickleball/s/${code}/tv`)
    await expect(page.getByTestId('fairness')).toBeVisible()
    await expect(page.getByRole('img', { name: 'QR code for self check-in' })).toBeVisible()
    const host = await hostSnapshot(request, code, hostKey)
    expect((await command(request, code, hostKey, { type: 'RECORD_RESULT', matchId: host.courts[0].match.id, winner: 'A', scoreA: 11, scoreB: 4 })).status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Standings' })).toContainText('1–0')
  })

  test('the host opens the TV board from Share', async ({ page, request }) => {
    const { code, hostKey } = await createSession(request)
    await page.goto(`/pickleball/s/${code}#host=${hostKey}`)
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByRole('link', { name: 'Open the TV board' })).toHaveAttribute('href', new RegExp(`/pickleball/s/${code}/tv$`))
  })

  // Spec §11: every key screen at 390, 768, 1280 and 1920 px with no sideways scroll.
  for (const width of [390, 768, 1280, 1920]) {
    test(`check-in, captain and TV screens fit a ${width}px screen without sideways scrolling`, async ({ browser, request }) => {
      const { code, hostKey } = await createSession(request, { courtCount: 8, players: Array.from({ length: 30 }, (_, i) => ({ name: `Player ${i + 1}` })) })
      const host = await hostSnapshot(request, code, hostKey)
      const made = await request.post(`/api/pickleball/open/s/${code}/captains`, { headers: { 'X-Host-Key': hostKey }, data: { courtId: host.courts[0].id } })
      const { captainKey } = await made.json()
      for (const path of [`/pickleball/s/${code}/check-in`, `/pickleball/s/${code}#cap=${captainKey}`, `/pickleball/s/${code}/tv`]) {
        // A fresh context per screen, so a remembered captain key never leaks into the next one.
        const context = await browser.newContext({ viewport: { width, height: 900 } })
        const screen = await context.newPage()
        await screen.goto(path)
        await expect(screen.locator('main, [data-testid="court-1"]').first()).toBeVisible()
        expect(await screen.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true)
        await context.close()
      }
    })
  }
})
```

In `pickleball-public-pages.spec.js`:
1. Remove `'tv mode'` from the banned list.
2. Add `'TV board'` to both the guide claims and the landing claims of `the guide and landing page describe the stacking modes and rules`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pickleball-open/lib`
Expected: FAIL, because `./tvLayout` and `tvLink` are missing.

Run: `npx playwright test tests/e2e/pickleball --project=worker -g "TV board|describe the stacking"`
Expected: FAIL, because `/tv` is 404.

- [ ] **Step 3: Write the layout helper, the board and the page**

```js
// src/pickleball-open/lib/tvLayout.js
// TV board grid (spec §7, §11): every court on one screen, readable from about
// 5 m on a 1080p screen. Columns grow with the court count; the type size
// shrinks with the columns so four names always fit a card.
const COLUMNS = [1, 1, 2, 3, 2, 3, 3, 4, 4, 3, 4, 4, 4, 4, 4, 4, 4]

/** Columns for n courts on a landscape screen: 1→1, 2→2, 3→3, 4→2×2, 5–6→3, 7–8→4, 9→3×3, 10–16→4. */
export function tvColumns(courts) {
  const n = Math.max(1, Math.min(16, Math.trunc(courts) || 1))
  return COLUMNS[n]
}

export function tvRows(courts) {
  const n = Math.max(1, Math.min(16, Math.trunc(courts) || 1))
  return Math.ceil(n / tvColumns(n))
}

/** The side panel cycles every PANEL_MS: standings, then recent results. */
export const PANEL_MS = 15_000
export const PANELS = ['standings', 'results']
```

```jsx
// src/pickleball-open/TvBoard.jsx
// TV mode (spec §7, §11): the same allowlisted viewer snapshot as the board,
// in large type, filling any screen with 1–16 courts and no scrolling.
// The side panel alternates standings and recent results.
import { useEffect, useState } from 'react'
import { formatPublicCode } from '../lib/pickleball/open/codes'
import { MODE_INFO } from '../lib/pickleball/open/modes/info'
import { checkInLink, viewerLink } from './lib/hostKeys'
import { PANEL_MS, PANELS, tvColumns, tvRows } from './lib/tvLayout'
import { useOpenSession } from './lib/useOpenSession'
import ExpiredNotice from './components/ExpiredNotice.jsx'
import FairnessPanel from './components/FairnessPanel.jsx'
import QrCode from './components/QrCode.jsx'

const STATE_LABEL = { PLAYING: 'Playing', UP_NEXT: 'Walk on now', WAITING_FOR_PLAYERS: 'Waiting for players' }

function usePanel() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => (i + 1) % PANELS.length), PANEL_MS)
    return () => clearInterval(timer)
  }, [])
  return PANELS[index]
}

function TvCourt({ court }) {
  const live = court.state === 'PLAYING'
  return (
    <article className={`flex min-h-0 flex-col justify-center gap-[0.4em] overflow-hidden rounded-[1.25rem] p-[0.6em] ${court.state === 'UP_NEXT' ? 'border-4 border-pickle-neon bg-ink' : 'bg-navy-900'}`} data-testid="tv-court">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="truncate text-[1.1em] font-bold text-pickle-neon">{court.label}</h2>
        <span className={`shrink-0 text-[0.6em] font-bold uppercase tracking-[0.08em] ${live ? 'text-mist' : 'text-pickle-neon'}`}>{STATE_LABEL[court.state]}</span>
      </div>
      {court.teamA.length > 0 && (
        <div className="grid gap-[0.15em] text-[1em] font-semibold leading-tight">
          <p className="truncate"><span className="mr-[0.3em] inline-block h-[0.55em] w-[0.55em] rounded-full bg-pickle-neon" aria-hidden="true" />{court.teamA.join(' & ')}</p>
          <p className="truncate"><span className="mr-[0.3em] inline-block h-[0.55em] w-[0.55em] rounded-full bg-pickle-teamb" aria-hidden="true" />{court.teamB.join(' & ')}</p>
        </div>
      )}
    </article>
  )
}

export default function TvBoard({ code }) {
  const { status, viewer } = useOpenSession(code, null)
  const panel = usePanel()
  if (!code || status === 'not-found') return <ExpiredNotice />
  if (!viewer) return <p className="grid h-screen place-items-center text-3xl text-mist" role="status">Loading the board…</p>

  const courts = viewer.courts.filter((c) => c.state !== 'OFF')
  const cols = tvColumns(courts.length)
  const rows = tvRows(courts.length)
  // Card type size: wide enough for "Name & Name" in a card, tall enough for 3 lines plus the label.
  const courtFont = `min(${(5.2 / cols).toFixed(2)}vw, ${(11 / rows).toFixed(2)}vh)`
  const qrUrl = viewer.settings.selfCheckIn ? checkInLink(window.location.origin, code) : viewerLink(window.location.origin, code)

  return (
    <main className="grid h-screen grid-cols-1 gap-[1.2vw] overflow-hidden p-[1.2vw] md:grid-cols-[minmax(0,1fr)_minmax(18rem,26vw)]">
      <section aria-label="Courts" className="grid min-h-0 gap-[1vw]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`, fontSize: courtFont }}>
        {courts.map((court) => <TvCourt key={`${court.id}-${court.teamA.join()}`} court={court} />)}
      </section>
      {/* The side panel needs a TV-sized screen; on a phone the regular board is the better view. */}
      <aside className="hidden min-h-0 flex-col gap-[1vw] overflow-hidden md:flex">
        <header>
          <p className="flex items-center gap-2 text-[clamp(0.9rem,1.1vw,1.5rem)] font-bold text-pickle-neon">
            <span className={`h-3 w-3 rounded-full bg-pickle-neon ${viewer.status === 'ACTIVE' ? 'pb-pulse' : ''}`} aria-hidden="true" />
            {viewer.status === 'ACTIVE' ? 'LIVE' : 'ENDED'} · {MODE_INFO[viewer.settings.mode]?.label ?? 'Paddle stack'}
            {status !== 'open' && <span className="text-amber-200"> · reconnecting</span>}
          </p>
          <h1 className="truncate text-[clamp(1.5rem,2.2vw,3rem)] font-bold">{viewer.name}</h1>
        </header>
        <div className="flex items-center gap-[1vw]">
          <QrCode url={qrUrl} size={150} label={viewer.settings.selfCheckIn ? 'QR code for self check-in' : 'QR code for the player board'} />
          <div className="min-w-0">
            <p className="text-[clamp(0.9rem,1.1vw,1.5rem)] text-mist">{viewer.settings.selfCheckIn ? 'Scan to check in' : 'Scan to follow on your phone'}</p>
            <p className="text-[clamp(1.25rem,1.8vw,2.5rem)] font-bold tracking-[0.08em] text-pickle-neon">{formatPublicCode(code)}</p>
          </div>
        </div>
        <section aria-label="Up next">
          <h2 className="text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon">Up next</h2>
          <ol className="mt-1 flex flex-wrap gap-2 text-[clamp(1rem,1.3vw,1.75rem)]">
            {viewer.waiting.slice(0, 8).map((w, i) => <li key={w.id} className="rounded-full bg-navy-800 px-3 py-1">{i + 1} · {w.name}</li>)}
            {viewer.waiting.length === 0 && <li className="text-mist">Everyone is on court</li>}
          </ol>
        </section>
        <FairnessPanel fairness={viewer.fairness} tv />
        <section aria-label={panel === 'standings' ? 'Standings' : 'Recent results'} className="min-h-0 flex-1 overflow-hidden">
          <h2 className="text-[clamp(1rem,1.4vw,1.75rem)] font-bold uppercase tracking-[0.12em] text-pickle-neon">{panel === 'standings' ? 'Standings' : 'Recent results'}</h2>
          {panel === 'standings' ? (
            <ol className="mt-1 grid gap-1 text-[clamp(1rem,1.3vw,1.75rem)]">
              {viewer.standings.filter((row) => row.rank !== null).slice(0, 10).map((row) => (
                <li key={row.playerId} className="flex justify-between gap-2"><span className="truncate"><b className="text-pickle-neon">{row.rank}</b> {row.name}</span><span className="shrink-0 text-mist">{row.wins}–{row.losses}</span></li>
              ))}
            </ol>
          ) : (
            <ul className="mt-1 grid gap-1 text-[clamp(1rem,1.2vw,1.6rem)]">
              {viewer.recentResults.slice(0, 6).map((r) => (
                <li key={r.matchId} className="truncate">{r.courtLabel}: <b>{(r.winner === 'A' ? r.teamA : r.teamB).join(' & ')}</b>{r.scoreA !== null && ` ${Math.max(r.scoreA, r.scoreB)}–${Math.min(r.scoreA, r.scoreB)}`}</li>
              ))}
              {viewer.recentResults.length === 0 && <li className="text-mist">No results yet</li>}
            </ul>
          )}
        </section>
      </aside>
    </main>
  )
}
```

```astro
---
// src/pages/pickleball/s/[code]/tv.astro
import PickleballAppShell from '../../../../layouts/PickleballAppShell.astro'
import TvBoard from '../../../../pickleball-open/TvBoard.jsx'
import { normalizePublicCode } from '../../../../lib/pickleball/open/codes'

const code = normalizePublicCode(Astro.params.code ?? '') ?? ''
---
<PickleballAppShell title="TV board — Devlab Pickleball">
  <TvBoard code={code} client:only="react" />
</PickleballAppShell>
```

`src/pickleball-open/lib/hostKeys.js`, append:

```js
export function tvLink(origin, code) {
  return `${origin}/pickleball/s/${code}/tv`
}
```

`src/pickleball-open/components/ShareSheet.jsx`:
1. Import `tvLink` with the other `hostKeys` imports.
2. Add, just before the closing `</Sheet>`:

```jsx
      <a href={tvLink(origin, code)} target="_blank" rel="noopener" className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-navy-700 px-4 font-semibold hover:bg-navy-900">Open the TV board</a>
```

- [ ] **Step 4: Guide and landing copy**

`how-it-works.astro`, in `steps`, insert after `Save your host link, share the board`:

```js
  { title: 'Put the board on a TV', body: 'Open the TV board from Share on a venue screen. Every court, who is up next, the standings and the fairness numbers, in type big enough to read across the hall, with the check-in code in the corner.' },
```

`index.astro`, in `faqs`, replace the big-screen answer with:

```js
  { q: 'Can I use it on a tablet, laptop or big screen?', a: 'Yes. The courts reflow to fit any screen, from a phone to a wide monitor, and the TV board shows every court in large type on a venue screen.' },
```

and add to `features`, after `Court captains`:

```js
  { title: 'A TV board for the venue', body: 'Every court, who is up next, standings and fairness numbers on one screen, readable from across the hall.' },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run && npm run lint && npm run typecheck && npm run build`
Expected: PASS.

Run: `npx playwright test tests/e2e/pickleball --project=worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```markdown
- Open play: a TV board (`/pickleball/s/{code}/tv`) for a venue screen: every court (1–16) on one screen in large type with no scrolling, who is up next, the fairness numbers and the check-in QR, with standings and recent results taking turns. Opened from Share.
```

```bash
git add src tests/e2e/pickleball CHANGELOG.md
git commit -m "feat(pickleball): tv board for open play"
```

---

### Task 14: Docs, full verification, and the preview deploy (no release)

**Files:**
- Modify: `docs/pickleball/architecture.md` (the "Free open play (2026-10)" section and the phase table)
- Modify: `docs/pickleball/runbook.md` (open play section)
- Modify: `CHANGELOG.md` (docs line only; **no version bump**: the MINOR release is cut later with the user)

- [ ] **Step 1: Write the docs**

`docs/pickleball/architecture.md`, in "Free open play (2026-10)". Keep it short and factual:
- **Modes.** Four stacking modes behind one `ModeInput`/`pickFour` interface, with the sit-out guard in `queueOrder`. The `DUE_WINDOW` rule applies to winners/losers and by-standing.
- **Rules.** Keep-together / keep-apart in `settings_json`, read through `normalizeSettings`.
- **Captains.** The actor model in `OpenSessionDO`: host or captain, captains in `open_captains`, revocation from memory. Captain sockets are demoted to viewers on revoke.
- **Check-in.** The anonymous `POST …/check-in`, with its two rate limits.
- **TV.** `/pickleball/s/{code}/tv` reads the viewer snapshot.
- **Migration.** `0017_open_captains.sql`.

In the phase table, change the Open play row's status to "Phase 2 built (preview), release pending".

`docs/pickleball/runbook.md`, under the open-play section:
- **Apply `0017`.** Same commands as `0016`, with the file name changed. Read back with `SELECT name FROM sqlite_master WHERE name = 'open_captains'` and `SELECT recorded_by FROM open_matches LIMIT 1`.
- **Inspect a session's captain links:** `SELECT id, label, court_id, created_at, revoked_at FROM open_captains WHERE session_id = (SELECT id FROM open_sessions WHERE public_code = ?)`.
- **Turn a captain link off by hand** (after reading it first): `UPDATE open_captains SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`. A running DO keeps its cached copy until it next reloads, so prefer the host's "Turn off" button or `DELETE …/captains/{id}`.
- **Check-in floods:** the 429 messages and the two limits (30 per 10 min per address, 60 per 5 min per session).

```markdown
- Docs: architecture and runbook cover Phase 2 open play (stacking modes, pair rules, captain links, self check-in, TV board, migration 0017).
```

```bash
git add docs/pickleball CHANGELOG.md
git commit -m "docs(pickleball): document phase 2 open play"
```

- [ ] **Step 2: Full local verification**

Run: `npm run typecheck && npm run build && npm run test:unit && npm run lint`
Expected: all pass.

Run: `npx playwright test`
Expected: the full suite passes, including `static`, `worker` and both Safari projects.

- [ ] **Step 3: Push `development` and apply 0017 to the preview D1**

Run: `git push origin development`
Expected: the preview deploy workflow runs.

Ask the user to paste a fresh `CLOUDFLARE_API_TOKEN` for this one command (`AGENTS.md`). Use it inline only, and never write it to a file or echo it.

Run: `CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 migrations apply devlab-pickleball-preview --remote --env preview`
Expected: `0017_open_captains.sql` applied.

Read back: `CLOUDFLARE_API_TOKEN=<pasted> npx wrangler d1 execute devlab-pickleball-preview --remote --env preview --command "SELECT name FROM sqlite_master WHERE name = 'open_captains'"`
Expected: one row.

- [ ] **Step 4: Verify on the preview URL**

On `https://devlab-studios-preview.stpnrey-agustinez.workers.dev`:
- **A session from before the deploy, if any is still live.** Open it as host, and confirm it loads and a result saves (Review Focus 1).
- **Create in "Winners play winners"** with 12 players on 2 courts. Play 3 rounds: winners face winners with partners split. Then switch to "Balanced teams"; the court on screen stays as it is.
- **Rules.** Add keep-together for two players and keep-apart for two others. Watch two rounds keep them.
- **Check-in.** Scan the check-in QR on a second phone; the new player appears on the board, and that phone's board highlights them.
- **Captain.** Make a captain link for Court 1, open it on a second phone, start and save a game. Turn it off: that phone shows the notice and loses its buttons.
- **TV.** Open the TV board on a laptop or TV at full screen with 8+ courts. It has no scrollbars and is readable from across the room.

Report what was checked, and any failure, to the user. **Stop here.** The version bump, `[Unreleased]` retitle, production migration and `main` fast-forward happen in a separate release step with the user (`AGENTS.md`, "Versioning and releases").

- [ ] **Step 5: Housekeeping**

Stop any local `wrangler dev` or `npm run preview` servers this work started (`tasklist //FI "IMAGENAME eq node.exe"`).

---

## Self-review notes (for the executor)

**Spec coverage, Phase 2 (§14 row 2):**

| Requirement | Task(s) |
|---|---|
| Winners/losers, shuffled (§5.2; owner) | T3 (engine), T8 (UI), T9 (copy) |
| By standing (§5.2) | T4, T8, T9 |
| Balanced (§5.2) | T5, T8 (skill per player), T9 |
| Mode visible and chosen at create, switchable mid-session (owner) | T5 (`MODE_INFO`), T6 (`SET_MODE`, schema), T8 (create form, console, board label) |
| Sit-out guard and repeat avoidance in every mode (§5.2) | T2 (`queueOrder` input, `pickFour`), T3–T5 (property tests for all four modes) |
| Keep together / keep apart, hard constraints, unproposed court with a message (§5.4; owner) | T2 (engine), T6 (commands, edit refusal), T7 (`blocked`), T8 (`RulesPanel`, court message), T9 (copy) |
| Fairness panel on console and TV (§5.5) | T7 (`fairnessSummary`), T8 (`FairnessPanel`, player rows), T13 (TV) |
| QR self check-in, host can turn it off, rate limits, roster cleaning (§4.2, §10) | T10 |
| Court captain links: per-captain secret, record/undo, scope, revocation (§3.3, §3.4, §5.4) | T1 (table), T11 (server), T12 (screens) |
| "Already saved by Court captain N" (§3.4) | T1 (`recorded_by`), T11 (e2e) |
| TV mode, 1–16 courts, readable from 5 m, same allowlist (§7, §11) | T13 |
| Viewer allowlist unchanged in spirit (§7) | T7 and T11 tests (no skill, DUPR, rules, captains, hashes) |
| One diagram per mode, CSS-only motion (§11) | T9 |
| Copy rule; banned words lifted as features ship (§11) | T9, T12, T13 |
| Responsive, no sideways scroll (§11) | Phase 1 e2e kept green (T8), TV fit tests (T13) |
| CHANGELOG line per commit; MINOR, no bump here | every task; T14 |

**Deferred by design:**
- Tournaments (Phase 3).
- Google sign-in and the DUPR export (Phase 4); the DUPR ID collected at check-in is only stored.
- Retiring the logged-in app (Phase 5).

**Names that cross tasks:**
- `normalizeSettings`, `touch`, `LoadedSession`, `insertCaptain`, `revokeCaptain` (T1).
- `activeRules`, `pickFour`, `keepsRules`, `ruleViolation`, `ModeInput`, `bestSplit`, `splitTeams`, `proposalBlocker`, `simulate` (T2).
- `dueWindow`, `lastGames`, `setKey`, `byWait` (T3).
- `MODE_INFO`, `MODE_ORDER`, `rotationExample(rounds, mode)` (T5).
- `minActiveGames`, `returnLevel`, `stackingModeSchema` (T6).
- `fairnessSummary`, `toHostSnapshot(state, captains)`, `toCaptainSnapshot` (T7).
- `ModePicker`/`ModeSheet`, `FairnessPanel`, `useNow`/`minutesSince`, `hostSnapshot` e2e helper (T8).
- `applyCheckIn`, `checkInLink`, `readMe`/`writeMe`, `ShareSheet` (T10).
- `captainRefusal`, `findCaptain`, `captainLabel`, `Credentials`, `credentialsFrom` (T11).
- `captainLink`, `authHeaders`, `useCommandQueue(code, credentials, onSnapshot)`, `useOpenSession(…, { captainKey })` (T12).
- `tvColumns`, `tvRows`, `tvLink` (T13).

**Verified while writing this plan:** every engine and repository module, and every unit test, in Tasks 1–7, 10 and 11 were run against a copy of the current code at `5388fd1`, and pass under the repo's `strict` TypeScript settings. The client components in Tasks 8, 10, 12 and 13 pass the repo's ESLint config (React Hooks 7) and an esbuild JSX parse. Simulation backed the "sit out at most 2 rounds" guarantee for every mode: 4 modes × 16 player/court shapes × 25 seeds × 40 rounds.
