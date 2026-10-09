# Contrast — Liquid Glass mockup

**Result: 0 WCAG AA failures across 28 renders** (7 screens: home, table, predict, gate, verdict, charts, drill; × 2 themes × 900x640 and 1100x760).

## Method (rendered pixels, not token math)
`tests/tmp/glass-contrast.mjs` (throwaway, gitignored) does this for every render:
1. Record every visible text run: its box, computed colour, and effective opacity (the product of its ancestors' opacities).
2. Make all text transparent and take a screenshot. The backdrop is now exactly what the glass composites to:
   blur, saturate, sheen, scrim and every layer under it.
3. Clip each box to its scroll and overflow ancestors, so only the visible part is measured. Composite the
   text colour over each pixel and take the **5th-percentile-worst** ratio. That trims anti-aliased neighbouring
   borders but still catches a bright light pool behind part of a word.
4. Threshold: 4.5:1, or 3:1 for large text (≥ 24px, or ≥ 18.66px bold). Disabled controls are reported but not
   graded (WCAG exempts them). Their minimum is 5.48:1 anyway.
5. Content behind the gate and verdict sheets is `inert` (a modal), so it is not graded. Visible `aria-hidden`
   text (meter labels, the brand glyph) **is** graded.
6. Not covered by the script: `::before` counters (`.rules`, `.steps`), hover and focus states, and the gate's
   placeholder (it uses `--text-lo-2`, the same token as tertiary text, which measured ≥ 5.0:1 elsewhere). The reviewer probed them separately: counters ≥ 8.86:1, chart-cell hover ≥ 6.18:1, tab hover
   ≥ 15.6:1, meter labels 6.84 (dark) and 8.69 (light).

Card glyphs sit on an opaque ivory face, so they were computed directly: red `#C42F25` on `#EEF1EF` is
4.88:1, and black `#12161A` is 15.98:1.

## Fixes the check forced
- Folded seats were dimmed with `opacity: .55`, which fell to 2.4–3.7:1. They are now dimmed by colour
  (`--text-lo`). **Port rule: never dim text on glass with opacity.**
- Light-theme mint `#0F8F5A` measured 3.1:1 as text and as a fill under white. It is now `#086640` (text) and a
  `#0E7F50 → #0A6B43` fill (6.6:1).
- `--text-lo-2` changed from `#9AAAB1` to `#A6B4BA`. Off-range chart cells over the mint pool measured 4.45:1.
- Keyboard hints (`kbd`) now use `--text-hi`. Before that, "C" inside Call measured 4.41:1.
- Suit red on the ivory card changed from `#D2382C` (4.25:1) to `--card-red #C42F25`. The renderer's
  `--suit-red` (it aliases `--red`, which is text on dark surfaces) maps to coral `#FF7A6B` instead, because
  `#C42F25` on dark glass is only 2.9–3.3:1.
- The brand glyph in light measured 2.76:1, because the mint it sat on followed the darker light `--positive`.
  The brand tile now uses a fixed mint in both themes.

## Final per-render minimum
```
┌─────────┬──────────────────────────┬──────┬────────┬──────────────────────────┬───────┬─────────────┐
│ (index) │ shot                     │ runs │ min    │ minText                  │ fails │ disabledMin │
├─────────┼──────────────────────────┼──────┼────────┼──────────────────────────┼───────┼─────────────┤
│ 0       │ 'home-900x640'           │ 74   │ '6.77' │ '−150'                   │ 0     │ '99.00'     │
│ 1       │ 'home-1100x760'          │ 77   │ '6.17' │ '−150'                   │ 0     │ '99.00'     │
│ 2       │ 'home-light-900x640'     │ 74   │ '5.31' │ '→'                      │ 0     │ '99.00'     │
│ 3       │ 'home-light-1100x760'    │ 77   │ '5.31' │ '→'                      │ 0     │ '99.00'     │
│ 4       │ 'table-900x640'          │ 57   │ '5.53' │ 'BB'                     │ 0     │ '8.48'      │
│ 5       │ 'table-1100x760'         │ 57   │ '5.60' │ 'BB'                     │ 0     │ '8.48'      │
│ 6       │ 'table-light-900x640'    │ 57   │ '5.41' │ '75 to call · price 25%' │ 0     │ '6.47'      │
│ 7       │ 'table-light-1100x760'   │ 57   │ '5.45' │ 'Raise'                  │ 0     │ '6.46'      │
│ 8       │ 'predict-900x640'        │ 52   │ '5.53' │ 'BB'                     │ 0     │ '99.00'     │
│ 9       │ 'predict-1100x760'       │ 52   │ '5.60' │ 'BB'                     │ 0     │ '99.00'     │
│ 10      │ 'predict-light-900x640'  │ 52   │ '5.41' │ '75 to call · price 25%' │ 0     │ '99.00'     │
│ 11      │ 'predict-light-1100x760' │ 52   │ '5.54' │ '75 to call · price 25%' │ 0     │ '99.00'     │
│ 12      │ 'gate-900x640'           │ 6    │ '8.02' │ '↵'                      │ 0     │ '99.00'     │
│ 13      │ 'gate-1100x760'          │ 6    │ '8.03' │ '↵'                      │ 0     │ '99.00'     │
│ 14      │ 'gate-light-900x640'     │ 6    │ '5.45' │ 'Submit'                 │ 0     │ '99.00'     │
│ 15      │ 'gate-light-1100x760'    │ 6    │ '5.45' │ 'Submit'                 │ 0     │ '99.00'     │
│ 16      │ 'verdict-900x640'        │ 16   │ '4.75' │ 'Serious'                │ 0     │ '99.00'     │
│ 17      │ 'verdict-1100x760'       │ 16   │ '4.69' │ 'Serious'                │ 0     │ '99.00'     │
│ 18      │ 'verdict-light-900x640'  │ 16   │ '4.65' │ 'Serious'                │ 0     │ '99.00'     │
│ 19      │ 'verdict-light-1100x760' │ 16   │ '4.69' │ 'Serious'                │ 0     │ '99.00'     │
│ 20      │ 'charts-900x640'         │ 225  │ '5.01' │ 'Q7o'                    │ 0     │ '99.00'     │
│ 21      │ 'charts-1100x760'        │ 239  │ '5.01' │ 'J7o'                    │ 0     │ '99.00'     │
│ 22      │ 'charts-light-900x640'   │ 225  │ '5.45' │ 'AA'                     │ 0     │ '99.00'     │
│ 23      │ 'charts-light-1100x760'  │ 239  │ '5.51' │ 'AA'                     │ 0     │ '99.00'     │
│ 24      │ 'drill-900x640'          │ 58   │ '5.00' │ 'Outside the band'       │ 0     │ '99.00'     │
│ 25      │ 'drill-1100x760'         │ 58   │ '5.09' │ 'Outside the band'       │ 0     │ '99.00'     │
│ 26      │ 'drill-light-900x640'    │ 58   │ '4.70' │ 'Outside the band'       │ 0     │ '99.00'     │
│ 27      │ 'drill-light-1100x760'   │ 58   │ '4.74' │ 'Outside the band'       │ 0     │ '99.00'     │
└─────────┴──────────────────────────┴──────┴────────┴──────────────────────────┴───────┴─────────────┘
```
