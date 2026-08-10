import { describe, it, expect } from 'vitest';
import {
  classKey,
  reachTable,
  reachWeightedLoss,
  scoreboardRw,
  rwFor,
  type ClassDecision,
  type ClassReach,
} from '../../src/core/rw.js';

// A small frozen reference population fixture. Numbers are chosen so the RW arithmetic is exact and
// hand-checkable, not so they are realistic reaches.
const REF_POP = 'refpop-v1';

const reachEntries: ClassReach[] = [
  { street: 'flop', actionClass: 'faces any flop c-bet', reach: 0.5 },
  { street: 'turn', actionClass: 'turn probe', reach: 0.2 },
  { street: 'river', actionClass: 'river bluff-catch', reach: 0.1 },
];

describe('classKey', () => {
  it('joins street and action class', () => {
    expect(classKey('flop', 'faces any flop c-bet')).toBe('flop|faces any flop c-bet');
  });

  it('throws on an action class containing the separator, so two classes cannot collide', () => {
    expect(() => classKey('flop', 'a|b')).toThrow(/collide/);
  });
});

describe('reachTable', () => {
  it('throws on a duplicate class', () => {
    expect(() =>
      reachTable(REF_POP, [
        { street: 'flop', actionClass: 'x', reach: 0.1 },
        { street: 'flop', actionClass: 'x', reach: 0.2 },
      ]),
    ).toThrow(/two entries/);
  });

  it('throws on a reach outside [0, 1] because reach is a probability per hand', () => {
    expect(() =>
      reachTable(REF_POP, [{ street: 'flop', actionClass: 'x', reach: 2 }]),
    ).toThrow(/probability/);
    expect(() =>
      reachTable(REF_POP, [{ street: 'flop', actionClass: 'x', reach: -0.1 }]),
    ).toThrow(/probability/);
  });

  it('throws on a non-finite reach (NaN, Infinity) so it cannot poison rw = mean × reach × 100', () => {
    // NaN passes both `< 0` and `> 1` (every NaN comparison is false), so without the finiteness
    // guard a NaN reach would sail into the table and make every rw in that class NaN. Infinity
    // would multiply the class's rw and study rank to Infinity. Both must be rejected at load.
    expect(() =>
      reachTable(REF_POP, [{ street: 'flop', actionClass: 'x', reach: Number.NaN }]),
    ).toThrow(/probability/);
    expect(() =>
      reachTable(REF_POP, [{ street: 'flop', actionClass: 'x', reach: Number.POSITIVE_INFINITY }]),
    ).toThrow(/probability/);
    expect(() =>
      reachTable(REF_POP, [{ street: 'flop', actionClass: 'x', reach: Number.NEGATIVE_INFINITY }]),
    ).toThrow(/probability/);
  });

  it('carries the referencePopId through, binding reach to the frozen population', () => {
    expect(reachTable(REF_POP, reachEntries).referencePopId).toBe(REF_POP);
  });
});

describe('reachWeightedLoss — G2 formula', () => {
  const reach = reachTable(REF_POP, reachEntries);

  it('computes mean(ΔEV over class) × reach × 100, in bb/100', () => {
    // flop class: ΔEV mean over {2, 4} = 3; reach 0.5 → 3 × 0.5 × 100 = 150.
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 2 },
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 4 },
    ];
    const report = reachWeightedLoss(decisions, reach);
    expect(report.classes).toHaveLength(1);
    const flop = report.classes[0];
    expect(flop.meanDeltaEvBb).toBe(3);
    expect(flop.reach).toBe(0.5);
    expect(flop.rw).toBe(150);
    expect(flop.decisions).toBe(2);
  });

  it('takes the MEAN over the class, not the sum — averaging is load-bearing', () => {
    // Two decisions of 4 each: mean is 4 (not 8). rw = 4 × 0.5 × 100 = 200.
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 4 },
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 4 },
    ];
    const report = reachWeightedLoss(decisions, reach);
    expect(report.classes[0].rw).toBe(200);
  });

  it('groups by (street × action class) — same class name on two streets stays separate', () => {
    const shared = reachTable(REF_POP, [
      { street: 'flop', actionClass: 'shared', reach: 0.5 },
      { street: 'turn', actionClass: 'shared', reach: 0.5 },
    ]);
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'shared', deltaEvBb: 1 },
      { street: 'turn', actionClass: 'shared', deltaEvBb: 3 },
    ];
    const report = reachWeightedLoss(decisions, shared);
    expect(report.classes).toHaveLength(2);
    const byStreet = Object.fromEntries(report.classes.map((c) => [c.street, c.rw]));
    // Separate classes: flop mean 1 → 50, turn mean 3 → 150. A collapse would average to 2 → 100 each.
    expect(byStreet.flop).toBe(50);
    expect(byStreet.turn).toBe(150);
  });

  it('multiplies by the frozen reach: same ΔEV, higher reach ranks higher', () => {
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 1 }, // reach 0.5 → 50
      { street: 'turn', actionClass: 'turn probe', deltaEvBb: 1 }, // reach 0.2 → 20
    ];
    const report = reachWeightedLoss(decisions, reach);
    // Ranked worst-RW first: the higher-reach class leads despite identical ΔEV.
    expect(report.classes.map((c) => c.actionClass)).toEqual(['faces any flop c-bet', 'turn probe']);
    expect(report.classes[0].rw).toBe(50);
    expect(report.classes[1].rw).toBe(20);
  });

  it('ranks by RW descending, ties broken deterministically regardless of arrival order', () => {
    // Two classes with equal RW (both reach 0.5-equivalent), fed in reverse key order.
    const table = reachTable(REF_POP, [
      { street: 'flop', actionClass: 'bbb', reach: 0.5 },
      { street: 'flop', actionClass: 'aaa', reach: 0.5 },
    ]);
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'bbb', deltaEvBb: 2 },
      { street: 'flop', actionClass: 'aaa', deltaEvBb: 2 },
    ];
    const report = reachWeightedLoss(decisions, table);
    expect(report.classes.map((c) => c.actionClass)).toEqual(['aaa', 'bbb']);
  });

  it('echoes the referencePopId so an RW figure is auditable against its frozen population', () => {
    const report = reachWeightedLoss(
      [{ street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 1 }],
      reach,
    );
    expect(report.referencePopId).toBe(REF_POP);
  });

  it('throws when a decided class has no reach in the table, rather than dropping it silently', () => {
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'unknown class', deltaEvBb: 5 },
    ];
    expect(() => reachWeightedLoss(decisions, reach)).toThrow(/no reach for decided class/);
  });

  it('returns no classes for no decisions', () => {
    expect(reachWeightedLoss([], reach).classes).toHaveLength(0);
  });
});

describe('scoreboardRw — metric #2', () => {
  const reach = reachTable(REF_POP, reachEntries);

  it('sums the per-class RW figures', () => {
    // flop mean 2 → 100, turn mean 1 → 20. Total 120.
    const decisions: ClassDecision[] = [
      { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 2 },
      { street: 'turn', actionClass: 'turn probe', deltaEvBb: 1 },
    ];
    const report = reachWeightedLoss(decisions, reach);
    expect(scoreboardRw(report)).toBe(120);
  });

  it('is zero when nothing was decided', () => {
    expect(scoreboardRw(reachWeightedLoss([], reach))).toBe(0);
  });
});

describe('rwFor — G8 class-level lookup', () => {
  const reach = reachTable(REF_POP, reachEntries);
  const report = reachWeightedLoss(
    [{ street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 2 }],
    reach,
  );

  it('returns the class-level RW for a class that acted', () => {
    expect(rwFor(report, 'flop', 'faces any flop c-bet')).toBe(100);
  });

  it('returns zero for a class that saw no decisions this session', () => {
    expect(rwFor(report, 'river', 'river bluff-catch')).toBe(0);
  });
});

// Compile-time proof that `ClassDecision` exposes NO per-node coordinate. If an optional
// `readonly nodeKey?: string` (or any other key) were added to the interface, `keyof ClassDecision`
// would widen past this exact union and this assignment would fail `tsc --noEmit`. This is what makes
// guarantee (1) STRUCTURAL rather than a runtime-only Object.keys check on a self-built literal: the
// coordinate a per-node breakdown would need cannot be added to the type without breaking the build.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const CLASS_DECISION_KEYS_ARE_EXACTLY_CLASS_LEVEL: Exact<
  keyof ClassDecision,
  'street' | 'actionClass' | 'deltaEvBb'
> = true;

describe('structural guarantees (G2)', () => {
  it('ClassDecision carries no nodeKey — granularity is (street × action class), not per-node', () => {
    // A ClassDecision is fully specified by street, actionClass and deltaEvBb. If a nodeKey field
    // existed, tsc would accept it here; it does not, so an excess-property check would fail at
    // compile time. This asserts the runtime shape has exactly the three class-level keys.
    const decision: ClassDecision = { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 1 };
    expect(Object.keys(decision).sort()).toEqual(['actionClass', 'deltaEvBb', 'street']);
    // The compile-time union proof above must hold at runtime too, so the guarantee is not dead code.
    expect(CLASS_DECISION_KEYS_ARE_EXACTLY_CLASS_LEVEL).toBe(true);
  });

  it('collapses same-class decisions with distinct would-be node identities into ONE class row', () => {
    // Feed two decisions in the SAME (street × action class) but carrying DISTINCT node identities
    // smuggled in via a cast — exactly what a per-node regrouping (classKey@nodeKey) would key on.
    // The spec's granularity is (street × action class), so these MUST aggregate into a single row
    // whose mean is over both decisions. If the module ever regrouped per node, this would split into
    // two rows (or change the mean), and the assertions below would fail.
    const nodeA = { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 2, nodeKey: 'K72r-BB-vs-BTN' };
    const nodeB = { street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 6, nodeKey: 'A83s-BB-vs-CO' };
    const decisions = [nodeA, nodeB] as unknown as ClassDecision[];
    const report = reachWeightedLoss(decisions, reachTable(REF_POP, reachEntries));
    // One class row, not one per node.
    expect(report.classes).toHaveLength(1);
    const flop = report.classes[0];
    // Mean over BOTH decisions = (2 + 6) / 2 = 4; per-node splitting would leave 2 and 6 apart.
    expect(flop.meanDeltaEvBb).toBe(4);
    expect(flop.decisions).toBe(2);
    // rw = 4 × 0.5 × 100 = 200; per-node rows would each be 100 (or 300) and sum differently.
    expect(flop.rw).toBe(200);
    // The class row exposes no node coordinate to leak the identities back out.
    expect(flop).not.toHaveProperty('nodeKey');
  });

  it('ClassRw exposes no severity or tier — RW is study priority, not a per-decision verdict', () => {
    const report = reachWeightedLoss(
      [{ street: 'flop', actionClass: 'faces any flop c-bet', deltaEvBb: 1 }],
      reachTable(REF_POP, reachEntries),
    );
    const klass = report.classes[0];
    expect(klass).not.toHaveProperty('severity');
    expect(klass).not.toHaveProperty('tier');
    expect(Object.keys(klass).sort()).toEqual(
      ['actionClass', 'decisions', 'meanDeltaEvBb', 'reach', 'rw', 'street'].sort(),
    );
  });
});
