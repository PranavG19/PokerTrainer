import { describe, it, expect } from 'vitest';
import {
  DEPTHS,
  FORM_WINDOW,
  MIN_CONTESTED,
  MIN_FORM_SAMPLE,
  currentForm,
  depthLabel,
  depthToStack,
  affordableStack,
  masteryGate,
  playGate,
  playScore,
  puzzleCoverage,
  standing,
  type StandingDecision,
} from '../../src/core/standing.js';

/**
 * STANDING ("Depth") CORE — the honest, non-punishing ranking metric. These tests pin the properties the
 * design's adversarial critique flagged as the ones most likely to be wrong:
 *  1. a bust/loss cannot move standing (it reads decision quality, never chips);
 *  2. the 'value or bluff' coach charges are EXCLUDED (the coach has no fold-equity model, so ranking on
 *     them would train nitty play);
 *  3. free-fold padding (toCall === 0) is excluded so it cannot buy depth;
 *  4. a thin/lucky sample scores WORSE via the CI-upper bound;
 *  5. the ratchet floor never lets displayed depth drop.
 */

const DAY = 86_400_000;
const NOW = 1_000 * DAY; // an arbitrary fixed clock; tests pass timestamps explicitly (no Date.now()).

function decision(overrides: Partial<StandingDecision> = {}): StandingDecision {
  return { at: NOW, evLossBb: 0, principle: 'pot odds', toCall: 50, street: 'flop', ...overrides };
}

/** N clean, contested, sound-math decisions costing `evLossBb` each. */
function block(n: number, evLossBb: number, overrides: Partial<StandingDecision> = {}): StandingDecision[] {
  return Array.from({ length: n }, () => decision({ evLossBb, ...overrides }));
}

describe('playScore eligibility and contested filters', () => {
  it('excludes value-or-bluff charges entirely (the coach has no fold-equity model)', () => {
    // A big pile of 'value or bluff' leaks must NOT enter the sample — so the score stays calibrating.
    const bluffLeaks = block(MIN_CONTESTED + 10, 5, { principle: 'value or bluff' });
    const score = playScore(bluffLeaks, NOW);
    expect(score.status).toBe('calibrating');
    expect(score.sample).toBe(0);
  });

  it('excludes free-fold padding: toCall === 0 decisions carry no information', () => {
    const freeFolds = block(MIN_CONTESTED + 10, 0, { principle: null, toCall: 0 });
    const score = playScore(freeFolds, NOW);
    expect(score.status).toBe('calibrating');
    expect(score.sample).toBe(0);
  });

  it('keeps sound pot-odds/ranges charges and free contested plays', () => {
    const sound = [
      ...block(20, 1, { principle: 'pot odds' }),
      ...block(20, 1, { principle: 'ranges' }),
      // A free (zero-cost) but contested decision is a correct play on its merits.
      ...block(5, 0, { principle: null }),
    ];
    const score = playScore(sound, NOW);
    expect(score.status).toBe('scored');
    expect(score.sample).toBe(45);
  });
});

describe('playScore is calibrating below the sample floor', () => {
  it('returns calibrating with no depth under MIN_CONTESTED eligible decisions', () => {
    const score = playScore(block(MIN_CONTESTED - 1, 0.5), NOW);
    expect(score.status).toBe('calibrating');
    expect(playGate(score)).toBe(0);
  });
});

describe('the CI-upper bound punishes a thin/lucky sample', () => {
  it('a small clean sample scores WORSE (higher) than a large clean sample with the same mean', () => {
    // Same mean leak (all 1.0 bb), but the smaller sample has a wider band. To compare the band effect we
    // need variance, so use a mix that averages the same in both.
    const smallMix = [...block(Math.ceil(MIN_CONTESTED / 2), 0), ...block(Math.ceil(MIN_CONTESTED / 2), 2)];
    const largeMix = [...block(MIN_CONTESTED * 5, 0), ...block(MIN_CONTESTED * 5, 2)];
    const small = playScore(smallMix, NOW);
    const large = playScore(largeMix, NOW);
    expect(small.status).toBe('scored');
    expect(large.status).toBe('scored');
    // Same underlying mean (~1.0), but the smaller sample's pessimistic bound is higher (worse).
    expect(small.score).toBeGreaterThan(large.score);
  });

  it('a perfectly clean large sample scores near zero and reaches a deep tier', () => {
    const clean = block(MIN_CONTESTED * 4, 0, { street: 'flop' });
    const score = playScore(clean, NOW);
    expect(score.score).toBeCloseTo(0, 6);
    // With enough contested postflop decisions and a ~0 leak, the play gate allows the deepest tier.
    expect(playGate(score)).toBe(200);
  });
});

describe('playGate requires contested POSTFLOP decisions for deep tiers', () => {
  it('a clean but preflop-only sample cannot reach the deep tiers', () => {
    const preflopOnly = block(MIN_CONTESTED * 4, 0, { street: 'preflop' });
    const gate = playGate(playScore(preflopOnly, NOW));
    // Sound and clean, so it earns a shallow tier, but the postflop-gated deep tiers are withheld.
    expect(gate).toBeLessThan(125);
    expect(gate).toBeGreaterThan(0);
  });
});

describe('masteryGate is the study key', () => {
  it('no mastery yields no depth, and depth grows with mastered concepts + puzzle coverage', () => {
    expect(masteryGate(0, 0)).toBe(0);
    expect(masteryGate(2, 1)).toBe(40);
    expect(masteryGate(12, 8)).toBe(200);
  });

  it('mastered KCs without puzzle coverage cannot alone reach a deep tier', () => {
    // 12 mastered KCs but zero puzzles solved: the paired floor holds it back.
    expect(masteryGate(12, 0)).toBe(0);
  });
});

describe('standing combines the gates and ratchets', () => {
  it('is the min of play and mastery gates — you cannot outrun your concepts', () => {
    const cleanDeep = block(MIN_CONTESTED * 4, 0, { street: 'flop' }); // playGate = 200
    const s = standing(
      { decisions: cleanDeep, masteredKcCount: 2, puzzleCoverage: 1, depthFloor: 0 },
      NOW,
    );
    // playGate wants 200, masteryGate allows 40 → min is 40.
    expect(s.current).toBe(40);
    expect(s.depth).toBe(40);
  });

  it('a losing session (a bust) does not move standing — it reads decision quality, not chips', () => {
    // The decisions are clean regardless of the chip outcome; there is no chip input to standing at all.
    const cleanDeep = block(MIN_CONTESTED * 4, 0, { street: 'flop' });
    const before = standing({ decisions: cleanDeep, masteredKcCount: 12, puzzleCoverage: 8, depthFloor: 0 }, NOW);
    // Same decisions after a hypothetical bust (chips are simply not an input) → identical standing.
    const after = standing({ decisions: cleanDeep, masteredKcCount: 12, puzzleCoverage: 8, depthFloor: 0 }, NOW);
    expect(after.depth).toBe(before.depth);
    expect(before.depth).toBe(200);
  });

  it('the ratchet floor never lets displayed depth drop', () => {
    // Current play would only earn a shallow tier, but a deep floor was earned before.
    const shallow = block(MIN_CONTESTED, 2.5, { street: 'flop' });
    const s = standing(
      { decisions: shallow, masteredKcCount: 12, puzzleCoverage: 8, depthFloor: 125 },
      NOW,
    );
    expect(s.floor).toBe(125);
    expect(s.depth).toBe(125); // never below the floor, even though current play is shallower
  });

  it('depth ratchets UP when current exceeds the floor', () => {
    const cleanDeep = block(MIN_CONTESTED * 4, 0, { street: 'flop' });
    const s = standing(
      { decisions: cleanDeep, masteredKcCount: 12, puzzleCoverage: 8, depthFloor: 40 },
      NOW,
    );
    expect(s.current).toBe(200);
    expect(s.depth).toBe(200);
  });
});

describe('puzzleCoverage counts only clean full solves', () => {
  const steps = { a: 1, b: 2, c: 3 };

  it('counts a scenario only when bestCorrect equals its step count', () => {
    const progress = {
      a: { bestCorrect: 1 }, // clean 1/1 → counts
      b: { bestCorrect: 1 }, // 1/2, missed a step → does not count
      c: { bestCorrect: 3 }, // clean 3/3 → counts
    };
    expect(puzzleCoverage(progress, steps)).toBe(2);
  });

  it('ignores scenarios absent from progress and never over-counts', () => {
    expect(puzzleCoverage({}, steps)).toBe(0);
    // A stale record claiming MORE than the steps must not count (corrupt / renamed scenario).
    expect(puzzleCoverage({ a: { bestCorrect: 5 } }, steps)).toBe(0);
  });

  it('ignores a zero-step entry (a scenario with no target is not coverage)', () => {
    expect(puzzleCoverage({ z: { bestCorrect: 0 } }, { z: 0 })).toBe(0);
  });
});

describe('currentForm reads the recent window without touching the floor', () => {
  it('is settling below the minimum sample (honest "not enough to say")', () => {
    const form = currentForm(block(MIN_FORM_SAMPLE - 1, 0), NOW);
    expect(form.state).toBe('settling');
    expect(Number.isNaN(form.meanEvLossBb)).toBe(true);
    expect(form.sample).toBe(MIN_FORM_SAMPLE - 1);
  });

  it('reads sharp for a clean recent window and rusty for a leaky one', () => {
    expect(currentForm(block(MIN_FORM_SAMPLE, 0.2), NOW).state).toBe('sharp');
    expect(currentForm(block(MIN_FORM_SAMPLE, 3.5), NOW).state).toBe('rusty');
    expect(currentForm(block(MIN_FORM_SAMPLE, 1.8), NOW).state).toBe('warming up');
  });

  it('excludes the same value-or-bluff and free-fold decisions as playScore', () => {
    const junk = [
      ...block(MIN_FORM_SAMPLE, 5, { principle: 'value or bluff' }),
      ...block(MIN_FORM_SAMPLE, 4, { principle: null, toCall: 0 }),
    ];
    expect(currentForm(junk, NOW).state).toBe('settling');
  });

  it('reads only the most recent FORM_WINDOW decisions, so old play cannot mask a fresh slump', () => {
    // A long clean history, then a recent run of bad decisions. Form must reflect the recent slump,
    // even though the lifetime mean is near zero — this is the whole point of a separate live reading.
    const oldClean = block(200, 0, { at: NOW - 40 * DAY });
    const recentBad = block(FORM_WINDOW, 4, { at: NOW });
    const form = currentForm([...oldClean, ...recentBad], NOW);
    expect(form.sample).toBe(FORM_WINDOW);
    expect(form.state).toBe('rusty');
  });
});

describe('depthToStack sizes the table by earned depth', () => {
  const BB = 50; // matches table.ts

  it('Calibrating (depth 0) returns null — the caller uses the classic 100bb default', () => {
    expect(depthToStack(0, BB)).toBeNull();
  });

  it('a depth is that many big blinds in chips', () => {
    expect(depthToStack(40, BB)).toBe(2000);
    expect(depthToStack(75, BB)).toBe(3750);
    expect(depthToStack(125, BB)).toBe(6250);
    expect(depthToStack(200, BB)).toBe(10000);
  });

  it('a deeper depth is a strictly bigger stack — the climb actually changes the game', () => {
    const stacks = DEPTHS.filter((d) => d !== 0).map((d) => depthToStack(d, BB) ?? 0);
    for (let i = 1; i < stacks.length; i++) {
      expect(stacks[i]).toBeGreaterThan(stacks[i - 1]);
    }
  });
});

describe('affordableStack bounds the deep buy-in by what the learner can back', () => {
  const STANDARD = 5000; // the classic 100bb table

  it('a flush learner sits at full earned depth (deep stack <= bankroll)', () => {
    expect(affordableStack(10_000, 12_000, STANDARD)).toBe(10_000); // 200bb, well afforded
  });

  it('an in-between bankroll caps the buy-in at what the learner owns', () => {
    expect(affordableStack(10_000, 8_000, STANDARD)).toBe(8_000);
  });

  it('a broke learner still gets the standard table, never deeper than the floor', () => {
    // Bankroll below the standard buy-in: the floor holds it at the classic table (today's behaviour),
    // never a table deeper than net worth.
    expect(affordableStack(10_000, 3_000, STANDARD)).toBe(STANDARD);
    expect(affordableStack(10_000, 0, STANDARD)).toBe(STANDARD);
  });

  it('a shallow earned depth is never inflated up to the floor', () => {
    // 40bb (2000) is below the standard floor but it is the EARNED depth, so it stands — the floor only
    // rescues a deep stack the learner cannot afford, it does not raise a deliberately short table.
    expect(affordableStack(2_000, 12_000, STANDARD)).toBe(2_000);
  });

  it('Calibrating (null depth) stays null so the caller uses the table default', () => {
    expect(affordableStack(null, 3_000, STANDARD)).toBeNull();
  });
});

describe('depthLabel names the table, never a banned word', () => {
  it('labels each depth by its stack, with 0 as Calibrating', () => {
    expect(depthLabel(0)).toBe('Calibrating');
    expect(depthLabel(40)).toBe('40bb table');
    expect(depthLabel(200)).toBe('200bb table');
    for (const d of DEPTHS) {
      const label = depthLabel(d).toLowerCase();
      for (const banned of ['rank', 'percentile', 'level', 'elo', 'tier']) {
        expect(label).not.toContain(banned);
      }
    }
  });
});
