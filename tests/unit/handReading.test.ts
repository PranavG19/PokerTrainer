import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng.js';
import {
  edgeCombos,
  grade,
  inReadRange,
  nextQuestion,
  type HandReadingQuestion,
  type ReadScenario,
} from '../../src/core/handReading.js';
import {
  RFI_POSITIONS,
  THREEBET_RESPONSE_WIDTH_ORDER,
  isInRfiRange,
  threeBetResponseAction,
  ALL_COMBOS,
  type RfiPosition,
} from '../../src/core/preflop.js';

/**
 * HAND-READING DRILL core. The property that matters most: the answer key is the app's OWN rule-stated
 * ranges, never fabricated — 'open' reads the RFI range, 'flat-3bet' reads the CAPPED flat-call range
 * (the 'call' subset of the 3-bet response). This suite pins inReadRange/grade/nextQuestion to those
 * rules for both scenarios, proves the boundary sampler surfaces genuine edges, and proves determinism.
 */

const SCENARIOS: ReadScenario[] = ['open', 'flat-3bet'];

describe('inReadRange — the truth is the app rule for each scenario', () => {
  it("'open' is exactly isInRfiRange", () => {
    for (const position of RFI_POSITIONS) {
      for (const combo of ALL_COMBOS) {
        expect(inReadRange('open', combo, position)).toBe(isInRfiRange(combo, position));
      }
    }
  });

  it("'flat-3bet' is exactly the CALL subset of the 3-bet response (4-bets and folds excluded)", () => {
    for (const position of THREEBET_RESPONSE_WIDTH_ORDER) {
      for (const combo of ALL_COMBOS) {
        const expected = threeBetResponseAction(combo, position) === 'call';
        expect(inReadRange('flat-3bet', combo, position as RfiPosition), `${combo}@${position}`).toBe(expected);
      }
    }
  });

  it("'flat-3bet' caps the range: the top value (AA/KK/AK) that 4-bets is NOT a flat-call", () => {
    // The whole teaching point of a capped range: the nuts are gone (they'd have 4-bet).
    for (const position of THREEBET_RESPONSE_WIDTH_ORDER) {
      expect(inReadRange('flat-3bet', 'AA', position as RfiPosition), `AA@${position}`).toBe(false);
      expect(inReadRange('flat-3bet', 'AKs', position as RfiPosition), `AKs@${position}`).toBe(false);
      // And trash is gone too (folded), so a flat-call range is a middle band, not "everything".
      expect(inReadRange('flat-3bet', '72o', position as RfiPosition), `72o@${position}`).toBe(false);
    }
  });

  it("'flat-3bet' at an SB open (no 3-bet-response range) is empty, never throws", () => {
    for (const combo of ['AA', 'T9s', '72o'] as const) {
      expect(inReadRange('flat-3bet', combo, 'SB')).toBe(false);
    }
  });
});

describe('grade — marks correct exactly when the answer matches the scenario rule', () => {
  it('grades both scenarios against their own truth', () => {
    for (const scenario of SCENARIOS) {
      for (const position of THREEBET_RESPONSE_WIDTH_ORDER) {
        for (const combo of ['AA', 'AKs', '72o', 'T9s', 'A5o', '99'] as const) {
          const truth = inReadRange(scenario, combo, position as RfiPosition);
          const q: HandReadingQuestion = { scenario, position: position as RfiPosition, combo, inRange: truth };
          expect(grade(q, true).correct, `${scenario} ${combo}@${position} said-in`).toBe(truth);
          expect(grade(q, false).correct, `${scenario} ${combo}@${position} said-out`).toBe(!truth);
          expect(grade(q, true).inRange).toBe(truth);
        }
      }
    }
  });

  it('a concrete open read: UTG opens tight (72o out), BTN opens wide (A5o in)', () => {
    expect(grade({ scenario: 'open', position: 'UTG', combo: '72o', inRange: false }, false).correct).toBe(true);
    expect(grade({ scenario: 'open', position: 'BTN', combo: 'A5o', inRange: true }, true).correct).toBe(true);
  });
});

describe('edgeCombos — honest hard cases on the boundary, per scenario', () => {
  it('every scenario+position has a non-empty edge set that is a STRICT subset of all combos', () => {
    for (const scenario of SCENARIOS) {
      const seats = scenario === 'flat-3bet' ? THREEBET_RESPONSE_WIDTH_ORDER : RFI_POSITIONS;
      for (const position of seats) {
        const edges = edgeCombos(scenario, position as RfiPosition);
        expect(edges.length, `${scenario} ${position} has edges`).toBeGreaterThan(0);
        expect(edges.length, `${scenario} ${position} subset`).toBeLessThan(ALL_COMBOS.length);
      }
    }
  });

  it('an edge combo really borders a chart-neighbour on the other side of the line', () => {
    const ranks = 'AKQJT98765432';
    const neighboursOf = (combo: string): string[] => {
      const step = (r: string, by: number): string | null => {
        const i = ranks.indexOf(r);
        const j = i + by;
        return i >= 0 && j >= 0 && j < ranks.length ? ranks[j] : null;
      };
      if (combo.length === 2 && combo[0] === combo[1]) {
        return [-1, 1].map((b) => step(combo[0], b)).filter((r): r is string => !!r).map((r) => `${r}${r}`);
      }
      const [hi, lo, s] = combo;
      return [-1, 1]
        .map((b) => step(lo, b))
        .filter((r): r is string => !!r && r !== hi)
        .map((r) => `${hi}${r}${s}`)
        .filter((c) => ALL_COMBOS.includes(c));
    };
    for (const scenario of SCENARIOS) {
      const seats = scenario === 'flat-3bet' ? THREEBET_RESPONSE_WIDTH_ORDER : RFI_POSITIONS;
      for (const position of seats) {
        for (const combo of edgeCombos(scenario, position as RfiPosition)) {
          const here = inReadRange(scenario, combo, position as RfiPosition);
          const flips = neighboursOf(combo).some(
            (n) => inReadRange(scenario, n, position as RfiPosition) !== here,
          );
          expect(flips, `${scenario} ${combo}@${position} borders a different-classed neighbour`).toBe(true);
        }
      }
    }
  });
});

describe('nextQuestion — seed-deterministic and self-consistent across both scenarios', () => {
  it('is fully determined by the seed (same seed → same sequence)', () => {
    const draw = (seed: number): HandReadingQuestion[] => {
      const rng = mulberry32(seed);
      return Array.from({ length: 12 }, () => nextQuestion(rng));
    };
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(7));
  });

  it('every generated question carries the correct truth for its scenario+combo+position', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 300; i++) {
      const q = nextQuestion(rng);
      expect(SCENARIOS).toContain(q.scenario);
      // A flat-3bet question never lands on a seat without a 3-bet-response range.
      if (q.scenario === 'flat-3bet') {
        expect(THREEBET_RESPONSE_WIDTH_ORDER).toContain(q.position as (typeof THREEBET_RESPONSE_WIDTH_ORDER)[number]);
      } else {
        expect(RFI_POSITIONS).toContain(q.position);
      }
      expect(q.inRange, `${q.scenario} ${q.combo}@${q.position}`).toBe(inReadRange(q.scenario, q.combo, q.position));
    }
  });

  it('both scenarios actually occur over a run (the mix is not stuck on one)', () => {
    const rng = mulberry32(99);
    const seen = new Set<ReadScenario>();
    for (let i = 0; i < 50; i++) seen.add(nextQuestion(rng).scenario);
    expect(seen).toEqual(new Set(['open', 'flat-3bet']));
  });

  it('edgeBias=1 draws only boundary combos for its scenario', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const q = nextQuestion(rng, 1);
      expect(edgeCombos(q.scenario, q.position)).toContain(q.combo);
    }
  });
});
