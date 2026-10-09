# Review: design-glass-mockup
Verdict: PASS WITH NOTES
Base: 4c4a305  Head: see `git log -1` (the fix commit after a0907f6)

An adversarial reviewer ran in two rounds, following `~/.foundry/skills/pr-review/SKILL.md`:
- **Round 1** (c20e068): BLOCK, with 11 Act-on items.
- **Round 2** (a0907f6): BLOCK. Ten items were confirmed fixed. One new defect and one partial fix remained.

Both remaining items are fixed at head and were re-verified below, so no Act-on item is open.

## Act on
None open. Both round-2 items are resolved:
- **demo/glass/table.html — `?state=gate` showed "Coach off".** The gate only fires in coached mode, so the
  label was wrong. Fixed: the label is set to "Coach on" for every state except `live`. A probe now reads
  `live Coach off`, `predict/gate/verdict Coach on`.
- **DECISIONS.md and tokens.css — the claim "scale 1.02 (the mock keeps this)" was false for the real pin.**
  interaction.spec.ts:192 reads `transform` = `matrix(1.02…)`, but the mock uses the `scale` property, and
  the oval's `translateX(-50%)` would compose into that matrix. Fixed: the docs now say the shadow alpha is
  kept and the transform pin needs updating in the port.

## Consider
- **Scroll panels at 900x640 cut a row at the panel edge** (home recent hand #39, charts rule 3) with only
  a thin scrollbar as the cue. Tradeoff: an edge fade lowers the contrast of the last visible line; it is
  left as is, and the capture log reports "scrolls inside".
- **The overlap check covers only the table panes in the live and predict states.** Sheet-versus-nav and
  nested panes are not checked. Tradeoff: the sheets are centred modals with the nav inert, so the risk
  is low.

## Noted
- **Some text is outside the contrast script but was probed by the reviewer, and all of it passes:**
  pseudo-element counters (≥ 8.86), the gate placeholder (8.61 dark / 6.56 light) and hover states (≥ 6.18).
  contrast.md states the gap.
- **The light block keeps `--suit-red` `#FF7A6B`**, which would be about 2.5:1 on light glass if the light
  theme were ported. The light theme is declared preview-only (an Open question).
- **Minor markup:**
  - `<button class="start">` wraps `<div>`s.
  - the gate uses an `<input>`, where the real control is a `<textarea>`.
- **The evidence scripts live in gitignored `tests/tmp/`**, as the task specifies. They are captured as
  evidence instead of committed.
- **Applied during round 2:**
  - the gate focus ring is now a solid 2px `--notable` (it was 0.35-alpha amber)
  - the charts grid got `role="group"` for its `aria-label`
  - the contrast script now exits non-zero on any failure

## Dismissed (resolved, with proof, at a0907f6 and still true at head)
- **Archetype and showdown-quip leak.** All three villains show "Unknown" (jitter.ts `HIDDEN_ARCHETYPE_LABEL`),
  and Bo says "Let's put some in." (tableTalk.ts IN_HAND bet).
- **Gate missing.** `?state=gate` uses the real prompt, "Attempt 1 of 2", the coachPanel placeholder and an
  8 s budget. It is modal, the nav is inert and the input is focused.
- **"Next hand", N and S before the hand ends.** The footer is now "Ada and Bo play the hand out behind
  this sheet" plus Close/Esc, declared as invented. Only real hotkeys (F, C, R, A) are shown.
- **The tray disabled Check.** All four predicted actions are enabled and are `role=radio` with
  `aria-checked`.
- **"50bb table".** It now reads "40bb table" (a `DEPTHS` value), and the pill reads "15 min · not a session".
- **The chart quiz ring revealed the answer.** The ring is removed.
- **Copy was cut to fit 900x640.** The media-query deletions are gone; panels scroll instead. Rule 3, the
  boundary chips and the expansion/purity notes are present.
- **Port claims.** tokens.css and DECISIONS.md now describe a three-part port and list every e2e pin
  honestly. The light theme is an Open question. `--surface*` is near-opaque. `--suit-red` is `#FF7A6B`
  (dark-surface text) and `--card-red` is `#C42F25` (the ivory face).
- **Undisclosed inventions.** All are listed under Mock-only in DECISIONS.md. Ivory cards and position badges
  are under Decisions to evaluate.
- **Poker arithmetic and copy fidelity.** Checked by the reviewer against the source:
  - stacks: 4950/4950/4875/5000
  - pot 225, price 25%, minimum raise 150
  - fold EV loss (0.74 − 0.25) × 300 / 50 = 2.94 bb, which is serious
  - the predict and support strings
  - the recommend template
  - the session plan from `assemble()`: 27.25 min, 13 spots
  - the CO grid equals `rfiCombos('CO')`: 60 cells, 26.7%
- **The mock touches nothing under src/.** `git diff 4c4a305 -- src package.json package-lock.json` is empty
  (0 lines).

## Verification
- `node tests/tmp/glass-capture.mjs` exits 0. It reports no viewport or clip overflow, no overlapping table
  panes, and a one-line commit prompt across all 28 renders and 6 comparisons. The reviewer's negative test
  at 760x540 made it exit 1.
- `node tests/tmp/glass-contrast.mjs` exits 0 with "No AA failures" across 28 renders. The lowest result is
  4.65:1 (the verdict's "Serious" pill).
- `npm run typecheck` exits 0. `npm test` exits 0 (85 files, 1796 tests).
- `npm run e2e` exits 1: all 540 tests fail at `electron.launch` because `node_modules/electron` is
  half-installed. This is environmental, not caused by the branch.
- **Not tested:** how a real port behaves against the e2e pins, the GPU cost of stacked `backdrop-filter` in
  Electron, focus-visible states, and the `prefers-reduced-transparency` rendering.
