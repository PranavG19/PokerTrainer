# DECISIONS — Glass mockup, round 2 (`demo/glass/`)

Living record. Each line is the current end state. Round 1 ("Liquid Glass over a lit felt field") was
rejected by the user as tacky and "not modern glassmorphism". Its captures are kept for comparison in
`demo/glass/round1/`.

## Why round 1 read as tacky (diagnosis)
- **Every element was its own pane.** Nav, four seats, toolbar chips, quip, bet chip, pot, dock, tray and
  sheets each had a blur. That came to about 12 stacked `backdrop-filter`s. Modern material uses 2–3 per
  viewport, and Synara documents why: a blur over a blur samples its own coat and turns into a slab.
- **Uniform heavy blur and saturate(180%) on everything**, over a backdrop that was itself blurred and
  saturated. The result looks plasticky, not like a material.
- **A saturated teal felt and mint/indigo light pools.** It read like a gaming-site gradient, not a room.
- **Glow as emphasis:** a 1.5px mint ring plus a 28px glow on the hero, mint glow under the primary button,
  and mint dashed boundaries. Glow is the dated 2021 glass-card tell.
- **Thick, bright specular rims** (a 38%-white gradient ring) on every pane. Real glass edges are nearly
  invisible: Foundry uses 12% white and an 8% inset highlight.
- **Template chrome:** an all-caps tracked label on everything (UNKNOWN, POT, SUGGESTED NEXT, COACH),
  kbd chips on every button, a mint app-tile logo, gradient "candy" buttons and blue/green toy chips.
- **One radius and one shadow on every card-shaped thing**, the SaaS-card kit.

## Direction (round 2)
- **One coat, a few floats.** The whole window is a single translucent coat over a dark, low-chroma
  "desktop" (simulating macOS under-window vibrancy). Everything inside the window is clear and divided
  by 0.5–1px hairlines. Glass, meaning fill plus blur, is spent only on things that float over content:
  the action dock, the commit tray and the modal sheets. That makes **at most 2 blurred layers per
  viewport.**
- **The table is the one bold thing.** It is real cloth: a deep, desaturated spruce wool with a fine woven
  grain, lit from above by a soft pendant pool, inside a matte black rail with an inlaid hairline. Seats
  are not boxes; they are type set on the rail (name, stack, status) beside the cards.
- **Cards are objects.** Bone faces with a 0.5px edge and a two-layer contact shadow that sits on the felt.
  Indices are in the system serif (New York) and the centre pip is large. Backs are ink with a fine
  low-contrast line pattern.
- **Almost monochrome.** Ink, graphite and bone. Mint `#3DDC97` (the pinned role) appears only for "your
  turn" and positive numbers. Coral and amber appear only as text for severity. The primary button is
  bone-on-ink (Apple dark style), not a mint gradient.
- **Type:** SF Pro at native tracking (Synara's rule), with tabular figures. Sentence case everywhere, no
  all-caps labels. Hierarchy comes from size and weight steps: 11 / 12 / 13 / 15 / 20 / 28.
- **Motion:** one orchestrated moment, the deal on load. Everything else is response motion: colour
  transitions on hover, a press dip, and sheets that rise when opened. No hover lifts on tiles.
- **Dark only this round.** Light was optional and is dropped. Round 1's light work is in git history.

## References → what I took from each
- **Synara** (`tests/tmp/synara`, read-only):
  - "whole-window glass": the body carries ONE translucent coat and nested surfaces go transparent.
  - never stack `backdrop-filter`: a measured 30% coat rendered at 59%.
  - floating composer at popover 55% with `blur(40px) saturate(150%)` on a `::before`.
  - hairlines at white 4–5%.
  - monochrome oklch greys for charts.
  - native SF tracking.
  - muted text is translucent ink, so it is never dimmed twice.
- **Foundry** (`/Applications/Foundry.app`, `src/foundry-glass.ts` read from app.asar):
  - `vibrancy: under-window`, with background at oklch(0.13 0.028 262) / 50% and cards at 65%.
  - floats at 85% with `blur(24px) saturate(180%)`, edge white 12%, highlight `inset 0 1px 0` white 8%.
  - shadow `0 16px 40px -8px` at 55% plus `0 2px 8px` at 30%.
  - blur only on surfaces that cover content.
  - an opaque fallback at 97% under `prefers-reduced-transparency`.
- **"More premium than Foundry"**, in the specifics:
  - film grain on the coat so the blur is not plasticky.
  - a woven felt with a lamp pool instead of a flat surface.
  - real card objects.
  - fewer floats than Foundry's chrome.
  - a serif index on the cards as the one typographic flourish.

## Decisions to evaluate
- Seats move from the real top row to an oval, set as type on the rail rather than boxed. If overruled, keep the
  row: the cards and felt still carry the look.
- Coach and Stats leave the action dock for the table's top-right corner. If overruled, the dock carries 11
  controls and is tight at 900px.
- In coached mode the commit tray **replaces** the dock until the player commits (the real app stacks the
  tray above a disabled bar). If overruled, stack them, and shrink the hero seat at 900x640.
- The gate and verdict are **bottom sheets** that rise over the dock slot and fully cover the hero row. The
  verdict adds a pot-share-vs-price meter and a Close (Esc) button. If overruled, both become inline strips
  above the dock, with no dismiss.
- Cards get bone faces with serif indices (the app ships dark faces). If overruled, use dark faces; the felt
  and rail still carry the table.
- Charts open cells are graphite, not white. Bone is reserved for real cards, so the grid no longer outshouts
  the table. If overruled, use bone cells, and expect a white wall at 1100x760.

## Open questions
- Can Electron get the real look? The mock fakes vibrancy with a CSS "desktop" (dune bands with contour
  lines). In the app this needs Foundry's `vibrancy: 'under-window'` plus a transparent window. Default taken:
  the mock simulates it, and porting needs that main-process change.
- Theme-block rule: styles.css forbids changing `--text-hi`/`--positive` in a theme block. Default taken:
  both keep their pinned values. The coat itself cannot come from a paint-only block (see port work).

## Contrast (WCAG AA)
- Measured on rendered pixels with the text hidden (`tests/tmp/glass-contrast.mjs`). Results are in
  `demo/glass/contrast.md`.

## Mock-only vs port work
- **Mock-only:**
  - static markup with a hard-coded hand (blinds 25/50, hero on the button, flop 4♠ 4♦ K♦, hero K♥ 2♦, Bo
    bets 75)
  - no engine; the deal animation plays once on load
  - `?state=live|predict|gate|verdict`
  - dark only
- **Real copy kept:**
  - `predictPanel.ts` and `predict.ts`
  - `coach.ts`, `coachPanel.ts`, `confidence.ts` and the `table.ts` GATE
  - `tableTalk.ts` in-hand quips: Ada "Check.", Bo "Let's put some in.", Cy "I'm out.". These replace round 1's
    invented status lines.
  - `jitter.ts` hidden archetype "Unknown"
  - `recommend.ts`, `home.ts` (the bankroll is plain digits, coloured net-up), `sessionPlan.ts` and
    `standing.ts`
  - `charts.ts`, including the class-accuracy "—" column
  - `drill.ts` ("Next problem — Enter")
  - `preflop.ts` `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`
- **The gate follows `table.ts`:** the fold is committed but not applied while the gate is open, so the hero
  stays unchanged. The fold lands when the verdict shows.
- **Invented for the mock** (not app copy):
  - the table corner text "Blinds 25/50"
  - "75 to call, a 25% price"
  - the hero's "Your turn" / "Folded" line
  - the empty turn/river card wells
  - the sheets' "Coach" and "Serious" labels and the "On the flop, you folded to 75" context
  - "You committed to Fold, SURE"
  - the meter
  - "Ada and Bo play the hand out behind this sheet" and the Close/Esc footer
  - the gate note "The verdict appears when you answer, use both attempts, or the bar runs out."
  - the key hints on dock buttons (F, C, R and A are the real hotkeys)
- **Port work:**
  1. Main process: Foundry's `vibrancy: 'under-window'`, `visualEffectState: 'active'` and a transparent
     background, so the coat frosts the real desktop. A paint-only theme block cannot produce the coat.
  2. Paint: one `html[data-theme='glass']` block with the tier-2 names (`--text-lo`/`--text-lo-2` = the
     measured `--ink-2`/`--ink-3`, `--suit-red` = coral, `--rule`/`--edge` = hairlines). `--surface*` stays
     near-opaque for the roughly 60 renderer rules that use it without a backdrop.
  3. Component rules:
     - the coat on the shell, plus `.float` for the action bar, the predict panel and the coach sheets
     - the oval table, rail and felt in `screens/table.ts`
     - seats as type
     - bone card faces in `components/card.ts`
     - the tray/dock swap
     - bottom sheets with focus handling
  4. e2e pins this breaks or must update:
     - the pot (14px/500 pinned; the mock uses 20px/600)
     - Fold `box-shadow: none` (the mock has an inset hairline)
     - the to-act mint ring with `rgba(61, 220, 151, 0.4)` and scale 1.02 (the mock replaces it with a dot
       and mint text)
     - the winner ring's mint `border-top-color` (not mocked)
  5. A GPU check: the coat plus at most two floats in Electron.

## Tests and environment
- No failing-first test applies: no defect is repaired and nothing under `src/` changes.
- No automated test covers the visual design. The evidence is the PNGs, the capture guard and the contrast
  measurement.
- `npm run typecheck` passes. `npm test` passes (85 files, 1796 tests).
- `npm run e2e` fails, all 540 tests, at `electron.launch`, because `node_modules/electron` is half-installed
  in this checkout. This is environmental, not caused by the branch. Reinstalling was out of scope.
- Captures use Playwright's cached Chromium 1243 headless shell through `executablePath`. Nothing was
  installed. Synara was shallow-cloned read-only: nothing installed and none of its scripts run.
  Foundry's asar was read by a dependency-free script; nothing in the .app was modified.
