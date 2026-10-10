# SCORECARD — Offsuit glass, round 3


Target: ultra premium, Apple style, modern, a clean visual hierarchy, and colour that is intentional.
Material references:
- Apple HIG Materials / visionOS glass
- Synara (one window coat; glass only on what floats)
- Foundry (`foundry-glass.txt`)

| # | Category | Key | What a 10 looks like |
|---|---|---|---|
| 1 | Visual hierarchy | `hier` | It is obvious at a glance what matters most in and around the element; emphasis is earned, and nothing competes with the primary signal. |
| 2 | Typography | `type` | A disciplined scale and weights, native SF tracking, tabular numerals for figures, optical sizes that suit the role, and no orphan sizes. |
| 3 | Colour intentionality | `color` | Every hue has a defined role (state, meaning or brand); neutrals carry the structure, accent is rare and purposeful, and nothing is coloured for decoration. |
| 4 | Material and depth | `material` | The glass reads as glass where the element floats, and stays quiet where it sits in the coat. Light, edge and shadow are physically plausible, with no plastic slabs and no glow. |
| 5 | Spacing, alignment and rhythm | `space` | It sits on a consistent spacing scale, edges and baselines align, internal padding is proportional to size, and it breathes without empty dead zones. |
| 6 | Consistency with siblings | `consist` | Same role means same treatment: radii, heights, fills and type match related elements across screens. |
| 7 | Affordance and states | `states` | It is clearly interactive (or clearly not), and hover, press, focus, selected and disabled are distinct, tasteful and complete. For non-interactive elements, judge how well it reads as information and score accordingly. |
| 8 | Motion | `motion` | Motion is purposeful and physical (ease and duration fit the role) and respects reduced-motion. Score n/a only if the element should never move. |
| 9 | Legibility and accessibility | `a11y` | Text passes AA comfortably on its real backdrop, sizes are at least 11px with good line-height, focus is visible, and nothing relies on colour alone. |
| 10 | Craft and detail polish | `craft` | Pixel-level finish: optical alignment, crisp hairlines, refined shapes (cards, chips, icons), and no rough edges, clipping or default-looking parts. |
| 11 | Apple / visionOS fidelity | `apple` | It would look at home in a first-party Apple app or a visionOS window: restraint, material honesty and system-grade controls. |

**Rule:** any score under 8 must carry a specific, actionable reason. Name the property and the fix: for
example "label 12px/500 vs 13px siblings; use 13px/500", or "fill 84% reads as an opaque slab; drop it
to ~60–68% and add a top-edge highlight".


## Method
1. **Inventory.** 58 elements across the 7 screens. Each was cropped at 1100x760 and DPR 2, and the 12 interactive controls also got a rest/hover/focus/press strip. Inventory: `tests/tmp/sc/inventory.mjs`.
2. **Before-rater.** An independent subagent that did not design this scored round 2 only (`scores-before.json`), with a reason for every score under 8. Those reasons drove the redesign.
3. **Redesign.** Every element with a category under 8 was redesigned as a system: tokens, controls, materials and type. The change log is in `DECISIONS.md`.
4. **Blind re-score.** Fresh raters scored both versions of each element, labelled A and B in random order, using the same rubric, with full-screen context labelled X and Y, also randomised. The key was kept from them. These blind scores are the before/after numbers below.

### Limits of the method (read before trusting small gains)
- **The motion/state fact sheet was written by the designer and can reveal the version.** It is not neutral. For motion and states, raters read a per-variant sheet that I wrote from the CSS (`tests/tmp/sc/make-blind.py`). Its round-3 lines describe a richer state ramp and named motion, so the text can identify the newer side. **Without the Motion category**, the result is 7.5 → 7.8, against 7.5 → 7.9 with it.
- **One correction was applied to both sides.** The first sheet gave non-interactive elements a generic hover/press line. In iteration 3, rater 5 re-scored only Motion and States for six static elements (plan, villain, villain-name, slot, price, wordmark) against a corrected sheet, for both A and B. The other static elements were already n/a. Depth was not re-scored: its after-States 7 still cites the wrong "press ramp" fact, so treat it as artefact.
- **Rater noise is about ±0.15.** The same unchanged round-2 crops averaged 7.6 / 7.5 / 7.5 across the 3 iterations. Element gains of ±0.2 or less are within noise; this card reports iteration 3 without pooling.
- **Some rater reasons misread the DPR-2 crops** (for example "16px Your turn"; the CSS is 13px/500). Reasons are quoted verbatim.

## Summary — mean of 58 elements

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity | All |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7.6 | 7.7 | 7.8 | 7.6 | 7.4 | 7.6 | 7.3 | 6.6 | 7.6 | 7.5 | 7.4 | **7.5** |
| After | 8.1 | 7.9 | 8.0 | 7.7 | 7.7 | 7.9 | 7.8 | 8.1 | 7.9 | 7.7 | 7.8 | **7.9** |

## Biggest gains

| # | Element | Before | After | Gain | Change |
|---|---|---|---|---|---|
| 1 | Slider and value | 6.6 | 7.9 | +1.3 | Track fills to the thumb centre; thumb rim + top light, hover/press scale, focus ring; value in a fixed 40px tabular slot with 8px trailing space |
| 2 | Bankroll figure | 6.9 | 8.1 | +1.2 | 34/600 ink-1 figure with a baseline-aligned mint +840 delta (mint = positive delta) |
| 3 | New session / Play with friends | 6.5 | 7.7 | +1.2 | One inset group (3% fill) of two rows: icon tile, title, one-line caption, chevron, row hover/press, inset focus ring |
| 4 | Coach off / Stats | 6.7 | 7.9 | +1.2 | 'Coach' is a real switch whose track fills mint when on (role map: mint = an ON switch); Stats a tertiary text button 16px away |
| 5 | Sizing presets + All-in | 6.7 | 7.8 | +1.1 | Small segmented group (½ ¾ at 15px, Pot, All-in) with aria-labels; the All-in shortcut in its tooltip; a 2px focus ring at a 2px offset |
| 6 | Verdict sheet | 6.9 | 8.0 | +1.1 | Two groups and one primary Close; coral only on severity + tick; table dimmed to 30% behind (no bloom); support at 56ch |
| 7 | Nav bar | 6.7 | 7.6 | +0.9 | Traffic-light inset; the coat runs under the toolbar (unified title bar) with one hairline; tabs grouped play/study/you with short 12px dividers; one sliding selected thumb |
| 8 | Start session CTA | 7.3 | 8.1 | +0.8 | Single-line large primary (36px, r8), a stronger top highlight and a soft drop; caption vertically centred beside it |
| 9 | Tab, active | 7.0 | 7.8 | +0.8 | Shared sliding selected thumb (fill 20% + 16% top light + 0.5px edge + shadow); press darkens |
| 10 | Recent hands rows | 6.8 | 7.6 | +0.8 | Rows in a 3% inset group that hugs its content: hover, chevron, 13/500 amounts, #index in ink-2 |
| 11 | Segmented controls | 7.1 | 7.9 | +0.8 | 13px labels in ink-2 #C0C6CD, a 3% track with an edge, the shared sliding thumb (220ms), hover/press fills |
| 12 | Mini cards | 7.2 | 8.0 | +0.8 | A dedicated 24px mini card (rank 12 over suit 11, centred), toned bone, small contact shadow |
| 13 | Dealer button | 7.0 | 7.7 | +0.7 | 22px disc, 11px/700, inner rim + top light, on the hero's card corner; arrives with a 420ms spring |
| 14 | Next problem button | 7.5 | 8.2 | +0.7 | Bone ramp, trailing keycap ↩ |
| 15 | Raise (primary) | 7.6 | 8.3 | +0.6 | Bone ramp: hover #FAF8F3, press #E2DFD6, 0.5px dark edge |
| 16 | Commit tray | 7.2 | 7.8 | +0.6 | The same thin float glass; 15/600 question; 28px controls; Sure/Guess in title case (the app uppercases in code) |
| 17 | Charts side column | 7.1 | 7.7 | +0.6 | Wider 288px column; classes as a flat list (name, cells, score; description below); rules 13px; tags; scrolls with an edge fade |
| 18 | Wordmark and logo | 7.1 | 7.7 | +0.6 | 14px SVG spade mark at cap height plus a 15/600 wordmark; mark only below 1040px |
| 19 | Tab, inactive | 7.4 | 7.9 | +0.5 | Hover fill-1 (8%), press fill-2 (13%); labels raised to ink-2 #C0C6CD |
| 20 | Hero seat | 7.1 | 7.6 | +0.5 | Type on the felt; your turn = a soft light pool + the mint status; dealer puck tucked on the left card's corner |
| 21 | Drill kind + tally | 7.4 | 7.9 | +0.5 | One level-2 picker with a checkmark and the session tally trailing each kind, plus an 'All kinds' total (no duplicate list) |
| 22 | Plan rows | 7.1 | 7.6 | +0.5 | Flat list: label · pct · min · count; zero rows in ink-2; notes indented 16px |
| 23 | Price line | 7.7 | 8.1 | +0.4 | 13px with the two figures in ink-1/500 |
| 24 | Bet chip and amount | 7.4 | 7.7 | +0.4 | On the seat→pot line, 13/600 amount, slides in; crisp chips (no CSS filter blur; the contact shadow is drawn in the SVG) |
| 25 | Gate sheet | 7.5 | 7.8 | +0.4 | Sheet glass over a strongly dimmed, blurred table (no bloom); 32px field + button; a 1.5px focus ring at a 2px offset; budget as a progressbar; the timer exempt from reduced motion |
| 26 | Quiz bar | 7.4 | 7.7 | +0.4 | Horizontal group (no separators); trailing keycaps 'open O' |
| 27 | Skip button | 7.5 | 7.9 | +0.4 | Tertiary (plain) button on the shared ramp |
| 28 | Meter | 7.6 | 8.0 | +0.4 | 4px bar: dim fill to the price, bright band for the surplus over it, 2px coral price tick, 0/100% endpoints |
| 29 | Band + you said / answer | 7.6 | 8.0 | +0.4 | Band sentence 15/600 ink-1, coral only on the wrong value, the shared stat component, a 320ms reveal |
| 30 | Plan a sitting panel | 7.5 | 7.8 | +0.3 | Title row; Length/Mode beside their labels; flat hairline table and footer; CTA with a vertically centred caption; coat blur 18px so no crisp contour sits under text |
| 31 | "What a shorter sitting gave up" | 7.7 | 8.0 | +0.3 | Section label + a flat two-column row (label, value) and a caption footer |
| 32 | Rail | 7.7 | 8.0 | +0.3 | Top-arc sheen 13%, a bottom shade, a 1.5px top light at 16%; the rail casts onto the felt |
| 33 | Committed choices | 7.8 | 8.0 | +0.2 | 12px lead-in 'You committed to Fold, Sure' above the neutral result (the result keeps the app's 'SURE') |
| 34 | Support copy | 7.8 | 8.0 | +0.2 | 12px ink-2 at 1.55, measure capped at 56ch; copy verbatim |
| 35 | Severity label | 7.9 | 8.1 | +0.2 | A 13px warning glyph + 'Serious' in coral; no light behind the header |
| 36 | Quip | 7.7 | 7.9 | +0.2 | Regular 12px ink-2 in curly quotes; fades in after the deal |
| 37 | Card backs | 7.8 | 8.0 | +0.2 | Fine ±60° lattice + 16% spade monogram, soft sheen, single frame; deal 420ms with a soft spring |
| 38 | Board cards | 8.4 | 8.5 | +0.2 | Unchanged artwork; deal 640 → 420ms with a soft spring, 45ms stagger |
| 39 | Felt | 7.9 | 8.0 | +0.1 | A single-direction 0.5px weave at 3.5% plus finer noise; the lamp 7.5% → 9% |
| 40 | Villain name + archetype + stack | 7.9 | 8.0 | +0.1 | The archetype is an inline 11/500 ink-2 suffix (real hidden label kept) |
| 41 | Pot | 8.0 | 8.1 | +0.1 | Label 12/500 ink-2, value 17/600 |
| 42 | Chart grid | 7.5 | 7.5 | +0.1 | Three states: open 26% flat, fold 3.5%, boundary = a 10px corner notch; 11px; row-staggered fade-in |
| 43 | Villain seat | 7.8 | 7.9 | +0.1 | Cards top-aligned to the name; 13/600 name, 11/500 archetype and 12px quip in ink-2 (AA on felt), 13/500 stack; deal 420ms spring |
| 44 | Table-depth label | 7.5 | 7.5 | +0.0 | 15/500 value + the shared 12/500 label on the same stat component and baseline |
| 45 | Empty board slots | 8.0 | 8.0 | +0.0 | Deeper inset well (24% black, inset shadow, bottom lip highlight), above the weave; aria-label 'turn/river, to come' |
| 46 | Your-turn indicator | 7.6 | 7.6 | +0.0 | 13/500 mint with a slow 2.4s breathing dot (off under reduced motion) |
| 47 | Fold / Check / Call | 7.6 | 7.6 | +0.0 | Secondary ramp (8/13/18%); disabled Check keeps a quiet hairline container and ink-3 text |
| 48 | Chart cells (detail) | 7.7 | 7.7 | +0.0 | Flat cells with a ≥1.6:1 open/fold luminance step; boundary corner notch; hover lift |
| 49 | Train sub-nav | 7.9 | 7.9 | +0.0 | Source-list selection (fill-1, no shadow) distinct from the toolbar thumb |
| 50 | Method steps | 8.0 | 8.0 | +0.0 | Tertiary tabular numerals inside the content edge, 13px at 1.5 |
| 51 | Hero cards | 8.4 | 8.3 | -0.1 | Unchanged artwork; deal 420ms spring |
| 52 | Shortcut hints | 7.6 | 7.5 | -0.1 | Trailing keycaps (18px, r4, edge + bottom shade, ink-1 glyph); only real hotkeys get one |
| 53 | Action dock | 7.5 | 7.5 | -0.1 | Lighter, thinner glass (L .32 at 34%, blur 26 / saturate 175%), a 20% top highlight and a gradient rim; r14 = 8 + 6 |
| 54 | +/− results | 8.0 | 7.9 | -0.1 | 13/500 tabular amounts with the U+2212 minus; mint/coral by the role map |
| 55 | Question | 8.0 | 7.9 | -0.1 | 22/600 title on the now-frosted coat |
| 56 | Chart legend | 7.9 | 7.8 | -0.1 | Three swatches matching the cells (with a hairline), boundary shown with the same notch |
| 57 | Blinds label | 7.9 | 7.7 | -0.2 | 12px ink-3 metadata on the same 28px row as the controls |
| 58 | Suggested next block | 7.8 | 7.2 | -0.6 | A plain hairline section: action row (title, body, chevron) whose hover rect bleeds into the gutter so text sits on the section edge; Skip as a small secondary button |

## Lowest remaining

| Element | After avg | Lowest category | Reason |
|---|---|---|---|
| Suggested next block | 7.2 | Spacing 6 | eyebrow 'Suggested next' is separated from its title by a hairline and 40px; keep eyebrow within 8px of the title |
| Action dock | 7.5 | Type 7 | '150' 20px/600 is the heaviest figure and competes with Raise; 17px/500 tabular. |
| Table-depth label | 7.5 | Hierarchy 7 | '40bb table' is near the weight of the bankroll label and competes; drop to 15px/500 |
| Shortcut hints | 7.5 | Hierarchy 7 | Boxed keycap gives the hint near-equal weight to 'Call 75'; recess it to plain text. |
| Chart grid | 7.5 | Material 7 | Open cells are opaque mid-grey tiles; lower to ~18% white with a 0.5px edge. |
| Plan rows | 7.6 | Material 6 | dune bands show through the rows with high contrast (dark wedge behind 'graded spots'); raise the coat fill to flatten the backdrop under dense data |
| Nav bar | 7.6 | Material 7 | bar fill is near-opaque navy; drop to ~65-70% so the dune coat reads, keep the bottom hairline |
| Recent hands rows | 7.6 | Material 7 | the first row shows a lighter band from the backdrop through the group, so row fills look uneven; raise the group fill so it reads as one coat |
| Hero seat | 7.6 | Type 7 | 'Your turn' 16px is larger than the 'You' label; set status 13-14px/500. |
| Your-turn indicator | 7.6 | Type 7 | 16px status is larger than the 'You' label; 13-14px/500. |
| Fold / Check / Call | 7.6 | Material 7 | 8% fills with 1px borders read as flat tiles; add a 1px top highlight and drop border to 0.5px. |
| Wordmark and logo | 7.7 | Type 7 | wordmark 600 at ~17px with default tracking; tighten to -0.01em for display weight |

## Target check — every element average ≥ 8 and no category < 7

36 element(s) miss the target: Nav bar (avg 7.6, min 7); Wordmark and logo (avg 7.7, min 7); Tab, active (avg 7.8, min 7); Tab, inactive (avg 7.9, min 7); Table-depth label (avg 7.5, min 7); Suggested next block (avg 7.2, min 6); Skip button (avg 7.9, min 7); New session / Play with friends (avg 7.7, min 7); Recent hands rows (avg 7.6, min 7); +/− results (avg 7.9, min 7); Plan a sitting panel (avg 7.8, min 7); Segmented controls (avg 7.9, min 7); Plan rows (avg 7.6, min 6); Villain seat (avg 7.9, min 7); Quip (avg 7.9, min 7); Bet chip and amount (avg 7.7, min 7); Hero seat (avg 7.6, min 7); Dealer button (avg 7.7, min 7); Your-turn indicator (avg 7.6, min 7); Blinds label (avg 7.7, min 7); Coach off / Stats (avg 7.9, min 7); Action dock (avg 7.5, min 7); Fold / Check / Call (avg 7.6, min 7); Shortcut hints (avg 7.5, min 7); Slider and value (avg 7.9, min 7); Sizing presets + All-in (avg 7.8, min 7); Commit tray (avg 7.8, min 7); Gate sheet (avg 7.8, min 7); Chart grid (avg 7.5, min 7); Chart cells (detail) (avg 7.7, min 7); Chart legend (avg 7.8, min 7); Charts side column (avg 7.7, min 7); Quiz bar (avg 7.7, min 7); Train sub-nav (avg 7.9, min 7); Drill kind + tally (avg 7.9, min 7); Question (avg 7.9, min 7).

## Per element

### Nav bar (`nav-bar`) — 6.7 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 6 | 6 | 7 | 7 | 5 | 8 | 7 | 6 |
| After | 8 | 8 | 8 | 7 | 7 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** 11 equal tabs, flat strip, no window inset
- **Change:** Traffic-light inset; the coat runs under the toolbar (unified title bar) with one hairline; tabs grouped play/study/you with short 12px dividers; one sliding selected thumb — Hierarchy without hiding any of the 11 real tabs; macOS window grammar
- **Remaining:** Material: bar fill is near-opaque navy; drop to ~65-70% so the dune coat reads, keep the bottom hairline · Spacing: group separators sit tight to adjacent labels (~16px vs 40px tab pitch); centre them in the gap · Craft: separators are 1px at 40% and look a little heavy against 13px labels; use 0.5px hairline at ~20% · Apple fidelity: selected pill is heavier than a macOS toolbar segment; lower its fill to ~12% and add a subtle top highlight
- **Crops:** `demo/glass/scorecard/before/nav-bar.png` → `demo/glass/scorecard/after/nav-bar.png`

### Wordmark and logo (`wordmark`) — 7.1 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 7 | 8 | 7 | 7 | 8 | n/a | 8 | 6 | 6 |
| After | 8 | 7 | 8 | 8 | 7 | 8 | 8 | n/a | 9 | 7 | 7 |

- **Problem:** 13/600 text plus a soft Unicode ♠
- **Change:** 14px SVG spade mark at cap height plus a 15/600 wordmark; mark only below 1040px — A brand anchor and a crisp glyph
- **Remaining:** Type: wordmark 600 at ~17px with default tracking; tighten to -0.01em for display weight · Spacing: spade-to-text gap ~8px is tight for a 16px glyph; use 10px · Craft: spade glyph sits optically high relative to the x-height; nudge down 1px · Apple fidelity: glyph is a generic font spade; draw a custom mark with refined curves
- **Crops:** `demo/glass/scorecard/before/wordmark.png` → `demo/glass/scorecard/after/wordmark.png`

### Tab, active (`tab-active`) — 7.0 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 6 | 8 | 8 | 6 | 5 | 7 | 7 | 7 |
| After | 8 | 7 | 8 | 7 | 8 | 8 | 7 | 9 | 8 | 8 | 8 |

- **Problem:** Flat pill with no edge; a different selection style from segments
- **Change:** Shared sliding selected thumb (fill 20% + 16% top light + 0.5px edge + shadow); press darkens — One selection material everywhere
- **Remaining:** Type: 13px/500 label in a 34px pill feels small; use 13px/590 (SF semibold) to match macOS toolbar selection · Material: thumb is a flat grey fill without edge light; add 0.5px top inner highlight at ~12% white · States: hover on the selected tab is indistinguishable from rest; either suppress hover on selected or lift fill +3%
- **Crops:** `demo/glass/scorecard/before/tab-active.png` → `demo/glass/scorecard/after/tab-active.png`

### Tab, inactive (`tab-inactive`) — 7.4 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 6 | 6 | 7 | 7 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 8 |

- **Problem:** Hover 3.5% was invisible; no press state
- **Change:** Hover fill-1 (8%), press fill-2 (13%); labels raised to ink-2 #C0C6CD — One state ramp
- **Remaining:** Motion: fills step at 120ms with no press release easing; add 80ms ease-out on release
- **Crops:** `demo/glass/scorecard/before/tab-inactive.png` → `demo/glass/scorecard/after/tab-inactive.png`

### Bankroll figure (`bankroll`) — 6.9 → 8.1

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 5 | 8 | 7 | 6 | 7 | n/a | 8 | 7 | 6 |
| After | 9 | 8 | 9 | 8 | 7 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** 40px orphan size; mint spent on a balance
- **Change:** 34/600 ink-1 figure with a baseline-aligned mint +840 delta (mint = positive delta) — Colour role map; type scale
- **Remaining:** Spacing: the +840 delta floats at mid-height of the figure; baseline-align it to the figure baseline or to the cap line
- **Crops:** `demo/glass/scorecard/before/bankroll.png` → `demo/glass/scorecard/after/bankroll.png`

### Table-depth label (`depth`) — 7.5 → 7.5

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 8 | 7 | 8 | 7 | n/a | 7 | 8 | 7 |
| After | 7 | 8 | 8 | 8 | 7 | 7 | 7 | n/a | 8 | 8 | 7 |

- **Problem:** Read as a second headline; mixed label styles
- **Change:** 15/500 value + the shared 12/500 label on the same stat component and baseline — One stat component
- **Remaining:** Hierarchy: '40bb table' is near the weight of the bankroll label and competes; drop to 15px/500 · Spacing: block baseline does not align with the bankroll figure or label; align its subtitle baseline to 'Bankroll' · Consistency: subtitle grey is lighter than other secondary text on the page; use the shared secondary token · States: reads as static info but motion-facts list a press ramp; make it purely static or give it a disclosure affordance · Apple fidelity: stat pair lacks a shared baseline grid, unlike system stat rows
- **Crops:** `demo/glass/scorecard/before/depth.png` → `demo/glass/scorecard/after/depth.png`

### Suggested next block (`suggest`) — 7.8 → 7.2

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 8 | 8 | 8 |
| After | 7 | 8 | 8 | 7 | 6 | 7 | 7 | 7 | 8 | 7 | 7 |

- **Problem:** The primary action looked like a heading; Skip looked like the button
- **Change:** A plain hairline section: action row (title, body, chevron) whose hover rect bleeds into the gutter so text sits on the section edge; Skip as a small secondary button — A clear primary → tertiary order
- **Remaining:** Hierarchy: chevron at the far right implies the whole block is a link, but 'Skip this' is a separate control inside it; drop the chevron or make the title the link · Material: block sits in the coat but the hairline above the title cuts the eyebrow off from its content; remove that divider · Spacing: eyebrow 'Suggested next' is separated from its title by a hairline and 40px; keep eyebrow within 8px of the title · Consistency: the chevron treatment here differs from the tile rows below; use the same row pattern · States: whole-block hover ramp plus an inner button makes nested hit targets; scope hover to the title row · Motion: press scale 0.98 on a large text block feels heavy; use fill only · Craft: chevron sits at the title line, far from the content mass; vertically centre it or remove it · Apple fidelity: nested interactive targets are not a system pattern
- **Crops:** `demo/glass/scorecard/before/suggest.png` → `demo/glass/scorecard/after/suggest.png`

### Skip button (`skip`) — 7.5 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 7 | 7 | 8 | 7 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

- **Problem:** More button-like than the primary; faint states
- **Change:** Tertiary (plain) button on the shared ramp — Button ranks
- **Remaining:** Material: pill fill is a flat slab; add a 0.5px top-edge highlight
- **Crops:** `demo/glass/scorecard/before/skip.png` → `demo/glass/scorecard/after/skip.png`

### New session / Play with friends (`tiles`) — 6.5 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 6 | 8 | 8 | 7 | 7 | 6 | 5 | 6 | 7 | 6 | 6 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 7 | 8 |

- **Problem:** No affordance, asymmetric padding, a blue UA focus ring
- **Change:** One inset group (3% fill) of two rows: icon tile, title, one-line caption, chevron, row hover/press, inset focus ring — Apple grouped-list grammar
- **Remaining:** Material: group fill and border are fine but the icon wells are opaque slabs; lower to ~10% white · States: hover lift from rest is small; press reads lighter rather than darker; press should deepen · Craft: focus ring is square-cornered (~4px) inside a 14px container radius; match radius minus inset
- **Crops:** `demo/glass/scorecard/before/tiles.png` → `demo/glass/scorecard/after/tiles.png`

### Recent hands rows (`recent`) — 6.8 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 7 | 6 | 7 | 5 | 6 | 8 | 7 | 6 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 7 | 8 | 7 | 8 |

- **Problem:** ~300px dead zone; static-looking rows
- **Change:** Rows in a 3% inset group that hugs its content: hover, chevron, 13/500 amounts, #index in ink-2 — Rows read as openable; no void
- **Remaining:** Material: the first row shows a lighter band from the backdrop through the group, so row fills look uneven; raise the group fill so it reads as one coat · States: chevrons signal tap but hover feedback is not visible; use the 8% row hover · Motion: press scale on a list row is non-system; use fill only · Craft: row number column and cards are not optically aligned to the header 'Recent hands' left edge; inset header to match
- **Crops:** `demo/glass/scorecard/before/recent.png` → `demo/glass/scorecard/after/recent.png`

### Mini cards (`mini-cards`) — 7.2 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 8 | 6 | 7 | 8 | n/a | 7 | 6 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** 9px suit; sticker shadow; outshouted the row
- **Change:** A dedicated 24px mini card (rank 12 over suit 11, centred), toned bone, small contact shadow — Optical small size and quieter emphasis
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/mini-cards.png` → `demo/glass/scorecard/after/mini-cards.png`

### +/− results (`results`) — 8.0 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 7 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** 13/400, lighter than the cards
- **Change:** 13/500 tabular amounts with the U+2212 minus; mint/coral by the role map — The outcome leads the row
- **Remaining:** Spacing: crop shows the amount touching the divider area with little vertical padding; centre within the row
- **Crops:** `demo/glass/scorecard/before/results.png` → `demo/glass/scorecard/after/results.png`

### Plan a sitting panel (`plan`) — 7.5 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 7 | 7 | 8 | 7 | n/a | 8 | 8 | 7 |
| After | 8 | 8 | 8 | 7 | 7 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Seven tiers; segments unlabeled and run together
- **Change:** Title row; Length/Mode beside their labels; flat hairline table and footer; CTA with a vertically centred caption; coat blur 18px so no crisp contour sits under text — Form-style grouping
- **Remaining:** Material: panel has no edge; the dune bands show through rows unevenly; raise coat fill behind the panel · Spacing: 'Length'/'Mode' labels baseline sits ~4px above segment text; vertically centre labels to the control
- **Crops:** `demo/glass/scorecard/before/plan.png` → `demo/glass/scorecard/after/plan.png`

### Segmented controls (`segmented`) — 7.1 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 7 | 8 | 8 | 6 | 5 | 7 | 7 | 7 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 9 | 8 | 8 | 8 |

- **Problem:** 12px labels; invisible track; jumping thumb; no hover/press
- **Change:** 13px labels in ink-2 #C0C6CD, a 3% track with an edge, the shared sliding thumb (220ms), hover/press fills — NSSegmentedControl fidelity
- **Remaining:** Material: thumb is a flat grey slab; add a 0.5px top highlight and soft shadow like NSSegmentedControl · States: hover and press on the selected segment are near-identical to rest; suppress or lift fill +4%
- **Crops:** `demo/glass/scorecard/before/segmented.png` → `demo/glass/scorecard/after/segmented.png`

### Plan rows (`plan-rows`) — 7.1 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 6 | 6 | 7 | 8 | n/a | 7 | 7 | 7 |
| After | 8 | 8 | 8 | 6 | 8 | 8 | 8 | n/a | 7 | 8 | 7 |

- **Problem:** Four type styles per row; crowded fixed columns; zeros read active
- **Change:** Flat list: label · pct · min · count; zero rows in ink-2; notes indented 16px — Fewer styles; clear zero state
- **Remaining:** Material: dune bands show through the rows with high contrast (dark wedge behind 'graded spots'); raise the coat fill to flatten the backdrop under dense data · Legibility: grey sub-notes on the dark band dip near 4.5:1; lift to ~62% · Apple fidelity: backdrop pattern competing with tabular data is not how macOS treats list content
- **Crops:** `demo/glass/scorecard/before/plan-rows.png` → `demo/glass/scorecard/after/plan-rows.png`

### "What a shorter sitting gave up" (`gave-up`) — 7.7 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 7 | 7 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Read as a footnote; values misaligned with the table
- **Change:** Section label + a flat two-column row (label, value) and a caption footer — Aligned values, honest grouping
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/gave-up.png` → `demo/glass/scorecard/after/gave-up.png`

### Start session CTA (`start`) — 7.3 → 8.1

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 7 | 7 | 6 | 7 | 8 | 7 | 7 |
| After | 9 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

- **Problem:** A two-line marketing-card pill; radius 10 off-scale; hover = press
- **Change:** Single-line large primary (36px, r8), a stronger top highlight and a soft drop; caption vertically centred beside it — One primary-button spec
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/start.png` → `demo/glass/scorecard/after/start.png`

### Felt (`felt`) — 7.9 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 7 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** The ±45° crosshatch read as a screen door
- **Change:** A single-direction 0.5px weave at 3.5% plus finer noise; the lamp 7.5% → 9% — Wool, not mesh
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/felt.png` → `demo/glass/scorecard/after/felt.png`

### Rail (`rail`) — 7.7 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 8 | 8 | 8 | n/a | 8 | 7 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Flat black band; invisible inlay
- **Change:** Top-arc sheen 13%, a bottom shade, a 1.5px top light at 16%; the rail casts onto the felt — One plausible light source
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/rail.png` → `demo/glass/scorecard/after/rail.png`

### Villain seat (`villain`) — 7.8 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 6 | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 |

- **Problem:** Cards centred against a 3-line block; four sizes
- **Change:** Cards top-aligned to the name; 13/600 name, 11/500 archetype and 12px quip in ink-2 (AA on felt), 13/500 stack; deal 420ms spring — A tighter type ramp
- **Remaining:** Legibility: quoted quip at ~55% grey on felt is near 4.5:1; lift to ~65%
- **Crops:** `demo/glass/scorecard/before/villain.png` → `demo/glass/scorecard/after/villain.png`

### Villain name + archetype + stack (`villain-name`) — 7.9 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Placeholder-looking 'Unknown'; three sizes
- **Change:** The archetype is an inline 11/500 ink-2 suffix (real hidden label kept) — A quieter suffix, one line
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/villain-name.png` → `demo/glass/scorecard/after/villain-name.png`

### Quip (`quip`) — 7.7 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 6 | 7 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 |

- **Problem:** Synthetic italic as bright as data; static
- **Change:** Regular 12px ink-2 in curly quotes; fades in after the deal — Flavour text recedes
- **Remaining:** Legibility: ~55% grey upright on felt near 4.5:1; lift slightly
- **Crops:** `demo/glass/scorecard/before/quip.png` → `demo/glass/scorecard/after/quip.png`

### Card backs (`card-backs`) — 7.8 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

- **Problem:** The lattice read as a mesh; double ring mushed
- **Change:** Fine ±60° lattice + 16% spade monogram, soft sheen, single frame; deal 420ms with a soft spring — Calmer pattern
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/card-backs.png` → `demo/glass/scorecard/after/card-backs.png`

### Bet chip and amount (`bet`) — 7.4 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 4 | 8 | 7 | 7 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** Floated alone; no motion
- **Change:** On the seat→pot line, 13/600 amount, slides in; crisp chips (no CSS filter blur; the contact shadow is drawn in the SVG) — Physical logic
- **Remaining:** Material: chip stack is a bone cylinder with a grey base that looks plastic; add top-face highlight and edge stripes · Craft: chip edge has no denominations/stripes and the base ring is muddy; refine · Apple fidelity: chip rendering is less refined than the cards
- **Crops:** `demo/glass/scorecard/before/bet.png` → `demo/glass/scorecard/after/bet.png`

### Pot (`pot`) — 8.0 → 8.1

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 9 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** 'Pot' label as bright as the value
- **Change:** Label 12/500 ink-2, value 17/600 — Label/value hierarchy
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/pot.png` → `demo/glass/scorecard/after/pot.png`

### Board cards (`board`) — 8.4 → 8.5

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 9 | 9 | 8 | 8 | 8 | 8 | 8 | 7 | 9 | 9 | 9 |
| After | 9 | 9 | 8 | 8 | 8 | 8 | 8 | 9 | 9 | 9 | 9 |

- **Problem:** (scored 8+)
- **Change:** Unchanged artwork; deal 640 → 420ms with a soft spring, 45ms stagger — —
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/board.png` → `demo/glass/scorecard/after/board.png`

### Empty board slots (`slot`) — 8.0 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Flat dark rectangles crossed by the twill
- **Change:** Deeper inset well (24% black, inset shadow, bottom lip highlight), above the weave; aria-label 'turn/river, to come' — Reads as a recess
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/slot.png` → `demo/glass/scorecard/after/slot.png`

### Price line (`price`) — 7.7 → 8.1

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 8 | 8 | 8 | 7 | n/a | 7 | 8 | 8 |
| After | 9 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** The key figure was the quietest text
- **Change:** 13px with the two figures in ink-1/500 — Decision-relevant numbers lead
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/price.png` → `demo/glass/scorecard/after/price.png`

### Hero cards (`hero-cards`) — 8.4 → 8.3

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 9 | 9 | 8 | 8 | 8 | 8 | 8 | 7 | 9 | 9 | 9 |
| After | 9 | 9 | 8 | 8 | 8 | 8 | 8 | 9 | 9 | 7 | 8 |

- **Problem:** (scored 8+)
- **Change:** Unchanged artwork; deal 420ms spring — —
- **Remaining:** Craft: dealer button overlaps the bottom-left corner of the first card, clipping it; offset it 8px off the card
- **Crops:** `demo/glass/scorecard/before/hero-cards.png` → `demo/glass/scorecard/after/hero-cards.png`

### Hero seat (`hero`) — 7.1 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 7 | 7 | 7 | 7 | 6 | 8 | 7 | 7 |
| After | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** No seat treatment for 'it's you, now'; 10px dealer inline
- **Change:** Type on the felt; your turn = a soft light pool + the mint status; dealer puck tucked on the left card's corner — One clear to-act treatment
- **Remaining:** Type: 'Your turn' 16px is larger than the 'You' label; set status 13-14px/500. · Spacing: D puck overlaps the hero card's bottom-left corner by ~8px; keep it 4-6px clear of the card edge. · Craft: Puck clips the card's rounded corner and the '2' index area; move it fully onto the felt. · Apple fidelity: Text column top isn't aligned to card top; align 'You' cap-height to card top + 8px for a composed lockup.
- **Crops:** `demo/glass/scorecard/before/hero.png` → `demo/glass/scorecard/after/hero.png`

### Dealer button (`dealer`) — 7.0 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 6 | 7 | 7 | 8 | 5 | 8 | 7 | 7 |
| After | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 7 | 8 |

- **Problem:** 10px under the floor; flat disc inline in text
- **Change:** 22px disc, 11px/700, inner rim + top light, on the hero's card corner; arrives with a 420ms spring — Type floor; real button shape
- **Remaining:** Type: 'D' 13px/600 in a 26px disc slightly heavy; 12px/700 rounded. · Spacing: Overlaps hero card corner; keep 4px clear. · Craft: Overlap clips the card's corner radius; sit fully on the felt.
- **Crops:** `demo/glass/scorecard/before/dealer.png` → `demo/glass/scorecard/after/dealer.png`

### Your-turn indicator (`your-turn`) — 7.6 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 8 | 7 |
| After | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 8 | 7 |

- **Problem:** A 12px line with no cue
- **Change:** 13/500 mint with a slow 2.4s breathing dot (off under reduced motion) — The most important state reads first
- **Remaining:** Type: 16px status is larger than the 'You' label; 13-14px/500. · Motion: Continuous 2.4s breathing loop pulls the eye while thinking; run two cycles then rest (already off under reduced motion). · Legibility: Mint text on green felt is ~4.3:1, borderline for 16px/400; lighten mint or use 500 weight. · Apple fidelity: Green dot+green label reads like a web status badge; keep the dot accent and set the label in secondary white.
- **Crops:** `demo/glass/scorecard/before/your-turn.png` → `demo/glass/scorecard/after/your-turn.png`

### Blinds label (`blinds`) — 7.9 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 7 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 7 | 7 | 8 | n/a | 7 | 8 | 8 |

- **Problem:** Different baseline from the right-hand controls
- **Change:** 12px ink-3 metadata on the same 28px row as the controls — Alignment
- **Remaining:** Spacing: Baseline sits ~9px above the opposite corner's 'Coach'/'Stats' row; align both corners to one baseline. · Consistency: Corner labels across the top band don't share a row height; set both corners to the same 32px row. · Legibility: Secondary grey on navy ~4.5:1 at 15px; raise to ~62% white.
- **Crops:** `demo/glass/scorecard/before/blinds.png` → `demo/glass/scorecard/after/blinds.png`

### Coach off / Stats (`coach-stats`) — 6.7 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 6 | 8 | 7 | 8 | 6 | 7 | 6 | 6 | 7 | 7 | 6 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 9 | 8 | 7 | 8 |

- **Problem:** Mode toggle read as plain text; no pressed state
- **Change:** 'Coach' is a real switch whose track fills mint when on (role map: mint = an ON switch); Stats a tertiary text button 16px away — macOS toggle grammar
- **Remaining:** States: 'Stats' remains bare text with no rest affordance next to a real control; make it a ghost button or icon. · Craft: Knob is slightly small and the track border heavy; use 2px knob inset and 0.5px track hairline like the macOS mini switch.
- **Crops:** `demo/glass/scorecard/before/coach-stats.png` → `demo/glass/scorecard/after/coach-stats.png`

### Action dock (`dock`) — 7.5 → 7.5

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 7 | 8 | 8 | 6 | 7 | 8 | 8 |
| After | 8 | 7 | 8 | 7 | 7 | 7 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** 84% slab with no refraction; non-concentric radii; three button styles
- **Change:** Lighter, thinner glass (L .32 at 34%, blur 26 / saturate 175%), a 20% top highlight and a gradient rim; r14 = 8 + 6 — Visible glass and one control system
- **Remaining:** Type: '150' 20px/600 is the heaviest figure and competes with Raise; 17px/500 tabular. · Material: Dock fill reads ~90% opaque, a dark slab; drop to ~70% with blur, 8% top-edge highlight. · Spacing: Button heights (64) vs preset capsule (54) vs Raise (66) differ; unify to one control height. · Consistency: All-in carries no hint while F/C/R do; give it 'A' or remove all. · Craft: Boxed keycaps inside bordered buttons inside the dock make three nested radii; render hints as plain trailing text. · Apple fidelity: Nested keycap boxes are non-native; macOS shows shortcuts as trailing secondary text.
- **Crops:** `demo/glass/scorecard/before/dock.png` → `demo/glass/scorecard/after/dock.png`

### Fold / Check / Call (`fcc`) — 7.6 → 7.6

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 7 | 7 | 8 | 8 |
| After | 8 | 8 | 8 | 7 | 7 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** Disabled Check looked enabled; faint states
- **Change:** Secondary ramp (8/13/18%); disabled Check keeps a quiet hairline container and ink-3 text — Distinct states
- **Remaining:** Material: 8% fills with 1px borders read as flat tiles; add a 1px top highlight and drop border to 0.5px. · Spacing: Keycap sits 12px from right edge vs 24px left padding; balance to 16/16. · Craft: Double box (button border + keycap border) is busy; flatten the keycap to text. · Apple fidelity: Boxed keycaps aren't a macOS idiom; trailing secondary glyph is.
- **Crops:** `demo/glass/scorecard/before/fcc.png` → `demo/glass/scorecard/after/fcc.png`

### Shortcut hints (`hints`) — 7.6 → 7.5

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 8 | 8 |
| After | 7 | 8 | 8 | 7 | 7 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** 'Call 75 C' read as an amount
- **Change:** Trailing keycaps (18px, r4, edge + bottom shade, ink-1 glyph); only real hotkeys get one — Unambiguous shortcuts
- **Remaining:** Hierarchy: Boxed keycap gives the hint near-equal weight to 'Call 75'; recess it to plain text. · Material: Keycap has its own fill and border inside a filled button, stacked plastic; drop the fill. · Spacing: Keycap sits ~10px from right edge vs 24px left padding; balance. · Craft: Keycap 1px border aliases at DPR2; use a 0.5pt hairline. · Apple fidelity: macOS shows shortcuts as trailing secondary text, not keycaps in buttons.
- **Crops:** `demo/glass/scorecard/before/hints.png` → `demo/glass/scorecard/after/hints.png`

### Slider and value (`slider`) — 6.6 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 7 | 7 | 7 | 7 | 5 | 6 | 6 | 7 | 7 |
| After | 8 | 7 | 8 | 8 | 7 | 8 | 8 | 9 | 8 | 8 | 8 |

- **Problem:** No focus; value detached; flat thumb
- **Change:** Track fills to the thumb centre; thumb rim + top light, hover/press scale, focus ring; value in a fixed 40px tabular slot with 8px trailing space — System-grade slider
- **Remaining:** Type: '150' at 20px is an orphan size against 17px dock labels; 17px tabular. · Spacing: Value sits ~50px past the track; tighten to 16px.
- **Crops:** `demo/glass/scorecard/before/slider.png` → `demo/glass/scorecard/after/slider.png`

### Sizing presets + All-in (`presets`) — 6.7 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 7 | 6 | 6 | 6 | 7 | 7 | 7 | 6 |
| After | 8 | 7 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 |

- **Problem:** Loose ghost text, tiny fractions, no states
- **Change:** Small segmented group (½ ¾ at 15px, Pot, All-in) with aria-labels; the All-in shortcut in its tooltip; a 2px focus ring at a 2px offset — Grouped presets
- **Remaining:** Type: ½ ¾ glyphs render smaller/lighter than 'Pot'; use matching size with diagonal-fractions. · States: No selected segment when a preset matches the slider value; show a selected fill.
- **Crops:** `demo/glass/scorecard/before/presets.png` → `demo/glass/scorecard/after/presets.png`

### Raise (primary) (`raise`) — 7.6 → 8.3

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 9 | 8 | 8 | 7 | 8 | 8 | 6 | 7 | 8 | 8 | 7 |
| After | 9 | 8 | 8 | 8 | 8 | 8 | 9 | 9 | 8 | 8 | 8 |

- **Problem:** Hover = press (pure white)
- **Change:** Bone ramp: hover #FAF8F3, press #E2DFD6, 0.5px dark edge — Press feedback
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/raise.png` → `demo/glass/scorecard/after/raise.png`

### Commit tray (`tray`) — 7.2 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 6 | 8 | 7 | 7 | 6 | 7 | 8 | 7 | 8 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 8 | 8 |

- **Problem:** Slab; 13px question; mixed heights
- **Change:** The same thin float glass; 15/600 question; 28px controls; Sure/Guess in title case (the app uppercases in code) — Glass plus aligned controls
- **Remaining:** States: No rest indication that confidence (Sure/Guess) is still required; show an unselected prompt state. · Legibility: Placeholder ~55% grey (~4:1 at 15px); raise to 60%.
- **Crops:** `demo/glass/scorecard/before/tray.png` → `demo/glass/scorecard/after/tray.png`

### Gate sheet (`gate`) — 7.5 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 7 | 6 | 7 | 8 | 6 | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 8 |

- **Problem:** Slab; dead space; field ≠ button height; the timer broke under reduced motion
- **Change:** Sheet glass over a strongly dimmed, blurred table (no bloom); 32px field + button; a 1.5px focus ring at a 2px offset; budget as a progressbar; the timer exempt from reduced motion — Material, a11y and a functional timer
- **Remaining:** Material: Sheet fill near-opaque; ~75% with blur and a top highlight. · Craft: Input focus shows a heavy double ring; use one 3px ring at ~50%.
- **Crops:** `demo/glass/scorecard/before/gate.png` → `demo/glass/scorecard/after/gate.png`

### Verdict sheet (`verdict`) — 6.9 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 6 | 7 | 6 | 7 | 7 | 7 | 7 | 7 | 8 | 7 | 7 |
| After | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 9 | 8 | 8 | 8 |

- **Problem:** About 10 tiers; coral three times; no primary; ring at rest
- **Change:** Two groups and one primary Close; coral only on severity + tick; table dimmed to 30% behind (no bloom); support at 56ch — One headline, one visual, one action
- **Remaining:** Spacing: 'pot odds' line sits 16px under the headline but ~40px above the divider; even to 24px rhythm.
- **Crops:** `demo/glass/scorecard/before/verdict.png` → `demo/glass/scorecard/after/verdict.png`

### Severity label (`severity`) — 7.9 → 8.1

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 7 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 9 | 8 | 8 |

- **Problem:** Text only
- **Change:** A 13px warning glyph + 'Serious' in coral; no light behind the header — Not colour alone
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/severity.png` → `demo/glass/scorecard/after/severity.png`

### Meter (`meter`) — 7.6 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 7 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

- **Problem:** 1px tick; no scale; the gap was not shown
- **Change:** 4px bar: dim fill to the price, bright band for the surplus over it, 2px coral price tick, 0/100% endpoints — The insight is the gap
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/meter.png` → `demo/glass/scorecard/after/meter.png`

### Committed choices (`committed`) — 7.8 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 8 | 8 | 7 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Small grey line
- **Change:** 12px lead-in 'You committed to Fold, Sure' above the neutral result (the result keeps the app's 'SURE') — Calm hierarchy
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/committed.png` → `demo/glass/scorecard/after/committed.png`

### Support copy (`support`) — 7.8 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 6 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Dense, repetitive engine copy
- **Change:** 12px ink-2 at 1.55, measure capped at 56ch; copy verbatim — Readable support tier
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/support.png` → `demo/glass/scorecard/after/support.png`

### Chart grid (`grid`) — 7.5 → 7.5

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 6 | 6 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 8 | 7 | 7 | 7 |

- **Problem:** Dashed outlines shouted; 9.5px floor; three boundary channels
- **Change:** Three states: open 26% flat, fold 3.5%, boundary = a 10px corner notch; 11px; row-staggered fade-in — One channel per meaning
- **Remaining:** Material: Open cells are opaque mid-grey tiles; lower to ~18% white with a 0.5px edge. · States: Boundary marker is a 14px corner triangle, weak at a glance; strengthen the marker. · Legibility: Boundary signalled only by a small white notch; hard to see and no non-visual cue. · Craft: Corner triangles look default/web; use an inset ring or 4px dot. · Apple fidelity: Notch markers and opaque tiles feel less refined than first-party data grids.
- **Crops:** `demo/glass/scorecard/before/grid.png` → `demo/glass/scorecard/after/grid.png`

### Chart cells (detail) (`cells`) — 7.7 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 7 |
| After | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** Keycap-like edge on open cells; dashed corners
- **Change:** Flat cells with a ≥1.6:1 open/fold luminance step; boundary corner notch; hover lift — Crisper data
- **Remaining:** Material: Opaque #555 tiles read as slabs; translucent fill with 0.5px edge. · Craft: Corner triangle is crude at this zoom; use an inset ring or dot. · Apple fidelity: Tiles feel flat/default.
- **Crops:** `demo/glass/scorecard/before/cells.png` → `demo/glass/scorecard/after/cells.png`

### Chart legend (`legend`) — 7.9 → 7.8

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 7 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 7 | 7 | 8 |

- **Problem:** Dashed checkbox swatch; mismatched radii
- **Change:** Three swatches matching the cells (with a hairline), boundary shown with the same notch — Legend = data
- **Remaining:** Legibility: Fold swatch is dark-on-dark (~1.3:1); add a hairline border. · Craft: Boundary swatch half-split doesn't match the in-grid corner notch; draw the same notch.
- **Crops:** `demo/glass/scorecard/before/legend.png` → `demo/glass/scorecard/after/legend.png`

### Charts side column (`charts-side`) — 7.1 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 8 | 6 | 7 | 7 | 8 | 7 | 6 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 8 |

- **Problem:** Everything 12px; ragged wraps; button-like chips
- **Change:** Wider 288px column; classes as a flat list (name, cells, score; description below); rules 13px; tags; scrolls with an edge fade — Hierarchy and honest non-interactive tags
- **Remaining:** States: '—' score placeholders look actionable; mute or remove. · Legibility: Final line 'below those.' fades under a mask; remove the mask or add bottom padding. · Craft: Bottom fade clips the last rule line.
- **Crops:** `demo/glass/scorecard/before/charts-side.png` → `demo/glass/scorecard/after/charts-side.png`

### Quiz bar (`quiz`) — 7.4 → 7.7

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 7 | 8 | 8 | 8 | 7 | 7 | 7 | 7 | 8 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 7 | 7 |

- **Problem:** Key before the label; hairline crossing the text
- **Change:** Horizontal group (no separators); trailing keycaps 'open O' — Consistent shortcuts
- **Remaining:** Consistency: Boxed keycaps here vs plain trailing hints elsewhere; one hint style app-wide. · Craft: Keycap box nested in bordered button adds radii noise; flatten to text. · Apple fidelity: Boxed keycaps inside buttons are non-native.
- **Crops:** `demo/glass/scorecard/before/quiz.png` → `demo/glass/scorecard/after/quiz.png`

### Train sub-nav (`drill-subnav`) — 7.9 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 |

- **Problem:** Selection identical to the top tab; jump
- **Change:** Source-list selection (fill-1, no shadow) distinct from the toolbar thumb — Secondary nav reads secondary
- **Remaining:** Legibility: Inactive items ~65% white over the warm band (~4:1); raise to 70%.
- **Crops:** `demo/glass/scorecard/before/drill-subnav.png` → `demo/glass/scorecard/after/drill-subnav.png`

### Drill kind + tally (`drill-kind`) — 7.4 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 6 | 8 | 8 | 8 | 6 | 7 | 8 | 8 | 8 | 7 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 8 | 8 |

- **Problem:** Chips wrapped to two rows; a third selection style
- **Change:** One level-2 picker with a checkmark and the session tally trailing each kind, plus an 'All kinds' total (no duplicate list) — Lists, not wrapping chips
- **Remaining:** States: Rows don't read as selectable beyond the checkmark; add a hover row highlight.
- **Crops:** `demo/glass/scorecard/before/drill-kind.png` → `demo/glass/scorecard/after/drill-kind.png`

### Question (`drill-q`) — 8.0 → 7.9

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 7 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** (material only: wallpaper crisp behind text)
- **Change:** 22/600 title on the now-frosted coat — —
- **Remaining:** Type: 34px display line with default tracking; tighten ~-0.4px like SF Display.
- **Crops:** `demo/glass/scorecard/before/drill-q.png` → `demo/glass/scorecard/after/drill-q.png`

### Band + you said / answer (`drill-result`) — 7.6 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 7 | 8 | 7 | 8 | 8 | 8 | 8 | 6 | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |

- **Problem:** Coral twice; stat styling differed
- **Change:** Band sentence 15/600 ink-1, coral only on the wrong value, the shared stat component, a 320ms reveal — Colour role map; one stat
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/drill-result.png` → `demo/glass/scorecard/after/drill-result.png`

### Method steps (`drill-method`) — 8.0 → 8.0

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 8 | n/a | 8 | 8 | 8 |

- **Problem:** Small numbered circles fine; spacing tight
- **Change:** Tertiary tabular numerals inside the content edge, 13px at 1.5 — Rhythm
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/drill-method.png` → `demo/glass/scorecard/after/drill-method.png`

### Next problem button (`drill-next`) — 7.5 → 8.2

| | Hierarchy | Type | Colour | Material | Spacing | Consistency | States | Motion | Legibility | Craft | Apple fidelity |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Before | 8 | 7 | 8 | 8 | 8 | 7 | 6 | 7 | 8 | 8 | 7 |
| After | 8 | 8 | 8 | 8 | 8 | 8 | 9 | 9 | 8 | 8 | 8 |

- **Problem:** Hover = press
- **Change:** Bone ramp, trailing keycap ↩ — Button spec
- **Remaining:** all categories ≥ 8
- **Crops:** `demo/glass/scorecard/before/drill-next.png` → `demo/glass/scorecard/after/drill-next.png`
