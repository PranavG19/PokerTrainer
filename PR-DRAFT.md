# demo: Liquid Glass design mockup

## Summary
This is a static HTML/CSS mockup of an Apple-style "liquid glass" direction for Offsuit. Every screen is
built from real app content: the copy, numbers and controls come from `src/renderer` and `src/core`.
Every surface becomes a translucent pane with a specular rim and layered shadows. The panes sit over a deep
felt backdrop with light pools, built only from CSS. Mint is kept for to-act, positive results and the one
primary action per screen. Type is the system SF stack on a 7-step scale.

- **Nothing under `src/` changes, and no dependencies change.** The mockup lives entirely in `demo/glass/`,
  and the decision record is in `DECISIONS.md`.
- **The design tokens are in one file**, `demo/glass/tokens.css`, named after the renderer's tier-2
  semantics. Its header describes the three-part port (a paint block, component rules, and the e2e pins).
- **The direction differs from the earlier `demo/` explorations**, all of which banned felt and used opaque
  depth. Here translucency is the identity. See `DECISIONS.md`.

## Screens
Each screen is captured at 900x640 and 1100x760, in dark and light, in `demo/glass/screenshots/`.

| Screen | File | Before / after |
|---|---|---|
| Home | `home.html` | `compare-home.png` |
| Table, live (flop, hero to act, dock and bet slider) | `table.html?state=live` | `compare-table.png` |
| Commit first (the predict panel replaces the dock) | `table.html?state=predict` | `compare-predict.png` |
| Gate (verdict withheld behind the one-line prompt) | `table.html?state=gate` | — (no current "before" capture exists) |
| Coach verdict and prediction result | `table.html?state=verdict` | `compare-verdict.png` |
| Preflop charts (CO open) | `charts.html` | `compare-charts.png` |
| Train → Math drill (graded) | `drill.html` | `compare-drill.png` |

## How to open
1. Open `demo/glass/index.html` in a browser. Chrome or Safari is recommended, because they support
   `backdrop-filter`.
2. Resize the window to 900x640 or 1100x760.
3. Optionally, add `?theme=light` to any page for the light variant.
4. Optionally, open `demo/glass/compare.html?screen=<id>` for the side-by-side before/after view.

## Verification
- **Contrast:** WCAG AA was measured on rendered pixels, and all 28 renders pass. See
  `demo/glass/contrast.md`.
- **Layout guard:** the capture run found no viewport or clip overflow, no overlapping table panes, and the
  commit prompt stays on one line.
- **Tests:**
  - `npm run typecheck` passes.
  - `npm test` passes (1796 tests).
  - `npm run e2e` fails: 540 out of 540 tests stop at `electron.launch`, because `node_modules/electron` is
    only half-installed in this checkout. This is an environment problem, not caused by this branch.
- **Test coverage:** no failing-first test applies, since no defect is repaired. No automated test covers
  the visual design.
- **Review:** there was an adversarial review; see `code-review.md`.

## Decisions for the reviewer
These are listed in `DECISIONS.md` under "Decisions to evaluate" and "Open questions":
- the oval seat layout
- moving Coach and Stats into a toolbar
- the tray replacing the dock
- modal gate and verdict sheets
- the ivory card face
- position badges
- whether a light theme can be ported at all, given the e2e colour pins
