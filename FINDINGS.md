# FINDINGS — Offsuit glass mockup, round 3

## Outcome
Each of the 58 UI elements across the seven screens was rated on an 11-category rubric and redesigned as a
system:
- one type scale
- concentric radii
- one state ramp for every control
- primary, secondary and tertiary buttons
- a colour role map
- sliding selection
- a real switch
- lighter float glass

The round-2 background is kept. Round 2's coat blur had never actually rendered (a stacking and blend bug);
it now frosts at 18px.

Blind raters scored round 2 at **7.5** and round 3 at **7.9** (7.8 without Motion). **36 of 58 elements
still miss the target** of an average ≥ 8 with no category < 7. Scores plateaued over three iterations.

Open `demo/glass/scorecard.html`.

## Decisions to evaluate
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
