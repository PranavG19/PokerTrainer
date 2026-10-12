# Technical architect: how the expansion fits into the Offsuit codebase

Panel lens: architecture, data, assets, performance, network, tests, and how to split the work.
Read at `dc4a9b8` on `glass-full-redesign`. Nothing here is built. Every persisted-schema item is a
proposal **reserved for the owner's approval**.

---

## 0. Owner decisions, up front

The expansion runs into rules the code already enforces, not just ones written down. These need a yes or
no before any agent writes code:

| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| D1 | **Amend PRODUCT-SPEC N1 ("Nothing is ever locked… no level, no unlock animation")** | `navigation.spec` fails if any tab is disabled or hidden on a fresh profile. Levels and a campaign that *gate content* break it. | Levels, leagues and campaign chapters gate **cosmetics and story beats only, never a mode, lesson, drill or tool**. Keep N1 for features. Write it as a v2.2 amendment, the same way v2.1 added Standing (PRODUCT-SPEC:544). |
| D2 | **Amend the non-goals list (PRODUCT-SPEC:542)**: it still names XP, streaks, cosmetics, a shop, ICM, tournaments and HH import as non-goals. The 2026-08-14 decision only lifted the *vocabulary* ban (`progress.ts:442`, `guard.ts`). | Agents will hit spec text that contradicts the task. | One amendment that lists each of these as in scope, with what stays banned. |
| D3 | **Praise and trait bans stay in force for the character.** `BANNED_PHRASINGS` (progress.ts:448: "you are", "you're", "great job", "well done", "keep it up") and the guard's `praise:phrase` rule (guard.ts) are pedagogy rules, not gamification rules. | A tutor character whose lines say "You're on fire!" or "Nice hand!" would fail the existing lint. | Character lines go through the same lint in a unit test. Celebrations describe the **effort or the fact** ("Day 7 in a row", "Puzzle solved clean"), never the person. G3 ("Silence is not praise") and sound.ts ("no you-were-right chime") also stay. |
| D4 | **Profile schema change** (the `schemaVersion` key and the `progression` namespace, §2) | The persisted profile has no version field today, and `deserialize` drops unknown keys. | Approve the v1→v2 plan in §2, including the downgrade guard. |
| D5 | **Soft currency** | The bankroll is already "chips" (session.ts `DEFAULT_BANKROLL`), and v2.1 bans "chips-for-power". | If there is a currency, give it its own name. It is never convertible to or from bankroll, and it buys cosmetics only. Better still, have no currency and unlock cosmetics directly from milestones (no shop UI, no balance to manage). |
| D6 | **What may touch the network** (§6) | The no-network guarantee is measured from outside the app (`no-network.spec`, loopback proxy). | Nothing new leaves the machine by default. Global leagues, friends and cloud sync are out of scope or deferred to a separately opted-in backend. LAN and file-based alternatives ship instead. |
| D7 | **Clock injection for e2e** (`OFFSUIT_NOW`) | Streaks, quests and seasons can't be tested end to end without moving the clock. | Approve a main-process env flag, honoured only when `OFFSUIT_E2E=1`, exposed through one new IPC read. |
| D8 | **Vite config change**: `build.assetsInlineLimit: 0` (§4) | Vite inlines assets under 4 KB as `data:` URIs. The CSP (`default-src 'self'`, so `img-src` and `font-src` fall back to `'self'`) blocks `data:`, so small icons would fail silently. | Approve it in the first asset work package. |

---

## 1. Constraints read from the code (what any design must respect)

- **Pure core, no clock.** `src/core` has zero `Date.now()` calls. Every time-based module takes an
  explicit `now` (schedule.ts header: "a scheduler that reads the clock internally is a scheduler you
  cannot time-travel"). Streaks, quests and seasons must work the same way.
- **The profile is one JSON blob, written whole.** `renderer/main.ts` calls
  `io.saveState(serialize(session))` from about 20 sites. `store:save` (main.ts:229) writes whatever it
  receives through `saveWithBackup` (backup.ts: atomic write-temp-then-rename, 3 rolling `.bakN`).
  There is no `schemaVersion`. "Migration" today means `deserialize` (session.ts:569) reading every field
  tolerantly and falling back to defaults.
- **Unknown keys are dropped.** `deserialize` builds a fresh object from known keys and `serialize`
  writes only those. So an older build that opens a newer profile and then saves **erases the new
  fields**. Every addition so far was safe because no downgrade ever happened. Progression data (XP,
  cosmetics owned) is exactly what a user would be upset to lose.
- **Settings are separate.** `offsuit-settings.json` (store.ts) holds `tutorEnabled`,
  `multiplayerEnabled` and `theme`, merged through `writeSettings`. Theme is a device preference, not
  profile state. Cosmetic *equips* are a judgement call (§2).
- **Main-process tsconfig.** `tsconfig.main.json` pins `rootDir: "src"` so main can import `src/core`
  (store.ts already imports `core/backup.js`). Tutor types are kept in `src/main/tutor/types.ts` by
  convention.
- **IPC surface.** `preload.ts` exposes 18 methods. There is an `ipc-channels.test.ts`. Every new channel
  is a deliberate addition there.
- **Network.** `network.ts` cancels every non-local request on every session and silences Chromium. The
  only egress paths are the `aws` CLI child (tutor) and `node:net` (relay, opt-in, default OFF).
  `no-network.spec` checks this with an external proxy oracle, a positive control, an
  autoUpdater/crashReporter check, a switch check and a stray-session check.
- **CSP**, both in `index.html` and set as a header in main.ts:
  `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`. That means no `data:` or
  `blob:` images, fonts, workers or media, and no remote anything.
- **Rendering.** Plain DOM. Glyphs use `createElementNS`, never `innerHTML` (DECISIONS "Glyphs"). Equity
  runs **synchronously on the renderer main thread** (coach.ts uses `DISPLAY_ITERATIONS = 2000`). There
  are no Web Workers anywhere in `src`. `deal-perf.spec` pins "no main-thread long task" when dealing the
  flop.
- **Honesty modules.** `progress.ts` has "FIVE NUMBERS, AND ONLY FIVE" (`METRIC_KEYS`, asserted).
  `career.ts` already has `Milestone` and `PracticeCadence` (`currentRun` is a day streak computed from
  timestamps on UTC days). `standing.ts` is a ratchet from decision quality, never chips. Reuse these.
  Do not add XP to Progress.
- **Dialogue precedent.** `tableTalk.ts` is pure, has no RNG and no clock, chooses variants with a stable
  index, and holds an invariant that **in-hand banter is information-free** (keyed by action kind only;
  archetype flavour only after showdown). Rival characters inherit this rule.
- **Content precedent.** `src/core/lessons/` has typed data, `validate.ts`, `AUTHORING.md` and unit tests.
  Line banks and campaign chapters should copy this shape.

---

## 2. Module layout

### 2.1 New pure core modules (`src/core/`, no DOM, no clock, no fs)

| File | Responsibility | Inputs → outputs |
|---|---|---|
| `core/progression/types.ts` | Persisted shapes (below) and event types | — |
| `core/progression/events.ts` | `ProgressEvent` union derived from things the app already records: `hand-recorded`, `decision-graded`, `puzzle-solved`, `lesson-completed`, `assessment-finished`, `drill-block`, `chart-answer`, `lexicon-accepted` | `(prev: SessionState, next: SessionState) → ProgressEvent[]`. Events are a diff, so no screen has to remember to emit them. |
| `core/progression/xp.ts` | XP rules table, level curve, idempotent award | `award(ledger, events, dayKey) → ledger` |
| `core/progression/streak.ts` | Day streak, freezes, longest run | `(streak, dayKey, qualifyingActivity) → streak` |
| `core/progression/quests.ts` | Daily and weekly quest generation (seeded) and progress | `generate(seed, dayKey, profileSnapshot)`, `advance(quests, events)` |
| `core/progression/achievements.ts` | Catalogue and predicates (supersets `career.ts` milestones; reuse its ids) | `evaluate(state) → unlocked ids` |
| `core/progression/league.ts` | Ghost-league standings from seeded bots, weekly promotion | `table(seasonSeed, weekKey, myXpThisWeek) → rows` |
| `core/progression/season.ts` | Season calendar arithmetic (local week keys) | pure date math on integer day keys |
| `core/cosmetics/catalogue.ts` | Typed list of card backs, felts, chip sets, avatars, outfits, celebrations, themes, each with an unlock rule | static data plus `isUnlocked(item, progression)` |
| `core/cosmetics/validate.ts` | Catalogue checks: unique ids, every unlock rule resolvable, no item gates a feature | test-time and dev-time |
| `core/dialogue/types.ts`, `core/dialogue/select.ts` | Line-bank schema and the deterministic selector (§3) | `select(bank, event, ctx, memory, rng) → Line \| null` |
| `core/dialogue/banks/*.ts` | Authored line banks: tutor, each rival | data |
| `core/dialogue/lint.ts` | Applies `bannedPhrasingIn` and the guard's ban rules to every line | test helper |
| `core/campaign/types.ts`, `core/campaign/chapters/*.ts`, `core/campaign/run.ts` | Chapters made of scripted beats and seeded table configs (archetype mix, depth, seat count 2–6) built on `table.ts` and `archetypes.ts`; chapter completion rules | `nextBeat(progress, outcome)` |
| `core/pro/handHistory.ts` | Parser for one documented text format (PokerStars-style) to `HandRecord`-compatible records; size and line caps; tolerant of bad input | `parse(text) → {hands, errors}` |
| `core/pro/icm.ts` | Malmuth-Harville ICM with memoisation, O(2^n·n), n ≤ 10 | `icm(stacks, payouts) → equities` |
| `core/pro/leaks.ts` | Leak finder over imported or played hands, reusing `coach.ts` grading and `rw.ts` reach weighting | batch, chunkable (§5) |

All of these take `now`/`dayKey`/`seed` as arguments. **The renderer computes the local day key**
(`Math.floor((Date.now() - tzOffset) / 86_400_000)`) and hands core an integer. Streaks have to follow
the learner's midnight, not UTC. `career.ts`'s `currentRun` uses UTC (`dayIndex`), so that difference
needs one documented decision. Recommendation: progression uses the local day; Career keeps its UTC
cadence or switches with it, but the two must not disagree on screen.

### 2.2 Main process (`src/main/`)

| File | Addition |
|---|---|
| `store.ts` | `load()` runs `migrate()` (core) and snapshots before the first migrated save (§2.4); a downgrade guard on `save()` |
| `core/backup.ts` | `snapshotBeforeMigrate(file, fromVersion)`: an atomic copy to `offsuit-state.json.pre-v{N}`, never rotated out. Covered by `backup.test.ts`. |
| `main.ts` | New IPC handlers: `profile:export`, `profile:import` (via `dialog.showSaveDialog` / `showOpenDialog`; the renderer never sees a path it chose), `hh:import` (read file, size cap, return text or parsed result), `app:clock` (e2e only, D7), `tutor:flavour` (§3.4) |
| `preload.ts` | The matching methods. Update `ipc-channels.test.ts`. |
| `relaySession.ts` / `core/multiplayer.ts` | LAN league: new `ClientMessage` `{type:'league-card', card}` and `ServerMessage` `{type:'league', table}`, used only when hosting a league room (§6) |

Keep the main process thin. Nothing in progression needs Node, so it stays in core and runs in the
renderer, like every other reducer.

### 2.3 Renderer

| File | Notes |
|---|---|
| `screens/journey.ts` + `styles-journey.css` | A "you" hub for level, streak, quests, league, achievements and season. **Separate from Progress**, whose five-metric contract is asserted. Adding a twelfth tab means editing `TABS` (renderer/main.ts:204). The nav already holds 11 tabs at 900px, so this is a layout risk (§8). An alternative is to fold it into Profile or Career. |
| `screens/campaign.ts` + `styles-campaign.css` | Chapter map and beat player. Hands run on the existing table screen with a campaign config. |
| `screens/wardrobe.ts` | Cosmetics: browse, preview, equip |
| `screens/proTools.ts` (ICM, HH import, leaks) | Or new Train/Study rungs. Reuse `.g-seg` with `thumb.ts`. |
| `components/character.ts` | Builds the tutor/rival SVG with `createElementNS` and exposes `setExpression(name)` (§4) |
| `components/speechBubble.ts` | Shows one line and announces it to the existing a11y live region, the same one the coach announcer uses (`a11y-coach-announcer.spec`) |
| `components/celebration.ts` | Celebration effects using compositor-only properties (§5) |
| `components/questRing.ts`, `components/xpBar.ts` | Kit compositions. No new primitives unless they are added to `styles-glass.css` "Shared primitives". |
| `progressionHost.ts` | One observer: after every `session` change, diff → events → award → persist, in one `saveState`. **This is what keeps the ~20 `saveState` call sites unchanged.** |

### 2.4 Data model and migration (RESERVED FOR OWNER APPROVAL)

**Shape: one namespaced key in the existing profile, not a second file.** XP awarded for a hand that
was never saved, or the reverse, is a consistency bug that a second file invites. One atomic write
avoids it. The namespace keeps `session.ts` (which is in `ALWAYS_FULL` in affected-tests) down to a
one-line change: `progression: parseProgression(obj.progression)` delegating to
`core/progression/persist.ts`.

```ts
// core/progression/types.ts — persisted (proposal)
export interface ProgressionState {
  /** Lifetime XP, rolled up. The ledger below is bounded, so XP can NOT be re-derived from logs:
   *  hands are capped at MAX_HAND_LOG=500, so a derived total would fall when old hands trim. */
  xpTotal: number;
  /** Recent awards, newest last, bounded (500). `key` makes awards idempotent: 'hand:<id>',
   *  'puzzle:<id>:<attempt>', 'quest:<weekKey>:<questId>'. A replayed diff cannot double-award. */
  ledger: { key: string; xp: number; dayKey: number; source: XpSource }[];
  streak: { current: number; longest: number; lastDayKey: number | null; freezes: number;
            freezesUsedDayKeys: number[] };
  quests: { dayKey: number; weekKey: number; active: QuestInstance[]; completed: string[] };
  league: { seasonId: string; weekKey: number; tier: LeagueTier; weekXp: number;
            history: { weekKey: number; tier: LeagueTier; place: number }[] };   // bounded 52
  achievements: Record<string, { unlockedAt: number }>;                            // id → epoch ms
  cosmetics: { owned: string[]; equipped: Partial<Record<CosmeticSlot, string>> };
  campaign: { chapters: Record<string, { beat: number; completed: boolean; bestGrade?: number }> };
  dialogue: { seenOnce: string[] };   // bounded; only for 'once' lines (intro beats). Cooldowns are session-only.
  currency?: number;                  // ONLY if D5 says yes; never touches bankroll
}
export type CosmeticSlot = 'cardBack' | 'felt' | 'chips' | 'avatar' | 'outfit' | 'celebration' | 'theme';
```

**Where equips live.** `theme` is already a settings-file value (store.ts `THEMES`, `loadTheme`), checked
by `theme.spec`. Keep the device-level theme in settings. Put *owned* cosmetics in the profile, and
*equipped* items in the profile too, except theme. That way deleting the profile resets cosmetics, the
same way it resets progress. Wardrobe theme choices write through the existing `settings:setTheme`, and
`THEMES` grows only for themes that pass `theme.spec`'s paint-only rule.

**Versioning, forward-only:**

```ts
// core/migrate.ts — pure
export const SCHEMA_VERSION = 2;
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
const MIGRATIONS: Record<number, Migration> = {
  // v1 = every profile written before this change (no schemaVersion key).
  1: (raw) => ({ ...raw, schemaVersion: 2, progression: seedProgression(raw) }),
};
export function migrate(raw: Record<string, unknown>):
  { state: Record<string, unknown>; from: number; to: number; tooNew: boolean } { … }
```

- **v1 → v2 seeding is honest.** `seedProgression` backfills XP from what the bounded logs still contain
  (hands, assessments, `puzzleProgress`, `chartMastery` attempts). It sets
  `streak.current` from `career.ts`'s existing cadence calculation, and achievements from milestones that
  already hold. Nothing is invented. A learner with 3,000 lifetime hands gets XP for the 500 still in the
  log, plus `stats.handsPlayed`-based credit only if the owner approves that rule.
- **Snapshot before migrating.** On the first `load()` where `from < to`, `store.ts` calls
  `snapshotBeforeMigrate(STATE_FILE, from)` *before* any save. A rolling backup is not enough: three
  ordinary saves rotate the pre-migration file out of `.bak3` within one session.
- **Downgrade guard.** `schemaVersion > SCHEMA_VERSION` sets `tooNew`. That build loads read-only: Settings
  shows "this profile was written by a newer Offsuit", and `save()` refuses. That closes the
  unknown-keys-dropped hole. As a second line of defence, `serialize` copies unknown top-level keys
  through (`...passthrough`), so a future additive field survives a same-version round trip.
- **Recovery integration.** `loadWithRecovery` runs before migration. A `.bakN` from before v2 just
  migrates again. `profileStatus()` gains `migratedFrom: number | null` for Settings.
- **Delete** (`deleteProfile`) must also remove `*.pre-v*` snapshots, otherwise it "would not be a delete"
  (backup.ts comment). One more target in the list, and the `backup.test.ts` case gets updated.
- **Size.** Every bounded list keeps a `MAX_*` constant. Imported hand histories do **not** go in the
  profile (§5): they live in `offsuit-hh/` as one NDJSON file per import, read on demand. A full
  `JSON.stringify` of a 50k-hand profile on every action would cost more than one frame.

**Tests required by the migration package:** v1 fixtures taken from the existing e2e profile writers (18
specs write `offsuit-state.json`; listed in §7). Checks: migrate is idempotent; migrate(v1) followed by
deserialize keeps every v1 field byte-identical; tooNew refuses to save; snapshot exists before the first
save; delete removes the snapshot.

---

## 3. Character dialogue

### 3.1 Line banks as typed data

```ts
// core/dialogue/types.ts
export type DialogueEvent =
  | 'session-start' | 'streak-continued' | 'streak-broken' | 'quest-complete' | 'level-up'
  | 'verdict-shown' /* after the grader; never before commit */ | 'free-grade' | 'puzzle-solved'
  | 'lesson-complete' | 'idle' | 'campaign-beat' | 'rival-action' | 'rival-showdown';
export type Expression = 'neutral' | 'warm' | 'thinking' | 'wry' | 'concerned' | 'delighted' | 'sleepy';
export interface Line {
  readonly id: string;                         // stable; used by seenOnce, tests, replay
  readonly speaker: 'tutor' | RivalId;
  readonly event: DialogueEvent;
  readonly text: string;                       // lint-clean; no numerals unless templated from payload
  readonly expression: Expression;
  readonly weight?: number;                    // default 1
  readonly once?: boolean;                     // intro lines
  readonly cooldownEvents?: number;            // don't repeat within N selections of this event
  readonly when?: Condition;                   // see below
  readonly contexts?: readonly TutorContext[]; // where it may appear (muteMatrix vocabulary)
}
export type Condition =
  | { all: Condition[] } | { any: Condition[] } | { not: Condition }
  | { streakAtLeast: number } | { levelAtLeast: number } | { severity: 'free'|'minor'|'notable'|'serious' }
  | { chapter: string } | { firstTimeToday: true } | { errorTag: ErrorTag };
```

Conditions form a closed, serialisable union (no closures), so banks are data that `validate.ts` can
check: every `chapter` exists, every `errorTag` is in `progress.ts`'s `ERROR_TAGS`, every event has a
fallback line with no condition.

### 3.2 The deterministic selector

`select(bank, event, ctx, memory, rng)`:

1. **Gate by context first.** Reuse the T5 mute matrix as policy. The character is **silent** in
   `plm-drill`, `spot-pre-commit` and `assessment`, which matches `unpromptedCoach: 'never'`. In
   `table-whole-task` it batches to block end. `muteMatrix.ts` lives in `src/main/tutor/`. Add a pure
   twin of the `unpromptedCoach` table in `core/dialogue/policy.ts`, plus a unit test asserting the two
   tables agree cell for cell. That avoids a renderer import of a main-only module.
2. Filter by `event`, then `when`, `once` against `memory.seenOnce`, and cooldown against the in-memory
   recent list.
3. Weighted choice with `rng`, where `rng = mulberry32(hash(appSeed, event, ctx.handIndex ?? ctx.dayKey))`
   from `rng.ts`. **Same seed, same line**, so e2e can pin text (as `table-talk.spec` does for `quipFor`)
   and a replayed hand says the same things.
4. Returns `null` when nothing qualifies. Silence is a valid output (G3).

**The character never delivers the verdict.** The grader's text stays in the coach panel. The character
reacts after the verdict (`verdict-shown`) using severity and tag only. It must not restate EV or invent
numbers. `free-grade` lines stay neutral or say nothing (G3: "Silence is not praise"; the guard's
`praise:phrase` rule).

**Rivals.** During a hand, rival lines are keyed by `ActionKind` only, extending `tableTalk.ts`'s
invariant. Personality lines go on `rival-showdown` or campaign beats. A unit test asserts no in-hand
rival line differs across archetypes. This is the same leak guard O3 relies on.

**Lint gate (CI-hard).** `tests/unit/dialogue-lint.test.ts` runs every line in every bank through
`bannedPhrasingIn` (progress.ts) and `checkTutorOutput` (guard.ts), using a synthetic empty request so
any numeral fails provenance. It also enforces a per-line word cap (20 words recommended; the bubble has
to fit 900x640). This is the same "assert over every string, don't trust it" pattern `progress.ts` uses.

### 3.3 Persona memory

Session-only: the cooldown ring, last expression. Persisted (bounded): `seenOnce`. The character does not
remember the learner's mistakes in a way that becomes a trait claim. A line like "you always fold the
river" is banned (`trait:you-habitually`). If the character refers back to history, it goes through the
lexicon (`lexicon.ts` quotes the learner's own sentence, which is the approved mechanism).

### 3.4 Optional LLM flavour, with no change to the offline guarantee

- **The scripted line renders immediately, always.** Flavour is an optional *replacement* that arrives
  later or not at all. When `resolveTutor` returns `nullTutor` (no credentials, the default and the e2e
  path), `tutor:flavour` returns the scripted line in the same tick. So "zero network calls with no key"
  holds by construction, as it does today (tutor/index.ts T1).
- **Channel.** New `tutor:flavour` IPC with input `{lineId, event, context, severity?, errorTag?}`. The
  renderer sends **a line id and enums, never free text**. Main looks up the scripted line itself, so a
  compromised renderer cannot turn this into a general prompt relay.
- **Guard.** Output goes through `checkTutorOutput`, with the request being the scripted line plus enums,
  so numeral provenance means only numerals already in the scripted line. Then the dialogue word cap,
  then `bannedPhrasingIn`. On failure, retry once, then use the scripted line (the `liveTutor` pattern).
  Same mute-matrix gate as above, applied in main as well.
- **Rate.** At most one flavour call per hand or per screen event, debounced in main, with an LRU cache by
  `(lineId, enums)`. The character talks more often than the tutor rail, so cost and latency matter.
- **Network accounting.** This is the same egress path as today (`aws` CLI child, Bedrock host in
  `egressAllowlist`), so `no-network.spec` doesn't change. The Settings privacy statement
  (`settings:read`) must list "character flavour" as a use of the tutor connection. That's a string
  change there, and `settings.spec` may pin it.
- **Tests.** `replayCache.ts` already records and replays prompts by hash. Flavour gets its own
  namespace (`${hash}.flavour.json`) and a `tutor-live`-style spec gated on `OFFSUIT_LIVE_E2E`, so it
  stays out of the default suite.

---

## 4. Asset pipeline

**CSP facts that decide this.** `default-src 'self'` with no `img-src`, `font-src`, `media-src` or
`worker-src` means all of them fall back to `'self'`. Under `loadFile`, `'self'` is files next to
`index.html`. So:

- `data:` and `blob:` images, fonts, audio and workers are **blocked**. That includes CSS
  `background: url(data:…)`. **Vite inlines assets under 4 KB as `data:` by default**, so a small icon
  imported by URL would build fine and then not render. Set `build.assetsInlineLimit: 0` in
  `vite.config.ts` (D8). `vite.config.ts` is in `ALWAYS_FULL`, so this triggers a full run once.
- Inline SVG built in the DOM is not a fetch, so CSP does not apply. **That is the primary path.**
- `style-src 'unsafe-inline'` allows inline style attributes, which `thumb.ts` already uses. CSS custom
  properties set from JS are fine.

**Characters (tutor and rivals).** Author each as an SVG of named parts (`body`, `head`, `brow-l/r`,
`eye-l/r`, `lid-l/r`, `mouth-*`, `outfit-*`, `prop-*`). A small build-free script
(`scripts/svg-to-parts.ts`, run by hand with Node 26) turns the authored `.svg` into a TS module of path
data, `core`-free and committed:
`renderer/art/tutor.parts.ts` → `{ viewBox, parts: { id, d, fill: 'var(--char-skin)', … }[] }`.
`components/character.ts` builds it with `createElementNS`, the established glyphs pattern, never
`innerHTML`.

- **Expressions are CSS only.** The root gets `data-expression="wry"`. Each expression sheet shows or
  hides mouth variants (`opacity`) and moves brows and lids with `transform` (translate/rotate/scaleY).
  Blink is a `@keyframes` on `lid-*` `transform: scaleY()`, randomised per instance with an
  `animation-delay` custom property chosen from the seeded RNG so screenshots stay deterministic. In e2e,
  pause animations (`animation-play-state: paused` via an `html[data-e2e]` hook, or reduced motion).
- **Outfits and avatars** are swappable `<g>` layers from the same parts module. Colours come from
  `--char-*` tokens defined in `styles-glass.css` (the "no hex in screen sheets" rule).
- **Sprite sheets.** Avoid raster sprite sheets for characters. They don't scale on Retina, can't be
  recoloured by tokens, and frame-stepping them at 60 fps costs more paint than transforms. If a
  celebration needs frame animation, use one local `.webp` strip with `steps()` on `background-position`,
  loaded as a URL asset (allowed once inlining is off).

**Card backs, felts, chips.** CSS gradients and SVG patterns behind `data-cardback` / `data-felt` /
`data-chips` attributes on the table root. **Paint only, never layout.** `theme.spec` asserts this for
`html[data-theme]`; apply the same rule and extend that spec's measurement to the new attributes. The
felt-green role (table only) and the card bone stay fixed. Card *faces* are not cosmetic, because
legibility and the e2e card selectors depend on them.

**Fonts.** The app uses the system stack (`-apple-system…`, `ui-serif`). A character display face would
have to be a local `.woff2` under `src/renderer/fonts/`, loaded by `@font-face` with a relative URL
(`font-src` → `'self'`), with a licence file. DECISIONS (line ~234) already rejected a system-font file
hack under this CSP. Recommendation: no new font. If one is needed, one weight, subset, ≤ 40 KB.

**Audio.** `sound.ts` synthesises cues with Web Audio, no assets. Celebrations should do the same (a
short arpeggio), behind the existing `soundCues` switch (default false), and **never on a free grade**
(the sound.ts invariant). Files, if any, are local `.ogg` via `media-src 'self'`.

**Bundle budget** (proposal, enforced by a `scripts/bundle-budget.ts` check run after `vite build` in the
e2e build step):

| Bucket | Budget |
|---|---|
| Tutor and each rival parts module | ≤ 25 KB raw each (≤ 6 rivals) |
| Cosmetic CSS (all felts, backs, chips) | ≤ 40 KB |
| Line banks | ≤ 80 KB total; campaign chapters lazy-loaded with `import()` (Vite emits chunks next to index.html, which `script-src 'self'` allows) |
| Raster/audio assets | ≤ 500 KB total |
| Renderer JS growth for the whole expansion | ≤ +350 KB minified |

`no-network.spec`'s "local assets still load" test covers the loading mechanism. Add one assertion that
the character SVG and a lazy chunk render with the seal on.

---

## 5. Performance

- **The hot path today.** On a facing-bet decision, coach grading runs `equityVsRange` with 2,000 Monte
  Carlo iterations synchronously in the renderer. `deal-perf.spec` pins no long task at flop deal.
  Celebrations, bubbles and the progression diff all land at the *same moments* (hand end, verdict).
  Rules:
  1. Order: grade, then paint the verdict, then the next frame (`requestAnimationFrame`), then
     progression diff and award, then the celebration. The award is cheap (O(events)), but
     `serialize` + IPC of the whole profile is not free. Coalesce to one `saveState` per settled hand.
  2. Animate only `transform` and `opacity`. **No `backdrop-filter` on anything that moves.** DECISIONS
     notes that a full-window `backdrop-filter` re-blurs on every repaint, which is why the backdrop is
     pre-blurred. Celebrations sit in their own layer (`will-change: transform` only while running) and
     are removed afterwards.
  3. Particles: ≤ 40 DOM nodes, or one `<canvas>` if more. Respect `prefers-reduced-motion` (stillness
     plus a static badge).
  4. Idle character: one blink keyframe every 3–6 s. No continuous breathing animation over the table,
     because it keeps the compositor busy and costs battery.
- **New heavy compute.**
  - *ICM:* Malmuth-Harville with subset memoisation is about 10 ms at n=9. Fine synchronously.
  - *Leak finder and HH import over thousands of hands:* re-grading each decision costs 2,000 iterations.
    10k decisions is about 20M evaluations, which is seconds. It **must not** run on the UI thread.
    Option A: a renderer **module Worker** (`new Worker(new URL('./leakWorker.ts', import.meta.url),
    {type:'module'})`). Vite emits it as a file next to the bundle, and `worker-src` falls back to
    `script-src 'self'`. **Needs a spike**, because module workers from `file://` origins have had
    restrictions in Chromium. Option B, the fallback: time-sliced batches of ~200 iterations on
    `setTimeout(0)` with a progress bar and cancel. Option C: Electron `utilityProcess` in main, which is
    more IPC surface. Recommend spiking A, with B as the guaranteed fallback. Either way the grading code
    is the existing pure `coach.ts`/`equity.ts`. Do not fork it.
  - The parser streams line by line with hard caps (file ≤ 20 MB, ≤ 50k hands per import), mirroring
    `relayHost.ts`'s `MAX_MESSAGE_BYTES` discipline.
- **Perf gates.** Add `xp.award`, `select` and `icm(n=9)` to `tests/unit/perf.test.ts` using its
  self-scaling calibration ratios. Extend `deal-perf.spec` with one case where a level-up celebration
  fires on the same hand and still produces no long task.

---

## 6. What needs a backend, and the local/LAN alternatives

| Feature | Needs a server? | Breaks no-network? | Local/LAN alternative (recommended) |
|---|---|---|---|
| Streaks, XP, levels, quests, achievements, seasons | No | No | Pure core plus profile |
| Global leagues / leaderboards | Yes (ranking, identity, anti-cheat) | **YES** | **Ghost leagues**: 29 seeded bot "players" per week (`league.ts`; names and XP curves drawn from `mulberry32(seasonSeed ^ weekKey)`, calibrated to the learner's own recent pace). Clearly labelled as simulated. v2.1 says "no comparison to other players", and bots are not players, but the owner should confirm the wording. |
| Leagues with real friends | Server, or LAN | Through the relay only: an opt-in socket, already outside the seal and default OFF | **LAN league**: a host collects unsigned "league cards" (`{name, weekKey, xp, handsGraded}`) over the existing relay (`relayHost.ts` binds `127.0.0.1` by default; `lanAddresses()` for LAN). On a trusted network the host can't verify anything, so label it as honour system. |
| Friends list, presence, chat | Yes | **YES** | Not recommended. If it's wanted, it's a later, separate opt-in product. |
| Friend challenges | No | No | **Challenge codes**: a base32 string (~20 chars) encoding `{seed, seatCount, depth, archetypeMix, handCount, version}`. Both players play the same seeded deal offline and compare results by pasting a result code back (`{challengeHash, evLossBb, handsGraded, checksum}`). A QR rendering is possible as local SVG with a hand-written encoder (no dependency allowed). The checksum catches typos, not cheating. |
| Cloud sync / multiple devices | Yes | **YES** | **File export/import** of the profile: `profile:export` writes `offsuit-profile-YYYYMMDD.json` through a native save dialog. Import validates, migrates and snapshots the current profile first, then replaces it, behind a typed confirmation like `DELETE_CONFIRM_PHRASE`. |
| Anti-cheat | Yes (server-side replay validation) | **YES** | Nothing local is tamper-proof, since the user owns the JSON. That only matters if a ranking exists. With ghost leagues and honour-system LAN leagues there is nothing to protect. **This is the main argument against global leagues.** |
| Hand-history import | No | No | Local file dialog |
| ICM, leak finder | No | No | Pure core |
| LLM character flavour | Bedrock | No new path (existing opt-in `aws` CLI) | Scripted lines by default |
| Cosmetics store with real money | Payments backend | **YES** | Out of scope (PRODUCT-SPEC: no real money) |
| Remote seasonal content drops | CDN | **YES** | Seasons ship in the binary; a season is a calendar over bundled content |
| Telemetry / balancing analytics | Yes | **YES** | None. Balance XP curves with a local simulator script in `scripts/`. |

**Rule for agents:** any item marked **YES** is out of scope without a separate owner decision. If one is
ever approved, it gets its own opt-in, its own Settings disclosure, and its own path outside Electron's
session (as the tutor's CLI and the relay's `node:net` do today), plus a `no-network.spec` case proving
it is silent while off.

---

## 7. Testing strategy

**Unit (vitest, `tests/unit/`). Most of the coverage goes here.**

- One test file per core module (`xp`, `streak`, `quests`, `achievements`, `league`, `season`,
  `cosmetics-catalogue`, `dialogue-select`, `dialogue-lint`, `campaign`, `icm`, `handHistory`, `leaks`,
  `migrate`).
- **Time-travel tests** with explicit `dayKey` and `now`: streaks across DST, the 23:59 to 00:01 local
  boundary, freeze consumption, a 400-day simulated year, week and season rollover.
- **Idempotency:** applying the same diff twice awards once. Property test with seeded random event
  streams: XP is monotonic, the ledger stays bounded, `xpTotal` is at least the ledger sum.
- **Content validation** in the style of `lessons/validate.ts`: line banks, chapters and the cosmetic
  catalogue. Every unlock rule is reachable, and **no catalogue or chapter entry references a tab or
  mode as a reward** (the N1 guard).
- **Migration:** fixtures from real v1 profiles, round-trip identity on v1 fields, tooNew refusal,
  snapshot ordering (with fs in a tmp dir, as `backup.test.ts` does).
- **ICM** against published hand-calculated values. HH parser against a corpus of malformed inputs.
- `ipc-channels.test.ts` updated for each new channel.

**E2E (Playwright): small, fixture-driven, budgeted.** The suite is about 539 tests in roughly 45 minutes
on one worker, about 5 s per test. Budget for the whole expansion: **+60 tests, about 6 min.**

- **Seed profiles instead of playing.** 18 specs already write `offsuit-state.json` into the temp
  user-data dir before launch. Add `tests/e2e/fixtures/progression.ts` with builders (a level-7 profile,
  a profile one day into a streak, a profile with a quest one step from done). Play at most one hand per
  test to trigger an event.
- **Clock:** `OFFSUIT_NOW=<epoch>` (D7), read by main only when `OFFSUIT_E2E=1`, returned by
  `app:clock`. The renderer's local-day computation uses it. Relaunching with a later `OFFSUIT_NOW` tests
  streak continuation, which is the only honest end-to-end streak test.
- **New specs** (≤ 8 tests each): `journey.spec`, `streak.spec`, `quests.spec`, `character.spec`
  (bubble visible, announced, silent in assessment and pre-commit, fits both window sizes),
  `wardrobe.spec` (equip persists; paint-only measured as in `theme.spec`), `campaign.spec`,
  `pro-tools.spec`, `migration.spec` (launch with a v1 profile, then the snapshot file exists, then
  Settings reports the migration, then the old data is intact), `profile-transfer.spec`.
- **Extend, don't duplicate:** add new screens to the existing 900x640 / 1100x760 no-scroll loops in
  `layout.spec` and the screen-list loops in `screens.spec` and `a11y-labels.spec`, rather than writing
  new fit specs. Add the new routes to `SUITE_SURFACES` in `scripts/affected-tests.ts`. A screen missing
  there falls back to over-testing, which is safe but slow.
- **Determinism:** pause CSS animations under e2e. Choose lines from the app seed so text can be pinned.
- **Live-model flavour** only behind `OFFSUIT_LIVE_E2E`, like `tutor-live.spec`.
- **Screenshot hygiene:** e2e overwrites tracked `screenshots/`. Agents must `git checkout screenshots/`
  before committing (AGENTS.md).

---

## 8. Risks to existing e2e pins

| Pin / spec | Risk | Mitigation |
|---|---|---|
| `navigation.spec`: every tab enabled and visible, fresh profile | Level- or campaign-gated tabs | D1. Gate cosmetics only. |
| Nav fit at 900px (11 tabs, mark-only brand under 1040px; DECISIONS "Window and nav chrome"); title bar ≤ 52px pin | A 12th or 13th tab (Journey, Campaign) overflows | Put Journey inside Profile or Career and Campaign inside Learn or Play as a launcher row. No new tabs without a nav-fit measurement at 900x640. |
| Home 900x640 no-scroll (`session-plan.spec` 17, "Start above the fold"); standing on the bankroll row (`screens.spec`) | A streak flame, XP bar or quest ring on Home pushes the planner down | Only a compact streak/XP chip in the headline row with zero net height (the standing pattern), or inside the Suggested next section. Recent hands is the one block allowed to shrink. |
| `screens.spec` ban on "rank/percentile/**level**/elo/**tier**/leaderboard" in the standing label | "Level 7" or "Gold tier" leaking into the standing element | Keep level and tier strings out of `home-standing*`. Progression uses its own testids. |
| `BANNED_PHRASINGS` assertions (`progress.spec`, `train.spec`, `screens.spec`) | Character lines rendered on those screens | `dialogue-lint.test.ts` (§3.2) makes this a unit failure before e2e |
| `--positive` #3DDC97 = mint = "your turn, positive deltas, ON switch, never a balance" (`gameplay.spec`) | XP bars, streak flames and league promotion painted mint | XP and level use bone or neutral ink. Promotion uses amber ("notable"). Mint only for "+120 XP" deltas, which fits the delta role. |
| `--text-hi` #FFFFFF; to-act ring and `matrix(1.02…)` (`interaction.spec`:198); Fold has no box-shadow; seat opacity live > folded > busted | Cosmetic felts, chips and avatars restyling pods or seats | Cosmetic CSS may only set properties on an allowlist (background-image and colours of felt, card-back paint, chip fill), checked by a `wardrobe.spec` diff of computed style on the pinned elements with each cosmetic equipped |
| `theme.spec`: theme blocks paint only | New themes or felts changing radii or padding | Same allowlist |
| `deal-perf.spec`: no long task at flop | Celebration plus progression save on the same frame | Ordering rules in §5. Extend the spec. |
| `no-network.spec` (all 6) | Any CDN font, remote avatar, update check, analytics | CSP plus seal plus the §6 rule. Add an assertion that the character renders with the seal on. |
| `table-talk.spec` / O3 archetype hiding | Rival personality lines mid-hand reveal the archetype | Extend tableTalk's invariant to rivals, with a unit test |
| `a11y-coach-announcer.spec` | Bubbles flooding the live region and burying the verdict | Character lines use a separate `aria-live="polite"` region, announced after the verdict. The verdict keeps priority. |
| `persistence.spec`, `settings.spec` (backup count, recovery label, delete) | Snapshot files counted as backups; delete leaving `pre-v*` behind | `countBackups` unchanged (it counts `.bakN` only). Delete removes snapshots. `profileStatus` gains a separate field. |
| `ALWAYS_FULL` files (`session.ts`, `renderer/main.ts`, `preload.ts`, `main.ts`, `store.ts`, `vite.config.ts`) | Every package touching them triggers the full 45-minute suite | Batch hotspot edits into a few integration commits (§9) |

---

## 9. Work packages for a parallel agent swarm

Principle: **pure core packages are parallel and conflict-free. Hotspot files get one owner each and are
integrated in sequence.** Each package's definition of done is the AGENTS.md "Done" list: typecheck,
unit tests, full e2e on the final integration commit, screenshots at both sizes for UI work.

| WP | Package | Depends on | Files (new = N, touched = T) | Parallel? |
|---|---|---|---|---|
| **WP0** | Owner gate: spec amendment v2.2 (D1–D3, D5, D6) and approval of schema v2 (D4), D7, D8 | — | T `PRODUCT-SPEC.md`, `DECISIONS.md` | Blocks all code |
| **WP1** | Schema v2 and migration infrastructure | WP0 | N `core/migrate.ts`, `core/progression/types.ts`, `core/progression/persist.ts`; T `core/session.ts` (one key, passthrough), `core/backup.ts` (`snapshotBeforeMigrate`, delete targets), `main/store.ts`; N tests `migrate.test.ts`; T `backup.test.ts` | Serial. **Hotspot owner: session/store.** |
| **WP2** | Progression core: xp, streak, quests, achievements, season, league (ghost) | WP1 types only | N `core/progression/*.ts`, unit tests | Parallel (pure) |
| **WP3** | Dialogue engine, policy twin, lint, starter tutor bank | — (types only) | N `core/dialogue/*`, tests `dialogue-select`, `dialogue-lint`, `dialogue-policy` (reads `main/tutor/muteMatrix.ts` in test) | Parallel (pure) |
| **WP4** | Character art: parts script, tutor parts module, `components/character.ts`, expression CSS, `speechBubble.ts` | D8 | N `scripts/svg-to-parts.ts`, `renderer/art/*`, `components/character.ts`, `components/speechBubble.ts`, `styles-character.css`; T `vite.config.ts` (`assetsInlineLimit: 0`), `styles-glass.css` (`--char-*` tokens only) | Parallel. vite.config is a one-line hotspot. |
| **WP5** | Cosmetics catalogue, validation, paint-only CSS for backs, felts and chips | WP1 types | N `core/cosmetics/*`, `styles-cosmetics.css`; T `screens/table.ts` / `components/card.ts` (data attributes only) | Parallel. card.ts and table.ts are near-hotspots: attributes only, no layout. |
| **WP6** | Test infrastructure: `OFFSUIT_NOW` and `app:clock`, progression fixtures, bundle-budget script, `SUITE_SURFACES` entries, animation pause under e2e | D7 | T `main/main.ts`, `main/preload.ts`, `ipc-channels.test.ts`, `scripts/affected-tests.ts`; N `tests/e2e/fixtures/progression.ts`, `scripts/bundle-budget.ts` | Serial with WP1 (hotspots). Do it early. |
| **WP7** | Integration A: `progressionHost.ts` (diff → award → single save), Journey surface, Home chip, character on Home and table, `journey`/`streak`/`quests`/`character` specs | WP1–4, WP6 | N `renderer/progressionHost.ts`, `screens/journey.ts`, `styles-journey.css`, `components/xpBar.ts`, `components/questRing.ts`; T `renderer/main.ts`, `screens/home.ts`, `screens/profile.ts` | Serial. **Hotspot owner: renderer/main.ts.** |
| **WP8** | Wardrobe screen, equip persistence, `wardrobe.spec` (computed-style allowlist) | WP5, WP7 | N `screens/wardrobe.ts`; T `renderer/main.ts` (route), `main/store.ts` THEMES if new themes | After WP7 |
| **WP9** | Campaign: chapter types, runner, 1 chapter and 2 rivals (banks plus parts), `campaign.spec` | WP2, WP3, WP4, WP7 | N `core/campaign/*`, `core/dialogue/banks/rival-*.ts`, `screens/campaign.ts`; T `core/tableTalk.ts` (rival hook), `screens/table.ts` (campaign config entry) | Core part parallel; UI after WP7 |
| **WP10** | Pro tools core: ICM, HH parser, leak finder (chunked), plus the Worker spike | — | N `core/pro/*`, tests, `renderer/leakWorker.ts` (spike) | Parallel (pure); spike independent |
| **WP11** | Pro tools UI and IPC: `hh:import` dialog, NDJSON store, screens, `pro-tools.spec` | WP10, WP6 | N `screens/proTools.ts`, `main/hhStore.ts`; T `main/main.ts`, `main/preload.ts` | Serial on main/preload |
| **WP12** | Profile export/import and challenge codes | WP1, WP6 | N `core/challengeCode.ts`, `core/qr.ts` (optional, hand-written); T `main/main.ts`, `main/preload.ts`, `screens/settings.ts` | Serial on main/preload |
| **WP13** | LAN league over the relay | WP2, WP12 (card format) | T `core/multiplayer.ts`, `core/relayServer.ts`, `main/relaySession.ts`; tests `relayServer`, `multiplayer` | Parallel to UI; relay owner |
| **WP14** | LLM flavour: `tutor:flavour`, guard reuse, rate limit, replay namespace, Settings disclosure | WP3 | N `main/tutor/flavour.ts`; T `main/tutor/index.ts`, `main/main.ts`, `main/preload.ts`, `screens/settings.ts` | Last; optional |
| **WP15** | Final integration: full `typecheck && test && e2e`, screenshots at both sizes, DECISIONS lines (pins touched with reasons), `git checkout screenshots/` | all | — | Serial |

**Hotspot ownership rule:** `core/session.ts` + `main/store.ts` (WP1), `main/main.ts` + `main/preload.ts`
(WP6, then a queue of WP11, WP12, WP14), `renderer/main.ts` (WP7, then WP8 and WP9 routes),
`styles-glass.css` (tokens only, WP4). Agents on parallel packages may not edit these. They hand the
owner a patch description. That keeps the costly `ALWAYS_FULL` runs to about five integration commits
instead of one per package.

**Critical path:** WP0 → WP1 → WP6 → WP7 → (WP8, WP9 UI) → WP15. WP2, WP3, WP4, WP5 and WP10 run fully in
parallel from the start, since they only need WP1's types file, which can be agreed on day one.

---

## 10. Summary of the architectural position

1. Everything stateful is a **pure core reducer with an injected clock and seed**, persisted under **one
   versioned namespace** in the existing atomic profile, with a **pre-migration snapshot** and a
   **downgrade guard**.
2. The character is **data plus a deterministic selector, gated by the existing mute matrix and linted by
   the existing ban lists**. The LLM can only *replace* a scripted line after the guard passes. Without
   credentials it is never called.
3. Art is **inline SVG built from TS path data, animated with transform and opacity only**, with Vite's
   `data:` inlining turned off so the CSP can't silently drop assets.
4. **Nothing new leaves the machine.** Social and competitive features become ghost leagues, LAN leagues
   over the existing relay, challenge codes and file export. Global leaderboards, friends and cloud sync
   need a backend and break the no-network guarantee, so they stay out until the owner decides otherwise.
5. Coverage comes mostly from unit tests. E2E stays within about +6 minutes by seeding profiles and
   injecting the clock rather than playing hands.
