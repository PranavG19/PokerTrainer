import { describe, it, expect } from 'vitest';
import {
  DEPTHS,
  MIN_CONTESTED,
  depthLabel,
  masteryGate,
  playGate,
  playScore,
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
