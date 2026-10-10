# DECISIONS — Glass mockup (`demo/glass/`)

Living record. Each line is the current end state.
- Round 1 ("liquid glass" everywhere) was rejected as tacky; its captures are in `demo/glass/round1/`.
- Round 2 (one coat, few floats) was liked for its background; its captures are in `demo/glass/round2/`.
- Round 3 is a scored, element-by-element refinement. The rubric and scores are in `SCORECARD.md` and
  `demo/glass/scorecard.html`.

## Round 4 — the table surface (green under review)
The user likes the direction but questions the green felt. Round 4 changes only the table surface and what
sits on it, offering switchable variants (`table.html?felt=…`). Everything else stays as in round 3.

### Apple Sports: what makes it premium (from the App Store listing, iOS 26 assets; see references.md)
- **A near-black canvas that is never flat.** The Today list sits on a deep tinted field (the brand green
  at about L .18), with a gentle top-down gradient and one lighter grouped card, not pure #000. The game
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
- **Unchanged in every variant:** cards, chips, dealer, dock, sheets and chrome. The dock needed no tuning;
  its 34% glass reads over all six surfaces.

- **`sports`: added after blind rating 1**, applying that rater's fixes to `scoreboard`:
  - no boxed panel: the coat is the canvas, and a dark lit zone with no edge holds the play
  - quieter seat rows (4% fill, 0.5px edge)
  - outlined turn/river wells (the rater measured them at 1.1:1)
  - the bet as a flat "Bet 75" pill instead of a 3D chip
  - The rater's "web face, not SF" note is wrong: the figures are SF Pro on its width axis. That is recorded
    rather than changed.

### Recommendation (round 4)
- **Ship `sports`.** It scored highest in both blind ratings on fit (7.67) and overall (7), and it is the
  most direct translation of Apple Sports. Both raters ranked round-3 green last or near-last on fit: it
  spends the app's semantic green on the largest surface and is the one casino-textured screen.
- **What green does better:** both raters credit it with an instant sense of place. `sports` keeps green only
  as the "you" accent wash. A faint green glow under the board is a cheap option if the user misses it.
- **Port notes for `sports`:**
  - The condensed figures need SF Pro's width axis in Electron. Chromium's `-apple-system` doesn't expose
    it; the mock loads `SFNS.ttf` via `@font-face`. Alternatively bundle SF Pro Condensed under Apple's
    licence, or fall back to the regular width.
  - If the condensed figures ship, adopt them for the Home bankroll and the Charts/Drill stats too, so they
    belong to the system, not one screen. This is a fork for the user.
  - The e2e pot pin (14px/500) and the to-act pin must be updated.
  - The table loses its oval, so `screens/table.ts` positions seats as row cards.

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
- **Table surface (round 4):** `sports` is recommended over round-3 green. If overruled, choose `glass` (the best-fitting oval) or keep green, accepting the fit cost both raters measured.
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
