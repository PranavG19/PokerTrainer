# Review: design-glass-mockup (round 2 redesign)
Verdict: PASS WITH NOTES
Base: 4c4a305  Head: e754297

An adversarial reviewer ran twice, following `~/.foundry/skills/pr-review/SKILL.md` with an added
"does this still look tacky?" lens against Synara and Foundry.

| Pass | Commit | Verdict | Outcome |
|---|---|---|---|
| A | e2bbc1d | BLOCK | 7 Act-on items, plus "glass not perceptible" |
| B | 6fc2940 | BLOCK | all of pass A confirmed fixed; 2 new Act-on items |

Both pass-B items are fixed at e754297 and were re-verified by me (probes below). No Act-on item is open.

## Does it still look tacky?
No. In the reviewer's words at pass B, "the direction is now right."
- Home is no longer a box kit.
- The table at 1100x760 is "quiet and premium": bone cards, a matte rail, seats set as type, real quips in
  italics.

What changed between the passes:
- **The glass is now perceptible.** A contoured dune "desktop" sits under a 50% coat (Foundry's alpha) with
  `blur(26px) saturate(135%)`, so umber and slate bands read through at the window edges. Before this, a flat
  radial wash read as decoration.
- **The floats match Foundry's density:** 84% with a 10% edge and an inset highlight. They read as solid
  slabs over uniform felt, which is what Foundry and Synara do too: glass where it covers content.
- **No grey smudge under the sheets.** The felt's lamp turns off behind them.
- **Sheets no longer slice the table.** The table recedes behind an open sheet (blur 5px, 62% brightness),
  so the sheet edge never cuts crisp content (pass B, Act on #1).
- **Charts is no longer a white wall** (graphite cells), and **not a fake heatmap**: an opaque base under the
  grid stops the wallpaper from tinting cells (pass B, Act on #2).
- **The remaining tells are gone:**
  - all-caps eyebrows
  - kbd chips on every button
  - glow rings
  - candy mint buttons
  - the mint app tile
  - colour-coded class swatches that encoded nothing
  - `↵` appended to buttons

## Act on
None open.
- **Resolved (pass B #1): the verdict sheet cut through the pot, bet and side seats.**
  - Fix: `.sheet-open > :not(#gate):not(#verdict) { filter: blur(5px) brightness(0.62) }` in glass.css.
  - Guard: the capture guard now requires any element the sheet half-covers to sit in a blurred layer, and
    the hero to be fully covered or missed.
  - Negative test (`tests/tmp/probe-guard.mjs`): as shipped, clean. With the filter removed, it flags
    `pos-left`, `pos-right` and `bet-bo`.
- **Resolved (pass B #2): the wallpaper tinted chart cells brown, then green, then grey.**
  - Fix: `.grid` gets an opaque `--surface` base (charts.html). The open/out state is the only cell colour.
    See charts-1100x760.jpg.

## Consider
- **The commit tray and dock read as dark slabs**, with no glass character of their own. Tradeoff: this is
  deliberate. Foundry floats are 85%, and Synara drops the blur on raised surfaces. A thinner float would let
  the felt bleed through behind the action labels.
- **A scroll container hiding content still only logs "(scrolls inside)".** The 28px mask fade makes the cut
  readable. Tradeoff: an enforced rule would need a per-screen allowance.

## Noted
- **The bet chip stack** beside "75" reads as a small sticker at 1100, though no longer emoji-like.
- **The verdict support text says "day 2 and day 7" twice.** That is faithful to `predictSupportText` plus
  the rationale; it's a pre-existing copy issue in src.
- **The "Current app" column is captioned "(older build)".** The committed app screenshots predate the
  current tab set.
- **The class-accuracy column is "—" on all rows.** That is correct for a fresh visit (charts.ts:381).

## Dismissed (resolved, with proof)
- **DECISIONS "Mock-only vs port work" was a placeholder.** It now lists:
  - what is mock-only
  - the real copy kept, by source file
  - the gate semantics
  - each invented string or device
  - the 5 port steps, including main-process vibrancy and the note that a paint-only theme block cannot make
    the coat
  - the e2e pins this breaks
- **Stale "positions shown" decision.** Removed; `.pos` was renamed `.arch`.
- **The gate showed the hero folded.** The fold is now applied only in `verdict` (table.html), matching
  table.ts holding state until the gate resolves.
- **The sheet half-covered the hero.** Bottom sheets plus `.sheet.short` now cover it at both sizes, and the
  guard checks it.
- **"10,840" in white.** It is now `10840` in net-up mint, matching home.ts:157-166.
- **Class swatches / class-accuracy dropped.** The swatches are removed, and the `—` score column is
  restored.
- **The quips were real lines but not the engine's pick.** They now use table.ts:1012
  `(seat.id + board.length) % 6`: Ada "I’ll wait.", Bo "Let’s make it interesting.", Cy "I’ll let this one
  go."
- **Contrast was measured at DPR 1 while the evidence is DPR 2.** Both are DPR 2 now. contrast.md was
  regenerated from the current run, with run-to-run variance noted.
- **Dead CSS and tokens.** These were removed: `.card.dim`, `.sev.notable`, `.seg button.on`, `.seat .tag`,
  `.c3`, `--chip-c`, `--r-window`, `--s-1` and `--dur-2`. `--mint` now aliases `--positive`, and the
  `--desk-*` tokens feed the SVG.
- **Arithmetic and copy fidelity.** The reviewer re-derived both:
  - pot 225 and price 25%
  - fold EV loss 2.94 bb, which is serious
  - the session plan from `assemble()`
  - CO = 26.7% across 60 cells
  - the drill's 33.33%
  - every string, matched to its source
- **src or package changes.** `git diff --stat 4c4a305..HEAD -- src package.json package-lock.json` is
  empty.

## Verification
- `node tests/tmp/glass-capture.mjs` exits 0. All 14 screens (DPR 2) and 7 three-way compares are "ok".
  The reviewer also ran it from a copy outside the repo: exit 0.
- `node tests/tmp/glass-contrast.mjs` (DPR 2) exits 0 with "No AA failures". Pass B's independent run also
  exited 0.
- `node tests/tmp/probe-guard.mjs`: the sheet guard's negative test, results above.
- `npm run typecheck` exits 0, and `npm test` exits 0 (1796 tests).
- `npm run e2e` exits 1: all 540 tests fail at `electron.launch` because Electron is half-installed. This is
  environmental and unchanged from round 1.
- **Not tested:** real Electron vibrancy, the GPU cost of the coat plus floats, hover and focus states, and
  `prefers-reduced-transparency` rendering.
