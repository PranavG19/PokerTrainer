# Glass redesign, built: every screen as the mockup (draft — do not merge without review)

Branch `glass-full-redesign` → `main`. Base `ddd4f27`.

## Summary
The previous restyle gave the app the glass tokens, materials and the `sports` table, but most screens kept
their old layouts. This branch builds the mockup's layouts and components (`demo/glass/*.html`, rounds 3 and 5)
in the real app. Every decision, and every spec change with its reason, is in `DECISIONS.md` ("The full
redesign").

- **Shared kit** (`styles-glass.css`, "Shared primitives"): text roles, the stat component, inset groups vs
  hairline sections, segmented tracks with ONE sliding selected thumb (`components/thumb.ts`), switches,
  keycaps, mini cards, the tertiary/large button ranks. SVG glyphs in `components/glyphs.ts`.
- **Chrome:** tabs grouped play / study / you with short dividers and the sliding thumb; the spade mark and
  wordmark; the hiddenInset traffic lights centred on the 44px bar (`trafficLightPosition`). The tab bar is
  built once, so the thumb slides and a clicked tab keeps focus.
- **Home:** neutral bankroll with a baseline mint/coral delta, the stat component for depth, Suggested next as
  a hairline section (eyebrow 6px from its title), launch rows as one inset group, recent hands with mini
  cards and U+2212 amounts, the planner as a flat hairline table with segmented controls and one bone Start.
- **Table:** Coach as a real switch and Stats as a text button in the table's corner; the dock's
  secondary/primary hierarchy with trailing keycaps, the filled slider, the preset group; the Win/Tie strip
  becomes a corner readout; round-5 fixes (one green on the hero, dealer button off the cards, board nearer
  the hero); empty board wells.
- **Coached sheets:** the gate and the verdict are sheets over the table (focus moved in, the table dimmed and
  inert, Close/Esc), with the severity glyph, a new price meter (`Grade.price`) and the commit lead-in; the
  commit tray takes the dock's place until the hero commits. Every behaviour contract is kept (the 8s budget,
  Enter-to-submit, the announcer, commit-before-feedback, the verdict cleared at the next decision).
- **Every other screen** restyled with the kit: Learn, every Train drill, Charts (graphite cells, corner-notch
  boundary, the 288px side column), Bank, Equity, Ranges, Dossier, Progress, Profile, Settings, Review,
  Assessment, Career, Multiplayer.
- **Repo setup:** `AGENTS.md` (commands, the glass token/stylesheet/colour-role conventions, "affected-tests is
  for iteration only"), `CLAUDE.md` → `@AGENTS.md`, and `.claude/skills/verify-app/` (run once, green).

## Bugs found and fixed (each with a failing test first)
- Equity showed its hidden villain inputs and grid in "Any two cards" mode (`grid-tools.spec` E1).
- Spots labelled Check's hotkey "C" instead of K (`puzzle.spec` 0).
- Learn: Enter on the lesson list re-clicked the persistent focused tab (`lesson.spec` 7).
- Review findings: switching Coach on hid an uncoached verdict while the voice read on; a stale "hand plays
  on" caption at handover; two primaries at handover (`coached-handover.spec` 4, 5).

## Spec changes (none weakens an assertion; details in DECISIONS.md)
- `screens.spec`: U+2212 minus in hand nets; the bankroll's loss colour asserted on its delta.
- `predict.spec`: the Coach switch's off state via `role="switch"` + `aria-checked`.
- `layout.spec` 8: the made-hand float — every row on screen, inside the body, hit-testing to itself; no seat
  stack covered.
- `gate.spec` 5: the budget bar keeps draining under reduced motion (a functional timer).
- `charts.spec` 4: the boundary's corner notch counts as its non-colour cue.
- Added: `coached-handover.spec` 3–5, `grid-tools.spec`, `puzzle.spec` 0, `coach.test.ts` (`Grade.price`).

## Not built from the mockup
- **The price line** ("75 to call, a 25% price") under the board: it would hand the learner the pot-odds
  answer the drills ask for.
- **A fully modal verdict sheet over the dock:** the dock stays live under the sheet, so Next hand at handover
  and the next commit are never blocked (`coached-handover.spec` 1 pins that).
- **The uncoached verdict as a sheet:** the mock defines sheets only in coached mode; uncoached it stays an
  inline float with the same head and meter.
- **Real macOS vibrancy and condensed numerals:** kept as the user decided (pre-blurred in-app backdrop; CSP
  blocks the condensed face).
- **A drawn multiplayer table:** multiplayer still lists seats as rows (now an inset group).

## Verification
- `npm run typecheck`: exit 0. `npm test`: 1804 passed.
- `npm run e2e` (full): 551 passed, 0 failed, 1 skipped (the same opt-in live-tutor skip as on `main`).
- AA contrast on the running app: 100 renders (every screen and table state in Glass and Obsidian, plus the
  busted-seat showdown), 0 failures, minimum 4.75:1 (`tests/tmp/aa-fr.log`).
- Screenshots of every screen at 900x640 and 1100x760 (`tests/tmp/app/fr-final/`); before / after / mockup
  comparisons for Home, the table, the tray, the gate, the verdict and Charts (`tests/tmp/app/fr-compare/`).
- Independent adversarial review: `code-review.md`.

## Final test run
On `2a69db7` (the last code commit; the commit after it changes only this file):
- `npm run typecheck`: exit 0.
- `npm test`: 86 files, 1804 passed.
- `npm run e2e`: 551 passed, 1 skipped, exit 0, 40.0 min.
- Screenshots that the e2e run rewrote under `screenshots/` were restored, not committed.
