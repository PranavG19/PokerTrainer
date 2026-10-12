# Offsuit

Electron + TypeScript desktop Hold'em trainer. `src/core/` is pure poker logic (engine, grader, schedulers;
no DOM), `src/main/` is the Electron main process (window, store, network seal, LAN relay), `src/renderer/` is
the UI: plain DOM in `screens/*.ts` and `components/*.ts`, plain CSS, no framework.

## Commands
- Fast check (seconds): `npm run typecheck`. Unit tests: `npm test` (vitest, `tests/unit/`).
- Run locally: `npm start` (builds, then opens the window).
- e2e builds `dist/` then drives the real Electron app with Playwright (`tests/e2e/`, one worker).

## Test tiers (pick by blast radius, the same sizing as review)
| Tier | Command | Time | Use for |
|---|---|---|---|
| smoke | `npm run test:smoke` | 33 tests; 8.7 min measured at load avg ~600 | a sanity pass: launch, navigation, one hand, persistence, no-network |
| affected | `npm run test:affected` | typecheck + the selection; the full suite when it must widen | low and medium radius (tests, docs, one module, a screen): typecheck plus the unit and e2e suites `scripts/affected-tests.ts` attributes to the diff vs `origin/main` |
| full | `npm run test:full` | 552 tests (1 skipped) + 1804 unit; 1.3 h measured at load avg ~300, ~45 min idle | high radius (engine, profile schema, security, network), batch merges, anything the selector sends to "FULL SUITE REQUIRED" |
- `test:affected` widens to the full suite by itself when the diff touches a shared file (`ALWAYS_FULL` in the
  script: engine, app shell, `helpers.ts`, `package.json`, …) or when no suite can be attributed to it.
- Under heavy machine load (endpoint-security agents), a 60s test timeout can fire on a healthy spec. Rerun that
  one spec before believing it.
- `node scripts/affected-tests.ts [base]` prints the selection without running it. Node 26 runs the .ts
  directly; `tsx` is not installed and must not be fetched.
- Red-first for a bug fix: run the one spec (`npx playwright test <name>` after `npm run build`) before the fix.

## e2e windows: hidden by default, workspace 12 when visible
- **Hidden (default).** `tests/e2e/helpers.ts` launches with `OFFSUIT_E2E=1 OFFSUIT_E2E_HIDDEN=1`. The main
  process never calls `show()`, hides the Dock icon and uses the accessory activation policy, so a run never
  takes focus or shows a window. The window still paints (`paintWhenInitiallyHidden`, no background
  throttling): screenshots, layout geometry and keyboard specs all pass hidden. No spec currently needs the
  visible tier.
- **Visible tier.** For a spec that truly needs an on-screen window, use `launchApp({ visible: true })`, or set
  `OFFSUIT_E2E_VISIBLE=1` to make every launch visible. The window is shown with `showInactive()`, switched to the
  regular policy so AeroSpace can see it, and moved to workspace 12 with
  `aerospace move-node-to-workspace --window-id <id> 12`. It is never focused. It sits on the focused workspace
  for ~100ms before the move. Without `aerospace` on PATH it throws, naming the cause.
- To prove a run took no focus: `scripts/focus-watch.sh <log> &` polls the focused workspace/app and lists any
  Electron window AeroSpace can see. Kill it after the run.
- **`ELECTRON_RUN_AS_NODE` gotcha.** Some shells (the Foundry shell) export `ELECTRON_RUN_AS_NODE=1`, which makes
  Electron run as plain Node, so a launch hangs with no window. The e2e helper and the verify-app drive script
  strip it. For any other Electron launch, use `env -u ELECTRON_RUN_AS_NODE npm start`.

## Boundaries
- No dependency changes and no network: `no-network.spec` and the CSP in `index.html` (no remote fonts or
  scripts) enforce it. Do not reinstall or add packages.
- e2e runs overwrite tracked files in `screenshots/`. Never commit those side effects: `git checkout screenshots/`.
- Pushing, opening PRs and merging are the human's.

## Look and styling (the glass system)
- `src/renderer/styles-glass.css` is the design system: tokens, materials, the shared `g-` component kit, the
  table, the coach sheets. Read its header and "Shared primitives" before styling anything. The mock it was
  built from is `demo/glass/` (`tokens.css`, `glass.css`, `*.html`); the decisions are in `DECISIONS.md`.
- Tokens only: the type scale `--t-cap … --t-hero` (11 12 13 15 17 22 28 34), ink `--ink-1/2/3`, the one state
  ramp `--fill-0…3`, radii `--r-xs/thumb/ctl/group/dock/sheet` (4 6 8 12 14 20), heights `--h-sm/ctl/lg`. No
  hex literals or orphan sizes in screen sheets.
- Colour role map (each hue one meaning): neutrals = structure; bone = cards and the ONE primary action per
  screen; mint (`--positive`, pinned by e2e) = your turn, positive deltas, an ON switch — never a balance;
  coral = serious / wrong / negative; amber = notable and the gate timer; felt green = the table only.
- Compose the kit (`.g-group` for actionable lists only, `.g-sect`/`.g-flat` for informational ones, `.g-seg`
  + `components/thumb.ts` for any segmented choice, `.pill` / `.pill.primary` / `.pill.quiet`, `.g-kbd` via
  `components/glyphs.ts`) instead of restyling per screen.
- Load order: `styles-glass.css` loads before the per-screen sheets, so a screen rule of equal specificity
  wins over the kit. A theme block (`html[data-theme]`) may change paint only, never layout (`theme.spec`).
- Every screen must fit 900x640 and 1100x760 with no page scroll; many specs pin this.
- e2e pins to keep: `--text-hi` #FFFFFF, `--positive` #3DDC97, the to-act ring and 1.02 scale, Fold with no
  box-shadow, seat opacity order live > folded > busted. Change a pin only with the reason in `DECISIONS.md`.

## Profile schema (`offsuit-state.json`)
- One JSON file, written whole by main (`store.ts` → `backup.ts`: atomic write-temp-then-rename, 3 rolling
  `.bakN`). `schemaVersion` is the version (absent = v1); `SCHEMA_VERSION` and the migration chain live in
  `src/core/profileSchema.ts`. v2 = v1 + `progression` (`src/core/progression/types.ts`, parsed in `persist.ts`).
- Load path: main reads → `migrate()` → on an upgrade, a never-rotated, never-overwritten `.pre-v{N}` copy of
  the file actually read → renderer `deserialize`. A file with a NEWER `schemaVersion` opens read-only
  (`store.save` refuses, a banner shows); so does a file changed on disk since this build last touched it.
- **Adding a field (no version bump):** additive and optional only. Put it in a new top-level key or a new key
  inside `progression` (never inside an existing v1 object), add it to the type, the default, the parser
  (tolerant: bad input → default, never throw) and the key tree (`PROFILE_SHAPE` / `PROGRESSION_SHAPE`;
  `profileSchema.test` fails if you forget). Older builds of the same version carry it through untouched.
  For vocabularies a later build may extend (ids, tiers, answers), persist the string and map unknown values
  to a default when reading, so an older build never overwrites a newer value.
- **Bump `SCHEMA_VERSION` when** a field changes meaning or shape, a value moves, or an older build carrying
  it through stale would be wrong. Add one `{ from, to, run }` step: pure, additive, idempotent (running it on
  its own output changes nothing), never deleting or rewriting an older version's key. Add a fixture test
  (v(N-1) in → every old field byte-identical, idempotent) and extend `store.test`. Older builds then open
  the profile read-only, by design.
- Counts never mix: `Chips` (bankroll), `Reps`, `Chalk` are branded in `src/core/units.ts`; days are `DayKey`s
  from `src/core/localDay.ts` (local time, the day turns at 4 am). The streak is the classic daily
  streak (`progression.streak`, owner D5): a missed day resets it, with no rest days or freezes. Go
  through `countSession` and `currentStreakOn` (`progression/persist.ts`); never add a freeze field. Core takes a `DayKeyOf`; only the renderer
  calls `systemDayKeyOf()`.

## Routing
- `DECISIONS.md` is the living decision record; edit the line, do not append history.
- To prove a change in the running app, use `.claude/skills/verify-app/SKILL.md`.

## Done
- The tier the blast radius calls for (above) exits 0 on the final commit; `npm run test:full` for high radius.
- UI changes: screenshots of the running app at 900x640 and 1100x760.
- Changed files, any spec change with its reason, skipped checks and open concerns reported.
