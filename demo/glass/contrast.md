# Contrast — glass mockup, round 2

**0 WCAG AA failures across 14 renders**: 7 screens (home, table, predict, gate, verdict, charts, drill) ×
900x640 and 1100x760, dark only.

## Method (rendered pixels, not token math)
`tests/tmp/glass-contrast.mjs` (a throwaway in gitignored `tests/tmp/`) runs these steps for every render:
1. Records every visible text run: its box, colour, and effective opacity (the product of its ancestors'
   opacities). Visible `aria-hidden` text is graded. `inert` content behind a modal is not.
2. Makes all text transparent and screenshots the page, so the backdrop is exactly what the coat, the
   grain, the felt and any float composite to.
3. Clips each box to its scroll and overflow ancestors, composites the text colour over each pixel, and
   takes the 5th-percentile-worst ratio.
4. Fails below 4.5:1, or 3:1 for large text. Disabled controls are reported but not graded; they
   measured 6.0:1 or better anyway. The script exits non-zero on any failure.

Card glyphs sit on the opaque bone face, so they were computed directly: red `#B8322A` on `#F4F2EC` is
5.3:1, and black `#16181B` is 16:1.

Not covered by the script: `::before` counters, hover and focus states, and placeholders. Each of these uses
`--ink-3` or lighter, and `--ink-3` measured at least 4.5:1 here.

## Fixes the check forced in round 2
- `--ink-3` went from `#8C939C` to `#989FA8`. "Unknown" over the felt's lamp pool measured 4.48:1, and
  off-range chart cells measured 4.47:1.
- Keyboard hints (`.key`) moved from `--ink-3` to `--ink-2`. "O" and "F" on the quiz buttons were 3.9–4.1:1.

## Final per-render minimum
```
┌─────────┬────────────────────┬──────┬────────┬────────────────────────────────────────────┬───────┬─────────────┐
│ (index) │ shot               │ runs │ min    │ minText                                    │ fails │ disabledMin │
├─────────┼────────────────────┼──────┼────────┼────────────────────────────────────────────┼───────┼─────────────┤
│ 0       │ 'home-900x640'     │ 72   │ '4.94' │ 'Interleaving'                             │ 0     │ '99.00'     │
│ 1       │ 'home-1100x760'    │ 75   │ '5.73' │ 'Interleaving'                             │ 0     │ '99.00'     │
│ 2       │ 'table-900x640'    │ 49   │ '4.87' │ 'Pot'                                      │ 0     │ '7.02'      │
│ 3       │ 'table-1100x760'   │ 49   │ '4.73' │ 'Pot'                                      │ 0     │ '6.98'      │
│ 4       │ 'predict-900x640'  │ 43   │ '4.87' │ 'Pot'                                      │ 0     │ '99.00'     │
│ 5       │ 'predict-1100x760' │ 43   │ '4.73' │ 'Pot'                                      │ 0     │ '99.00'     │
│ 6       │ 'gate-900x640'     │ 5    │ '6.59' │ 'The verdict appears when you answer, use' │ 0     │ '99.00'     │
│ 7       │ 'gate-1100x760'    │ 5    │ '6.59' │ 'The verdict appears when you answer, use' │ 0     │ '99.00'     │
│ 8       │ 'verdict-900x640'  │ 16   │ '6.13' │ 'Ada and Bo play the hand out behind this' │ 0     │ '99.00'     │
│ 9       │ 'verdict-1100x760' │ 16   │ '6.52' │ 'Ada and Bo play the hand out behind this' │ 0     │ '99.00'     │
│ 10      │ 'charts-900x640'   │ 226  │ '5.11' │ 'K2s'                                      │ 0     │ '99.00'     │
│ 11      │ 'charts-1100x760'  │ 240  │ '5.11' │ 'K2s'                                      │ 0     │ '99.00'     │
│ 12      │ 'drill-900x640'    │ 59   │ '6.18' │ 'Settings'                                 │ 0     │ '99.00'     │
│ 13      │ 'drill-1100x760'   │ 59   │ '6.53' │ 'Every problem is built from its seed, so' │ 0     │ '99.00'     │
└─────────┴────────────────────┴──────┴────────┴────────────────────────────────────────────┴───────┴─────────────┘
```
