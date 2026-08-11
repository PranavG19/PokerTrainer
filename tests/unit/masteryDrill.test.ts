import { describe, expect, it } from 'vitest';
import { classDrawWeight, pickWeightedClass, type ClassTally } from '../../src/core/masteryDrill.js';
import { mulberry32 } from '../../src/core/rng.js';

const tally = (attempts: number, correct: number): ClassTally => ({ attempts, correct });

describe('classDrawWeight', () => {
  it('gives an unseen class more weight than any class with a baseline', () => {
    const unseen = classDrawWeight(tally(0, 0));
    // The worst possible seen class: every attempt missed. Even that must not outrank the unseen one,
    // so the drill establishes a baseline on every class before fine-tuning the ones it has data on.
    const allMissed = classDrawWeight(tally(20, 0));
    expect(unseen).toBeGreaterThan(allMissed);
  });

  it('weights a class that misses more strictly above one that misses less', () => {
    const mostlyRight = classDrawWeight(tally(10, 9));
    const mostlyWrong = classDrawWeight(tally(10, 2));
    expect(mostlyWrong).toBeGreaterThan(mostlyRight);
  });

  it('never starves a fully mastered class — its weight stays strictly positive', () => {
    const mastered = classDrawWeight(tally(50, 50));
    expect(mastered).toBeGreaterThan(0);
  });

  it('does not treat a lucky single attempt as mastery', () => {
    // A 1/1 class should still outweigh a genuinely-mastered 20/20 one: one rep is not evidence.
    expect(classDrawWeight(tally(1, 1))).toBeGreaterThan(classDrawWeight(tally(20, 20)));
  });

  it('is monotonic in misses at a fixed attempt count', () => {
    const weights = [0, 1, 2, 3, 4, 5].map((correct) => classDrawWeight(tally(5, correct)));
    // More correct (fewer misses) → strictly less weight, all the way down.
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });
});

describe('pickWeightedClass', () => {
  it('returns 0 for an empty list rather than indexing undefined', () => {
    expect(pickWeightedClass([], mulberry32(1))).toBe(0);
  });

  it('always returns an in-range index', () => {
    const tallies = [tally(0, 0), tally(3, 3), tally(5, 1)];
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i += 1) {
      const index = pickWeightedClass(tallies, rng);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(tallies.length);
    }
  });

  it('draws the weakest class more often than the strongest over many samples', () => {
    // Index 0 mastered, index 1 middling, index 2 failing hard. Over many draws the failing class
    // must come up most and the mastered one least — the whole point of the weighting.
    const tallies = [tally(30, 30), tally(30, 20), tally(30, 3)];
    const rng = mulberry32(7);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i += 1) counts[pickWeightedClass(tallies, rng)] += 1;
    expect(counts[2]).toBeGreaterThan(counts[1]);
    expect(counts[1]).toBeGreaterThan(counts[0]);
  });

  it('is deterministic given the same seed and tallies', () => {
    const tallies = [tally(0, 0), tally(4, 1), tally(9, 8)];
    const draw = (): number[] => {
      const rng = mulberry32(2024);
      return Array.from({ length: 20 }, () => pickWeightedClass(tallies, rng));
    };
    expect(draw()).toEqual(draw());
  });
});
