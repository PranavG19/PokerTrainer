# demo: glass design mockup (round 2)

## Summary
This is a static HTML/CSS mockup of a modern glass direction for Offsuit. Round 1 ("liquid glass"
everywhere) was rejected as tacky, and this round is a full visual rebuild. Every screen is built from real
app content: the copy, numbers and controls come from `src/renderer` and `src/core`.

- **Material, taken from Synara and Foundry:**
  - the whole window is one translucent coat over a muted, contoured desktop with film grain
  - only the action dock, the commit tray and the coach sheets are glass, so each screen has at most two
    floats
  - divisions are hairlines, not cards
- **The table is the hero:** woven spruce felt in a matte black rail, bone cards with serif indices,
  ceramic chips, and seats set as type.
- **Colour:** near-monochrome. Mint, the pinned `--positive`, appears only for "your turn" and positive
  numbers. The primary button is bone on ink.
- **Scope:** nothing under `src/` changes, and no dependencies change. The mockup is all in `demo/glass/`,
  and the decision record is `DECISIONS.md`. It includes the round-1 diagnosis and what was taken from each
  reference.

## Screens
Each screen is captured at 900x640 and 1100x760 (DPR 2), dark only, in `demo/glass/screenshots/`.

| Screen | File | 3-way compare |
|---|---|---|
| Home | `home.html` | `compare-home.jpg` |
| Table, live | `table.html?state=live` | `compare-table.jpg` |
| Commit first | `table.html?state=predict` | `compare-predict.jpg` |
| Gate | `table.html?state=gate` | `compare-gate.jpg` |
| Verdict | `table.html?state=verdict` | `compare-verdict.jpg` |
| Charts (CO open) | `charts.html` | `compare-charts.jpg` |
| Math drill (graded) | `drill.html` | `compare-drill.jpg` |

## How to open
1. Open `demo/glass/index.html` in Chrome or Safari, since both support `backdrop-filter`.
2. Resize the window to 900x640 or 1100x760.
3. For the side-by-side view, open `demo/glass/compare.html?screen=<id>`. It shows the current app, round 1
   and round 2.

## Verification
- **Contrast:** WCAG AA was measured on rendered pixels, and all 14 renders pass. See
  `demo/glass/contrast.md`.
- **Layout guard:** clean. It found no overflow, no overlapping table panes and no half-covered hero seat,
  and the commit prompt stays on one line.
- **Tests:**
  - `npm run typecheck` passes.
  - `npm test` passes (1796 tests).
  - `npm run e2e` fails at `electron.launch` (540/540), because `node_modules/electron` is half-installed in
    this checkout. This is environmental, not caused by this branch.
- **Test coverage:** no failing-first test applies, since no defect is repaired. No automated test covers
  the visual design.
- **Review:** there was an adversarial review with a "does it still look tacky?" lens against Synara and
  Foundry; see `code-review.md`.

## Decisions for the reviewer
These are in `DECISIONS.md` under "Decisions to evaluate" and "Open questions":
- oval seats set as type
- Coach and Stats in the table corner
- the tray replacing the dock
- bottom sheets
- bone cards
- graphite chart cells
- real vibrancy in Electron (a main-process change)
