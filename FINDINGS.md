# FINDINGS — Offsuit glass mockup, round 2

## Outcome
Round 1 was rejected as tacky, so this is a full visual rebuild on the material model Synara and Foundry use.
The whole window is one translucent coat over a muted, contoured desktop, with film grain. Only the action
dock, the commit tray and the coach sheets are glass, so a screen has at most two floats.

The table is the one bold thing: woven spruce felt in a matte black rail, bone cards with serif indices, and
ceramic chips. Everything else is near-monochrome, with mint only for "your turn" and positive numbers.

It covers seven real screens at 900x640 and 1100x760. Every text run passes WCAG AA, measured on rendered
pixels. Nothing under `src/` changed.

Open `demo/glass/index.html`.

## Decisions to evaluate
- **Oval seating, with seats set as type** instead of the real top row of boxes. If overruled: keep the row,
  and the cards and felt still carry the look.
- **Coach and Stats move to the table's top-right corner**, off the dock. If overruled: the dock carries 11
  controls and is tight at 900px.
- **The commit tray replaces the dock** until you commit (the app stacks both). If overruled: stack them,
  and shrink the hero seat at 900x640.
- **The gate and verdict are bottom sheets that cover the hero row**, and the verdict adds a meter and a
  Close button. If overruled: inline strips above the dock, with no dismiss.
- **Bone card faces with serif indices** (the app uses dark faces). If overruled: dark faces; the felt still
  carries the table.
- **Graphite chart cells**, with bone reserved for real cards. If overruled: bone cells, which turn into a
  white wall at 1100x760.

## Open questions
- **Real vibrancy.** The mock fakes the desktop behind the window. In the app this needs Foundry's
  `vibrancy: 'under-window'` and a transparent window. Default taken: simulate it in the mock and list it as
  port work.
- **The light theme was dropped this round** (it was optional). Default taken: dark only; round 1's light
  work is in git history.
- **The e2e suite could not run** (540/540 fail at `electron.launch`) because Electron is half-installed in
  this checkout. Default taken: left as is. Typecheck and the 1796 unit tests pass.

## Alternatives rejected
- **Round 1's pane-per-element liquid glass** (about 12 blurs, glow rings, a saturated teal felt): the user
  called it tacky.
- **A flat gradient "desktop"** behind the coat: it read as a gradient wash, not glass.

## Evidence
- Mockups: `index.html`, `home.html`, `table.html`, `charts.html`, `drill.html`, `compare.html`,
  `tokens.css`, `glass.css`, `shell.js`.
- Screenshots: `<screen>-<900x640|1100x760>.jpg` for home, table, predict, gate, verdict, charts and drill
  (DPR 2), plus `compare-<screen>.jpg` with the 3-way comparison: current app | round 1 | round 2.
- Contrast: `contrast.md` and `glass-contrast.log`.
- Layout guard: `glass-capture.log`.
- Tests: `tests-typecheck.log`, `tests-unit.log` and `tests-e2e.log`.
- References:
  - `foundry-glass.txt`: Foundry's glass CSS, as read.
  - the Synara notes are in `DECISIONS.md` under "References → what I took from each".
- Records:
  - `DECISIONS.md`: the full decision record.
  - `DESIGN.md`: implementer detail.
  - `code-review.md`: the adversarial review and its resolution.
  - `PR-DRAFT.md`: the draft PR description.
