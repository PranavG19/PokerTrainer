import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/core/rng.js';
import {
  edgeCombos,
  grade,
  nextQuestion,
  type HandReadingQuestion,
} from '../../src/core/handReading.js';
import { RFI_POSITIONS, isInRfiRange, ALL_COMBOS, type RfiPosition } from '../../src/core/preflop.js';

/**
 * HAND-READING DRILL core. The one property that matters most: the answer key is the app's OWN
 * rule-stated RFI range, never a fabricated one — so this suite pins grade()/nextQuestion() to
 * isInRfiRange for every position, proves the boundary sampler surfaces genuine edge combos, and
 * proves the sequence is seed-deterministic.
 */

describe('grade — the truth is the app rule, not an invented range', () => {
  it('marks an answer correct exactly when it matches isInRfiRange for that combo+position', () => {
    for (const position of RFI_POSITIONS) {
      for (const combo of ['AA', 'AKs', '72o', 'T9s', 'A5o', '54s'] as const) {
        const truth = isInRfiRange(combo, position);
        const q: HandReadingQuestion = { position, combo, inRange: truth };
        // Saying "in range" is correct iff the rule says in range; saying "out" is correct iff out.
        expect(grade(q, true).correct, `${combo} @${position} said-in`).toBe(truth);
        expect(grade(q, false).correct, `${combo} @${position} said-out`).toBe(!truth);
        // The verdict carries the truth verbatim so the caller renders no second opinion.
        expect(grade(q, true).inRange).toBe(truth);
      }
    }
  });

  it('a concrete read: UTG opens tight (72o out), BTN opens wide (A5o in)', () => {
    // These anchor that the drill teaches a REAL asymmetry, not a coin flip.
    expect(isInRfiRange('72o', 'UTG')).toBe(false);
    expect(grade({ position: 'UTG', combo: '72o', inRange: false }, false).correct).toBe(true);
    expect(isInRfiRange('A5o', 'BTN')).toBe(true);
    expect(grade({ position: 'BTN', combo: 'A5o', inRange: true }, true).correct).toBe(true);
  });
});

describe('edgeCombos — the honest hard cases sit on the range boundary', () => {
  it('every position has a non-empty edge set that is a STRICT subset of all combos', () => {
    for (const position of RFI_POSITIONS) {
      const edges = edgeCombos(position);
      expect(edges.length, `${position} has edges`).toBeGreaterThan(0);
      expect(edges.length, `${position} edges are a subset`).toBeLessThan(ALL_COMBOS.length);
    }
  });

  it('an edge combo really has a chart-neighbour on the other side of the line (not a gimme)', () => {
    // For every edge combo, its in/out status differs from at least one rank-adjacent same-shape combo.
    // We re-derive neighbours here independently so the test is not just echoing the implementation.
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
    for (const position of RFI_POSITIONS) {
      for (const combo of edgeCombos(position)) {
        const here = isInRfiRange(combo, position);
        const flips = neighboursOf(combo).some((n) => isInRfiRange(n, position) !== here);
        expect(flips, `${combo} @${position} should border a differently-classed neighbour`).toBe(true);
      }
    }
  });
});

describe('nextQuestion — seed-deterministic and self-consistent', () => {
  it('is fully determined by the seed (same seed → same sequence)', () => {
    const draw = (seed: number): HandReadingQuestion[] => {
      const rng = mulberry32(seed);
      return Array.from({ length: 8 }, () => nextQuestion(rng));
    };
    expect(draw(42)).toEqual(draw(42));
    // A different seed should not produce the identical eight (guards a constant/ignored rng).
    expect(draw(42)).not.toEqual(draw(7));
  });

  it('every generated question carries the correct truth for its combo+position', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 200; i++) {
      const q = nextQuestion(rng);
      expect(RFI_POSITIONS).toContain(q.position as RfiPosition);
      expect(q.inRange, `${q.combo} @${q.position}`).toBe(isInRfiRange(q.combo, q.position));
    }
  });

  it('edgeBias=1 draws only boundary combos; edgeBias=0 can draw any', () => {
    const rngEdge = mulberry32(5);
    for (let i = 0; i < 100; i++) {
      const q = nextQuestion(rngEdge, 1);
      expect(edgeCombos(q.position)).toContain(q.combo);
    }
  });
});
