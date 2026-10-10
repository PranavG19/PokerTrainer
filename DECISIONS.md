# DECISIONS — Glass mockup (`demo/glass/`)

Living record. Each line is the current end state.
- Round 1 ("liquid glass" everywhere) was rejected as tacky; its captures are in `demo/glass/round1/`.
- Round 2 (one coat, few floats) was liked for its background; its captures are in `demo/glass/round2/`.
- Round 3 is a scored, element-by-element refinement. The rubric and scores are in `SCORECARD.md` and
  `demo/glass/scorecard.html`.

## The app restyle (shipped look: glass, with the `sports` table)
The user chose `sports`. The real app (`src/renderer/`) now uses the glass system and the `sports` table.
The mock in `demo/glass/` stays as the reference.

### What changed, and where
- **`styles-glass.css`** (new, loaded after the global sheets) holds the whole look.
  - Tokens, a pre-blurred backdrop, one coat, a titlebar nav and one button system.
  - Selected states, fields, floats, bone cards, grid-cell faces, and the table.
  - Per-screen sheets are untouched. The few selected states they define are overridden with an `html`
    prefix.
- **`seatLayout.ts`** (new, pure, unit-tested in `tests/unit/seatLayout.test.ts`) is the scoreboard "U" rule
  from the mock. It gives one or two seats per side column and the rest in the top row, clockwise from the
  hero.
- **`screens/table.ts`** has three small DOM changes:
  - a `.table-stage` wrapper
  - the pot as "Pot" plus a value span, with the text still "Pot N"
  - the hero's seat moves onto the hero plate, together with the big hole cards
  - Seat order in the document is unchanged (0, 1, 2, 3).
- **`screens/settings.ts`:** the default theme's label reads "Glass". Its id stays `graphite`, so saved
  settings still resolve.

### Decisions
- **The backdrop is drawn in the app and pre-blurred,** not real macOS vibrancy. A static `filter: blur` layer
  is rasterised once, while a full-window `backdrop-filter` re-blurs on every repaint (`deal-perf.spec`
  measures the flop). Contrast was measured on this exact backdrop. Real vibrancy needs a transparent window,
  and contrast then depends on the user's wallpaper.
- **Numerals are regular-width SF, heavy and tabular,** not the mock's condensed SF. Supersedes: condensed
  figures across the app. The latest blind rater scored the condensed face 6.8 on type and asked for SF Pro
  tabular, and it needs a system-font file hack that Electron's CSP would not load.
- **The coach verdict, the gate and the commit row stay inline panels** under the table, now as glass
  floats. They are not the mock's bottom sheets. Sheets would change focus and dismissal behaviour that a
  dozen specs cover, so they are a separate change.
- **Selected means the glass thumb** (a light fill with light ink) everywhere. It replaces the old white chip
  and the white outlines. The committed prediction is a selection, so it is no longer mint.
- **Grid cells get opaque graphite faces:** in range is `#474C55`, out is `#1C1F25`, a 3-bet is stronger. Bone
  is reserved for real cards. The range editor and equity grids lose their decorative green. The opaque face
  is also what lets the revealed-cell ring read (`charts.spec` 6b).
- **Obsidian stays a paint-only alternative.** It is opaque near-black with the backdrop hidden, and switching
  to it still causes no layout (`theme.spec`).
- **Kept pins:**
  - `--text-hi` stays white and `--positive` stays mint.
  - The to-act ring (mint at 0.4 alpha with a 1.02 scale), and a resting seat's transform of `none`. Seats are
    placed with `translate`, never `transform`.
  - Fold has no shadow, and the enabled Raise is lifted. The secondary hairline is a border.
  - A busted seat has a dashed edge.
  - The seat opacity order holds: live is 1, then folded, then busted, all above 0.
- **Folded and busted opacity moved from 0.4 / 0.22 to 0.72 / 0.56.** At the old values the dimmed seat
  text failed AA on the coat (2.7–3.6:1 in `app-contrast.log`). The order is what `busted-seats.spec`
  pins, not the values. All text on a busted seat is full ink, so it stays legible at 0.56. A folded
  hero now also dims their own hole cards on the hero plate.
- **Three "quiet" captions were coloured with a surface token (`--surface-hi`),** which made them invisible
  (1.2:1, before and after the restyle). They are now `--text-lo-2`:
  - the charts class score with no attempts
  - the drill's "when" tag
  - the drill's "Full worked method" line
  - The tab bar stays at or under 52px; it is 44px.
- **Changed pin:** `interaction.spec`'s pot check asserted the old 14px/500 `.pot`. It now asserts what the
  design intends: the pot figure is white, at least 700 weight, larger than every seat stack, and the text
  still reads "Pot N".
- **A pre-existing failure was fixed in the test,** in its own commit. `voice.spec` test 2 failed on `main`
  before any restyle. Its second verdict is hand 2, because re-opening the table continues the hand
  numbering, and that hand grades notable rather than the pinned hand-1 serious.

### Tests: why no failing-first test, and what no test covers
- **No failing-first test applies.** A restyle repairs no defect. The new behaviour with logic is the seat
  rule, and `seatLayout.test.ts` covers it. The pot pin was rewritten to the new intent; it was not loosened.
- **No test covers:**
  - How the screens look, beyond the e2e colour, geometry and fit pins.
  - The 6–9 seat compaction in the real app, which has 4 seats solo; the rule is unit-tested but only the
    mock renders more seats.
  - The obsidian theme's appearance.
  - Hover and press states.
  - The backdrop under `prefers-reduced-transparency`.
  - The evidence for these is the Playwright screenshots of the running app (`tests/tmp/app/`) and the
    contrast measurement on them (`app-contrast.log`).
- **AA on the running app:** 96 renders at both sizes, and all pass. The minimum is 4.75:1, the dealer
  button's "D" on bone in Obsidian.
  - The renders are every screen state in the default theme, the same in Obsidian, and a busted-villain
    showdown and next hand in both themes.
  - The method is `app-contrast.mjs` plus `aa-measure.py`: rendered pixels with the text hidden, the
    5th-percentile-worst pixel per text run.
  - It does not see pseudo-element text, such as the "Bet" label and the quote marks. Those were checked
    by hand: "Bet" is `--ink-2` on the pill, about 9:1.
- **A layout test was added after the review found a defect:** no seat may overlap the board or another seat
  at showdown at 900x640 (`layout.spec` 4). It failed first ("seat 3 x board": the river crossed Cy's seat),
  and it passes after the side seats were capped at `47% - 160px`.

## Table: refined tinted glass, and more seats
The user is leaning to `sports` and the tinted `glass` table. `?felt=glass` is now the refined slab; the
round-4 version stays as `?felt=glass-r4`. Links to `?felt=glass` in the round-4 records now open the refined slab; the version those ratings scored is `glass-r4`. The seat count is switchable: `table.html?felt=glass&seats=6`
(4, 6 or 9).

### What was wrong with `glass-r4` (both blind raters) → the fix
- **The oval framed an empty field.** The rail filled about 80% of the window with nothing in it but a
  dead zone between the board and the hero (rating 2 surface hier/space; rating 1 space). → The slab is
  smaller and holds only the pot and board; the seats sit on its rim.
- **The rail was neither glass nor coat.** It had two concentric hairlines of different opacities that
  read as an embossed tabletop or a "CSS donut" (rating 1 material/craft; rating 2 material). → One real
  frosted slab: one 0.5px rim, a specular top edge, a soft inner shadow, and no inner pane.
- **The pot did not lead.** "Pot 225" was about 20px, lower than the hero's 34px stack (both raters, pot
  and hero hier). → The pot uses the `sports` scoreboard numeral and is the largest figure on the table.
- **Seats were loose type on the surface.** Name, stack and quip sat at one level with no container, unlike
  the app's row cards (rating 2 seat consist/hier). → Seats use the `sports` row card, the same radius,
  fill and condensed stack for every seat.
- **No seat states.** Nothing marked the active villain or the folded seats (both raters, seat states). →
  The seat with the live bet gets a brighter rim and full-ink text, folded seats lose the plate, and busted
  seats show as an outlined empty chair.
- **Empty turn and river slots vanished** (1.15:1). → 1px outlined wells, as in `sports`.
- **The bet was a 3D chip** (rating 2 bet apple 4). → The flat "Bet 75" pill from `sports`.
- **The hero was not distinguished** except by the green dot. → The `sports` mint wash on the hero card:
  colour reserved for whose turn it is.
- **No identity or sense of place** (rating 2 colour). → A very faint green glow under the board was tried on
  both `glass` and `sports` (`&glow=1`) and **not adopted**. The blind rater preferred the version without it
  in both pairs (`glass` 7 vs 6 overall, `sports` 8 vs 7), saying it is decoration that dilutes the "Your
  turn" green. The `&glow=1` switch stays in the mock for reference only.

### Result and recommendation (blind rating 3, `SCORECARD-TABLE.md`)
- **Scores:** `sports` 8 overall (fit 8.17, scales 7.83). Refined `glass` 7 (fit 7.17, scales 7.33).
  `glass-r4` 5 (fit 7.33, scales 6.33). In the same rating, the refinement put `glass` 2 points above `glass-r4` overall and on hierarchy
  (7.67 vs 6.50). It is slightly lower on fit (7.17 vs 7.33) and on type (6.8 vs 8.0, the condensed numerals). `sports` still beats
  it on every summary score.
- **Recommendation: ship `sports`**, with its 6- and 9-seat rows layout. `glass` is the alternative if you
  want a literal table shape.
  - It is the better oval, and it scales to 9 seats at 900x640 with no overlaps.
  - The rater still reads the oval as a game skin no other screen uses.
  - At 9 seats the oval's hairline runs through the folded seats.
- **Rater fixes not yet applied (unrated):**
  - `sports`:
    - Close the about-170pt gap between the price line and the hero at 1100x760.
    - Drop one of the hero's two greens (the wash or the green "Your turn" text).
    - Move the dealer button off the hero's card.
  - `glass`:
    - Give folded rim seats the frosted fill, so the rim hairline stops cutting through them.
    - Mark the active villain at 4 seats too.
  - Both: the condensed numerals (`type` 6.8) are the open decision below.

### Seat counts the real app supports
- **Solo play: hero plus 3**, fixed. The table screen seats `['You', 'Ada', 'Bo', 'Cy']`
  ([table.ts:83](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/table.ts:83)).
- **LAN multiplayer: 2 to 6 seats.**
  - The room rejects anything outside 2..6
    ([multiplayer.ts:131](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/multiplayer.ts:131)).
  - The main process clamps the host request to 2..6, default 3
    ([main.ts:292](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/main.ts:292)).
  - The host picker offers 2 to 6 ([multiplayer.ts:352](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/multiplayer.ts:352)).
  - The relay comments that "2–6 seats a real table uses"
    ([relayHost.ts:44](/Users/pranavgk/Documents/scratch/temp/Poker/src/main/relayHost.ts:44)).
  - The multiplayer screen draws seats as a list of rows, not an oval
    ([multiplayer.ts:444](/Users/pranavgk/Documents/scratch/temp/Poker/src/renderer/screens/multiplayer.ts:444)).
- **The engine has no cap.** `createTable` takes any seat array
  ([table.ts:120](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/table.ts:120)). The six
  archetypes are villain styles, not seats
  ([archetypes.ts:2](/Users/pranavgk/Documents/scratch/temp/Poker/src/core/archetypes.ts:2)).
- **9-max exceeds today's maximum of 6.** It is mocked as a stress case only.

### Seat layout algorithm (`demo/glass/table-seats.js`)
- **Order:** villains go clockwise from the hero, who is on the button. Seat 1 is always the small blind,
  on the hero's left.
- **Ring layout (`glass`, and `glass-r4` for comparison).**
  - Villains sit on the slab's rim ellipse, spaced evenly by arc length (not by angle, which bunches the
    end seats).
  - The arc's half-width from 12 o'clock is 90° for up to 3 villains, 112° for 5 and 124° for 8. Extra
    seats wrap down the sides toward the hero.
  - A seat is clamped 12px inside the window.
  - The hero holds the bottom of the rim. The pot and board sit 4% below the slab's centre.
- **Rows layout (`sports`): a scoreboard U.**
  - Each side column holds `max(1, round(k/4))` seats, where k is the number of villains. The rest form one
    top row across 27–73% of the width.
  - Columns fill the band between the top row and the hero.
- **Bets.**
  - A bet sits 8px inside its seat, on the line to the pot.
  - If that spot hits the board, the price line, a seat, the hero or another bet, it tries straight across,
    then straight up or down, stepping outward 4px at a time.
  - In the rows layout, a top-row seat bets straight down and a column seat straight across, so ownership
    reads by alignment.
- **Dealer button:** on the seat's inner edge, vertically centred, clear of the stack figure.
- **Compaction.**
  - Full (4 seats): the round-4 seat card.
  - Mid (5–6): cards 30 → 26px, no "Unknown" tag, the quip cut to 112px, folded seats drop the quip.
  - Compact (7–9): cards 21px, no quips except on the live seat, folded seats show no cards, and stacks
    shrink to 20px (22px live) but stay condensed and legible.
- **States:**
  - The live bettor gets a brighter rim and a larger stack.
  - Folded seats lose the plate and are dimmed.
  - A busted seat is a dashed empty chair reading "Sitting out".
- **Verified by:** [r5-capture.log](/Users/pranavgk/Documents/scratch/temp/Poker/tests/tmp/r5-capture.log): 116 renders, all
  passing the layout guard.
  - **Sets covered:**
    - The 48 evidence renders.
    - Probes with every villain betting and the button on seat 1 or 4.
    - Predict and gate at 4–9 seats.
    - 5, 7 and 8 seats.
  - **Checks:**
    - No clipping, and no truncated name or stack.
    - The seat count matches.
    - No unplaced bet.
    - No overlap between seats, hero, bets, pot, board, price, corners, dock, commit tray and every dealer button.
    - The glass slab clears the dock and tray.
  - **What it does not check:**
    - Overlaps under an open sheet. The table behind is inert and dimmed, and only clipping is tested.
    - The oval's hairline crossing seats. The rater flagged this at 9 seats.
    - Resizing after load.
  - **AA:** checked on the 48 evidence renders,
    [r5-contrast.log](/Users/pranavgk/Documents/scratch/temp/Poker/tests/tmp/r5-contrast.log).
    - All 36 `glass` and `sports` renders pass (minimum 4.93:1 against the 4.5 bar).
    - The only failures are `glass-r4` at 6 and 9 seats, at 3.2–3.65:1. There its bare-type seats land on its rail hairline, which
      is a reason the round-4 surface does not scale.

## Round 4 — the table surface (green under review)
The user likes the direction but questions the green felt. Round 4 changes only the table surface and what
sits on it, offering switchable variants (`table.html?felt=…`). Everything else stays as in round 3.

### Apple Sports: what makes it premium (from the App Store listing, iOS 26 assets; see references.md)
- **A dark canvas that is never flat.** The Today list sits on a deep, clearly saturated brand-green field, with a gentle top-down gradient and one lighter grouped card, not pure #000. The game
  sheet's canvas is the two team colours blended across the width, with soft vertical light streaks.
  Depth comes from tint and light, not texture.
- **Team colour is identity, not surface.**
  - A colour appears as a wash: a diagonal or left/right gradient behind a live card, or a soft glow
    behind a crest.
  - It appears as an accent: the possession bar or a tick.
  - Rows in the list stay neutral, and the colour is only in the logos.
  - Even the full-colour sheet keeps every number white.
- **Scoreboard typography.** Scores are a heavy, condensed, tabular face (SF Pro Compressed/Condensed
  Bold) at roughly 3× the size of everything around them. The clock is a medium-weight middle figure.
  Labels are small and grey. The scale contrast does the hierarchy, with almost no boxes.
- **Card and row materials.**
  - The Lock Screen cards are opaque colour washes with 0.5px light edges.
  - The Upcoming list is frosted glass over a blurred teal-to-navy field, with the focused row lifted as
    its own slightly lighter glass slab.
  - Lists use full-bleed hairline dividers and generous row heights.
- **Live state.** "3rd 11:55" plus a small symbol and a progress bar; no flashing. What is live is shown
  by which numbers are present, plus one accent bar.
- **Density and restraint.** There are many rows, but each row is three things: a crest, a number and a
  name. There is nothing decorative, and the motion is functional.

### Translated to a poker table
- The table should be a **canvas defined by light and tint**, not a textured material. The oval can stay,
  but as a lit zone rather than a cloth.
- **"Team colour" maps to the player whose turn it is.** It is one accent wash behind the acting seat,
  never the whole surface.
- **The pot is the score:** a heavy, condensed, tabular figure. The board is the "clock" row; seats are
  team rows with a name, a stack (a condensed tabular figure) and a quip in grey.
- **Glass is used only where something is lifted:** the focused hero seat, like the focused row in the
  Upcoming list.

### Variants built (`demo/glass/table-variants.css`, `table.html?felt=…`, gallery `table-variants.html`)
Every variant keeps the oval or panel positions: seats left/top/right, the pot and board in the centre, the
hero at the bottom. They differ in material and emphasis, not in layout logic. All pass AA
(`variants-contrast.log`) and the layout guard.
- **`midnight`: graphite, defined by light.** A near-black, hue-free surface; a soft top lamp (11% white);
  a hairline rail and a 0.5px inlay. The weave is replaced by fine grain only. Cards and chips are the only
  colour. Taken from Apple Sports: the dark canvas that avoids flatness through light.
- **`glass`: a tinted frosted slab.** A rail at 10% fill with `blur(28px) saturate(175%)` picks up the
  desktop, plus the floats' 0.5px gradient rim. The playing area is a darker inset pane of the same slab,
  with no second blur. Taken from the frosted Upcoming list. Trade-off: it costs one more backdrop blur, and
  the table and coat are both glass.
- **`ink`: deep ink felt.** The round-3 cloth, re-dyed to the background's slate navy
  (`#1D2A45 → #131D33 → #0B1222`) with a neutral lamp. This tests whether green is the problem, rather than
  felt itself.
- **`scoreboard`: the Apple Sports layout.**
  - A tinted near-black rounded panel replaces the oval.
  - The pot is the score: 60px heavy condensed tabular SF (`SFNS.ttf` at `font-stretch: 50%`, falling back
    to the system font).
  - Seats are team-row cards with condensed 26px stacks.
  - The hero gets the single accent wash (a mint diagonal gradient, the "team colour" of whose turn it is).
- **`classic`: the control.** A darker, desaturated green with a neutral lamp, to show whether a refined green
  would have been enough.
- **Unchanged in every variant:** cards, dealer, dock, sheets and chrome. The dock needed no tuning; its 34%
  glass reads over all seven surfaces. `sports` replaces the bet chips with a pill.

- **`sports`: added after blind rating 1**, applying that rater's fixes to `scoreboard`:
  - no boxed panel: the coat is the canvas, and a dark lit zone with no edge holds the play
  - quieter seat rows (4% fill, 0.5px edge)
  - outlined turn/river wells (the rater measured them at 1.1:1)
  - the bet as a flat "Bet 75" pill instead of a 3D chip
  - The rater's "web face, not SF" note is wrong: the figures are SF Pro on its width axis. That is recorded
    rather than changed.

### Recommendation (round 4)
- **Ship `sports`.** It was the top pick in rating 2, with the highest fit (7.67) and element mean (7.29).
  Rating 1 predates it; there, its parent `scoreboard` was the top pick (overall 7, fit 7.00). It is the most
  direct translation of Apple Sports. Both raters ranked round-3 green last or near-last on fit: it
  spends the app's semantic green on the largest surface and is the one casino-textured screen. Note that Apple
  Sports' own Today canvas *is* a saturated green, so the case against green is semantic (in Offsuit, mint
  already means "your turn" and "gain"), not that green is un-premium.
- **What green does better:** both raters credit it with an instant sense of place. `sports` keeps green only
  as the "you" accent wash. A faint green glow under the board is a cheap option if the user misses it.
- **Port notes for `sports`:**
  - The condensed figures need SF Pro's width axis in Electron. Chromium's `-apple-system` doesn't expose
    it; the mock loads `SFNS.ttf` via `@font-face`. Alternatively bundle SF Pro Condensed under Apple's
    licence, or fall back to the regular width.
  - If the condensed figures ship, adopt them for the Home bankroll and the Charts/Drill stats too, so they
    belong to the system, not one screen. This is a fork for the user.
  - The e2e pot pin (14px/500) and the to-act pin must be updated.
  - The table loses its oval, so `screens/table.ts` positions seats as row cards. The rows rule, the bet placement and the compaction tiers in `demo/glass/table-seats.js` port as a pure function of the seat count and the stage size. It belongs beside `seatPositions.ts`, and it would also let the multiplayer screen's list become a table.

## Round 3 — system decisions
- **The coat's blur never rendered in round 2.** An independent rater found the desktop's contour lines showing
  crisp through the "frosted" coat. A probe confirmed it: with and without `backdrop-filter`, the round-2
  pixels were identical (mean diff 0.00). The cause was the desktop at `z-index:-2` plus the grain as
  `.shell::after` with `mix-blend-mode`; together they make Chromium drop the coat's backdrop at DPR 2. The fix
  is explicit stacking (desk 0 · coat 1 · grain 2) with the grain on its own element.
  - The blur is set to **18px**: the dunes still read and contours stay faint, so no text sits on a crisp
    line. 14px left contours under body text; 26px erased them.
  - The background artwork, colours and grain are unchanged.
- **Glass is perceptible where it floats.** Floats went from an 84% dark slab to a lighter grey glass at
  `oklch(.32 / .34)` (dock, tray) and `oklch(.27 / .62)` (sheets), `blur(26px) saturate(175%)`. The first
  iteration (58% dark) still read as a slab to the blind raters. A 0.5px gradient rim (22% → 4%) and a 20% top
  highlight carry the shape instead of opacity. The felt and rail now show through the dock. Glow, thick rims and saturation stay out.
- **Type scale:** caption 11 · footnote 12 · body 13 · headline 15 · title3 17 · title2 22 · stat 28 · hero 34.
  - The 40, 20, 10 and 9px orphans are gone.
  - Labels are 12/500 ink-2 and captions are 12/400 ink-3, so there are two roles, not four.
- **Radii are concentric:**
  - 4: cells, keycaps, tags
  - 6: thumb inside an 8px track
  - 8: controls
  - 12: inset groups
  - 14: dock and tray (8 + 6 padding)
  - 20: sheets
- **Control heights:** 28 (small: segmented, presets, tertiary) and 32 (regular); 36 only for the Home CTA.
- **Button ranks:**
  - **primary:** bone, with a hover → press ramp `#FAF8F3` → `#E2DFD6`
  - **secondary:** fill 8 → 13 → 18% with a top light and a 0.5px edge
  - **tertiary:** plain, then 8 → 13% fills
  - **disabled:** no fill and no edge, ink-3
  - **focus:** one 2px ring everywhere, including the slider thumb and rows
- **One selection material**, a sliding thumb shared by tabs and segments. Secondary lists (the Train
  sub-nav, drill kinds) use a quieter fill-1 with no shadow.
- **Colour role map** (in tokens.css):
  - neutrals carry the structure
  - bone = physical objects and the one primary action
  - mint = your turn, positive deltas and an ON switch (never a balance)
  - coral = serious severity, a wrong value, negative deltas
  - amber = notable severity and the gate timer
  - felt green = the table only
  - desk bands = the background only
- **Containers:** inside the coat, only actionable lists (New session / Play with friends, Recent hands, the
  tally) are inset groups. Informational sections (Suggested next, the plan table, chart classes) are flat
  hairline lists. The blind raters flagged translucent cards that don't float.
- **To-act:** a soft pool of light on the felt plus the mint status, with no coloured outline on the seat.
  This changes the e2e pin for the to-act mint shadow and scale; see port work.
- **Chart boundary:** a corner notch, because a ring reads as keyboard focus.
- **Motion:**
  - the deal
  - sliding selection thumbs
  - quip fade, bet slide, dock rise and sheet rise
  - a meter grow and a gap reveal
  - staggered chart cells and the drill reveal
  - a breathing your-turn dot
  - reduced motion stops all of it except the gate's functional 8s timer, which round 2 broke
- **Shortcut hints** are trailing keycaps, and only on real hotkeys.
- **Deal** is 420ms on a soft spring with a 45ms stagger. The raters found 640ms sluggish for a UI.
- **Focus** is a 2px ring at a 2px offset everywhere (1.5px on fields).

## Round 3 — element change log (problem → change → rationale)
| Element | Problem (from the before-rater) | Change | Rationale |
|---|---|---|---|
| `nav-bar` | 11 equal tabs, flat strip, no window inset | Traffic-light inset; the coat runs under the toolbar (unified title bar) with one hairline; tabs grouped play/study/you with short 12px dividers; one sliding selected thumb | Hierarchy without hiding any of the 11 real tabs; macOS window grammar |
| `wordmark` | 13/600 text plus a soft Unicode ♠ | 14px SVG spade mark at cap height plus a 15/600 wordmark; mark only below 1040px | A brand anchor and a crisp glyph |
| `tab-active` | Flat pill with no edge; a different selection style from segments | Shared sliding selected thumb (fill 20% + 16% top light + 0.5px edge + shadow); press darkens | One selection material everywhere |
| `tab-inactive` | Hover 3.5% was invisible; no press state | Hover fill-1 (8%), press fill-2 (13%); labels raised to ink-2 #C0C6CD | One state ramp |
| `bankroll` | 40px orphan size; mint spent on a balance | 34/600 ink-1 figure with a baseline-aligned mint +840 delta (mint = positive delta) | Colour role map; type scale |
| `depth` | Read as a second headline; mixed label styles | 15/500 value + the shared 12/500 label on the same stat component and baseline | One stat component |
| `suggest` | The primary action looked like a heading; Skip looked like the button | A plain hairline section: action row (title, body, chevron) whose hover rect bleeds into the gutter so text sits on the section edge; Skip as a small secondary button | A clear primary → tertiary order |
| `skip` | More button-like than the primary; faint states | Tertiary (plain) button on the shared ramp | Button ranks |
| `tiles` | No affordance, asymmetric padding, a blue UA focus ring | One inset group (3% fill) of two rows: icon tile, title, one-line caption, chevron, row hover/press, inset focus ring | Apple grouped-list grammar |
| `recent` | ~300px dead zone; static-looking rows | Rows in a 3% inset group that hugs its content: hover, chevron, 13/500 amounts, #index in ink-2 | Rows read as openable; no void |
| `mini-cards` | 9px suit; sticker shadow; outshouted the row | A dedicated 24px mini card (rank 12 over suit 11, centred), toned bone, small contact shadow | Optical small size and quieter emphasis |
| `results` | 13/400, lighter than the cards | 13/500 tabular amounts with the U+2212 minus; mint/coral by the role map | The outcome leads the row |
| `plan` | Seven tiers; segments unlabeled and run together | Title row; Length/Mode beside their labels; flat hairline table and footer; CTA with a vertically centred caption; coat blur 18px so no crisp contour sits under text | Form-style grouping |
| `segmented` | 12px labels; invisible track; jumping thumb; no hover/press | 13px labels in ink-2 #C0C6CD, a 3% track with an edge, the shared sliding thumb (220ms), hover/press fills | NSSegmentedControl fidelity |
| `plan-rows` | Four type styles per row; crowded fixed columns; zeros read active | Flat list: label · pct · min · count; zero rows in ink-2; notes indented 16px | Fewer styles; clear zero state |
| `gave-up` | Read as a footnote; values misaligned with the table | Section label + a flat two-column row (label, value) and a caption footer | Aligned values, honest grouping |
| `start` | A two-line marketing-card pill; radius 10 off-scale; hover = press | Single-line large primary (36px, r8), a stronger top highlight and a soft drop; caption vertically centred beside it | One primary-button spec |
| `felt` | The ±45° crosshatch read as a screen door | A single-direction 0.5px weave at 3.5% plus finer noise; the lamp 7.5% → 9% | Wool, not mesh |
| `rail` | Flat black band; invisible inlay | Top-arc sheen 13%, a bottom shade, a 1.5px top light at 16%; the rail casts onto the felt | One plausible light source |
| `villain` | Cards centred against a 3-line block; four sizes | Cards top-aligned to the name; 13/600 name, 11/500 archetype and 12px quip in ink-2 (AA on felt), 13/500 stack; deal 420ms spring | A tighter type ramp |
| `villain-name` | Placeholder-looking 'Unknown'; three sizes | The archetype is an inline 11/500 ink-2 suffix (real hidden label kept) | A quieter suffix, one line |
| `quip` | Synthetic italic as bright as data; static | Regular 12px ink-2 in curly quotes; fades in after the deal | Flavour text recedes |
| `card-backs` | The lattice read as a mesh; double ring mushed | Fine ±60° lattice + 16% spade monogram, soft sheen, single frame; deal 420ms with a soft spring | Calmer pattern |
| `bet` | Floated alone; no motion | On the seat→pot line, 13/600 amount, slides in; crisp chips (no CSS filter blur; the contact shadow is drawn in the SVG) | Physical logic |
| `pot` | 'Pot' label as bright as the value | Label 12/500 ink-2, value 17/600 | Label/value hierarchy |
| `board` | (scored 8+) | Unchanged artwork; deal 640 → 420ms with a soft spring, 45ms stagger | — |
| `slot` | Flat dark rectangles crossed by the twill | Deeper inset well (24% black, inset shadow, bottom lip highlight), above the weave; aria-label 'turn/river, to come' | Reads as a recess |
| `price` | The key figure was the quietest text | 13px with the two figures in ink-1/500 | Decision-relevant numbers lead |
| `hero-cards` | (scored 8+) | Unchanged artwork; deal 420ms spring | — |
| `hero` | No seat treatment for 'it's you, now'; 10px dealer inline | Type on the felt; your turn = a soft light pool + the mint status; dealer puck tucked on the left card's corner | One clear to-act treatment |
| `dealer` | 10px under the floor; flat disc inline in text | 22px disc, 11px/700, inner rim + top light, on the hero's card corner; arrives with a 420ms spring | Type floor; real button shape |
| `your-turn` | A 12px line with no cue | 13/500 mint with a slow 2.4s breathing dot (off under reduced motion) | The most important state reads first |
| `blinds` | Different baseline from the right-hand controls | 12px ink-3 metadata on the same 28px row as the controls | Alignment |
| `coach-stats` | Mode toggle read as plain text; no pressed state | 'Coach' is a real switch whose track fills mint when on (role map: mint = an ON switch); Stats a tertiary text button 16px away | macOS toggle grammar |
| `dock` | 84% slab with no refraction; non-concentric radii; three button styles | Lighter, thinner glass (L .32 at 34%, blur 26 / saturate 175%), a 20% top highlight and a gradient rim; r14 = 8 + 6 | Visible glass and one control system |
| `fcc` | Disabled Check looked enabled; faint states | Secondary ramp (8/13/18%); disabled Check keeps a quiet hairline container and ink-3 text | Distinct states |
| `hints` | 'Call 75 C' read as an amount | Trailing keycaps (18px, r4, edge + bottom shade, ink-1 glyph); only real hotkeys get one | Unambiguous shortcuts |
| `slider` | No focus; value detached; flat thumb | Track fills to the thumb centre; thumb rim + top light, hover/press scale, focus ring; value in a fixed 40px tabular slot with 8px trailing space | System-grade slider |
| `presets` | Loose ghost text, tiny fractions, no states | Small segmented group (½ ¾ at 15px, Pot, All-in) with aria-labels; the All-in shortcut in its tooltip; a 2px focus ring at a 2px offset | Grouped presets |
| `raise` | Hover = press (pure white) | Bone ramp: hover #FAF8F3, press #E2DFD6, 0.5px dark edge | Press feedback |
| `tray` | Slab; 13px question; mixed heights | The same thin float glass; 15/600 question; 28px controls; Sure/Guess in title case (the app uppercases in code) | Glass plus aligned controls |
| `gate` | Slab; dead space; field ≠ button height; the timer broke under reduced motion | Sheet glass over a strongly dimmed, blurred table (no bloom); 32px field + button; a 1.5px focus ring at a 2px offset; budget as a progressbar; the timer exempt from reduced motion | Material, a11y and a functional timer |
| `verdict` | About 10 tiers; coral three times; no primary; ring at rest | Two groups and one primary Close; coral only on severity + tick; table dimmed to 30% behind (no bloom); support at 56ch | One headline, one visual, one action |
| `severity` | Text only | A 13px warning glyph + 'Serious' in coral; no light behind the header | Not colour alone |
| `meter` | 1px tick; no scale; the gap was not shown | 4px bar: dim fill to the price, bright band for the surplus over it, 2px coral price tick, 0/100% endpoints | The insight is the gap |
| `committed` | Small grey line | 12px lead-in 'You committed to Fold, Sure' above the neutral result (the result keeps the app's 'SURE') | Calm hierarchy |
| `support` | Dense, repetitive engine copy | 12px ink-2 at 1.55, measure capped at 56ch; copy verbatim | Readable support tier |
| `grid` | Dashed outlines shouted; 9.5px floor; three boundary channels | Three states: open 26% flat, fold 3.5%, boundary = a 10px corner notch; 11px; row-staggered fade-in | One channel per meaning |
| `cells` | Keycap-like edge on open cells; dashed corners | Flat cells with a ≥1.6:1 open/fold luminance step; boundary corner notch; hover lift | Crisper data |
| `legend` | Dashed checkbox swatch; mismatched radii | Three swatches matching the cells (with a hairline), boundary shown with the same notch | Legend = data |
| `charts-side` | Everything 12px; ragged wraps; button-like chips | Wider 288px column; classes as a flat list (name, cells, score; description below); rules 13px; tags; scrolls with an edge fade | Hierarchy and honest non-interactive tags |
| `quiz` | Key before the label; hairline crossing the text | Horizontal group (no separators); trailing keycaps 'open O' | Consistent shortcuts |
| `drill-subnav` | Selection identical to the top tab; jump | Source-list selection (fill-1, no shadow) distinct from the toolbar thumb | Secondary nav reads secondary |
| `drill-kind` | Chips wrapped to two rows; a third selection style | One level-2 picker with a checkmark and the session tally trailing each kind, plus an 'All kinds' total (no duplicate list) | Lists, not wrapping chips |
| `drill-q` | (material only: wallpaper crisp behind text) | 22/600 title on the now-frosted coat | — |
| `drill-result` | Coral twice; stat styling differed | Band sentence 15/600 ink-1, coral only on the wrong value, the shared stat component, a 320ms reveal | Colour role map; one stat |
| `drill-method` | Small numbered circles fine; spacing tight | Tertiary tabular numerals inside the content edge, 13px at 1.5 | Rhythm |
| `drill-next` | Hover = press | Bone ramp, trailing keycap ↩ | Button spec |

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
- The gate and verdict are **bottom sheets** that rise over the dock slot and fully cover the hero row. The table
  behind them recedes (blur 5px, 62% brightness), so a sheet edge never cuts crisp content. The verdict adds a
  pot-share-vs-price meter and a Close (Esc) button. If overruled, both become inline strips above the dock,
  with no dismiss.
- Cards get bone faces with serif indices (the app ships dark faces). If overruled, use dark faces; the felt
  and rail still carry the table.
- Charts open cells are graphite on an opaque base. Bone is reserved for real cards, and the base stops the
  wallpaper from tinting data cells into a fake heatmap. If overruled, use bone cells, and expect a white wall
  at 1100x760.
- **Table surface:** `sports`, with a scoreboard rows layout up to 9 seats, is recommended over the refined `glass` oval (8 vs 7 overall, scales 7.83 vs 7.33) and over round-3 green. If overruled, ship `glass` with its ring layout and accept the lower fit score; or keep green, accepting the fit cost two earlier raters measured.
- **Green glow under the board:** not adopted (it lost in both A/B pairs). If overruled, `&glow=1` is ready on either surface.

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
  - `tableTalk.ts` in-hand quips, using the engine's own pick `IN_HAND_LINES[action][(seat.id + board.length) % 6]`
    on the flop: Ada "I’ll wait.", Bo "Let’s make it interesting.", Cy "I’ll let this one go." These replace
    round 1's invented status lines.
  - `jitter.ts` hidden archetype "Unknown"
  - `recommend.ts`, `home.ts` (the bankroll is plain digits; round 3 shows it in neutral ink with a mint
    "+840" delta, where the app colours the whole figure — see port work), `sessionPlan.ts` and `standing.ts`
  - `charts.ts`, including the class-accuracy "—" column
  - `drill.ts` ("Next problem — Enter" is shown as "Next problem" plus an ↩ keycap)
  - `preflop.ts` `RFI_SPECS.CO` and `BOUNDARY_COMBOS.CO`
- **The gate follows `table.ts`:** the fold is committed but not applied while the gate is open, so the hero
  stays unchanged. The fold lands when the verdict shows.
- **Invented for the mock** (not app copy):
  - the table corner text "Blinds 25/50"
  - "75 to call, a 25% price"
  - the hero's "Your turn" / "Folded" line
  - the empty turn/river card wells
  - the sheets' "Coach" and "Serious" labels and the "On the flop, you folded to 75" context
  - "You committed to Fold, Sure"
  - the meter
  - "Ada and Bo play the hand out behind this sheet" and the Close/Esc footer
  - the gate note "The verdict appears when you answer, use both attempts, or the bar runs out."
  - the key hints (F, C, R and A are real hotkeys; A moves to the All-in tooltip). The charts quiz shows
    "open O" / "fold F" where the app writes "O open" / "F fold".
  - the window chrome: traffic lights, the spade mark and the grouped tab dividers
  - the "+840" bankroll delta, the plan's "Length"/"Mode" labels and the charts "cells · score" header
  - "Sure"/"Guess" in title case (the app calls `toUpperCase()` in `predictPanel.ts`)
  - the merged drill kind list with trailing tallies (the app shows kind chips and a separate tally)
- **Port work:**
  1. Main process: Foundry's `vibrancy: 'under-window'`, `visualEffectState: 'active'` and a transparent
     background, so the coat frosts the real desktop, plus `titleBarStyle: 'hiddenInset'` for the inline
     traffic lights. A paint-only theme block cannot produce the coat. Layer order matters: the round-2 bug
     (a blended `::after` on the coat silently disabling `backdrop-filter`) applies to the renderer too.
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
     - the pot (14px/500 pinned; the mock uses 17px/600)
     - Fold `box-shadow: none` (the mock has an inset hairline)
     - the to-act mint ring with `rgba(61, 220, 151, 0.4)` and scale 1.02 (the mock replaces it with a felt
       light pool, a breathing dot and mint text)
     - the bankroll's whole-figure net colour (`data-direction` is kept; the colour moves to the delta)
     - the predict confidence labels' casing, if any spec matches "SURE"/"GUESS"
     - the winner ring's mint `border-top-color` (not mocked)
  5. A GPU check: the coat plus at most two floats in Electron.

## Tests and environment
- No failing-first test applies: no defect is repaired and nothing under `src/` changes.
- No automated test covers the visual design. The evidence is the DPR-2 JPEG captures, the capture guard and
  the contrast measurement (also DPR 2). The guard's sheet rule was negative-tested
  (`tests/tmp/probe-guard.mjs`): with the recede filter removed it flags Ada, Cy and the bet.
- `npm run typecheck` passes. `npm test` passes (85 files, 1796 tests).
- `npm run e2e` fails, all 540 tests, at `electron.launch`, because `node_modules/electron` is half-installed
  in this checkout. This is environmental, not caused by the branch. Reinstalling was out of scope.
- Captures use Playwright's cached Chromium 1243 headless shell through `executablePath`. Nothing was
  installed. Synara was shallow-cloned read-only: nothing installed and none of its scripts run.
  Foundry's asar was read by a dependency-free script; nothing in the .app was modified.
