# DESIGN — glass mockup, round 2 (implementer detail)

The decisions and the reasons for them are in `DECISIONS.md`. This file is the build sheet.

## Files (`demo/glass/`)
- `tokens.css` is the only source of values. Its header explains the three-part port.
- `glass.css` holds the coat, nav, controls, floats, cards, chips, table, dock, tray, sheets and page
  helpers.
- `shell.js` renders the 11 real tabs and injects the "desktop" SVG (dune bands plus contour lines) behind the
  coat. It also drives the slider fill. `?still=1` freezes the gate budget for captures.
- Pages:
  - `home.html`
  - `table.html`, with `?state=live|predict|gate|verdict`
  - `charts.html`, whose grid is generated from `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`
  - `drill.html`
  - `index.html`
  - `compare.html`, a 3-way compare
- `round1/` holds the rejected round's captures, kept only for the comparison.

## Material model
| Layer | Recipe | Where |
|---|---|---|
| Desktop | SVG dune bands `--desk-1..5` + 22 contour lines at white 7% | `.desk` (simulates vibrancy) |
| Coat | `oklch(0.15 0.012 262 / 0.50)`, `blur(26px) saturate(135%)`, film grain 8% overlay | `.shell` (the whole window) |
| Hairline | white 7% (12% strong), 0.5–1px | dividers, control edges |
| Float | `oklch(0.19 0.01 262 / 0.84)`, `blur(28px) saturate(160%)`, edge white 10%, inset highlight 7%, shadow `0 18px 44px -12px /60%` + `0 2px 8px /30%` | `.float`: dock, tray, sheets only |
| Scrim | `oklch(0.09 0.01 262 / 0.55)`, flat, with the lamp off underneath | behind sheets |

**Rule:** nothing inside the coat blurs, and floats never nest. A float over a float samples the first
float's coat and turns into a slab; Synara measured a 30% coat rendering at 59%.

## Table
- **Rail:** an oval at `left/right 6%`, `top 40px`, `bottom 44px`. The dock overlaps its bottom edge, so
  its blur refracts the rail and the felt.
- **Felt:** a radial spruce vignette plus a 7.5% warm lamp pool, with a twill weave (±45° 1px lines) and
  noise in soft-light, and a 0.5px inlay ring.
- **Seats:** cards plus a `who` column of name and archetype, the stack, and the quip or status. Hero cards
  are 56px wide.
- **Cards:** bone `#F4F2EC` with a 0.5px edge and a three-layer contact shadow. Indices use `ui-serif`
  (New York). Red is `#B8322A` (5.3:1). Backs are ink with a ±60° line lattice and an inner frame.
- **Chips:** an SVG `<symbol>` with a side band, edge inserts and a face ellipse, in two tones (bone and
  slate).

## Type and colour
- **Type:** SF Pro at native tracking, on a 11 / 12 / 13 / 15 / 20 / 28 scale, with tabular figures and
  sentence case.
- **Ink:** `#F3F4F6` / `#AEB4BC` / `#989FA8`.
- **Signals:**
  - mint `#3DDC97` (the pinned `--positive`) only for your turn and positive numbers
  - coral `#F08A7A` (serious) and amber `#E6B866` (the gate budget), as text or a 2px bar
  - the primary button is bone on ink

## Motion
- **The deal:** one moment on load, 640ms `cubic-bezier(.16,1,.3,1)` with a 60ms stagger, from each seat's
  direction.
- **Response motion:** hover colour transitions, a 0.97 press, sheets that rise over 320ms, the meter that
  grows, and the gate budget that drains over 8s.
- `prefers-reduced-motion` turns all of it off. `prefers-reduced-transparency` makes the coat and floats
  97–98% opaque.

## Verification tools (throwaway, `tests/tmp/`)
- **`glass-capture.mjs`** captures at DPR 2 as JPEG. The guard fails on:
  - viewport or clip overflow (scroll containers report "scrolls inside")
  - pairwise overlap of table panes
  - a sheet that half-covers the hero seat
  - a wrapped commit prompt
- **`glass-contrast.mjs`** works at DPR 1. It hides the text, screenshots, clips each run to its visible
  rect, and takes the 5th-percentile-worst ratio. It exits non-zero on any failure.
