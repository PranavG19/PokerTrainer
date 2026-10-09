# FINDINGS — Offsuit "Liquid Glass" mockup

## Outcome
This is a static mockup of an Apple-style liquid-glass direction. Translucent panes, each with a bright top
rim and soft layered shadows, sit over a deep felt backdrop with blurred light pools. Mint is used only
for "your turn", wins and the one main action on each screen. Type is the system SF font.

It covers seven real Offsuit screens: Home, the table (live, commit first, gate, verdict), Charts and the
Math drill. Each is captured at 900x640 and 1100x760, in dark and light. Every glass text run passes WCAG AA,
measured on the rendered pixels. Nothing under `src/` changed.

Open `demo/glass/index.html`.

## Decisions to evaluate
- **Oval seating** instead of the real top row of seats. If overruled: keep the row, and only the material
  changes, which makes the table port smaller.
- **Coach and Stats move to a top-right toolbar**, off the action dock. If overruled: the dock carries 11
  controls again and is tight at 900px.
- **The commit tray replaces the action dock** until you commit; the real app stacks both. If overruled:
  stack them, and shrink the hero seat at 900x640.
- **The gate and the verdict are modal glass sheets** over a blurred table, and the verdict gets a meter and
  a Close button. If overruled: they stay inline strips above the dock, and no dismiss is needed.
- **Ivory card faces**; the app uses dark faces. If overruled: keep the dark faces, and the glass still works.
- **Position badges (BTN/SB/BB/UTG) on seats**; the app shows none. If overruled: drop them.

## Open questions
- **Can a light theme be ported?** The renderer forbids theme blocks from changing `--text-hi` and
  `--positive`, because e2e tests pin those colours. Default taken: light ships as a mock-only preview.
- **Is the GPU cost acceptable?** The mock stacks about 12 `backdrop-filter` layers, and Electron must hold
  that on low-end GPUs. Default taken: assume yes, with the opaque `prefers-reduced-transparency` fallback
  already in the tokens.
- **The e2e suite could not run.** All 540 tests fail at `electron.launch` because `node_modules/electron`
  is half-installed in this checkout. Default taken: left as is, because reinstalling was out of scope.
  Typecheck and the 1796 unit tests pass.

## Alternatives rejected
- **Glass on the opaque `--surface` tokens.** It would turn about 60 non-glass renderer surfaces
  see-through.
- **Hiding copy to fit 900x640.** Panels scroll instead, as the real screens do.

## Evidence
- Mockups: the `demo/glass/` folder, also kept as evidence: `index.html`, `home.html`, `table.html`,
  `charts.html`, `drill.html`, `compare.html`, `tokens.css`, `glass.css`, `shell.js`.
- Screenshots: `<screen>[-light]-<900x640|1100x760>.png` for home, table, predict, gate, verdict, charts and
  drill, plus `compare-<screen>.png` for each before/after pair.
- Contrast: `contrast.md`, with the log in `glass-contrast.log`.
- Capture and layout guard: `glass-capture.log`.
- Tests: `tests-typecheck.log`, `tests-unit.log` and `tests-e2e.log`.
- Records:
  - `DECISIONS.md`: the full decision record.
  - `DESIGN.md`: implementer detail.
  - `code-review.md`: the adversarial review and its resolution.
  - `PR-DRAFT.md`: the draft PR description.
