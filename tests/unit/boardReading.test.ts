import { describe, it, expect } from 'vitest';
import { nextQuestion, grade } from '../../src/core/boardReading.js';
import { evaluate, HandCategory } from '../../src/core/evaluate.js';
import { RT_THRESHOLD_MS } from '../../src/core/anomaly.js';
import { mulberry32 } from '../../src/core/rng.js';
import type { BoardReadingQuestion } from '../../src/core/boardReading.js';

describe('boardReading — stimulus generation', () => {
  it('is fully seed-determined: same seed yields the identical question', () => {
    const a = nextQuestion(mulberry32(42));
    const b = nextQuestion(mulberry32(42));
    expect(a).toEqual(b);
  });

  it('deals seven distinct cards (two hole + five board)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const q = nextQuestion(mulberry32(seed));
      const all = [...q.hole, ...q.board];
      expect(all).toHaveLength(7);
      expect(new Set(all).size).toBe(7);
    }
  });

  // The load-bearing honesty invariant: the answer key IS evaluate() over the seven cards, nothing
  // else. If nextQuestion ever fabricated or reshaped the category, this equality breaks. It is the
  // mutation guard that keeps "the rules of poker" the only source of truth for the drill.
  it('categorises every board by evaluate() of the seven cards — no other source', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const q = nextQuestion(mulberry32(seed));
      expect(q.category).toBe(evaluate([...q.hole, ...q.board]).category);
    }
  });
});

describe('boardReading — grading and the fluency gate', () => {
  const straightQ: BoardReadingQuestion = {
    hole: ['9s', '8d'],
    board: ['7c', '6h', '5s', 'Kd', '2c'],
    category: HandCategory.Straight,
  };

  it('confirms the fixture is a genuine straight (built from the same evaluator)', () => {
    expect(evaluate([...straightQ.hole, ...straightQ.board]).category).toBe(HandCategory.Straight);
  });

  it('correct AND fast is a pass', () => {
    const v = grade(straightQ, HandCategory.Straight, 800);
    expect(v).toMatchObject({ correct: true, fast: true, pass: true });
  });

  it('correct but slow is not a pass (silence is not the reward; fluency is both)', () => {
    const v = grade(straightQ, HandCategory.Straight, RT_THRESHOLD_MS + 1);
    expect(v).toMatchObject({ correct: true, fast: false, pass: false });
  });

  it('wrong category never passes, however fast', () => {
    const v = grade(straightQ, HandCategory.TwoPair, 10);
    expect(v).toMatchObject({ correct: false, fast: true, pass: false });
    expect(v.category).toBe(HandCategory.Straight);
    expect(v.chosen).toBe(HandCategory.TwoPair);
  });

  it('the gate is inclusive at the boundary: rt exactly at the threshold is fast', () => {
    expect(grade(straightQ, HandCategory.Straight, RT_THRESHOLD_MS).fast).toBe(true);
    expect(grade(straightQ, HandCategory.Straight, RT_THRESHOLD_MS + 0.001).fast).toBe(false);
  });
});
