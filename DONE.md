# DONE — Fix #1: grade decisions vs the villain's RANGE, not vs a random hand

## The bug (CONSOLIDATED audit #1)
The live decision grader scored every bet-facing call/fold/raise on **equity-vs-RANDOM**
(`equityVsRandom` deals the villain two uniform cards — a 100% range). A villain who bets or raises
holds a range strictly stronger than random, so vs-random **overstated hero equity in exactly the
graded spots**. Measured consequences: loose calls graded `free` (teaches calling too wide — the
commonest losing leak) and correct folds facing a bet got charged an EV-loss (a good laydown told it
was a leak). This grade drives the on-screen verdict, the profile leak list, the assessment score,
and the Depth tier — so the error propagated everywhere.

## What changed
- **`src/core/equity.ts`** — new `equityVsRange(hole, board, range, iterations, seed)`: a seeded Monte
  Carlo that mirrors `equityVsRandom` exactly, except the villain's two cards are drawn from a set of
  canonical combos instead of the deck. It enumerates every concrete two-card hand consistent with the
  range and the dead cards and samples them uniformly — which reproduces the 6/4/12 `comboWeight`
  weighting and bakes in card removal for free. Empty/fully-blocked range falls back to
  `equityVsRandom` (honest "no better info than random", never a divide-by-zero). `equityVsRandom` and
  the exact evaluator/enumeration are **untouched**.
- **`src/core/preflop.ts`** — new `VILLAIN_BETTING_RANGE` (the combos a betting/raising villain is
  modelled to hold) built from the **same** `RfiSpec` + `inThresholds` threshold machinery and
  `comboWeight` the RFI ranges use, plus `villainBettingWidth()` so a test can pin it. Width ≈ **31.8%**
  — deliberately between the cutoff RFI (27%) and button RFI (44%): strictly stronger than random (the
  bug it removes) but not nit-tight (a too-narrow model just flips the error). Documented as a coarse,
  position-independent floor, not a solve.
- **`src/core/coach.ts`** — `gradeDecision` takes an optional `villainRange`. When hero **faces a bet**
  (`toCall > 0`) and a range is supplied, equity is measured with `equityVsRange`; otherwise it falls
  back to `equityVsRandom`. **Only the equity SOURCE changed** — pot-odds/MDF/EV-loss/severity/message
  math is byte-for-byte the same.
- **`src/renderer/screens/table.ts`** (`computeHeroGrade`, ~:346) and **`src/core/assessmentBlock.ts`**
  (`gradeHere`, ~:195) — both now pass `villainRange: toCall > 0 ? VILLAIN_BETTING_RANGE : undefined`,
  so the live table and the assessment block grade on range equity.
- **`src/core/standing.ts`** (~:13) and **`assessmentBlock.ts`** header — updated the comments that
  conceded the "Monte-Carlo-vs-random" heuristic to describe the range-based grading (still an honest
  model, not a solver).

## Tests added (red-first, real oracles)
- **`tests/unit/coach.test.ts`** — `grading against the villain range (CONSOLIDATED #1)`:
  - **(a)** 99 on A-K-7 facing a pot-sized bet: vs-random the correct fold is charged `serious` 16.3bb
    "pot odds" (the bug, asserted as oracle); vs-range it is `free`.
  - **(b)** A5 on K-Q-9 calling 60 into 140 (30% price): vs-random the loose call is `free` (the bug);
    vs-range it is correctly flagged `serious` "pot odds".
  - width pin (~32%, strictly between 27% and 44%) and a scope guard proving unpriced `toCall 0` spots
    are unaffected. Each flagship test grades the SAME spot both ways so the vs-random column is the
    oracle. Reverting the coach equity-source change turns (a)/(b) red.
- **`tests/unit/equity.test.ts`** — `equityVsRange`: collapses to exact heads-up equity for a
  single-combo range (KK vs `['AA']` ≈ 0.18, an enumeration oracle); a marginal hand has strictly less
  equity vs the range than vs random; determinism by seed; win+tie+lose ≈ 1; empty-range fallback
  equals `equityVsRandom`.

No tests were weakened or deleted.

## What I left alone
- **`statsSheet.ts` / `robustness.ts`** still show equity-vs-random. These are DISPLAY/diagnostic
  readouts (labelled "Win%"/robustness spread), not the decision grader; `robustness.ts` deliberately
  matches the displayed vs-random pot share on its own screen. Unifying the displayed equity with the
  grader's range equity is a separate UX change (relates to audit #2/#15).
- The AI villain equity (`ai.ts`, `archetypes.ts`) — those are villain decisions, not hero grading.
- Audit #2 (hard-coded no-price thresholds), #3 (dead `tiedWithHero` / multiway tie), and everything
  below #1. The check/lead heuristics still use the random model by design (the fix is scoped to
  bet-facing branches).

## Verification (real results)
- `npm run typecheck` — **PASS** (exit 0, no errors).
- `npm test` (`vitest run`) — **PASS**, 76 files, **1679 tests** (1670 prior + 9 new), 0 failed.

## Concerns
- `VILLAIN_BETTING_RANGE` is a single position- and street-independent model (a documented floor). A
  real betting range varies by seat and by street; both the live and assessment tables are 4-handed, so
  there is no clean 6-max seat to read a position-specific range from, and the app models ranges only
  preflop. The verdict should be read as a floor, not a point estimate (the standing "HONEST CEILING"
  comment now says so).
- The coach line now quotes a range-based "pot share" while the stats sheet still shows vs-random Win%
  on the same screen; they measure genuinely different things. Not user-visibly reconciled here — worth
  a follow-up to either relabel or move the sheet onto range equity too.
- Security posture unchanged: no `innerHTML`/`eval`, no new IPC/network surface, no renderer-controlled
  paths — this is pure core-logic + one renderer import of a data constant.
