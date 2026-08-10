import { describe, it, expect } from 'vitest';
import {
  HIDDEN_ARCHETYPE_LABEL,
  JITTER_MAX_ABSOLUTE_SHIFT,
  JITTER_RELATIVE_BAND,
  bandFor,
  isWithinBand,
  jitterParameters,
  visibleArchetypeLabel,
} from '../../src/core/jitter.js';
import { PROFILES, type Archetype } from '../../src/core/ai.js';
import { DEVIATION_THRESHOLD_POINTS } from '../../src/core/reads.js';

/**
 * OPPONENT JITTER — O3, stories 25 and 26.
 *
 * O3 has four separable claims and each fails in its own direction, so each gets its own block:
 *
 *  1. SEEDED AND REPRODUCIBLE — asserted on the actual returned numbers, not on a hash, so a change
 *     to the mixing function is visible here rather than merely "still deterministic".
 *  2. WITHIN A BAND — the load-bearing block. A band wide enough to turn a nit into a maniac defeats
 *     the classification skill O3 exists to build, so the extremes over a large seed sample are
 *     asserted against the REAL archetype numbers in ai.ts, not against a friendly fixture.
 *  3. IT ACTUALLY VARIES — the opposite failure. Returning the input unchanged passes 1 and 2
 *     perfectly while serving exactly the three fixed caricatures O3 forbids.
 *  4. PER SESSION, NOT PER HAND — a bot that shifts mid-session is unclassifiable, which inverts the
 *     clause, so stability across many draws at one seed is pinned.
 */

const ARCHETYPE_LIST = Object.keys(PROFILES) as Archetype[];
const PARAMETERS = Object.keys(PROFILES.nit) as (keyof typeof PROFILES.nit)[];

/** Large enough that a band violation reachable by any appreciable share of seeds cannot hide. */
const SEEDS = 2000;
const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);

function jitteredProfile(seed: number, archetype: Archetype) {
  return jitterParameters(seed, archetype, PROFILES[archetype]);
}

/** Every (seed, archetype) sample of one parameter. */
function samples(archetype: Archetype, parameter: keyof typeof PROFILES.nit): number[] {
  return seeds.map((seed) => jitteredProfile(seed, archetype)[parameter]);
}

// ── 1. Seeded and reproducible ──────────────────────────────────────────────

describe('O3: jitter is seeded and reproducible', () => {
  it('returns identical parameters for the same seed, on the actual values', () => {
    for (const archetype of ARCHETYPE_LIST) {
      const first = jitteredProfile(4242, archetype);
      const second = jitteredProfile(4242, archetype);
      expect(second).toEqual(first);
      // Deep equality on a numeric record compares every field exactly; make that explicit so a
      // silently-added field cannot pass by being absent from both sides of a partial check.
      for (const parameter of PARAMETERS) {
        expect(second[parameter]).toBe(first[parameter]);
      }
    }
  });

  it('is stable across 50 repeat draws at the same seed', () => {
    const expected = jitteredProfile(99, 'tag');
    for (let i = 0; i < 50; i++) {
      expect(jitteredProfile(99, 'tag')).toEqual(expected);
    }
  });

  it('pins the exact parameters for seed 7, so the generator itself cannot drift silently', () => {
    // Recorded from this implementation. This is the reproducibility O3 demands stated as data: if
    // any of these numbers changes, a saved session replays a different opponent than it recorded.
    const nit = jitteredProfile(7, 'nit');
    expect(nit.callStrength).toBeCloseTo(0.7169010257534684, 15);
    expect(nit.raiseStrength).toBeCloseTo(0.8160039507085458, 15);
    expect(nit.raiseFreq).toBeCloseTo(0.8074996638577432, 15);
    expect(nit.bluffBetFreq).toBeCloseTo(0.04947721557924524, 15);
    expect(nit.bluffRaiseFreq).toBe(0);
    expect(nit.loosecallFreq).toBe(0);
    expect(nit.betPotFraction).toBeCloseTo(0.6094780102605, 15);
  });

  it('gives different parameters to different archetypes that share a nominal value', () => {
    // nit and station both nominally stab 5% of the time. If the archetype id were absent from the
    // stream seed they would receive the identical jitter, and one dice roll would move two bots.
    expect(PROFILES.nit.bluffBetFreq).toBe(PROFILES.station.bluffBetFreq);
    const nit = jitteredProfile(11, 'nit').bluffBetFreq;
    const station = jitteredProfile(11, 'station').bluffBetFreq;
    expect(nit).not.toBe(station);
  });

  it('draws each parameter from its own stream, not one roll reused across the profile', () => {
    // Normalised offset within the band. A single shared roll would make these identical.
    const jittered = jitteredProfile(31, 'tag');
    const offsets = PARAMETERS.filter((p) => bandFor(PROFILES.tag[p]).halfWidth > 0).map(
      (p) => (jittered[p] - PROFILES.tag[p]) / bandFor(PROFILES.tag[p]).halfWidth,
    );
    expect(new Set(offsets.map((o) => o.toFixed(9))).size).toBe(offsets.length);
  });

  it('rejects a non-finite seed rather than silently producing NaN parameters', () => {
    expect(() => jitterParameters(Number.NaN, 'nit', PROFILES.nit)).toThrow();
  });
});

// ── 2. Within a band ────────────────────────────────────────────────────────

describe('O3: jitter stays within a band', () => {
  it('bands are the smaller of 15% relative and 5 absolute points', () => {
    expect(bandFor(0.8).halfWidth).toBeCloseTo(JITTER_MAX_ABSOLUTE_SHIFT, 12); // 0.12 capped to 0.05
    expect(bandFor(0.2).halfWidth).toBeCloseTo(0.03, 12); // relative binds below 1/3
    expect(bandFor(0.05).halfWidth).toBeCloseTo(0.0075, 12);
  });

  it('the band is far narrower than R1s 15-point deviation gate', () => {
    // If jitter could move a true frequency by 15 points it could open or close a read gate on its
    // own, and the learner would be reading this session's dice instead of the opponent.
    const widestShiftPoints = JITTER_MAX_ABSOLUTE_SHIFT * 100;
    expect(widestShiftPoints).toBeLessThan(DEVIATION_THRESHOLD_POINTS / 2);
  });

  it('no seed in 2000 pushes any parameter of any archetype outside its band', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        const band = bandFor(nominal);
        for (const value of samples(archetype, parameter)) {
          expect(isWithinBand(nominal, value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(band.min);
          expect(value).toBeLessThanOrEqual(band.max);
        }
      }
    }
  });

  it('holds every real archetype parameter inside hard-coded absolute bounds', () => {
    /**
     * NOT SELF-REFERENTIAL, on purpose. Every other band assertion in this block derives its bound
     * from `bandFor`, so widening `JITTER_RELATIVE_BAND` widens the assertion with it and the test
     * passes on a band that has stopped protecting anything. These numbers are written out by hand
     * from the nominal profiles in ai.ts, so widening any constant fails here.
     */
    const BOUNDS: Record<Archetype, Partial<Record<keyof typeof PROFILES.nit, [number, number]>>> = {
      nit: {
        callStrength: [0.63, 0.73],
        raiseStrength: [0.75, 0.85],
        raiseFreq: [0.75, 0.85],
        bluffBetFreq: [0.042, 0.058],
        betPotFraction: [0.55, 0.65],
      },
      tag: {
        callStrength: [0.5, 0.6],
        raiseStrength: [0.63, 0.73],
        raiseFreq: [0.65, 0.75],
        bluffBetFreq: [0.297, 0.403],
        bluffRaiseFreq: [0.102, 0.138],
        loosecallFreq: [0.042, 0.058],
        betPotFraction: [0.61, 0.71],
      },
      station: {
        callStrength: [0.34, 0.46],
        raiseStrength: [0.8, 0.9],
        raiseFreq: [0.127, 0.173],
        bluffBetFreq: [0.042, 0.058],
        bluffRaiseFreq: [0.017, 0.023],
        loosecallFreq: [0.8, 0.9],
        betPotFraction: [0.45, 0.55],
      },
    };
    for (const archetype of ARCHETYPE_LIST) {
      for (const [parameter, bound] of Object.entries(BOUNDS[archetype])) {
        const [low, high] = bound as [number, number];
        const values = samples(archetype, parameter as keyof typeof PROFILES.nit);
        expect(Math.min(...values)).toBeGreaterThanOrEqual(low);
        expect(Math.max(...values)).toBeLessThanOrEqual(high);
      }
    }
  });

  it('never moves a parameter by more than 5 points, or by more than 15% of itself', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        for (const value of samples(archetype, parameter)) {
          const shift = Math.abs(value - nominal);
          expect(shift).toBeLessThanOrEqual(JITTER_MAX_ABSOLUTE_SHIFT + 1e-12);
          expect(shift).toBeLessThanOrEqual(JITTER_RELATIVE_BAND * nominal + 1e-12);
        }
      }
    }
  });

  it('leaves a structurally-zero parameter at exactly zero', () => {
    // "A nit never bluff-raises" is a fact about the archetype, not a number to be jittered off 0.
    expect(PROFILES.nit.bluffRaiseFreq).toBe(0);
    expect(PROFILES.nit.loosecallFreq).toBe(0);
    for (const seed of seeds) {
      const nit = jitteredProfile(seed, 'nit');
      expect(nit.bluffRaiseFreq).toBe(0);
      expect(nit.loosecallFreq).toBe(0);
    }
  });

  it('never produces a negative or above-one frequency', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        if (PROFILES[archetype][parameter] > 1) continue; // pot fractions may legitimately exceed 1
        for (const value of samples(archetype, parameter)) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('cannot drive a positive frequency to zero, because the band is relative', () => {
    // 15% of a small number is a smaller number, so no clamp at 0 is needed and none is claimed.
    expect(bandFor(0.02).min).toBeCloseTo(0.017, 12);
    for (const seed of seeds) {
      expect(jitterParameters(seed, 'probe', { tiny: 0.02 }).tiny).toBeGreaterThan(0);
    }
  });

  it('clips a near-one frequency at one instead of exceeding it', () => {
    expect(bandFor(0.98).max).toBe(1);
    for (const seed of seeds) {
      expect(jitterParameters(seed, 'probe', { almostAlways: 0.98 }).almostAlways).toBeLessThanOrEqual(1);
    }
  });

  it('bands a pot fraction above one symmetrically rather than clipping it down', () => {
    // An overbet is legitimate. Clipping at 1 would only ever shrink it and would bias the bot.
    const overbet = bandFor(1.3);
    expect(overbet.max).toBeGreaterThan(1.3);
    expect(overbet.max - 1.3).toBeCloseTo(1.3 - overbet.min, 12);
  });
});

describe('O3: the archetype stays recognisable as itself', () => {
  it('no seed makes the nit a bluffer', () => {
    // A maniac stabs at half the pots it sees. The nit's band tops out an order of magnitude below
    // that: if this ever fails, jitter has destroyed the thing the learner is being asked to classify.
    for (const value of samples('nit', 'bluffBetFreq')) {
      expect(value).toBeLessThan(0.1);
    }
  });

  it('no seed makes the nit a caller', () => {
    for (const seed of seeds) {
      const nit = jitteredProfile(seed, 'nit');
      expect(nit.loosecallFreq).toBeLessThan(0.1);
      expect(nit.callStrength).toBeGreaterThan(0.6);
    }
  });

  it('no seed makes the station a folder', () => {
    for (const value of samples('station', 'loosecallFreq')) {
      expect(value).toBeGreaterThan(0.7);
    }
  });

  it('no seed makes the station aggressive', () => {
    for (const value of samples('station', 'raiseFreq')) {
      expect(value).toBeLessThan(0.2);
    }
  });

  it('preserves the callStrength ordering nit > tag > station under every seed', () => {
    // This is the ordering a learner classifies on. Jitter that can reorder it teaches nothing.
    for (const seed of seeds) {
      const nit = jitteredProfile(seed, 'nit').callStrength;
      const tag = jitteredProfile(seed, 'tag').callStrength;
      const station = jitteredProfile(seed, 'station').callStrength;
      expect(nit).toBeGreaterThan(tag);
      expect(tag).toBeGreaterThan(station);
    }
  });

  it('keeps the station the loosest caller and the tag the biggest bluffer under every seed', () => {
    for (const seed of seeds) {
      const nit = jitteredProfile(seed, 'nit');
      const tag = jitteredProfile(seed, 'tag');
      const station = jitteredProfile(seed, 'station');
      expect(station.loosecallFreq).toBeGreaterThan(tag.loosecallFreq);
      expect(tag.loosecallFreq).toBeGreaterThan(nit.loosecallFreq - 1e-12);
      expect(tag.bluffBetFreq).toBeGreaterThan(nit.bluffBetFreq);
      expect(tag.bluffBetFreq).toBeGreaterThan(station.bluffBetFreq);
    }
  });

  it('is unbiased: the mean over seeds sits on the nominal value', () => {
    // A one-sided jitter would systematically loosen or tighten every bot in the game while passing
    // every band assertion above.
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        const halfWidth = bandFor(nominal).halfWidth;
        if (halfWidth === 0) continue;
        const values = samples(archetype, parameter);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        expect(Math.abs(mean - nominal) / halfWidth).toBeLessThan(0.05);
      }
    }
  });
});

// ── 3. It actually varies ───────────────────────────────────────────────────

describe('story 26: jitter actually varies, so there are no fixed caricatures', () => {
  it('different seeds give different parameters', () => {
    const a = jitteredProfile(1, 'tag');
    const b = jitteredProfile(2, 'tag');
    const differing = PARAMETERS.filter((p) => a[p] !== b[p]);
    expect(differing.length).toBeGreaterThan(0);
  });

  it('no jitterable parameter is constant across 2000 seeds', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        if (bandFor(nominal).halfWidth === 0) continue;
        const distinct = new Set(samples(archetype, parameter));
        expect(distinct.size).toBeGreaterThan(SEEDS * 0.9);
        expect(distinct.has(nominal)).toBe(false);
      }
    }
  });

  it('moves parameters by a measurable amount, not by a rounding error', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        const halfWidth = bandFor(nominal).halfWidth;
        if (halfWidth === 0) continue;
        const shifts = samples(archetype, parameter).map((v) => Math.abs(v - nominal));
        const meanShift = shifts.reduce((sum, s) => sum + s, 0) / shifts.length;
        // Uniform over the band gives 0.5 x halfWidth; anything under 0.4 is jitter in name only.
        expect(meanShift / halfWidth).toBeGreaterThan(0.4);
      }
    }
  });

  it('reaches close to both edges of the band', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (const parameter of PARAMETERS) {
        const nominal = PROFILES[archetype][parameter];
        const band = bandFor(nominal);
        if (band.halfWidth === 0) continue;
        const values = samples(archetype, parameter);
        expect(Math.min(...values)).toBeLessThan(band.min + 0.05 * band.halfWidth);
        expect(Math.max(...values)).toBeGreaterThan(band.max - 0.05 * band.halfWidth);
      }
    }
  });

  it('separates adjacent session seeds, which is how sessions are actually numbered', () => {
    // Sessions count 1, 2, 3. If adjacent seeds gave adjacent draws the "jitter" would be a
    // near-constant across a learner's week, which is the fixed-caricature failure by another route.
    const consecutive = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => jitteredProfile(s, 'nit').callStrength);
    const halfWidth = bandFor(PROFILES.nit.callStrength).halfWidth;
    const spread = Math.max(...consecutive) - Math.min(...consecutive);
    expect(spread).toBeGreaterThan(halfWidth);
  });
});

// ── 4. Per session, not per hand ────────────────────────────────────────────

describe('O3: jitter is per session, not per hand', () => {
  it('holds every parameter fixed across 200 draws within one session', () => {
    // The signature has no hand argument on purpose; this pins that the function keeps no state
    // that could make hand 7 face a different opponent than hand 6.
    const sessionSeed = 555;
    for (const archetype of ARCHETYPE_LIST) {
      const atSessionStart = jitteredProfile(sessionSeed, archetype);
      for (let hand = 0; hand < 200; hand++) {
        expect(jitteredProfile(sessionSeed, archetype)).toEqual(atSessionStart);
      }
    }
  });

  it('changes only when the session seed changes', () => {
    const sessionOne = jitteredProfile(1000, 'station');
    const sessionTwoInterleaved = jitteredProfile(1001, 'station');
    expect(jitteredProfile(1000, 'station')).toEqual(sessionOne);
    expect(sessionTwoInterleaved).not.toEqual(sessionOne);
    expect(jitteredProfile(1000, 'station')).toEqual(sessionOne);
  });
});

// ── O4: the jittered values are the truth a read is graded against ──────────

describe('O4: jitter leaves the true frequencies knowable', () => {
  it('returns exactly the parameter set it was given, so nothing is lost from the record', () => {
    const jittered = jitteredProfile(12, 'tag');
    expect(Object.keys(jittered).sort()).toEqual(Object.keys(PROFILES.tag).sort());
    for (const value of Object.values(jittered)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('is recoverable from the session seed alone, so a read can be graded after the fact', () => {
    // A read is scored against the bot's TRUE frequency (reads.ts nodeBaseRate). That truth is this
    // return value, and it is reconstructible from the stored seed without storing the parameters.
    const duringSession = jitteredProfile(31337, 'tag');
    const reconstructedLater = jitterParameters(31337, 'tag', PROFILES.tag);
    expect(reconstructedLater).toEqual(duringSession);
  });
});

// ── Story 25: the label is hidden until the hand ends ───────────────────────

describe('story 25: the archetype label is hidden until the hand ends', () => {
  it('hides the label mid-hand', () => {
    const label = visibleArchetypeLabel('Nit', false);
    expect(label.revealed).toBe(false);
    expect(label.text).toBe(HIDDEN_ARCHETYPE_LABEL);
    expect(label.text).not.toBe('Nit');
  });

  it('reveals the label once the hand has ended', () => {
    const label = visibleArchetypeLabel('Nit', true);
    expect(label.revealed).toBe(true);
    expect(label.text).toBe('Nit');
  });

  it('never leaks any real archetype label while the hand is live', () => {
    for (const archetype of ARCHETYPE_LIST) {
      const trueLabel = archetype;
      const hidden = visibleArchetypeLabel(trueLabel, false);
      expect(hidden.text).not.toContain(trueLabel);
      expect(visibleArchetypeLabel(trueLabel, true).text).toBe(trueLabel);
    }
  });
});
