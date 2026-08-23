# DONE — Standalone Equity Calculator (BACKLOG #5)

Branch: `feat/equity-calculator`

## What changed

- **`src/renderer/screens/equityCalculator.ts`** (new) — a standalone equity-calculator
  screen. It is a pure surface over the existing VERIFIED equity engine and adds no poker
  maths of its own:
  - `parseCards(text)` — reads `"As Kh"` / `"as,kh"` / `"Th 9d 8c"`, normalises case, and
    validates each token against the real 52-card deck.
  - `validateInput(input)` — the first reason a spot is unplayable (hero not two cards, an
    illegal board size, a villain hand that isn't two cards, or any card used twice), or null.
  - `computeEquity(input)` — routes the spot to the right existing primitive:
    - specific villain hand → `exactEquityHeadsUp` (exact, full enumeration)
    - a range of combos → `equityVsRange` (Monte Carlo, combo-weighted with card removal)
    - "any two cards" → `equityVsRandom` (Monte Carlo vs one uniform opponent)
  - `renderEquityCalculator()` — keyboard-accessible DOM: native `<input type=text>` fields
    for hero / board / villain hand, native radio buttons for the villain mode, a 13×13 grid
    of `<button>` cells for range selection (mirroring the Charts grid layout and using
    `ALL_COMBOS`), a Calculate `<button>`, an `role="alert"` error line, and an
    `aria-live="polite"` result panel. Cards are drawn with the shared `renderCard`.
- **`src/renderer/styles-equity.css`** (new) — screen styles, imported by the screen module
  (mirrors the per-screen `styles-*.css` convention).
- **`src/renderer/main.ts`** — registered the screen in the router exactly like the other
  top-level surfaces: added `'equity'` to the `Tab` union, a `{ id: 'equity', label:
  'Equity', testid: 'tab-equity' }` entry in the `TABS` registry (placed after Charts), the
  import, and an `if (which === 'equity') return renderEquityCalculator();` arm in
  `renderTab`.
- **`tests/unit/equityCalculator.test.ts`** (new) — red-first tests with real oracles:
  - `AA vs KK` preflop ≈ 0.82 and `AKs vs 22` preflop ≈ 0.50 (the coinflip), both computed
    by the engine through `computeEquity` and asserted against their known values.
  - a dominating overpair on a blank river is exactly 1.0 (exact path).
  - vs-range routes through `equityVsRange` (win+tie+lose sums to 1, not exact) and vs-random
    reproduces `equityVsRandom` byte-for-byte at the same seed.
  - `parseCards` / `validateInput` unit coverage.
  - jsdom UI wiring: the screen renders native focusable controls, computing a filled spot
    paints the headline equity, and bad input surfaces an error instead of throwing.

## Verification (real counts)

- `npm run typecheck` — exit 0.
- `npm test` (vitest) — **79 files, 1714 tests, all passing** (baseline was 78 / 1698; +1
  file, +16 tests, no regressions).
- `npm run build:renderer` — succeeds (126 modules, screen + CSS bundle cleanly).
- e2e (`npm run e2e`) not run here; the dynamic navigation spec reads the tab bar and requires
  every tab to render a real (non-placeholder) surface — this screen satisfies that (real DOM,
  no `pageerror`).

## What I left alone

- Did not touch the equity engine, evaluator, or range modules — reused them as-is.
- Did not reuse `renderStatsSheet`: it computes `equityVsRandom` internally and cannot accept
  a pre-computed range/exact result, so the calculator paints its own breakdown from the
  engine's `EquityResult` instead. Card rendering is still single-sourced via `renderCard`.
- Did not wire the calculator into the grader or any persisted state — it is a read-only tool.

## Concerns

- A specific-hand calc PREFLOP (`need = 5`) runs the full `exactEquityHeadsUp` enumeration
  (~1.7M boards, ~3–4s) synchronously on the renderer thread — a deliberate, user-initiated
  Calculate press, but it will briefly freeze the UI. Flop/turn/river specific-hand calcs and
  all Monte Carlo paths are fast (tens of ms). If the freeze proves annoying, options are a
  worker or a "sampling" fallback for the preflop specific-hand case; left out to keep the
  change focused and the numbers exact.
- The range grid has no preset buttons (e.g. "top 20%"); combos are selected cell by cell.
  Presets would be a natural, cheap follow-up.
