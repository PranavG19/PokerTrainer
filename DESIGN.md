# DESIGN — Liquid Glass (implementer detail)

The decisions and the reasons for them are in `DECISIONS.md`. This file is the build sheet.

## Files (`demo/glass/`)
- `tokens.css` is the only source of values. Its header explains the three-part port (paint block,
  component rules, e2e pins).
- `glass.css` holds the components:
  - the glass material
  - the nav
  - buttons
  - cards
  - chips
  - the table and seats
  - the dock and slider
  - the commit tray
  - the gate and verdict sheets
  - the reduced-motion block
- `shell.js` sets the theme from `?theme=light`, renders the 11 real nav tabs and adds the backdrop
  layer. It also drives the slider fill. `?still=1` freezes the gate budget for captures.
- Pages:
  - `home.html`
  - `table.html`, with `?state=live|predict|gate|verdict`
  - `charts.html`, whose grid is generated from `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`
  - `drill.html`
  - `index.html`
  - `compare.html`

## Material recipe
Every pane is `.glass`, plus `.thin` or `.thick` where needed. Each pane gets five things:
1. **Fill:** `var(--glass-sheen), var(--glass)`, where the sheen is a top-lit linear gradient.
2. **Backdrop:** `blur(var(--blur-sm|md|lg)) saturate(180%)`.
3. **Specular rim:** a `::before` with 1px padding and a vertical gradient (bright top, faint bottom),
   masked to a ring with `mask-composite: exclude`.
4. **Depth:** `--inner-hi` (inset top highlight plus a 1px inner edge) plus `--shadow-1|2|3` (contact plus
   ambient).
5. **Isolation:** `isolation: isolate`, so the rim never bleeds out of the pane.

## Backdrop
`.field` is a fixed layer built in four steps:
1. A felt radial gradient.
2. Three blurred light pools (mint at the table centre, indigo top-right, faint amber bottom-left), drawn on
   `::before`.
3. SVG `feTurbulence` grain on `::after`, at 7% opacity with `overlay` blend. It stops the gradient banding.
4. The felt oval itself sits on top: a radial bed, inset rings, and a blurred glass rail on `.felt::before`.

## Table layout
Everything is absolute inside `.table-stage`.
- **Seats:**
  - hero at the bottom centre, 96px above the stage bottom (120px while the tray is open)
  - villains at left/top/right
  - villain seat: a 204px grid with avatar, name, hidden-archetype tag, cards, and a stack/status row
  - hero seat: one row with cards, then name/status, then the stack
- **Bet chip:** beside the quip under Bo.
- **Board and pot:** centred at 44% height.
- **Dock:** a bottom pill: Fold, Check, Call, a separator, the slider, ½ ¾ Pot All-in, a separator, Raise.
  The slider default is the minimum raise (150).
- **Predict state:** the tray takes the dock's slot. Row 1 is the prompt (one line). Row 2 is the action
  radios, the confidence radios and the Why field.
- **Gate and verdict states:** a scrim plus a sheet. Siblings and the nav are set `inert` and `aria-hidden`,
  and focus goes to the input or the first button.

## Motion
- **Deal:** `@keyframes deal`, translating from `--from-x/--from-y` with a -14deg rotation and 0.7 scale. It
  runs for `--dur-deal` (560ms) on `--ease-spring`, staggered by `--i` × 70ms.
- **Board:** a `flip` keyframe, starting after 400ms with a 90ms stagger.
- **Hover:** −1px for buttons, −2px for seats, −3px for tiles.
- **Press:** scale 0.965 over 60ms.
- **Sheets:** `rise` (420ms spring).
- **Meter:** `grow` (700ms).
- **Gate:** `drain` (8000ms linear, which matches `GATE_BUDGET_MS`).
- All of it is disabled by `prefers-reduced-motion`.

## Rules learned while building
- Dim text on glass by colour, never by `opacity`. The contrast check failed folded seats at 2.4–3.7:1
  until this changed.
- Light-theme mint must be dark (`#086640` for text; `#0E7F50 → #0A6B43` for a fill under white).
- Keep `--surface*` near-opaque, because about 60 renderer rules consume it without a backdrop. Glass is
  opt-in through `--glass*`.
- `--suit-red` in the renderer is dark-surface text. The ivory-card red is a separate token, `--card-red`.

## Verification tools (throwaway, `tests/tmp/`)
- `glass-capture.mjs` captures every screen, theme and size, plus the comparisons, at 1×. Its guard fails on
  three things:
  - viewport or clip overflow (content inside a scroll container is reported as "scrolls")
  - pairwise overlap of table panes
  - a wrapped commit prompt
- `glass-contrast.mjs` records text runs, hides the text, screenshots, clips each run to its visible rect,
  and takes the 5th-percentile-worst contrast per run.
