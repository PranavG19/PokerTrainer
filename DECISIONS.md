# DECISIONS — Liquid Glass mockup (`demo/glass/`)

Living record. Each line is the current end state.

## Direction
- **Liquid Glass over a lit felt field.** Every surface (nav, seats, dock, panels, sheet) is a translucent pane
  (`backdrop-filter: blur() saturate(180%)`). Each pane has a specular rim (a 1px masked gradient ring that is
  bright on top), an inset highlight and a two-layer contact-plus-ambient shadow. Behind the panes is a deep
  backdrop built only from CSS: a midnight-teal felt, three blurred light pools (mint, indigo, faint amber) and
  SVG film grain. The table is an elliptical felt bed with a blurred glass rail.
- **Three glass weights**: `thin` (chips, pills), default (seats, nav, cards panel) and `thick` (dock, verdict
  sheet, plan panel). Reading surfaces get the thickest glass.
- **Accent is rationed to the app's pinned mint `#3DDC97`**: the to-act ring, positive results and the one
  primary action per screen. Amber means notable and coral means serious. Nothing else is coloured.
- **Type**: the system stack (`-apple-system`, SF Pro, fallbacks) on a 7-step scale (11/12/13/15/17/22/34),
  with tabular figures for stacks, pot and prices. Cards use `ui-rounded`.
- **Motion** (CSS only): cards deal from the dealer with a spring and a 70ms stagger, the board flips in,
  buttons lift on hover and scale to 0.965 on press, seats and tiles lift, the verdict sheet rises, the meter
  fills, and the commit tray grows out of the dock's slot. All of it is off under `prefers-reduced-motion`.
- **Light variant ("daylight glass")** is a token swap only. Each screen was captured at both sizes.

## How this differs from earlier `demo/` explorations
- `demo/directions` (Broadsheet, Obsidian Jewel, Gallery Light, Kinetic Minimal), `demo/gallery` r0–r5 and
  `demo/nocturne-lab` all **ban felt** and get depth from opaque luminance steps and hairlines. Glass shows up
  there only as a light nav blur (≤24px, saturate ≤1.25).
- This one inverts that: **translucency is the identity**. Depth comes from stacked panes refracting a
  coloured field, so felt returns as a blurred light source rather than a green texture.
- `demo/redesign.html` reworks the layout on the opaque graphite palette. This keeps the app's information
  architecture and copy, and changes the material.

## Decisions to evaluate
- Seats move from the real top row to an oval (hero bottom, villains left/top/right). If overruled, keep the
  row and only the material changes, which makes the `table.ts` port smaller.
- Coach and Stats move off the action dock into a toolbar at the top-right of the table. If overruled, the dock
  carries 11 controls again and gets tight at 900px.
- In coached mode the commit tray **replaces** the dock until the player commits (the real app stacks the tray
  above a disabled bar). If overruled, both stack, and at 900x640 the hero seat must shrink to fit.
- The coach verdict is a modal glass sheet over a dimmed, inert table, with a pot-share-vs-price meter. If
  overruled, the verdict stays an inline strip above the dock in the same material.
- Dark is primary and light ships as a token block. If overruled, drop the light block (it costs nothing to keep).

## Contrast (WCAG AA)
- Measured on rendered pixels with text hidden, not on token values. **0 failures in 24 renders.** Method,
  per-render minimums and the five fixes it forced are in `demo/glass/contrast.md`.
- Port rule this produced: dim text on glass by colour, never by `opacity`.

## Mock-only vs port work
- Mock-only: static markup, a hard-coded hand (blinds 25/50, flop 4♠ 4♦ K♦, hero K♥ 2♦), no engine, deal
  animation once on load, states chosen with `?state=` and theme with `?theme=light`. Copy is taken from the real
  sources (`predictPanel.ts`, `predict.ts`, `coach.ts`, `confidence.ts`, `recommend.ts`, `home.ts`, `preflop.ts`
  RFI_SPECS.CO and BOUNDARY_COMBOS.CO). A few small additions are mock-only: the "Hand 42 · Flop · Blinds"
  label, "75 to call · price 25%", the tray hint "The table unlocks once both are picked", the meter, the
  bankroll's thousands separator, and the "Hand continues without you" / "Review hand" footer.
- Port work: `tokens.css` uses the renderer's tier-2 semantic names (`--page`, `--surface`, `--surface-2`,
  `--raise`, `--text-hi`, `--text-lo`, `--text-lo-2`, `--positive`, `--suit-red`, `--rule`, `--edge`), so it
  becomes one `html[data-theme='glass']` block in `src/renderer/styles.css`. Pinned e2e roles hold
  (`--text-hi` `#FFFFFF`, `--positive` `#3DDC97`). The real work: a backdrop layer in the app shell, glass rules
  for `.seat`, `.coach`, `.predict`, the action bar and nav, the oval layout in `screens/table.ts`, the
  tray/dock swap in the predict flow, modal focus handling for the verdict, a `prefers-reduced-transparency`
  fallback (already in tokens), and a GPU-cost check of about 12 stacked `backdrop-filter` layers in Electron.

## Tests and environment
- No failing-first test applies: no defect is repaired and nothing under `src/` changes.
- No automated test covers the visual design. The evidence is the PNGs in `demo/glass/screenshots/`, the
  overflow guard in the capture script, and the contrast measurement.
- `npm run typecheck` passes. `npm test` passes (85 files, 1796 tests).
- `npm run e2e` **fails, all 540 tests, before any app code runs**: `electron.launch: Electron failed to install
  correctly`. In this checkout `node_modules/electron` is half-installed (no `path.txt`, and the
  `Electron.app` has no `Info.plist`). Repairing it means reinstalling, which this task forbids, so it is left as
  is. This is unrelated to the branch, which touches no `src/` and no dependency.
- The capture uses Playwright's cached Chromium 1243 headless shell through `executablePath`, because the
  installed playwright-core 1.62 expects revision 1234, which is not downloaded. Nothing was installed.
- Screenshots are 1× (exact window size). 2× came to 33 MB; 1× is 12 MB.
