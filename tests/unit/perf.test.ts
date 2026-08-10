import { beforeAll, describe, expect, it } from 'vitest';
import { freshDeck } from '../../src/core/cards.js';
import { evaluate } from '../../src/core/evaluate.js';
import { equityVsRandom } from '../../src/core/equity.js';
import { mulberry32, shuffle } from '../../src/core/rng.js';
import {
  applyAction,
  createTable,
  legalActions,
  settle,
  startHand,
  type ActionKind,
  type TableState,
} from '../../src/core/table.js';
import {
  assembleInterleavedBlock,
  partitionByModule,
  type BlockItem,
  type ModuleId,
} from '../../src/core/interleave.js';

/**
 * PERFORMANCE REGRESSION SUITE for the Offsuit hot paths.
 *
 * WHY THIS SUITE IS BUILT THE WAY IT IS — read before touching a budget.
 *
 * The hot ops here were benchmarked (BENCHMARKS.md) and each carries a "suggested budget" that is
 * ~4.5x the observed median. That headroom is deliberate: the benchmarking machine was under heavy
 * multi-agent load, and a CI box may be busier still, so an absolute-millisecond gate must be loose
 * enough never to flake. But a gate that loose CANNOT catch a genuine 2-3x regression — a 316ms
 * evaluate batch that regresses to 900ms still sails under a 1500ms ceiling. An absolute check that
 * is safe from false positives is therefore useless as a real signal, and one tight enough to be a
 * real signal is a flake factory on a shared runner. There is no single absolute number that is both.
 *
 * THE FIX: SELF-SCALING RELATIVE CHECK. Every hot op is timed in the SAME run as a fixed "calibration"
 * op — a trivial integer-arithmetic loop with no dependency on any code under test. We assert that the
 * hot op costs no more than N calibration-units, not that it costs under M milliseconds. When the
 * machine is loaded, BOTH the calibration op and the hot op slow down proportionally, so the ratio
 * holds; the threshold self-scales to the machine. Measured here: across independent runs the machine
 * absolute times swing but each ratio stays within ~5-10% (see BENCHMARKS.md). The ratio budgets are
 * set at ~1.7x the observed baseline ratio — comfortably above that ~10% noise (no false positives)
 * yet strictly below 2x (so a real 2x code slowdown, which lifts the ratio ~2x while calibration is
 * unchanged, trips the gate). This is the assertion that carries the regression signal.
 *
 * SECONDARY ABSOLUTE GATE. Each op ALSO asserts its measured median under the JSON "suggested budget".
 * This is a loose catastrophe/sanity guard only (it has ~4.5x headroom and will not catch a 2-3x
 * regression); it exists to honor "assert the median stays under the suggested budget" and to flag a
 * pathological blow-up or a broken calibration op. The RELATIVE check above is the real signal.
 *
 * PROTOCOL, matching how the baselines were measured: warm up, run several batches, take the MEDIAN
 * batch (never the max — a single scheduler hiccup must not fail the suite), fixed mulberry32 seeds so
 * the work is deterministic, one-time input construction excluded from every timed loop.
 */

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Warm up, then return the median wall-time (ms) of `batches` batches of `iters` calls each. */
function benchBatchMedian(fn: () => void, warmups: number, batches: number, iters: number): number {
  for (let w = 0; w < warmups; w++) for (let i = 0; i < iters; i++) fn();
  const times: number[] = [];
  for (let b = 0; b < batches; b++) {
    const start = performance.now();
    for (let i = 0; i < iters; i++) fn();
    times.push(performance.now() - start);
  }
  return median(times);
}

/**
 * The machine-speed yardstick. A fixed LCG grind with no reference to any src/core code, so a
 * regression in the poker engine cannot move it. `calibAcc` is module-level and fed back into the loop
 * so V8 cannot eliminate the work as dead. Sized (80k iters x 64 steps) to land near ~5ms/batch — long
 * enough that performance.now() jitter is negligible, short enough to stay cheap.
 */
let calibAcc = 0;
const CALIB_ITERS = 80_000;
const CALIB_STEPS = 64;
function calibrationOp(): void {
  let x = calibAcc >>> 0;
  for (let k = 0; k < CALIB_STEPS; k++) x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  calibAcc = x & 255;
}

let calibrationMs = 0;
beforeAll(() => {
  // Measure once, up front, and reuse for every ratio in this file so all ratios share one yardstick.
  calibrationMs = benchBatchMedian(calibrationOp, 3, 11, CALIB_ITERS);
});

// ── Fixtures (built once, OUTSIDE every timed loop) ───────────────────────────

// 200k deterministic pre-built 7-card hands (mulberry32 seed 20250809), hand construction excluded
// from timing exactly as the baseline specified.
const rngEval = mulberry32(20250809);
const EVAL_HANDS: string[][] = [];
for (let i = 0; i < 200_000; i++) EVAL_HANDS.push(shuffle(freshDeck(), rngEval).slice(0, 7));

const sixSeats = () =>
  Array.from({ length: 6 }, (_, i) => ({ name: `p${i}`, stack: 1000, isHero: i === 0 }));
const BASE_TABLE = createTable({ seats: sixSeats(), sb: 25, bb: 50, seed: 424242 });
const DEALT = startHand(BASE_TABLE);

/** One passive check/call-down hand: deal -> settle, mirroring the baseline "full hand" op. */
function playFullHand(): TableState {
  let s = startHand(BASE_TABLE);
  let guard = 0;
  while (s.street !== 'showdown' && guard++ < 40) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    const kind: ActionKind = legal.includes('check') ? 'check' : 'call';
    s = applyAction(s, { kind });
  }
  return settle(s);
}

const spot = (spotClass: string, module: ModuleId, rung = 2): BlockItem => ({ spotClass, module, rung });

/** A 20-spot spec-legal preflop block (>=7 classes, rung 2, no adjacent repeats): the accept path. */
const LEGAL_BLOCK: BlockItem[] = [
  spot('K7s-CO', 'preflop-rfi'),
  spot('K7o-CO', 'preflop-rfi'),
  spot('K9s-CO', 'preflop-rfi'),
  spot('K7s-UTG', 'preflop-rfi'),
  spot('K7s-vs-UTG-open', 'preflop-vs-open'),
  spot('K9o-BTN', 'preflop-rfi'),
  spot('A5s-SB', 'preflop-rfi'),
  spot('Q9s-CO', 'preflop-rfi'),
  spot('ATo-UTG', 'preflop-rfi'),
  spot('98s-BTN', 'preflop-rfi'),
  spot('KQo-vs-UTG-open', 'preflop-vs-open'),
  spot('JTs-CO', 'preflop-rfi'),
  spot('A9s-HJ', 'preflop-rfi'),
  spot('KJs-CO', 'preflop-rfi'),
  spot('T9s-BTN', 'preflop-rfi'),
  spot('QJs-CO', 'preflop-rfi'),
  spot('A8s-CO', 'preflop-rfi'),
  spot('K9s-UTG', 'preflop-rfi'),
  spot('76s-BTN', 'preflop-rfi'),
  spot('55-CO', 'preflop-rfi'),
];

/** 20-spot mix spanning three low-similarity modules: the partition input / assemble refuse path. */
const MIXED_BLOCK: BlockItem[] = [
  ...LEGAL_BLOCK.slice(0, 10),
  spot('pot-odds-1', 'pot-odds-arithmetic'),
  spot('variance-1', 'variance'),
  ...LEGAL_BLOCK.slice(10, 18),
];

// ── Baseline ratios (target-op batch / calibration batch), measured on a machine matching the JSON
// baselines, taken as the max over 3 independent runs. Budgets = ~1.7x baseline: > ~10% ratio noise
// (no flakes) and < 2x (catches a 2-3x regression). See BENCHMARKS.md for the derivation. ──────────

interface Case {
  readonly name: string;
  readonly run: () => number; // returns the measured median batch (ms) for the hot op
  readonly maxRatio: number; // relative gate — the real regression signal
  readonly baselineRatio: number; // documented observed ratio, for the failure message
  readonly absBudgetMs: number; // loose secondary gate (from JSON suggestedBudgetMs)
  readonly absLabel: string;
}

const CASES: Case[] = [
  {
    name: 'evaluate() — 200k pre-built 7-card hands',
    run: () => {
      let idx = 0;
      return benchBatchMedian(() => {
        evaluate(EVAL_HANDS[idx++ % EVAL_HANDS.length]);
      }, 3, 11, 200_000);
    },
    baselineRatio: 60,
    maxRatio: 100,
    absBudgetMs: 1500,
    absLabel: '200k-call batch median',
  },
  {
    name: 'equityVsRandom() — flop, 2 opponents, 2000 iters',
    run: () => benchBatchMedian(() => {
      equityVsRandom(['As', 'Kd'], ['Qh', '7c', '2s'], 2, 2000, 42);
    }, 3, 15, 1),
    baselineRatio: 1.9,
    maxRatio: 3.2,
    absBudgetMs: 45,
    absLabel: 'single 2000-iter run median',
  },
  {
    name: 'equityVsRandom() — preflop, 3 opponents, 2000 iters (heaviest spot)',
    run: () => benchBatchMedian(() => {
      equityVsRandom(['Td', '9d'], [], 3, 2000, 12345);
    }, 3, 15, 1),
    baselineRatio: 2.65,
    maxRatio: 4.5,
    absBudgetMs: 60,
    absLabel: 'single 2000-iter run median',
  },
  {
    name: 'applyAction() — one call on a dealt state',
    run: () => benchBatchMedian(() => {
      applyAction(DEALT, { kind: 'call' });
    }, 2, 9, 5_000),
    baselineRatio: 9.5,
    maxRatio: 16,
    absBudgetMs: 250, // JSON per-op budget 0.05ms x 5000 iters
    absLabel: '5000-call batch median',
  },
  {
    name: 'full hand — startHand -> check/call-down -> settle',
    run: () => benchBatchMedian(playFullHand, 2, 9, 300),
    baselineRatio: 11.8,
    maxRatio: 20,
    absBudgetMs: 300, // JSON per-op budget 1ms x 300 iters
    absLabel: '300-hand batch median',
  },
  {
    name: 'assembleInterleavedBlock() — 20-spot legal block (accept path)',
    run: () => benchBatchMedian(() => {
      assembleInterleavedBlock({ items: LEGAL_BLOCK, preframeShown: true });
    }, 3, 9, 12_000),
    baselineRatio: 9.6,
    maxRatio: 16,
    absBudgetMs: 150, // JSON per-op budget 0.0125ms x 12000 iters
    absLabel: '12000-call batch median',
  },
  {
    name: 'partitionByModule() — 20-spot mixed proposal',
    run: () => benchBatchMedian(() => {
      partitionByModule(MIXED_BLOCK);
    }, 3, 9, 12_000),
    baselineRatio: 6.2,
    maxRatio: 11,
    absBudgetMs: 150, // JSON per-op budget 0.0125ms x 12000 iters
    absLabel: '12000-call batch median',
  },
];

describe('performance regression — hot paths (self-scaling relative gates + loose absolute guards)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const batchMs = c.run();
      const ratio = batchMs / calibrationMs;

      // PRIMARY, real signal: self-scaling relative gate. Catches a 2-3x regression regardless of
      // machine speed or load, because a code slowdown lifts `ratio` while `calibrationMs` is fixed.
      expect(
        ratio,
        `${c.name}: measured ratio ${ratio.toFixed(2)}x calibration ` +
          `(baseline ~${c.baselineRatio}x, gate ${c.maxRatio}x; abs ${batchMs.toFixed(2)}ms, calib ${calibrationMs.toFixed(2)}ms). ` +
          `Gate is <2x baseline so a genuine 2-3x regression trips it.`,
      ).toBeLessThan(c.maxRatio);

      // SECONDARY, loose catastrophe/sanity guard only (~4.5x headroom; will NOT catch a 2-3x
      // regression — that is the relative gate's job).
      expect(
        batchMs,
        `${c.name}: ${c.absLabel} ${batchMs.toFixed(2)}ms exceeded loose ceiling ${c.absBudgetMs}ms`,
      ).toBeLessThan(c.absBudgetMs);
    });
  }
});
