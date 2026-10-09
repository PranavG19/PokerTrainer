# DECISIONS — Liquid Glass mockup (`demo/glass/`)

Living record. Each line is the current end state.

## Direction
- **Liquid Glass over a lit felt field.** Every surface (nav, seats, dock, panels, sheets) is a translucent pane
  (`backdrop-filter: blur() saturate(180%)`). Each pane has a specular rim (a 1px masked gradient ring that is
  bright on top), an inset highlight and a two-layer contact-plus-ambient shadow. Behind the panes is a deep
  backdrop built only from CSS: a midnight-teal felt, three blurred light pools (mint, indigo, faint amber) and
  SVG film grain. The table is an elliptical felt bed with a blurred glass rail.
- **Three glass weights**: `thin` (chips, pills), default (seats, nav, cards panel) and `thick` (dock, sheets,
  plan panel). Reading surfaces get the thickest glass.
- **Accent is rationed to the app's pinned mint `#3DDC97`**: the to-act ring, positive results and the one
  primary action per screen. Amber means notable or the gate budget, and coral means serious. Chart boundaries
  and the verdict meter are neutral white, never mint (charts.ts reserves mint).
- **Type**: the system stack (`-apple-system`, SF Pro, fallbacks) on a 7-step scale (11/12/13/15/17/22/34),
  with tabular figures for stacks, pot and prices. Cards use `ui-rounded`.
- **Motion** (CSS only): cards deal from the dealer with a spring and a 70ms stagger, the board flips in,
  buttons lift on hover and scale to 0.965 on press, seats and tiles lift, sheets rise, the meter fills, the
  gate budget drains, and the commit tray grows out of the dock's slot. All of it is off under
  `prefers-reduced-motion`.
- **Nothing is cut to fit 900x640.** Long panels (charts compressed form, plan rows, recent hands) scroll
  inside their glass, as the real screens do. Primary CTAs stay pinned in view.
- **Light variant ("daylight glass")** is a token swap, captured for every screen at both sizes.

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
- The gate and the verdict are modal glass sheets over an inert, blurred table, and the verdict carries a
  pot-share-vs-price meter and a Close (Esc). If overruled, both stay inline strips above the dock in the same
  material, and no dismiss is needed.
- Playing cards switch to an **ivory face** (the app ships a dark face, `--play-card-*`), with
  `--card-red #C42F25` for the red suits. If overruled, keep the dark face, and the glass still works around it.
- Positions (BTN/SB/BB/UTG) appear as badges on seats; the app never renders positions. If overruled, drop
  the badges.

## Open questions
- A light theme conflicts with the renderer's rule that `--text-hi`/`--positive` never appear in a theme block,
  because the e2e pins hold everywhere. Default taken: the light block stays as a mock-only preview. Porting it
  needs either a pin exception or new ink tokens.
- Can Electron hold about 12 stacked `backdrop-filter` layers at 60fps on low-end GPUs? Default taken: assume
  yes for the mock, and keep the `prefers-reduced-transparency` opaque fallback (already in tokens) as the
  escape hatch.

## Contrast (WCAG AA)
- Measured on rendered pixels with text hidden, not on token values: **0 failures in 28 renders**. Method,
  per-render minimums and the fixes it forced are in `demo/glass/contrast.md`.
- Port rule this produced: dim text on glass by colour, never by `opacity`.

## Mock-only vs port work
- Mock-only: static markup, a hard-coded hand (blinds 25/50, hero on the button, flop 4♠ 4♦ K♦, hero K♥ 2♦,
  Bo bets 75), no engine, a deal animation once on load, `?state=live|predict|gate|verdict`,
  `?theme=light`. Copy comes from the real sources: `predictPanel.ts`, `predict.ts`, `coach.ts`,
  `confidence.ts`, the GATE constants in `table.ts`, `tableTalk.ts` in-hand bet line, `jitter.ts` hidden
  archetype "Unknown", `recommend.ts`, `home.ts`, `sessionPlan.ts`, `standing.ts`, `charts.ts` and `drill.ts`.
  The chart is `preflop.ts` `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`.
  - Invented for the mock:
    - table chrome: the "Hand 42 · Flop · Blinds 25/50" label, "75 to call · price 25%", the position
      badges, the "stack" caption and the kbd chips (F, C, R and A are the real hotkeys).
    - verdict sheet: the severity pill, the "Coach" eyebrow and the context line, the "You committed" row,
      the meter, and the footer ("Ada and Bo play the hand out behind this sheet", Close/Esc).
    - gate sheet: the note "The verdict is withheld until you answer…".
    - Home: the bankroll's thousands separator, and the arrow affordances on the suggestion and start cards.
- Port work, in three parts. `tokens.css` explains all three in its header.
  1. Paint goes into one `html[data-theme='glass']` block. Only the tier-2 semantic names
     (`--page --surface --surface-2 --raise --text-lo --text-lo-2 --suit-red --rule --edge`) go in it.
     `--surface*` stays near-opaque, because about 60 renderer rules consume it with no backdrop-filter.
  2. Glass material, blur, radii, spacing, type, motion and the oval layout are **not** theme-block material,
     because styles.css allows themes to change paint only. These become new `:root` tokens plus component
     rules for `.seat`, `.coach`, `.predict`, the action bar, the nav, and a backdrop layer in the shell.
  3. e2e pins to keep or update deliberately:
     - `--text-hi` `#FFFFFF` and `--positive` `#3DDC97` stay out of theme blocks.
     - the pot is 14px/500 (the mock uses 17px/700).
     - Fold has `box-shadow: none` (the mock has glass shadows).
     - the to-act shadow contains `rgba(61, 220, 151, 0.4)` (the mock keeps this). The pin also reads
       `transform` = `matrix(1.02, 0, 0, 1.02, 0, 0)`. The mock uses the `scale` property, which leaves
       `transform` untouched, and the oval's `translateX(-50%)` would compose into that matrix, so this pin
       needs updating in the port.
     - the winner ring has a mint `border-top-color` (not mocked).
  - Also needed: the tray/dock swap in the predict flow, modal focus handling for the gate and verdict
    sheets, and a check of the GPU cost.

## Tests and environment
- No failing-first test applies: no defect is repaired and nothing under `src/` changes.
- No automated test covers the visual design. The evidence is the PNGs in `demo/glass/screenshots/`, the
  capture guard (viewport and clip overflow, pairwise pane overlap on the table, one-line commit prompt, which
  exits non-zero on a hit), and the contrast measurement. Logs: `glass-capture.log`, `glass-contrast.log`.
- `npm run typecheck` passes. `npm test` passes (85 files, 1796 tests).
- `npm run e2e` **fails, all 540 tests, before any app code runs**: `electron.launch: Electron failed to install
  correctly`. In this checkout `node_modules/electron` is half-installed (no `path.txt`, and the
  `Electron.app` has no `Info.plist`). Repairing it means reinstalling, which this task forbids, so it is left as
  is. This is unrelated to the branch, which touches no `src/` and no dependency.
- Captures use Playwright's cached Chromium 1243 headless shell through `executablePath`, because the
  installed playwright-core 1.62 expects revision 1234, which is not downloaded. Nothing was installed.
- The capture and contrast scripts are throwaways in gitignored `tests/tmp/`, as the task specifies. Copies are
  captured as evidence.
- Screenshots are 1× (exact window size), 12 MB in total. 2× was 33 MB.
