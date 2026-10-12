# FINDINGS — The Back Room, round 2

## Outcome
- **Dee is now "Two lights":** a bone-ceramic dealer button with two engraved lights that carry every expression.
  It was picked from five drawn directions, and a truly blind rater also ranked it first (8/10, 9 for feeling personal).
- **A personalization layer.** It asks who you are once. Dee then quotes your own rules, leaks, rival and kept
  hands, and every line names its `src` source. 22 mocks render on the shipped `sports` table and glass system
  at both window sizes.
- **Blind scores, round 1 → round 2:** 6.88 → 7.90 overall, feels personal 7.0 → 9.1, premium 7.0 → 8.2. The
  re-score after fixes is in `scores.md`. Design and mocks only: nothing under `src/` changed, nothing was
  installed, nothing was pushed.

## Decisions to evaluate
- **Dee's mark is Two lights.** If overruled, pick another column on `dee-marks.html`: one `data-mark` swap redraws every mock.
- **Persistent regulars.** Each named regular keeps one archetype, and their dossier counts only showdowns. If overruled, rivals become per-session reads and the Rival and "Bo's room" screens go.
- **7 tabs plus a You sub-nav** (Profile, Trophies, Style, Hands, Letters, Rivals, Locker, Dee). If overruled, the shipped 11 tabs stay and You nests under Profile.
- **Style identity is one of four neutral archetypes** (The Closer, Anchor, Pressure, Explorer) from VPIP, PFR and aggression. If overruled, Style shows the numbers with no name.
- **Dee's default voice is Warm, speaking "After notable hands".** If overruled, the default is Dry or Mistakes only; copy changes, numbers don't.
- **The weekly letter is scripted templates filled from your numbers, never generated.** If overruled, an LLM rewords it, which needs a spec change (the tutor never sees bulk history).
- **The classic streak has no freeze, as you chose.** The research (Gardner 2012) says one forgiven miss doesn't hurt a habit; if you want one, it's a one-line rule plus a perch state.

## Open questions
- **Chalk** (a spendable earn-only currency) vs receipts only (D4). Default taken: receipts only; round 2 shows no currency.
- **Does "amend fully" also cover hand-history import and ICM** (D18)? Default taken: yes, so Study shows both.
- **The table mocks reuse the shipped 100 bb demo hand,** though the persona is certified at 75 bb (`standing.ts` sets the stack by earned depth). Default taken: keep the shipped hand.
- **Any backend** (leagues, sync; D3). Default taken: none.
- **Environment:** a Homebrew `simdjson` upgrade broke `/opt/homebrew` node mid-task. Default taken: render with the existing mise node 24 and install nothing. Your main checkout's `npm` scripts will hit the same break.

## Alternatives rejected
- **The button (a ceramic button with a jewel eye):** the best craft, but one eye reads as watching and has little range (6/10).
- **Pebble (a glass dome with a visor):** fits the glass best, but it isn't the button and reads as a minus sign at 16px (5–6/10).
- **Orbit (a ring and bead):** crisp, but reads as a loading spinner (5/10).

## Evidence
- **Design:** `DESIGN-BRIEF.md` (the FitPRD principles, P1–P21, each with its source), `fitprd-sources.md` (the research files used), `DESIGN.md` (implementer detail), `persona.md`, `personalization-sources.md`.
- **Mocks:** `dee-marks-*.png` (comparison and blind), plus every screen at both sizes: `home`, `table-live/mistake/great`, `onboarding-step1…4`, `profile`, `trophies`, `style`, `hands`, `letter`, `rival`, `dee-settings`, `locker`, `milestone`, `story`, `lesson`, `study`. `gallery.png` shows the index.
- **Scores and review:** `scores.md`, `scores-raw.md`, `scores-raw-2.md`, `scores-marks.md` and `scores-marks-captioned.md` for the scores; `code-review.md` for both review passes; `DECISIONS.md` for the decision record.
