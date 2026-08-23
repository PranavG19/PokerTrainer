# DONE — reach-weighted study prioritisation (BACKLOG #2, G2/G8)

## What changed
Wired `src/core/rw.ts` (previously imported nowhere) into the study/drill selection path so the
Home recommender ranks the study target by REACH-WEIGHTED loss instead of raw session cost.

- **`src/core/reachRef.ts` (new)** — supplies the frozen reference reach table rw.ts consumes
  (`REFERENCE_REACH`, `referencePopId = authored-street-class-v1`) and `classDecisionsFor`, which maps
  graded hero decisions to rw.ts `ClassDecision`s. Reach is AUTHORED ordinal data (no solver bank
  exists yet — see `bank.ts:EMPTY_BANK_INDEX`); the module header documents why authoring a study
  ORDERING is not the fabricated-GRADE that bank.ts refuses. Every (street × coach principle) a
  decision can carry has a reach, so `reachWeightedLoss` never throws in the live path; unknown
  classes are dropped rather than crashing Home.
- **`src/core/recommend.ts`** — `RecommendInput` gains optional `rw?: RwReport`. When present with a
  loss-bearing class, the `error-tag` family IS the report's classes ranked by `mean(ΔEV) × reach ×
  100`; absent/empty, it falls back to the existing raw-cost leak tally unchanged. Weight stays in the
  error-tag band (a strictly-increasing squash of rw into [20,29)) so reach discriminates within the
  family but a leak never leaps a spacing/gate/mastery candidate. Reuses `reachWeightedLoss`; no math
  reimplemented.
- **`src/renderer/main.ts`** — `currentRecommendation()` now builds the report from the same graded
  hero decisions the leak tally aggregates (`deriveRwReport`) and passes it to `recommend`.
- **Tests (red-first):** `tests/unit/reachRef.test.ts` (+8) and a new block in
  `tests/unit/recommend.test.ts` (+8). Oracles: `reachWeightedLoss` itself — the recommender must
  agree with the report's #1 class; reach (not raw cost) must decide ties and near-ties; a high-reach
  spot outranks a raw-cost-larger low-reach one; RW never outranks spacing debt; and the fallback is
  pinned so no-reach behaviour is unchanged.

## Verification (real counts)
- `npm run typecheck` — clean.
- `npm test` (vitest) — **79 files, 1714 tests pass** (baseline 78 / 1698; +1 file, +16 tests). No
  tests weakened or deleted.
- e2e not run (requires electron build + playwright); `tests/e2e/recommend.spec.ts` writes profiles
  with `hands: []`, so the RW report is empty there and the recommender takes the unchanged raw-cost
  fallback — its assertions are preserved by construction.

## What I left alone
- `rw.ts` `scoreboardRw` is NOT surfaced in `progress.ts` yet. BACKLOG #2 also mentions showing the RW
  figure on Progress; I scoped this change to the SELECTION path the task named. `scoreboardRw` /
  `rwFor` remain available for that follow-up.
- `bank.ts` and the real solver-derived reach it would ship — still unbuilt (BACKLOG #8). The reach
  table is authored v1 data pending that; swapping it in is a `referencePopId` bump.

## Concerns
- The reach numbers are AUTHORED estimates, not measured frequencies. They order study priority
  sensibly (street decay, preflop-range-heavy) but are not a solver artifact; the `referencePopId`
  marks them as v1 so the provenance is honest and the later swap is clean.
- The error-tag subject on the RW path is the coach principle (e.g. `pot odds`), same vocabulary the
  raw-cost path and the leak tally already use, so accept-routing (`onAcceptSuggestion`) is unchanged.
