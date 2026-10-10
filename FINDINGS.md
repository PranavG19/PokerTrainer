# FINDINGS — Offsuit glass mockup

## Outcome
- **Table: ship `sports`.** It has no table plate, row-card seats, a heavy SF score for the pot and one mint wash for your turn. Past 4
  seats it becomes a scoreboard U. In the latest blind rating it scored 8 overall, fit 8.17 and scales 7.83.
- **Refined `glass` came second at 7** (fit 7.17, scales 7.33), against 5 for the round-4 version scored in the same rating. The refined version is slightly lower on fit and type. Open
  `demo/glass/table-variants.html` and use the seat toggle.
- **Seats the real app supports:** solo is hero plus 3 (fixed). LAN multiplayer allows 2 to 6. The engine itself has no cap.
  9-max is beyond the app and was mocked as a stress case only. Both surfaces hold at 9 seats at 900x640.
- **Round 3:** 58 elements were refined as a system. Blind raters moved them from 7.5 to 7.9 (`demo/glass/scorecard.html`).

## Decisions to evaluate
- **Table surface:** `sports` rather than the refined `glass` oval or green. If overruled: `glass` with its ring layout, at a cost of
  1 point overall and 1 on fit.
- **Green glow under the board:** not adopted, because it lost both blind A/B pairs. If overruled: turn on `&glow=1`.
- **Condensed SF figures:** if `sports` ships, use them for the Home bankroll and the Charts/Drill stats too. If overruled: regular SF
  tabular on the table, which the latest rater preferred (type 6.8).
- **Seat compaction at 7–9 seats:** quips only on the live seat, no cards on folded seats, 20px stacks. If overruled: 6-max stays the
  densest supported layout.
- **The coat really frosts (18px blur).** If overruled: `--coat-blur` 0–8px.
- **Gate and verdict sheets dim the table to 30%.** If overruled: about 50%.
- **Informational sections are flat hairline lists; only actionable lists are inset groups.** If overruled: cards everywhere.
- **Charts boundaries are a corner notch.** If overruled: dashed outlines (scored 6 on craft).
- **Title-case Sure/Guess, a neutral bankroll with a mint delta, and a merged drill kind/tally.** If overruled: the app's current
  presentation.

## Open questions
- **Should the table support 7–9 seats?** Default taken: no. The app cap stays at 6, and the 9-max layout is evidence that the rule
  scales, not a feature.
- **Apply the latest rater's unrated fixes?** For `sports`: close the price-to-hero gap, use one green on the hero, and move the dealer
  off the hero's card. For `glass`: frost the folded rim seats. Default taken: listed in DECISIONS, not applied.
- **Real vibrancy in Electron:** it needs `vibrancy: 'under-window'` plus `titleBarStyle: 'hiddenInset'`. Default taken: the mock
  simulates both.
- **The e2e suite is blocked** by a half-installed Electron. Default taken: left as is. Typecheck and the unit tests passed earlier.

## Alternatives rejected
- **`glass-r4` (the round-4 oval):** it scored 5. Its pot is smaller than the hero's stack, and at 6 and 9 seats its seat text sits
  on the rail and fails AA (3.2–3.65:1).
- **Round-3 green felt:** it reads as poker fastest, but came last on fit in both round-4 ratings.
- **Round 1's pane-per-element liquid glass:** rejected as tacky.

## Evidence
- **Scaling:**
  - `compare-scaling.jpg` (felt × 4/6/9 seats, 1100x760)
  - `compare-scaling-900x640.jpg` (the stress size)
  - `<felt>-<seats>-<state>-<size>.jpg` (from `demo/glass/variants/scaling/`)
  - `gallery-9-seats.jpg`
- **Checks:**
  - `r5-capture.log`: the layout guard, 116/116 ok, including predict, gate and 5/7/8 seats
  - `r5-contrast.log`: AA, with `glass` and `sports` passing at a minimum of 4.93
  - `probe-*-allbets-*.jpg`: every villain betting, with the button on a villain
- **Scores:** `SCORECARD-TABLE.md`, `scores-r5.json`, `vblind5-key.json`
- **Earlier rounds:** `compare-variants.jpg`, `variants-*.log`, `scorecard.html`, `SCORECARD.md`, `compare-<screen>.jpg`
- **Records:**
  - `DECISIONS.md`: the glass problems → fixes, the seat-count sources with file:line, the layout algorithm and the port notes
  - `code-review.md`: the reviews
  - `PR-DRAFT.md`
