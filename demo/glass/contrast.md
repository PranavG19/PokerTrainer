# Contrast — glass mockup, round 3

**0 WCAG AA failures across 14 renders**: 7 screens (home, table, predict, gate, verdict, charts, drill) ×
900x640 and 1100x760, dark only. Measured at DPR 2, the same pixels as the evidence captures.
The minimum moves about ±0.3 between runs because of grain sampling.

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

## Round 3 notes
- The coat now actually frosts (the round-2 blur never rendered at DPR 2), and floats are thinner (a 34% grey
  glass). AA held: 0 failures.
- In response to the raters' legibility notes over the felt and the dunes, `--ink-2` moved from `#AEB4BC` to
  `#C0C6CD` and `--ink-3` from `#989FA8` to `#A3AAB2`, and the coat blur went from 14 to 18px.

## Final per-render minimum
```
┌─────────┬────────────────────┬──────┬────────┬────────────────────────────────────────────┬───────┬─────────────┐
│ (index) │ shot               │ runs │ min    │ minText                                    │ fails │ disabledMin │
├─────────┼────────────────────┼──────┼────────┼────────────────────────────────────────────┼───────┼─────────────┤
│ 0       │ 'home-900x640'     │ 72   │ '6.44' │ 'Sit down and play a hand with the coach ' │ 0     │ '99.00'     │
│ 1       │ 'home-1100x760'    │ 76   │ '6.44' │ 'Sit down and play a hand with the coach ' │ 0     │ '99.00'     │
│ 2       │ 'table-900x640'    │ 49   │ '5.81' │ 'Pot'                                      │ 0     │ '7.27'      │
│ 3       │ 'table-1100x760'   │ 50   │ '5.60' │ 'Pot'                                      │ 0     │ '7.27'      │
│ 4       │ 'predict-900x640'  │ 44   │ '5.81' │ 'Pot'                                      │ 0     │ '99.00'     │
│ 5       │ 'predict-1100x760' │ 45   │ '5.60' │ 'Pot'                                      │ 0     │ '99.00'     │
│ 6       │ 'gate-900x640'     │ 6    │ '7.28' │ 'The verdict appears when you answer, use' │ 0     │ '99.00'     │
│ 7       │ 'gate-1100x760'    │ 6    │ '7.28' │ 'The verdict appears when you answer, use' │ 0     │ '99.00'     │
│ 8       │ 'verdict-900x640'  │ 18   │ '7.03' │ 'Serious'                                  │ 0     │ '99.00'     │
│ 9       │ 'verdict-1100x760' │ 18   │ '6.88' │ 'Serious'                                  │ 0     │ '99.00'     │
│ 10      │ 'charts-900x640'   │ 229  │ '6.63' │ 'AA'                                       │ 0     │ '99.00'     │
│ 11      │ 'charts-1100x760'  │ 232  │ '6.58' │ 'Open'                                     │ 0     │ '99.00'     │
│ 12      │ 'drill-900x640'    │ 53   │ '6.69' │ '20%'                                      │ 0     │ '99.00'     │
│ 13      │ 'drill-1100x760'   │ 54   │ '6.68' │ '20%'                                      │ 0     │ '99.00'     │
└─────────┴────────────────────┴──────┴────────┴────────────────────────────────────────────┴───────┴─────────────┘
```
