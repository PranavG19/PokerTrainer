# Review: design-glass-mockup (round 3)
Verdict: PASS WITH NOTES
Base: 4c4a305  Head: see `git log -1` (the round-3 fix commit after 3088194)

An adversarial reviewer followed `~/.foundry/skills/pr-review/SKILL.md`, adding a "does it still look tacky?"
lens against Synara and Foundry. It returned **BLOCK** with four Act-on items. All four are fixed at head;
none of the fixes changes a scored visual, so the scorecard still describes the committed state.

## Does it still look tacky?
Mostly no. The reviewer described it as "a restrained macOS app": a unified title bar with inset traffic
lights, one sliding selection thumb, neutral controls, bone reserved for the single primary action, and colour
limited to mint, coral and amber by role. "No glow, no thick rims, no saturation bloom." It sits closer to
Synara's split view than to round 1.

What still reads unfinished:
- **Float glass.** It is perceptible but subtle; the dock reads as a dark translucent bar.
- **Gate and verdict.** They leave a near-black receded hole above a bottom sheet.
- **Charts.** 169 grey tiles, with a small boundary notch.
- **Drill.** About 40% dead space at 1100x760.

**Background.** It is byte-identical to round 2 (`--desk-*`, the dune SVG). It now actually frosts at 18px,
because round 2's blur never rendered. Disclosed in DECISIONS; the user should confirm the softer look on
`compare-home.jpg`.

## Act on
None open. All four were resolved at head:
- **The motion/state "neutral fact sheet" was not neutral.** It was written by me, and it partly unblinds
  the version through its richer wording for round 3.
  - Fix: SCORECARD.md now states this plainly under "Limits of the method". It reports the result without the
    Motion category (7.5 → 7.8, vs 7.5 → 7.9 with it).
  - It also quantifies rater noise: the same round-2 crops scored 7.6 / 7.5 / 7.5 across iterations.
- **The rater-5 re-score was undisclosed.** Six static elements had motion and states re-scored for both A
  and B after a facts-sheet correction.
  - Fix: disclosed in SCORECARD.md, with depth's stale reason flagged as an artefact.
- **DECISIONS.md had stale float values** (42% and a 12% highlight). Fixed to 34% and 20%, matching
  tokens.css.
- **shell.js applied radio behaviour to the non-radio bet-size group.** It wrote `aria-checked` onto plain
  buttons and could park the thumb on a one-shot preset.
  - Fix: the loop is scoped to `.seg[role="radiogroup"]`. The static captures are unaffected, since no preset
    is checked at rest.

## Consider (deferred so the scored state stays the committed state)
- **The predict tray shows Fold pre-checked.** The real `predictPanel.ts` has no default. It is shown as a
  mid-commit state; a port starts with nothing selected.
- **The gate/verdict recede is heavy** (blur 12px, 30% brightness). Raters had flagged a bloom at lighter
  dims; about 50% brightness is worth trying in the port.
- **Casing.** The verdict lead-in says "Sure" while the app's result line says "SURE". Pick one in the port.
- **Repo weight.** demo/glass is about 40 MB of binaries (scorecard 27 MB). Downscale to JPEG or move it out
  before any merge.
- **Gains within noise.** About 25 elements changed by ±0.2 or less, which is inside rater noise.

## Noted
- **Scorecard numbers verified independently from JSON + key:**
  - nav-bar 6.73 → 7.64
  - suggest 7.82 → 7.18 (a regression, listed)
  - slider 6.64 → 7.91
  - bankroll 6.9 → 8.1
  - overall 7.49 → 7.87
- **No cherry-picking.** The builder always takes the latest iteration, and r3's after (7.87) is slightly below
  r2's (7.90).
- **Targets missed, reported honestly.** 36/58 elements miss the target (average ≥ 8 and no category < 7).
  Suggested next and plan rows still hold a 6.
- **Cosmetic only.** Two focus styles (outline and halo token) coexist. The tier-2 renderer tokens are unused
  in the mock; that is intentional for the port.

## Dismissed
- **Background tampered with.** Proof: `git diff 6fc2940 HEAD` leaves `--desk-*` and the SVG block untouched.
- **Invented copy.** The support text, "You were SURE about fold…", the quips and the plan rows are verbatim
  from src. The round-3 deviations (Sure/Guess casing, the bankroll delta, the merged drill tally, "open O")
  are listed in DECISIONS "Invented for the mock".
- **Arithmetic.** CO 354/1326 = 27%; the classes sum to 169; drill 33.33%; pot 225 at a 25% price.
- **The re-score was unfair to one side.** Proof: every static element has motion n/a on both A and B.

## Verification
- `node tests/tmp/glass-capture.mjs` exits 0: 14 screens and 7 compares, with no overflow, overlap or crisp
  half-cover.
- `node tests/tmp/glass-contrast.mjs` (DPR 2) exits 0 with "No AA failures".
- `git diff 4c4a305 -- src package.json package-lock.json` is 0 lines. The branch has no upstream, so nothing
  is pushed.
- `npm run typecheck` and `npm test` passed earlier in this task with `src` unchanged since.
- `npm run e2e` is environmentally blocked: `node_modules/electron` is half-installed.
- **Not tested:** hover, focus and placeholder contrast; real Electron vibrancy; GPU cost.

---

# Review: design-glass-mockup (round 4: table-surface variants)
Verdict: PASS WITH NOTES
Base: 74ae4b1  Head: see `git log -1` (round-4 fix commit after c96aa1e)

A short adversarial review followed `~/.foundry/skills/pr-review/SKILL.md`. It found two Act-on items, both
fixed. The scope, scores, contrast and reference-image checks were all clean.

## Act on (resolved)
- **DECISIONS overstated the recommendation.** It said "`sports` highest in both blind ratings", but
  `sports` exists only in rating 2. Now: "top pick in rating 2 (fit 7.67, element mean 7.29); rating 1 predates
  it, and its parent `scoreboard` led there."
- **The new "Table surface" decision was inserted mid-sentence** in the round-3 seats bullet. It is moved to
  the end of "Decisions to evaluate".

## Consider (applied where cheap)
- **Blind labels.** SCORECARD-TABLE.md's quoted ship picks now name the blind labels, e.g. V6 [glass].
- **Gallery copy.** It now qualifies `sports` as "in blind rating 2".
- **Layout guard evidence.** It is saved as `variants-capture.log` (28/28 ok), and the script's default list
  includes `sports`.
- **Apple Sports' canvas is itself green.** DECISIONS now says so, and frames the case against green as
  semantic (mint already means your turn and gain) rather than "green isn't premium".
- **`scoreboard` layout problems, not fixed** (it is not the pick; `sports` fixes both):
  - its panel runs under the dock at 900x640
  - the bet chip sits on the "Pot" label
  - The guard doesn't test `.rail` against `.dock`.

## Noted
- **Condensed figures are macOS + `file://` only.** They depend on `local(".SF NS")` or
  `file:///System/Library/Fonts/SFNS.ttf`. Elsewhere, or over http(s), they fall back to regular-width SF
  at the same size: legible, with wider seat rows. Electron porting is in the DECISIONS port notes.
- **Rating 1's "web face, not SF" note is incorrect.** The figures are SF Pro on its width axis.

## Dismissed
- **Leaks into the dock or sheets.** Every rule is scoped to `html[data-felt=…]` and stage-only elements.
- **The default differs from round 3.** With no `?felt`, `data-felt="green"` is set and no rule matches it.
  glass.css, tokens.css, shell.js and the other pages have a 0-line diff since 74ae4b1.
- **The scores don't match.** All ten rows were recomputed from the JSON files and keys, and they match.

## Verification
- **Contrast:** `variants-contrast.log` covers 28 renders (7 variants × live/verdict × 2 sizes), with 0 AA
  failures. The lowest is 5.60.
- **Layout guard:** `variants-capture.log` is 28/28 ok.
- **Reference images:** `git ls-files | grep -i apple-sports` is empty.
- **src:** `git diff --stat 4c4a305..HEAD -- src package.json package-lock.json` is empty.

## Round 5 review (refined glass + seat scaling)
- **Verdict:** BLOCK at 05856f5, on one Act on item. It is fixed in the follow-up commit; dispositions below.
- **Base:** 2c49d05. **Head:** 05856f5.

### Act on
- **Fixed: the commit tray covered the hero in `sports` at 7–9 seats in the predict state.**
  - Cause: `[data-density='compact'] .hero-plate { bottom: 90px }` tied in specificity with `.predicting .hero-plate` and won by
    order.
  - Fix: a compact + predicting rule (`bottom: 112px`).
  - `glass` had the same latent risk, since the hero is pinned to the slab rim. It now also clamps above whichever float is
    showing. `table.html` re-runs the layout after the state switch.

### Consider
- **Fixed: the guard's blind spots.** `r5-capture.mjs` now also renders:
  - predict and gate at 4–9 seats
  - 5, 7 and 8 seats
  - the button on seat 1 as well as seat 4
  
  It now also checks the seat count, unplaced bets, the commit tray and every dealer button, including the hero's. The result is
  116/116 ok. DECISIONS lists what it still does not check: overlaps under a sheet, the rail hairline crossing seats, and resize.
- **Fixed: the D button overlapped a bet with the button on seat 1.** Bets now avoid dealer buttons, using the button's resting
  box, because it is mid-animation when the bets are placed.
- **Fixed: 7 and 8 seats came out one short.** The cast is filtered before slicing.
- **Fixed: the "Lifted by 2" wording.** DECISIONS now says that refined `glass` is +2 overall and on hierarchy, but slightly lower
  on fit (7.17 vs 7.33) and on type (6.8 vs 8.0).
- **Fixed: FINDINGS' "up from 5".** It now reads "against 5 for the round-4 version scored in the same rating".

### Noted
- **The `sports` 4-seat render is now rule-driven.** Cy gets the folded style, the bet sits about 10px higher, and the quip is the
  engine's pick. Positions are as in round 4.
- **Fixed: the evidence file-name pattern** in FINDINGS.
- **Fixed: `?glow=0` turned the glow on.** Only `glow=1` enables it now.
- **Old `?felt=glass` links now open the refined slab.** DECISIONS says so, and points to `glass-r4` for the version rated in
  round 4.

### Dismissed (by the reviewer, with proof)
- **Other felts or the default changed:** pixel-identical to 2c49d05.
- **`glass-r4` differs from round-4 glass:** pixel-identical.
- **CSS leaks into the dock or sheets:** `[data-layout]` is set only on `#stage`.
- **Seat-limit citations are wrong:** all 8 file:line citations verified.
- **Scores are misreported:** recomputed from the JSON and the key.
- **`src` or package files changed:** the diff is empty.

### Verification after the fixes
- `tests/tmp/r5-capture.log`: 116/116 ok.
- `tests/tmp/r5-contrast.log`: 48 renders, re-run. All 36 `glass` and `sports` renders pass (minimum 4.93). The 5 failures are
  all `glass-r4` at 6 and 9 seats (3.21–3.65), as reported.
- `git diff --stat 2c49d05..HEAD -- src package.json package-lock.json` is empty.

## App restyle review (glass + sports table)
- **Reviewer:** a separate subagent with no authoring context, following the pr-review skill.
- **Verdict:** BLOCK at 2d96e45, with 3 Act on items. All are fixed in the follow-up commit; dispositions
  below.
- **Base:** bff2dd7. **Head:** 2d96e45.

### Act on
- **Fixed: at 900x640 on a river showdown, the board overlapped the right seat by 7px.** Side seats had no
  width cap, and the revealed quip grew them to about 265px.
  - Fix: side seats are capped at `calc(47% - 160px)`, and name, tag and quip ellipsise.
  - A failing-first assertion was added: `layout.spec` 4, no seat overlaps the board or another seat at
    showdown. It failed with "seat 3 x board" before the fix and passes after.
- **Fixed: a busted seat's archetype tag failed AA** (3.95:1 at the 0.56 out-opacity). Every text on a
  busted seat is now full ink. The AA run now includes a busted showdown and the next hand in both themes,
  and the busted seats measure at least 5.7:1.
- **Fixed: keyboard focus was invisible on the active Train rung.** The thumb's box-shadow beat
  `:focus-visible`. Added `html .train-rail-btn:focus-visible { box-shadow: var(--focus-ring) }`.

### Consider
- **Fixed: Obsidian kept the failing `--text-lo-2` (#565C66)** on the quiet captions. Glass's obsidian block
  now sets it to `--ink-3`, which is paint-only. The Obsidian AA run passes, including those captions.
- **Fixed: stale "0.4 / 0.22" comments** in styles-glass.css and styles.css.
- **Fixed: the hard-coded `100vh - 45px - 16px`.** It now derives from `--nav-h` and `--screen-pad-y`.
- **Fixed: Home scrolled 13px at 900x640.** The planner-column padding is trimmed, and Home is 640px.
- **Fixed: the showdown quip no longer brightened.** `.table-screen .seat-talk[data-revealed='true']` is now
  ink-1.
- **Kept: `seatLayout.ts` generality** (one caller with 3 villains). The user asked whether the table scales.
  The rule is small, unit-tested, and the multiplayer screen could adopt it.

### Noted
- **The coached + gate + stats-open state at 900x640 still overflows the screen box by about 61px.** Base
  overflowed by about 221px. The dock stays visible, and the e2e fit specs pass.
- **Fixed: the dead `[heroCards]` fallback** in table.ts.
- **Fixed: the stale rebuy.spec comment.**
- **A folded hero dims their own hole cards.** DECISIONS now says so.
- **The hero's border shorthand would reset a dashed edge.** Latent only: the hero is never `data-out`.

### Dismissed (by the reviewer, with proof)
- **Seat document order:** 0, 1, 2, 3 in every state.
- **Pot text:** still "Pot N".
- **The pot pin was weakened:** it was not. It fails if the pot shrinks.
- **Theme geometry:** the obsidian block is paint only.
- **To-act and winner pins:** they hold for the right reasons; seats use `translate`.
- **The drag region:** it covers only tabs, which are `no-drag`.
- **The voice.spec reasoning:** it holds, and the check is still non-vacuous.
- **Scope:** nothing outside src/renderer and the tests changed.

### Verification after the fixes
- `npm run typecheck` is clean.
- Targeted e2e runs pass:
  - layout, session-plan, train, busted-seats, theme and rebuy: 53/53
  - earlier, charts, drill, interaction and gameplay
- AA: 96 renders, 0 failures (`tests/tmp/app-contrast.log`).
- The full e2e run on the final commit is in `tests/tmp/e2e-final.log`.
