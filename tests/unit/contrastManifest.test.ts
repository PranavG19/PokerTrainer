import { describe, expect, it } from 'vitest';
import {
  CONTRAST_MANIFEST,
  T2_SEVERITY,
  assertRemediationFloor,
  manifestEntry,
  remediate,
  remediationQueue,
  t2LeaksFrom,
  type ManifestEntry,
  type Remediation,
} from '../../src/core/contrastManifest.js';
import {
  AXIS_AVAILABILITY,
  DEFAULT_SET_SIZE,
  assertSingleVariable,
  buildSpot,
  differingAxes,
  hammingDistance,
} from '../../src/core/contrast.js';
import { remediationDays } from '../../src/core/schedule.js';
import type { HandRecord } from '../../src/core/session.js';

const SEEDS = [1, 2, 3, 7, 11];

function hand(grades: { severity: string; principle: string; evLossBb: number }[]): HandRecord {
  return {
    handNumber: 1,
    hole: ['Ah', 'Kd'],
    board: [],
    net: 0,
    vpip: true,
    pfr: false,
    grades: grades as HandRecord['grades'],
  };
}

describe('the manifest is a build input, and every entry in it is real', () => {
  it('has unique concept ids and a dealable base spot', () => {
    const ids = CONTRAST_MANIFEST.map((entry) => entry.conceptId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CONTRAST_MANIFEST) {
      // The base's own conceptId is what contrast.ts logs on failure, so it must agree.
      expect(entry.base.conceptId, entry.conceptId).toBe(entry.conceptId);
      const built = buildSpot(entry.base);
      expect(built.ok, `${entry.conceptId} base: ${built.ok ? '' : built.reason}`).toBe(true);
    }
  });

  it('names no axis twice per concept, and authors a worked example for every entry', () => {
    for (const entry of CONTRAST_MANIFEST) {
      expect(new Set(entry.axes).size, entry.conceptId).toBe(entry.axes.length);
      expect(entry.axes.length, `${entry.conceptId} manifests no axis`).toBeGreaterThan(0);
      // S2's floor is only satisfiable if the fallback content exists for every concept, including
      // the ones whose sets currently build.
      expect(entry.workedExample.length, entry.conceptId).toBe(3);
      for (const step of entry.workedExample) expect(step.length).toBeGreaterThan(20);
    }
  });

  it('looks an entry up by id and misses cleanly', () => {
    expect(manifestEntry('btn-srp-cbet')?.title).toContain('button');
    expect(manifestEntry('no-such-concept')).toBeUndefined();
  });
});

describe('remediation resolves the manifest against what can actually be built', () => {
  it('reports every manifested axis, buildable or not, in manifest order', () => {
    for (const entry of CONTRAST_MANIFEST) {
      for (const seed of SEEDS) {
        const remediation = remediate(entry, seed);
        expect(remediation.offers.map((offer) => offer.axis)).toEqual([...entry.axes]);
        for (const offer of remediation.offers) {
          // Honest coverage: an unbuildable axis carries a stated reason, never an empty one.
          if (offer.set === null) expect(offer.reason.length, offer.axis).toBeGreaterThan(10);
          else expect(offer.reason).toBe('');
        }
      }
    }
  });

  it('every built set is one-variable, at the size it claims, capped at four', () => {
    let sets = 0;
    for (const entry of CONTRAST_MANIFEST) {
      for (const seed of SEEDS) {
        for (const offer of remediate(entry, seed).offers) {
          if (offer.set === null) continue;
          sets += 1;
          expect(offer.spots).toBeGreaterThanOrEqual(2);
          expect(offer.spots).toBeLessThanOrEqual(DEFAULT_SET_SIZE);
          expect(offer.set.variants).toHaveLength(offer.spots - 1);
          expect(offer.set.axis).toBe(offer.axis);
          expect(() => assertSingleVariable(offer.set!)).not.toThrow();
          for (const variant of offer.set.variants) {
            expect(differingAxes(offer.set.base.features, variant.features)).toEqual([offer.axis]);
            expect(hammingDistance(offer.set.base.features, variant.features)).toBe(1);
          }
        }
      }
    }
    expect(sets, 'a vacuous pass over zero sets would prove nothing').toBeGreaterThan(30);
  });

  it('carries the T2 spacing days from the scheduler, not a local copy', () => {
    for (const entry of CONTRAST_MANIFEST) {
      expect([...remediate(entry, 3).repairDays]).toEqual(remediationDays());
    }
  });

  it('an axis unavailable in this build reports contrast.ts’s own stated reason', () => {
    const rare = manifestEntry('flop-cbet-size-by-texture');
    expect(rare).toBeDefined();
    if (rare === undefined) return;
    const remediation = remediate(rare, 5);
    for (const offer of remediation.offers) {
      expect(offer.set).toBeNull();
      expect(offer.spots).toBe(0);
      expect(offer.reason).toBe(AXIS_AVAILABILITY[offer.axis].reason);
      expect(offer.reason).toContain('solver');
    }
  });

  it('falls back to a worked example only when no axis built, and says which failed', () => {
    const fallbacks = CONTRAST_MANIFEST.filter(
      (entry) => remediate(entry, 5).kind === 'worked-example',
    );
    // B6: the fallback is the RARE case. It exists, and it is a minority of the grid.
    expect(fallbacks.length).toBe(1);
    expect(fallbacks.length).toBeLessThan(CONTRAST_MANIFEST.length / 2);

    const remediation = remediate(fallbacks[0], 5);
    expect(remediation.fallback).not.toBeNull();
    expect(remediation.fallback?.steps).toEqual([...fallbacks[0].workedExample]);
    for (const axis of fallbacks[0].axes) {
      expect(remediation.fallback?.reason).toContain(axis);
    }
  });

  it('a concept whose sets build never falls back', () => {
    for (const entry of CONTRAST_MANIFEST) {
      for (const seed of SEEDS) {
        const remediation = remediate(entry, seed);
        const built = remediation.offers.filter((offer) => offer.set !== null).length;
        if (built > 0) {
          expect(remediation.kind, entry.conceptId).toBe('contrast-sets');
          expect(remediation.fallback).toBeNull();
        } else {
          expect(remediation.kind, entry.conceptId).toBe('worked-example');
        }
      }
    }
  });

  it('an axis that cannot pair off this base is named, not dropped', () => {
    // BTN postflop: nobody acts after hero, so players-behind is pinned and the axis cannot pair.
    const entry = manifestEntry('btn-srp-cbet');
    expect(entry?.axes).toContain('playersBehind');
    const offer = remediate(entry as ManifestEntry, 7).offers.find(
      (o) => o.axis === 'playersBehind',
    );
    expect(offer?.set).toBeNull();
    expect(offer?.reason).toContain('playersBehind');
    // And the concept still remediates, on its other axes.
    expect(remediate(entry as ManifestEntry, 7).kind).toBe('contrast-sets');
  });
});

describe('S2: remediation never drops below one repair', () => {
  it('the floor holds for every entry at every seed', () => {
    for (const entry of CONTRAST_MANIFEST) {
      for (const seed of SEEDS) {
        const remediation = remediate(entry, seed);
        expect(() => assertRemediationFloor(remediation)).not.toThrow();
        const repairs =
          remediation.offers.filter((offer) => offer.set !== null).length +
          (remediation.fallback === null ? 0 : 1);
        expect(repairs, `${entry.conceptId} at seed ${seed}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('throws on a remediation carrying neither a set nor a worked example', () => {
    const empty: Remediation = {
      conceptId: 'forged',
      kind: 'worked-example',
      offers: [{ axis: 'boardTexture', set: null, spots: 0, reason: 'no solver' }],
      fallback: { steps: [], reason: 'nothing authored' },
      repairDays: remediationDays(),
    };
    expect(() => assertRemediationFloor(empty)).toThrow(/no repair|below one contrast set/);
    expect(() => assertRemediationFloor({ ...empty, fallback: null })).toThrow(/no repair/);
  });

  it('throws when a fallback was taken while a set was buildable', () => {
    const built = remediate(manifestEntry('bb-defence-vs-cbet') as ManifestEntry, 3);
    expect(built.kind).toBe('contrast-sets');
    expect(() =>
      assertRemediationFloor({
        ...built,
        kind: 'worked-example',
        fallback: { steps: ['a', 'b', 'c'], reason: 'forged' },
      }),
    ).toThrow(/fell back/);
  });

  it('throws when sets are claimed and none exist', () => {
    expect(() =>
      assertRemediationFloor({
        conceptId: 'forged',
        kind: 'contrast-sets',
        offers: [{ axis: 'stackDepth', set: null, spots: 0, reason: 'no solver' }],
        fallback: null,
        repairDays: remediationDays(),
      }),
    ).toThrow(/no repair/);
  });
});

describe('the T2 row: which leak fires which repair', () => {
  it('counts only T2-band grades, ranked by total cost not frequency', () => {
    const leaks = t2LeaksFrom([
      hand([
        { severity: 'free', principle: 'pot odds', evLossBb: 0.1 },
        { severity: T2_SEVERITY, principle: 'pot odds', evLossBb: 0.6 },
      ]),
      hand([
        { severity: T2_SEVERITY, principle: 'pot odds', evLossBb: 0.6 },
        { severity: T2_SEVERITY, principle: 'ranges', evLossBb: 1.9 },
        { severity: 'serious', principle: 'value or bluff', evLossBb: 8 },
      ]),
    ]);
    // ranges: one 1.9bb leak outranks two 0.6bb pot-odds leaks. Cost, not count.
    expect(leaks.map((leak) => leak.principle)).toEqual(['ranges', 'pot odds']);
    expect(leaks[0]).toEqual({ principle: 'ranges', count: 1, costBb: 1.9 });
    expect(leaks[1].count).toBe(2);
    expect(leaks[1].costBb).toBeCloseTo(1.2, 10);
    // 'serious' is the interrupt band, not the end-of-block band: it must not appear here.
    expect(leaks.map((leak) => leak.principle)).not.toContain('value or bluff');
  });

  it('an empty log fires nothing but still queues every concept (N1)', () => {
    expect(t2LeaksFrom([])).toEqual([]);
    const queue = remediationQueue([]);
    expect(queue).toHaveLength(CONTRAST_MANIFEST.length);
    expect(queue.every((item) => item.firedBy === null)).toBe(true);
    expect(queue.map((item) => item.entry.conceptId)).toEqual(
      CONTRAST_MANIFEST.map((entry) => entry.conceptId),
    );
  });

  it('a fired concept sorts ahead of the unfired ones, worst leak first', () => {
    const queue = remediationQueue([
      hand([
        { severity: T2_SEVERITY, principle: 'pot odds', evLossBb: 0.6 },
        { severity: T2_SEVERITY, principle: 'value or bluff', evLossBb: 1.8 },
      ]),
    ]);
    const firedCount = queue.filter((item) => item.firedBy !== null).length;
    expect(firedCount).toBeGreaterThan(0);
    // Every fired entry precedes every unfired one.
    const firstUnfired = queue.findIndex((item) => item.firedBy === null);
    expect(queue.slice(0, firstUnfired).every((item) => item.firedBy !== null)).toBe(true);
    // 'value or bluff' cost more than 'pot odds', so its concepts come first.
    expect(queue[0].firedBy?.principle).toBe('value or bluff');
    expect(queue[0].entry.repairs).toBe('value or bluff');
    expect(queue).toHaveLength(CONTRAST_MANIFEST.length);
  });
});
