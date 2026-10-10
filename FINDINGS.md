# FINDINGS — Offsuit glass mockup, rounds 3–4

## Outcome
- **Round 4 (table only).** Seven switchable table surfaces were studied against Apple Sports (App Store
  screenshots). Two blind ratings put the Apple Sports scoreboard idea first, refined as `sports`: overall 7,
  fit 7.67. Round-3 green came last on fit (4.0 / 4.67) but wins on instant sense of place. **Recommended:
  `sports`.** The default is still green until you choose. Open `demo/glass/table-variants.html`.
- **Round 3.** 58 elements were scored and redesigned as a system. Blind raters moved them from 7.5 to 7.9,
  and 36/58 elements still miss the target. The scorecard is `demo/glass/scorecard.html`.

## Decisions to evaluate
- **Table surface:** `sports` (no table plate, row-card seats, a heavy SF score pot, a mint wash for your turn) instead of green. If overruled: `glass` (the best-fitting oval) or keep green.
- **Condensed SF figures:** if `sports` ships, use them for the Home bankroll and the Charts/Drill stats too. If overruled: regular-width SF on the table as well.
- **The coat really frosts now (18px blur).** You liked a background that, in practice, was never blurred.
  If overruled: set `--coat-blur` back to 0–8px and the crisp contours return.
- **Seats are type on the felt, with no hero plate.** Your turn is a soft light pool plus mint text. If
  overruled: a neutral plate per seat.
- **Gate and verdict sheets dim the table to 30%.** If overruled: about 50%, at the risk of the bloom
  raters flagged.
- **Informational sections are flat hairline lists; only actionable lists are inset groups.** If overruled:
  cards everywhere, which raters scored lower.
- **Charts boundaries are a corner notch, not a ring or dashes.** If overruled: dashed outlines (scored 6
  on craft).
- **Title-case Sure/Guess, a neutral bankroll with a mint delta, and a merged drill kind/tally.** If
  overruled: the app's current presentation.

## Open questions
- **Real vibrancy in Electron.** Porting needs `vibrancy: 'under-window'` plus `titleBarStyle:
  'hiddenInset'`. Default taken: the mock simulates both.
- **Push for 8+ on every element?** Another iteration would mostly chase rater noise (about ±0.15). Default
  taken: stop and report.
- **The e2e suite is blocked** because Electron is half-installed. Default taken: left as is. Typecheck and
  the unit tests pass.

## Alternatives rejected
- **Round 1's pane-per-element liquid glass:** rejected as tacky.
- **A 58% dark float:** it still read as a slab to the blind raters.
- **Dashed chart boundaries, or a ring:** the ring reads as keyboard focus.

## Evidence
- **Round 4:**
  - `table-variants.html` (gallery)
  - `compare-variants.jpg`
  - `variants/<felt>-<live|verdict>-<900x640|1100x760>.jpg`
  - `SCORECARD-TABLE.md`
  - `variants-contrast.log`, `variants-capture.log`
  - `ref-apple-sports-*.jpg` + `references.md`
- **Scorecard:**
  - `scorecard.html`, `SCORECARD.md`
  - `scorecard-00-summary.png` and `scorecard-01..07-*.png`
  - the before/after crops in `demo/glass/scorecard/`
- **Screens:**
  - `<screen>-<900x640|1100x760>.jpg`
  - `compare-<screen>.jpg` (current app | round 2 | round 3)
- **Checks:** `contrast.md`, `glass-contrast.log`, `glass-capture.log`, and `tests-*.log` from the earlier run.
- **Records:**
  - `DECISIONS.md`: the round-3 system decisions and the element change log.
  - `code-review.md`: the final adversarial review.
  - `PR-DRAFT.md`: the draft PR description.
