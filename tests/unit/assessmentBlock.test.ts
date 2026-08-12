import { describe, it, expect } from 'vitest';
import { AssessmentBlock } from '../../src/core/assessmentBlock.js';
import type { ActionKind } from '../../src/core/table.js';

/**
 * ASSESSMENT BLOCK ENGINE — the pure host behind the weekly assessment. These tests pin the honesty and
 * safety properties a browser test cannot see cheaply: the block always terminates, only ever accepts a
 * legal action, grades every hero decision with a non-negative EV loss, is fully reproducible from its
 * seed, and rotates the button so the hero is assessed across positions (not stuck in one seat). The
 * grade values themselves are coach.gradeDecision's job and tested there; this module must not re-grade.
 */

/** A naive but always-legal policy: check when free, else call, else fold. Enough to drive a block. */
function naive(legal: readonly ActionKind[]): ActionKind {
  if (legal.includes('check')) return 'check';
  if (legal.includes('call')) return 'call';
  return 'fold';
}

/** Play a whole block with `pick`, returning every graded decision. Guarded so a bug cannot hang the run. */
function playBlock(size: number, seed: number, pick: (legal: readonly ActionKind[]) => ActionKind = naive) {
  const block = new AssessmentBlock({ size, seed });
  let guard = 0;
  while (!block.isDone() && guard < size * 100 + 100) {
    const spot = block.current();
    expect(spot, 'a live block must expose a current spot').not.toBeNull();
    // Every action the caller commits must be one the block declared legal.
    const choice = pick(spot!.legal);
    expect(spot!.legal, 'picked action must be legal').toContain(choice);
    block.commit(choice);
    guard += 1;
  }
  expect(block.isDone(), 'block must terminate within the guard').toBe(true);
  return block;
}

describe('AssessmentBlock — termination and shape', () => {
  it('deals exactly `size` hands and grades at least one decision per hand', () => {
    const block = playBlock(12, 42);
    const grades = block.grades();
    expect(grades.length).toBe(block.count);
    // Every hand from 1..size appears (the hero acts in every hand at 100bb 4-handed).
    const hands = new Set(grades.map((g) => g.hand));
    expect(hands.size).toBe(12);
    expect(Math.min(...hands)).toBe(1);
    expect(Math.max(...hands)).toBe(12);
    expect(block.plannedHands).toBe(12);
  });

  it('indexes graded decisions consecutively from 0', () => {
    const grades = playBlock(6, 3).grades();
    expect(grades.map((g) => g.index)).toEqual(grades.map((_g, i) => i));
  });

  it('every graded decision has a finite, non-negative EV loss', () => {
    for (const g of playBlock(10, 99).grades()) {
      expect(Number.isFinite(g.grade.evLossBb)).toBe(true);
      expect(g.grade.evLossBb).toBeGreaterThanOrEqual(0);
      expect(['free', 'notable', 'serious']).toContain(g.grade.severity);
    }
  });

  it('current() is null once the block is done, and commit() after that is a no-op', () => {
    const block = playBlock(3, 1);
    expect(block.current()).toBeNull();
    const before = block.count;
    expect(block.commit('check')).toBeNull();
    expect(block.count).toBe(before);
  });
});

describe('AssessmentBlock — reproducibility', () => {
  it('two blocks with the same seed and policy grade identically', () => {
    const a = playBlock(8, 7).grades().map((g) => `${g.hand}:${g.chosen}:${g.grade.evLossBb.toFixed(4)}`);
    const b = playBlock(8, 7).grades().map((g) => `${g.hand}:${g.chosen}:${g.grade.evLossBb.toFixed(4)}`);
    expect(a).toEqual(b);
  });

  it('different seeds produce different hands (not a fixed script)', () => {
    const a = playBlock(8, 7).grades().map((g) => g.grade.evLossBb.toFixed(4)).join(',');
    const b = playBlock(8, 8).grades().map((g) => g.grade.evLossBb.toFixed(4)).join(',');
    expect(a).not.toBe(b);
  });
});

describe('AssessmentBlock — the hero is assessed across positions', () => {
  it('rotates the button across seats over the block', () => {
    const block = new AssessmentBlock({ size: 8, seed: 5 });
    const dealers = new Set<number>();
    let last = 0;
    let guard = 0;
    while (!block.isDone() && guard < 800) {
      const spot = block.current()!;
      if (spot.hand !== last) {
        dealers.add(spot.table.dealer);
        last = spot.hand;
      }
      block.commit(naive(spot.legal));
      guard += 1;
    }
    // Four seats, button +1 per hand → all four positions occur within the first four hands.
    expect(dealers.size).toBe(4);
  });
});
