# demo: glass design mockup (scored refinement, table-surface study, seat scaling)

## Summary
This is a static HTML/CSS mockup of a modern glass direction for Offsuit, built from real app screens and copy.

- **Round 2's background** (the contoured desktop, the coat and the grain) is kept. Its coat blur never
  rendered because of a stacking and blend bug, and now frosts at 18px.
- **Round 3** rated each of 58 UI elements on an 11-category rubric. An independent rater scored round 2
  first, and every element with a category under 8 was redesigned as a system:
  - one type scale
  - concentric radii
  - one state ramp for every control
  - primary, secondary and tertiary buttons
  - a colour role map
  - sliding selection
  - a real switch
  - lighter float glass (34% grey, blur 26 / saturate 175%, a gradient rim)
- **Blind A/B re-scoring** by fresh raters ran for three iterations. The result is **7.5 → 7.9** (7.8
  without Motion), and 36 of 58 elements still miss the target. SCORECARD.md lists the method's limits.
- **Nothing under `src/` changes**, and no dependencies change.

## Round 4: table surface
- **What changed:** seven variants of the table surface only, switchable with `table.html?felt=green|midnight|glass|ink|scoreboard|sports|classic`. The gallery is `demo/glass/table-variants.html` and the side-by-side is `demo/glass/variants/compare-variants.jpg`. The default stays round-3 green.
- **Reference:** a study of Apple Sports (official App Store screenshots, not committed).
- **Result:** two blind ratings (SCORECARD-TABLE.md). `sports` leads (overall 7, fit 7.67); green trails on fit but reads as poker fastest. AA holds on every variant.

## Refined glass and seat scaling
- **Refined `glass`.** `?felt=glass` is now a smaller, real frosted slab that holds the pot and board, with frosted row-card seats on
  its rim. It borrows the scoreboard numerals and the hero wash from `sports`. The round-4 version is kept as `?felt=glass-r4`.
- **Seat counts.** A rule-based seat layout (`demo/glass/table-seats.js`, `?seats=4|6|9`): a ring for ovals and a scoreboard U for
  `sports`. It covers collision-aware bet placement, three compaction tiers, and folded, busted and live-bettor states.
- **What the real app supports:** solo is 4 seats and LAN is 2–6. 9-max is a stress case only.
- **Verification:**
  - Layout guard: 116/116 renders ok, including predict, gate, 5/7/8 seats and probes with every villain betting.
  - AA: passes on every `glass` and `sports` render (minimum 4.93).
  - `glass-r4` fails AA at 6 and 9 seats. It is a comparison variant only.
- **Blind rating 3:** `sports` 8 (fit 8.17, scales 7.83), `glass` 7 (7.17 / 7.33), `glass-r4` 5 (7.33 / 6.33). The green glow
  under the board lost both A/B pairs and is not adopted.
- **Defaults are unchanged.** The default `table.html` (green, 4 seats) is unchanged; `table-seats.js` returns early for it.

## Screens
Each screen is captured at 900x640 and 1100x760 (DPR 2) in `demo/glass/screenshots/`:
- `home`
- `table`
- `predict`
- `gate`
- `verdict`
- `charts`
- `drill`

There is also `compare-<screen>.jpg` for each, showing the current app, round 2 and round 3.

## How to open
- `demo/glass/index.html` is the hub.
- `demo/glass/scorecard.html` has the per-element before/after crops, scores, reasons and changes.
- `SCORECARD.md` has the same content in text, with the rubric.
- `demo/glass/compare.html?screen=<id>` is the side-by-side view.

## Verification
- **Contrast:** WCAG AA was measured on rendered pixels at DPR 2. There are 0 failures across 14 renders.
- **Layout guard:** clean.
- **Tests:**
  - `npm run typecheck` passes.
  - `npm test` passes (1796 tests).
  - `npm run e2e` is blocked by a half-installed Electron in this checkout. This is environmental.
- **Review:** an adversarial review returned BLOCK on four disclosure and code items, all fixed. See
  `code-review.md`.
- **Repo weight:** demo/glass carries about 40 MB of evidence images. Consider pruning before merge.

## Decisions for the reviewer
See `FINDINGS.md` and `DECISIONS.md`. The headline items:
- `sports` over the refined `glass` oval, and whether the table should ever go past 6 seats
- the coat now really frosts
- seats are type on the felt
- the sheet dim level
- flat sections vs cards
- the chart boundary notch
- Sure/Guess casing and the bankroll delta
