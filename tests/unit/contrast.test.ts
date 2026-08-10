import { describe, expect, it } from 'vitest';
import {
  AXIS_AVAILABILITY,
  AXIS_MAX_SET_SIZE,
  CONTRAST_AXES,
  DEFAULT_SET_SIZE,
  PRODUCIBLE_AXES,
  assertSingleVariable,
  axisCoverage,
  boardTextureOf,
  buildSpot,
  differingAxes,
  duplicateCards,
  featuresOf,
  gapBandOf,
  generateContrastSet,
  hammingDistance,
  playersBehind,
  suitednessOf,
  type ContrastAxis,
  type ContrastSet,
  type ContrastSpot,
} from '../../src/core/contrast.js';
import { legalActions } from '../../src/core/table.js';

const FLOP_BASE: ContrastSpot = {
  conceptId: 'btn-srp-cbet',
  hole: ['Ah', 'Kd'],
  board: ['7s', '2c', 'Td'],
  street: 'flop',
  position: 'BTN',
  villainPositions: ['BB'],
  effectiveStackBb: 100,
  potBb: 6,
  bb: 2,
  rangeAsymmetry: 'ip-favoured',
};

const PREFLOP_BASE: ContrastSpot = {
  conceptId: 'co-open',
  hole: ['Ah', 'Kd'],
  board: [],
  street: 'preflop',
  position: 'CO',
  villainPositions: ['BTN', 'SB', 'BB'],
  effectiveStackBb: 100,
  potBb: 0,
  bb: 2,
  rangeAsymmetry: 'symmetric',
};

/** Axes that can fill user story 19's four spots. Asserted, not assumed — see the coverage test. */
const FOUR_SPOT_AXES: readonly ContrastAxis[] = ['kickerGap'];

describe('feature vector', () => {
  it('covers exactly B6’s seven axes', () => {
    expect([...CONTRAST_AXES]).toEqual([
      'suitedness',
      'kickerGap',
      'position',
      'playersBehind',
      'rangeAsymmetry',
      'boardTexture',
      'stackDepth',
    ]);
    expect(Object.keys(featuresOf(FLOP_BASE)).sort()).toEqual([...CONTRAST_AXES].sort());
  });

  it('reads suitedness and gap band off the hole cards', () => {
    expect(suitednessOf(['Ah', 'Kh'])).toBe('suited');
    expect(suitednessOf(['Ah', 'Kd'])).toBe('offsuit');
    expect(gapBandOf(['9h', '9d'])).toBe('pair');
    expect(gapBandOf(['9h', '8d'])).toBe('connected');
    expect(gapBandOf(['9h', '7d'])).toBe('one-gap');
    expect(gapBandOf(['9h', '6d'])).toBe('two-gap');
    expect(gapBandOf(['Ah', '2d'])).toBe('wide');
  });

  it('classifies boards, and admits when it cannot place one', () => {
    expect(boardTextureOf([])).toBe('preflop');
    expect(boardTextureOf(['As', '7h', '2c'])).toBe('dry-ace-high');
    expect(boardTextureOf(['Ks', '7h', '2c'])).toBe('dry-king-high');
    expect(boardTextureOf(['8s', '6h', '5c'])).toBe('low-connected');
    expect(boardTextureOf(['8s', '8h', '5c'])).toBe('paired');
    expect(boardTextureOf(['Ks', 'Qs', '7s'])).toBe('monotone');
    expect(boardTextureOf(['Ks', 'Qh', '7h'])).toBe('broadway-two-tone');
    // Paired beats monotone: the pair is the feature that moves the strategy.
    expect(boardTextureOf(['8s', '8h', '5h'])).toBe('paired');
    expect(boardTextureOf(['Qs', '7h', '2c'])).toBe('other');
  });

  it('counts players behind by street order, not seat index', () => {
    // Postflop the small blind acts first, so from the button nobody is behind.
    expect(playersBehind(FLOP_BASE)).toBe(0);
    expect(playersBehind({ ...FLOP_BASE, position: 'SB', villainPositions: ['BB'] })).toBe(1);
    // Preflop the cutoff opens, so all three opponents act after it.
    expect(playersBehind(PREFLOP_BASE)).toBe(3);
  });

  it('buckets effective stack to B5’s solved depths at the band edges', () => {
    expect(featuresOf({ ...FLOP_BASE, effectiveStackBb: 70 }).stackDepth).toBe('bb40');
    expect(featuresOf({ ...FLOP_BASE, effectiveStackBb: 71 }).stackDepth).toBe('bb100');
    expect(featuresOf({ ...FLOP_BASE, effectiveStackBb: 150 }).stackDepth).toBe('bb100');
    expect(featuresOf({ ...FLOP_BASE, effectiveStackBb: 151 }).stackDepth).toBe('bb200');
  });

  it('hamming distance is 0 against itself and counts each moved axis', () => {
    const base = featuresOf(FLOP_BASE);
    expect(hammingDistance(base, base)).toBe(0);
    const twoMoved = featuresOf({ ...FLOP_BASE, hole: ['Ah', 'Kh'], effectiveStackBb: 200 });
    expect(differingAxes(base, twoMoved).sort()).toEqual(['stackDepth', 'suitedness']);
    expect(hammingDistance(base, twoMoved)).toBe(2);
  });
});

describe('honest axis coverage (B6)', () => {
  it('declares the three unsolvable axes unavailable with a stated reason', () => {
    for (const axis of ['rangeAsymmetry', 'boardTexture', 'stackDepth'] as const) {
      expect(AXIS_AVAILABILITY[axis].available).toBe(false);
      expect(AXIS_AVAILABILITY[axis].reason.length).toBeGreaterThan(10);
    }
    expect([...PRODUCIBLE_AXES]).toEqual(['suitedness', 'kickerGap', 'position', 'playersBehind']);
  });

  it('measured coverage never exceeds the declared ceiling', () => {
    for (const base of [FLOP_BASE, PREFLOP_BASE]) {
      const coverage = axisCoverage(base, 7);
      for (const axis of CONTRAST_AXES) {
        expect(coverage[axis]).toBeLessThanOrEqual(AXIS_MAX_SET_SIZE[axis]);
      }
      for (const axis of CONTRAST_AXES) {
        if (!AXIS_AVAILABILITY[axis].available) expect(coverage[axis]).toBe(0);
      }
    }
  });

  it('reports zero coverage everywhere when the base itself is undealable', () => {
    const coverage = axisCoverage({ ...FLOP_BASE, hole: ['Ah', 'Ah'] }, 7);
    for (const axis of CONTRAST_AXES) expect(coverage[axis]).toBe(0);
  });

  it('only kickerGap actually reaches the four-spot set, and says so honestly', () => {
    for (const axis of PRODUCIBLE_AXES) {
      const result = generateContrastSet(FLOP_BASE, axis, { seed: 11, size: DEFAULT_SET_SIZE });
      if (FOUR_SPOT_AXES.includes(axis)) {
        expect(result.ok, `${axis} should fill four spots`).toBe(true);
      } else {
        expect(result.ok, `${axis} cannot honestly fill four spots`).toBe(false);
        if (!result.ok) expect(result.reason).toContain('tops out at');
      }
    }
  });
});

describe('one-variable property (the spec’s oracle)', () => {
  /** Bases spread over streets, seats, opponent counts and depths. */
  const bases: ContrastSpot[] = [
    FLOP_BASE,
    PREFLOP_BASE,
    { ...FLOP_BASE, hole: ['9h', '8h'], board: ['As', 'Kd', '4c'] },
    { ...FLOP_BASE, hole: ['Qc', 'Qd'], board: ['Js', '9d', '3h'], position: 'SB' },
    { ...FLOP_BASE, hole: ['7c', '5d'], position: 'BB', villainPositions: ['CO', 'BTN'] },
    { ...FLOP_BASE, hole: ['Ts', '8s'], position: 'CO', villainPositions: ['BTN', 'BB'] },
    { ...FLOP_BASE, board: ['2h', '2d', '9s'], effectiveStackBb: 40, potBb: 3 },
    { ...FLOP_BASE, board: ['Kh', 'Qh', '3h'], effectiveStackBb: 200, potBb: 12, bb: 4 },
    {
      ...FLOP_BASE,
      street: 'turn',
      board: ['7s', '2c', 'Td', '4h'],
      hole: ['Jc', '9d'],
      potBb: 14,
    },
    {
      ...FLOP_BASE,
      street: 'river',
      board: ['7s', '2c', 'Td', '4h', 'Qs'],
      hole: ['Ac', '3d'],
      position: 'SB',
      villainPositions: ['BTN'],
      potBb: 30,
    },
  ];

  it('every emitted variant sits at hamming distance exactly 1 on the requested axis', () => {
    let generated = 0;
    for (const base of bases) {
      for (const axis of PRODUCIBLE_AXES) {
        for (let seed = 1; seed <= 12; seed++) {
          for (const size of [2, 3, 4, 5]) {
            const result = generateContrastSet(base, axis, { seed, size });
            if (!result.ok) continue;
            generated += 1;
            expect(result.set.variants).toHaveLength(size - 1);
            for (const variant of result.set.variants) {
              const axes = differingAxes(result.set.base.features, variant.features);
              expect(axes).toEqual([axis]);
              expect(hammingDistance(result.set.base.features, variant.features)).toBe(1);
            }
          }
        }
      }
    }
    // A property test that vacuously passed on zero sets would be worthless.
    expect(generated).toBeGreaterThan(200);
  });

  it('no pair anywhere in a set differs on two axes', () => {
    let pairsChecked = 0;
    for (const base of bases) {
      for (const axis of PRODUCIBLE_AXES) {
        for (let seed = 1; seed <= 12; seed++) {
          const result = generateContrastSet(base, axis, { seed, size: 3 });
          if (!result.ok) continue;
          const members = [result.set.base, ...result.set.variants];
          for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
              pairsChecked += 1;
              expect(hammingDistance(members[i].features, members[j].features)).toBe(1);
            }
          }
        }
      }
    }
    expect(pairsChecked).toBeGreaterThan(100);
  });

  it('holds every other axis fixed, including the ones it cannot vary', () => {
    for (const axis of PRODUCIBLE_AXES) {
      const result = generateContrastSet(FLOP_BASE, axis, { seed: 5, size: 2 });
      if (!result.ok) continue;
      const base = result.set.base.features;
      for (const variant of result.set.variants) {
        for (const other of CONTRAST_AXES) {
          if (other === axis) continue;
          expect(variant.features[other], `${axis} moved ${other}`).toBe(base[other]);
        }
      }
    }
  });

  it('varying position keeps the villain count as well as players-behind', () => {
    const result = generateContrastSet(
      { ...FLOP_BASE, position: 'BB', villainPositions: ['CO', 'BTN'] },
      'position',
      { seed: 4, size: 2 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const variant of result.set.variants) {
      expect(variant.spot.villainPositions).toHaveLength(2);
      expect(variant.spot.position).not.toBe('BB');
    }
  });

  it('is deterministic in the seed and varies with it', () => {
    const runs = [1, 2, 3, 4, 5, 6].map(
      (seed) => generateContrastSet(FLOP_BASE, 'kickerGap', { seed, size: 4 }),
    );
    const first = generateContrastSet(FLOP_BASE, 'kickerGap', { seed: 1, size: 4 });
    expect(JSON.stringify(first)).toEqual(JSON.stringify(runs[0]));
    const holeSets = runs.map((r) =>
      r.ok ? r.set.variants.map((v) => v.spot.hole.join('')).join('|') : 'fail',
    );
    expect(new Set(holeSets).size).toBeGreaterThan(1);
  });
});

describe('every variant is a real dealable position', () => {
  it('constructs through the real engine with no duplicate card', () => {
    let checked = 0;
    for (const axis of PRODUCIBLE_AXES) {
      for (let seed = 1; seed <= 8; seed++) {
        for (const base of [FLOP_BASE, PREFLOP_BASE]) {
          const result = generateContrastSet(base, axis, { seed, size: 2 });
          if (!result.ok) continue;
          for (const variant of [result.set.base, ...result.set.variants]) {
            checked += 1;
            expect(duplicateCards(variant.state)).toEqual([]);
            expect(variant.state.seats[0].hole).toEqual([...variant.spot.hole]);
            expect(variant.state.board).toEqual([...variant.spot.board]);
            // Hero must be able to act: a spot nobody can act in is not a decision.
            expect(variant.state.toAct).toBe(0);
            expect(legalActions(variant.state).length).toBeGreaterThan(0);
            const live = variant.state.seats.filter((seat) => !seat.folded);
            expect(live).toHaveLength(variant.spot.villainPositions.length + 1);
            for (const seat of live) expect(seat.hole).toHaveLength(2);
            for (const seat of live) expect(seat.stack).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('rejects illegal, duplicated and impossible spots instead of dealing them', () => {
    const cases: [Partial<ContrastSpot>, string][] = [
      [{ hole: ['Ah', 'Ah'] }, 'card unavailable'],
      [{ hole: ['Ah', '7s'] }, 'card unavailable'],
      [{ hole: ['Zx', 'Kd'] }, 'card unavailable'],
      [{ hole: ['Ah'] }, 'hole has 1 cards'],
      [{ board: ['7s', '2c'] }, 'board cards'],
      [{ street: 'turn' }, 'board cards'],
      [{ villainPositions: [] }, 'live villains'],
      [{ villainPositions: ['BB', 'BB'] }, 'one seat'],
      [{ villainPositions: ['BTN'] }, 'hero'],
    ];
    for (const [patch, needle] of cases) {
      const built = buildSpot({ ...FLOP_BASE, ...patch });
      expect(built.ok, JSON.stringify(patch)).toBe(false);
      if (!built.ok) expect(built.reason).toContain(needle);
    }
  });

  it('rejects a preflop spot whose effective stack cannot cover the blind', () => {
    const built = buildSpot({ ...PREFLOP_BASE, effectiveStackBb: 0.4 });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toContain('big blind');
  });

  it('conserves chips through the built state', () => {
    for (const base of [FLOP_BASE, PREFLOP_BASE]) {
      const built = buildSpot(base);
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      const committed = built.state.seats.reduce((sum, seat) => sum + seat.committed, 0);
      expect(built.state.pot).toBeGreaterThanOrEqual(committed);
    }
  });
});

describe('loud failure (edge-cases table)', () => {
  it('refuses an unavailable axis, names the concept and points at the fallback', () => {
    for (const axis of ['rangeAsymmetry', 'boardTexture', 'stackDepth'] as const) {
      const result = generateContrastSet(FLOP_BASE, axis, { seed: 1 });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.axis).toBe(axis);
      expect(result.conceptId).toBe('btn-srp-cbet');
      expect(result.fallback).toBe('worked-example');
      expect(result.reason).toContain('not available');
      expect(result.reason).toContain(AXIS_AVAILABILITY[axis].reason);
    }
  });

  it('refuses when the base spot itself cannot be dealt', () => {
    const result = generateContrastSet({ ...FLOP_BASE, hole: ['Ah', 'Ah'] }, 'kickerGap', {
      seed: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('base spot is not dealable');
      expect(result.fallback).toBe('worked-example');
    }
  });

  it('refuses a set larger than the axis can honestly fill', () => {
    const result = generateContrastSet(FLOP_BASE, 'suitedness', { seed: 1, size: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('yields 1 one-variable neighbour');
      expect(result.reason).toContain('tops out at 2');
    }
    // Same axis at its real size is fine, which is why the refusal above is a boundary not a bug.
    expect(generateContrastSet(FLOP_BASE, 'suitedness', { seed: 1, size: 2 }).ok).toBe(true);
  });

  it('refuses a degenerate size rather than emitting a one-spot "contrast"', () => {
    for (const size of [1, 0, -1]) {
      const result = generateContrastSet(FLOP_BASE, 'kickerGap', { seed: 1, size });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('not a contrast');
    }
  });

  it('refuses a pair whose only other level is unsuited-able: a pair is never suited', () => {
    // Gap band is held fixed, so flipping suitedness on a pocket pair has no realisation at all.
    const result = generateContrastSet({ ...FLOP_BASE, hole: ['Qc', 'Qd'] }, 'suitedness', {
      seed: 1,
      size: 2,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('yields 0 one-variable neighbour');
  });

  it('refuses players-behind when hero’s seat admits only one count', () => {
    // Postflop from the button every opponent is in front, so the count is pinned at 0.
    const result = generateContrastSet(FLOP_BASE, 'playersBehind', { seed: 1, size: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('yields 0 one-variable neighbour');
  });

  it('throws rather than return a two-variable set, because that is this module being wrong', () => {
    const good = generateContrastSet(FLOP_BASE, 'kickerGap', { seed: 2, size: 3 });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(() => assertSingleVariable(good.set)).not.toThrow();

    // Hand-forge a corrupt set: the second variant moves suitedness as well as the gap band.
    const forgedSpot: ContrastSpot = { ...FLOP_BASE, hole: ['9h', '7h'] };
    const forged: ContrastSet = {
      ...good.set,
      variants: [
        good.set.variants[0],
        { spot: forgedSpot, features: featuresOf(forgedSpot), state: good.set.base.state },
      ],
    };
    expect(() => assertSingleVariable(forged)).toThrow(/differs on|two-variable pair/);

    // And a set whose single moved axis is not the axis the learner was told about.
    const wrongAxis: ContrastSet = { ...good.set, axis: 'position' };
    expect(() => assertSingleVariable(wrongAxis)).toThrow(/differs on/);
  });
});
