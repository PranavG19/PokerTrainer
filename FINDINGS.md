# FINDINGS — Offsuit glass redesign

## Outcome
- **The app now ships the glass look with the `sports` table.** Branch `glass-app-restyle`.
  - One coat over a soft backdrop, with glass only on what floats: the action dock, the coach and predict
    panels, and the stats strip.
  - Villains sit in scoreboard rows, and the pot is the score.
  - The hero's seat is the hero plate, with a mint wash on your turn.
  - All 28 screens pick up the new tokens and buttons. Screenshots are in `after/` and `compare-*.jpg`.
- **Checks:**
  - Typecheck is clean, and the unit tests pass (1802).
  - The full e2e run on 7edf964 passed (545, with 1 skipped as on the baseline): `e2e-final.log`.
  - AA passes on 96 renders of the running app (every screen state in both themes, plus busted seats),
    minimum 4.75:1.
- **Seats the app supports:** solo is hero plus 3, and LAN allows 2–6. The seat rule (`seatLayout.ts`) is
  unit-tested up to 8 villains.

## Decisions to evaluate
- **Backdrop:** an in-app, pre-blurred backdrop rather than real macOS vibrancy. If overruled: a transparent
  window with `vibrancy: 'under-window'`, and contrast must be re-measured against real wallpapers.
- **Numerals:** regular-width SF, heavy and tabular. The condensed mock face is dropped (rater type score 6.8,
  and CSP blocks it). If overruled: bundle SF Pro Condensed.
- **Coach verdict, gate and commit row stay inline glass panels,** not the mock's bottom sheets. If
  overruled: a follow-up that changes focus and dismissal, which a dozen specs cover.
- **Selected means a light glass fill everywhere.** The committed prediction is no longer mint. If
  overruled: restore the white chip.
- **Grid cells are opaque graphite;** the range editor and equity grids lose their green. If overruled:
  bone or green cells.
- **Folded and busted seats dim to 0.72 / 0.56** (from 0.4 / 0.22) so their text passes AA. If overruled:
  the old dimming fails AA at 2.7–3.6:1.
- **Theme label:** the default theme reads "Glass"; its id stays `graphite`. If overruled: rename the id and
  migrate settings.

## Open questions
- **Real vibrancy?** Default taken: no (see above). It needs a main-process change and a wallpaper contrast
  pass.
- **More than 6 seats?** Default taken: no. The cap stays at 6, and the 9-max mock only shows that the rule
  scales.
- **The multiplayer screen** still lists seats as rows rather than drawing a table. Default taken: restyled
  only. The seat rule could draw it later.

## Alternatives rejected
- **Refined `glass` oval table:** blind 7 vs `sports` 8. Its oval outline crosses folded seats at 9 seats.
- **Round-3 green felt:** last on fit in two blind ratings.
- **Green glow under the board:** lost both blind A/B pairs.

## Evidence
- **App screenshots:**
  - `after/<screen>-<900x640|1100x760>.png`
  - `before/…` (the pre-restyle app)
  - `compare-0..3.jpg` (side by side)
- **Checks:**
  - `e2e-baseline.log`: the untouched code, 544 passed and 1 failed. That failure was pre-existing and is
    fixed in its own commit.
  - `e2e-final.log`
  - `unit.log`
  - `app-contrast.log`
- **Records:**
  - `DECISIONS.md` ("The app restyle" section): what changed, the kept and changed e2e pins, and why no
    failing-first test applies.
  - `code-review.md`: the independent review. It was BLOCK, then PASS WITH NOTES after the fixes.
  - `PR-DRAFT.md`
- **Design study:** `SCORECARD-TABLE.md`, `compare-scaling.jpg`, and the mock at `demo/glass/table-variants.html`.
