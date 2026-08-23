# DONE — safe simplifications (branch chore/simplify)

Applied the behavior-preserving "safe-now" group from `/tmp/poker-audit/SIMPLIFY.md`.
Every change is a refactor or dead-code removal; none alters observable behavior.

## What changed (commit per group)

### S1 — shared DOM `text()` helper — `src/renderer/components/dom.ts` (new) + 10 files
Ten byte-identical copies of `text(tag, className, content)` (contrast, drill, anomaly,
robustness, dossier, variance, lesson, puzzle, assessment screens + `tutorRail`
component) replaced by one exported helper. Variants left alone on purpose (they
differ behaviorally): `progress.el()` wraps text in `guarded()`, `review.line()`,
and `spacing.cell/label/note` set `dataset.testid`.

### S2 — dead `isPair` branch — `src/renderer/screens/handReadingDrill.ts`
For a pair like "QQ", `endsWith('s')` is false, so the offsuit branch already returns
`["Qs","Qh"]` — identical to the special case. Removed the branch and rewrote the
stale comment that justified it.

### S3 — ESM import extension — `src/core/anomaly.ts`
`import ... from './rng'` -> `'./rng.js'` to match every sibling (NodeNext consistency).

### S6/S7 — scalar dedup + dead code — `equity.ts`, `robustness.ts`, `ai.ts`, `archetypes.ts`, `coach.ts`, `card.ts`
- Added `equity.scalarEquity(eq) = eq.win + eq.tie*0.5` and routed the four identical
  copies through it.
- Removed the write-only `tiedWithHero` local in `equityVsRandom` (assigned, never read).
- Dropped `CardRenderOpts.tilt`: no caller ever passed it, so both `rotate()` branches
  were dead (always 0).

### S8 — raise-slider mirror — `src/renderer/screens/table.ts`
Collapsed the repeated "set `slider.value` + `amountLabel.textContent` +
`aria-valuetext`" writes in the input handler and `setPreset` into one `setAmount()`
helper. Same DOM, same aria strings.

## What I left alone (deliberately)

- **S4 (main.ts placeholder + stale JSDoc):** skipped — `main.ts` router additions are
  owned by a concurrent slice; editing it risks a conflict for a pure-cosmetic gain.
- **S5 (un-export test-only core symbols):** skipped — the plan flags it as a per-symbol
  *candidate* list, and every symbol I checked (`PRODUCIBLE_AXES`, `duplicateCards`,
  `continuationWeights`, `supportRank`, `moduleOfContent`, `compareHands`) is imported by
  a unit test. Un-exporting would break those tests, which this task forbids touching.
- **`ai.ts` (L1 / deletion candidate):** NOT deleted. A repo-wide search shows
  `src/core/robustness.ts` imports `PROFILES` and the `Archetype` type from it, and
  `ai.test.ts` / `archetype-wiring.test.ts` / `jitter.test.ts` reference it — so it is
  not genuinely unreferenced. The L1 extraction is marked medium-risk / "Later"; skipped.
- **`rw.ts` / `bank.ts`:** untouched (feature targets, per instructions).
- **S6 partials that were NOT behavior-identical:** `clamp01` (the second copy lives in
  the deliberately import-free `progress.ts`; deduping would force its first-ever import
  for a one-liner — net coupling, not simplification); `pct()` (drill uses `trim()` for
  up-to-2-decimals, robustness uses `Math.round` integer — different output); `inBb()`
  (contrast returns a string, lesson/puzzle return rounded numbers over different bb
  sources). Leaving these avoids a behavior change disguised as a dedup.
- **All "Later" items (L1–L7):** out of scope for the safe-now pass.

## Verification (real results)

- `npm run typecheck` — PASS (exit 0).
- `npm test` (vitest run) — PASS: **78 files, 1698 tests passed, 0 failed** — identical
  to the pre-change baseline (1698). No tests weakened, deleted, or added.
- Playwright e2e not run: it needs a full electron build (`npm run e2e`), not part of
  `npm test`. The screen changes are DOM-identical (same testids, same wording, same aria
  strings), so the e2e specs are unaffected.

## Concerns

- None material. The one judgment call worth flagging: I diverged from the plan on three
  S6 sub-items (`clamp01`/`pct`/`inBb`) because they are not actually behavior-identical
  or would add coupling — see above. If a maintainer wants them unified, `pct` and `inBb`
  need a decision on which rounding/return-type wins, and `clamp01` needs sign-off on
  giving `progress.ts` its first import.
