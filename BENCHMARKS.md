# Performance benchmarks & regression gates

This documents the measured baselines for the Offsuit poker-engine hot paths, the thresholds the
regression suite enforces, how to run it, and why it is built to not flake on a busy machine.

The gate lives in `tests/unit/perf.test.ts` and runs as an ordinary unit test.

## How to run

```bash
npx vitest run tests/unit/perf.test.ts
```

Runs single-worker in ~7-8s. It was run 3x back-to-back on the reference machine and passed all three
(see "Non-flakiness" below).

## The machine caveat (read this first)

The baselines below were measured with `npx tsx` (Node v25.9.0 / V8, `performance.now()`), warmed up,
over multiple batches, median reported — **while the machine was under heavy multi-agent load**.
Absolute numbers are therefore inflated versus a quiet machine, and a CI runner may be busier still.
Two consequences drive the whole design:

1. **Absolute-millisecond budgets carry ~4.5x headroom** so they never false-positive under load. That
   headroom makes them useless as a regression signal on their own: a 316 ms `evaluate` batch could
   regress to 900 ms and still pass a 1500 ms ceiling.
2. **A budget tight enough to catch a 2-3x regression would flake** on a shared runner, where absolute
   times swing wildly.

No single absolute number is both flake-proof and sensitive. So the suite's real signal is a
**self-scaling relative check**, with the absolute budget kept only as a loose catastrophe guard.

## Measured baselines (reference machine, under load)

Per-op figures are the source-of-truth benchmark numbers. Absolute times match the reference machine
this suite was authored on (`evaluate` 200k batch ~310 ms vs. the 336.7 ms external baseline; equity
flop-2opp ~9.5 ms vs. 10.3 ms), i.e. this machine reproduces the published baselines.

| Hot op | Work per timed unit | Median (this machine) | JSON suggested budget | Per-op |
|---|---|---|---|---|
| `evaluate()` | 200,000 calls on pre-built 7-card hands | ~310 ms / batch | 1500 ms | ~1.55 us |
| `equityVsRandom()` flop, 2 opp | one 2000-iter MC run (As Kd / Qh 7c 2s) | ~9.5 ms | 45 ms | — |
| `equityVsRandom()` preflop, 3 opp | one 2000-iter MC run (Td 9d, heaviest) | ~13.5 ms | 60 ms | — |
| `applyAction()` | 5,000 `call` applications (JSON deep-clone dominated) | ~48 ms / batch | 250 ms (0.05 ms x 5000) | ~9.6 us |
| full hand deal→settle | 300 hands, passive check/call-down, 6-handed | ~61 ms / batch | 300 ms (1 ms x 300) | ~0.2 ms |
| `assembleInterleavedBlock()` accept | 12,000 calls, 20-spot legal preflop block | ~49 ms / batch | 150 ms (0.0125 ms x 12000) | ~4.1 us |
| `partitionByModule()` | 12,000 calls, 20-spot mixed proposal | ~32 ms / batch | 150 ms (0.0125 ms x 12000) | ~2.7 us |

`exactEquityHeadsUp()` is intentionally NOT gated: its cost varies enormously with board completeness
(`need=5` enumerates C(45,5) ~1.2M combos) and it is not the per-hand/per-decision loop this suite
targets.

## The two gates each op asserts

### 1. Self-scaling relative gate — the real regression signal

Every hot op is timed in the **same run** as a fixed **calibration op**: a trivial integer LCG grind
(`Math.imul`-based, 80k iters x 64 steps, ~5 ms/batch) with **no dependency on any code under test**,
whose accumulator is fed back so V8 cannot dead-code it. The test asserts

```
median(hot op batch) / median(calibration batch)  <  maxRatio
```

When the machine is loaded, the calibration op and the hot op slow down together, so the **ratio is
stable** even as absolute times move. Measured ratio stability across independent runs on the
reference machine (each within ~5-10%):

| Op | Baseline ratio (max over 3 runs) | `maxRatio` gate | Gate as x baseline |
|---|---|---|---|
| `evaluate()` | ~60 | 100 | 1.67x |
| equity flop-2opp | ~1.9 | 3.2 | 1.68x |
| equity preflop-3opp | ~2.65 | 4.5 | 1.70x |
| `applyAction()` | ~9.5 | 16 | 1.68x |
| full hand | ~11.8 | 20 | 1.69x |
| `assembleInterleavedBlock()` | ~9.6 | 16 | 1.67x |
| `partitionByModule()` | ~6.2 | 11 | 1.77x |

Each gate sits at **~1.7x the baseline ratio**: comfortably above the ~10% run-to-run ratio noise (no
false positives) yet strictly **below 2x**, so a genuine 2x code slowdown — which lifts the ratio ~2x
while the calibration op is unchanged — trips it. This was verified empirically: a simulated ~2.5x
`evaluate` regression pushed its ratio to 121 (> 100, TRIPS) and a simulated ~2x equity regression
pushed its ratio to 3.72 (> 3.2, TRIPS). The green result is therefore meaningful, not vacuous.

### 2. Absolute-ms gate — loose catastrophe/sanity guard only

Each op also asserts its measured median under the JSON `suggestedBudgetMs` (scaled to batch size for
the per-op benchmarks). This honors "assert the median stays under the suggested budget" and catches a
pathological blow-up or a broken calibration op. It carries ~4.5x headroom and by design will **not**
catch a 2-3x regression — that is the relative gate's job.

## Protocol (matches how baselines were measured)

- **Warm up** before timing (3 batches for the tight loops, 2 for the heavier ones).
- **Median of several batches**, never the max — one scheduler hiccup must not fail the suite.
- **Fixed `mulberry32` seeds** so the work is fully deterministic (eval hands seed 20250809; equity
  seeds 42 / 12345; table seed 424242).
- **One-time input construction is excluded from every timed loop** (the 200k hands, the base table,
  and the interleave fixtures are built once at module load).

## Non-flakiness

`npx vitest run tests/unit/perf.test.ts` was run 3x consecutively on the reference machine: 7/7 tests
passed each time. Because the primary gate is a ratio to an in-run yardstick rather than an absolute
time, the result is stable across machine speed and load.

## If a gate ever needs re-baselining

Re-measure on a representative machine, update the `baselineRatio` values in `CASES`
(`tests/unit/perf.test.ts`) and this file, and keep each `maxRatio` at ~1.7x its baseline ratio so the
"< 2x regression trips it" property holds. The dominant cost in `applyAction`/`settle`/full-hand is
the `JSON.parse(JSON.stringify())` deep clone on every transition, not the poker logic — worth knowing
if those ratios move.
