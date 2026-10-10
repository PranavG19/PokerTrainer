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
