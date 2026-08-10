import { describe, it, expect } from 'vitest';
import type { ExploitNode, Forecast, Read } from '../../src/core/reads.js';
import {
  CALIBRATION_RELEASE_FORECASTS,
  DEVIATION_THRESHOLD_POINTS,
  MAX_ACTIVE_DEVIATIONS,
  MAX_DEVIATION_NODES,
  MIN_OBSERVATIONS,
  appliedDeviation,
  deviationPoints,
  deviationProbability,
  expireSession,
  falseReadProbability,
  gates,
  nodeValue,
  planDeviations,
  rankNodes,
  readAccuracy,
  revertState,
  selectDeviationNodes,
  shrinkageWeight,
} from '../../src/core/reads.js';

/**
 * READS AND DEVIATION — R1-R5, O4.
 *
 * The load-bearing assertions here are negative, because every one of them is a licence the module
 * must REFUSE to grant: n=19 with a huge deviation, n=200 with a tiny one, an opportunistic read
 * that was never pre-registered, a fourth deviation past the breadth cap, and — the one this module
 * exists for — the belief that a small `w` makes a bad read safe.
 */

const read = (over: Partial<Read> = {}): Read => ({
  id: 'folds-to-turn-probe',
  n: 20,
  observedFrequency: 0.7,
  baselineFrequency: 0.5,
  preRegistered: true,
  counterActions: 0,
  contraryObservations: 0,
  fullExploitBb: 2,
  ...over,
});

describe('R1 — the two go/no-go gates are independent', () => {
  it('licenses only when both gates pass', () => {
    const g = gates(read({ n: 20, observedFrequency: 0.7 }));
    expect(g.sampleGate).toBe(true);
    expect(g.deviationGate).toBe(true);
    expect(g.licensed).toBe(true);
  });

  it('does not license on the sample gate alone (n=40, only 10 points off)', () => {
    const g = gates(read({ n: 40, observedFrequency: 0.6 }));
    expect(g.sampleGate).toBe(true);
    expect(g.deviationGate).toBe(false);
    expect(g.licensed).toBe(false);
  });

  it('does not license on the deviation gate alone (40 points off, n=5)', () => {
    const g = gates(read({ n: 5, observedFrequency: 0.9 }));
    expect(g.sampleGate).toBe(false);
    expect(g.deviationGate).toBe(true);
    expect(g.licensed).toBe(false);
  });

  it('n=19 vs n=20 is the boundary, with the deviation held constant', () => {
    expect(gates(read({ n: 19 })).licensed).toBe(false);
    expect(gates(read({ n: MIN_OBSERVATIONS })).licensed).toBe(true);
  });

  it('14 points vs 15 points is the boundary, with n held constant', () => {
    expect(gates(read({ observedFrequency: 0.64 })).deviationGate).toBe(false);
    expect(gates(read({ observedFrequency: 0.65 })).deviationGate).toBe(true);
  });

  it('gates on absolute distance, so a read in the other direction licenses too', () => {
    const under = read({ observedFrequency: 0.3 });
    expect(deviationPoints(under)).toBeCloseTo(-20, 9);
    expect(gates(under).licensed).toBe(true);
  });

  it('measures distance from the node baseline, not from 50%', () => {
    // 60% folds is a 20-point deviation against a 40% baseline and a 10-point one against 50%.
    expect(gates(read({ observedFrequency: 0.6, baselineFrequency: 0.4 })).licensed).toBe(true);
    expect(gates(read({ observedFrequency: 0.6, baselineFrequency: 0.5 })).licensed).toBe(false);
  });

  it('exactly at baseline, and at n=0, licenses nothing', () => {
    const flat = read({ n: 0, observedFrequency: 0.5 });
    expect(gates(flat).deviationPoints).toBe(0);
    expect(gates(flat).licensed).toBe(false);
  });
});

describe('shrinkage is a magnitude control, never a go/no-go control', () => {
  it('w = n/(n+10) at the spec boundaries', () => {
    expect(shrinkageWeight(0)).toBe(0);
    expect(shrinkageWeight(10)).toBeCloseTo(0.5, 12);
    expect(shrinkageWeight(20)).toBeCloseTo(2 / 3, 12);
    expect(shrinkageWeight(100)).toBeCloseTo(100 / 110, 12);
  });

  it('is monotone in n and never reaches 1', () => {
    const weights = [1, 5, 10, 20, 50, 100, 1000].map(shrinkageWeight);
    for (let i = 1; i < weights.length; i++) expect(weights[i]).toBeGreaterThan(weights[i - 1]);
    expect(weights[weights.length - 1]).toBeLessThan(1);
  });

  it('is SIGN-PRESERVING — this is the misconception the module exists to remove', () => {
    // A wrong read at n=3 is still a deviation in the wrong direction, only smaller.
    expect(appliedDeviation(-4, 3)).toBeLessThan(0);
    expect(appliedDeviation(4, 3)).toBeGreaterThan(0);
    expect(Math.sign(appliedDeviation(-4, 3))).toBe(Math.sign(-4));
  });

  it('never shrinks a small sample to zero, so it cannot act as a gate', () => {
    // n=1 is 9% of the full exploit: tiny, but not zero and not baseline.
    expect(shrinkageWeight(1)).toBeGreaterThan(0);
    expect(appliedDeviation(10, 1)).toBeCloseTo(10 / 11, 12);
  });

  it('w is not consulted by the gates: an ungated read at n=19 still has a large w', () => {
    const ungated = read({ n: 19, observedFrequency: 0.9 });
    expect(gates(ungated).licensed).toBe(false);
    expect(shrinkageWeight(ungated.n)).toBeGreaterThan(0.65);
  });
});

describe('R4 — revert triggers fire mechanically', () => {
  it('one counter-action changes nothing', () => {
    const state = revertState(read({ counterActions: 1 }));
    expect(state.weightMultiplier).toBe(1);
    expect(state.triggers).toEqual([]);
  });

  it('two counter-actions halve w', () => {
    const state = revertState(read({ counterActions: 2 }));
    expect(state.weightMultiplier).toBe(0.5);
    expect(state.effectiveWeight).toBeCloseTo((2 / 3) * 0.5, 12);
    expect(state.revertedToBaseline).toBe(false);
    expect(state.triggers).toContain('counter-actions-halved');
  });

  it('three counter-actions revert to baseline for the session', () => {
    const state = revertState(read({ counterActions: 3 }));
    expect(state.effectiveWeight).toBe(0);
    expect(state.revertedToBaseline).toBe(true);
    expect(state.triggers).not.toContain('counter-actions-halved');
  });

  it('more than three stays at baseline rather than wrapping to halved', () => {
    expect(revertState(read({ counterActions: 9 })).effectiveWeight).toBe(0);
  });

  it('five contrary observations leave the gate open; six re-close it', () => {
    expect(revertState(read({ contraryObservations: 5 })).gateReClosed).toBe(false);
    const closed = revertState(read({ contraryObservations: 6 }));
    expect(closed.gateReClosed).toBe(true);
    expect(closed.effectiveWeight).toBe(0);
  });

  it('a re-closed gate outranks a mere halving', () => {
    const state = revertState(read({ counterActions: 2, contraryObservations: 6 }));
    expect(state.effectiveWeight).toBe(0);
    expect(state.triggers).toContain('gate-re-closed');
  });

  it('session end expires everything and resets n to zero', () => {
    const before = [read({ n: 60, counterActions: 2, contraryObservations: 4 })];
    const after = expireSession(before);
    expect(after[0].n).toBe(0);
    expect(after[0].counterActions).toBe(0);
    expect(after[0].contraryObservations).toBe(0);
    expect(shrinkageWeight(after[0].n)).toBe(0);
    expect(gates(after[0]).licensed).toBe(false);
    // The written hypothesis survives; the evidence does not.
    expect(after[0].preRegistered).toBe(true);
    expect(before[0].n).toBe(60); // pure: the input is untouched
  });

  it('an expired session cannot be re-licensed without fresh data', () => {
    const [expired] = expireSession([read({ n: 500, observedFrequency: 0.95 })]);
    expect(gates(expired).deviationGate).toBe(true);
    expect(gates(expired).sampleGate).toBe(false);
    expect(gates(expired).licensed).toBe(false);
  });
});

describe('R3 — caps on breadth and on node selection', () => {
  const nodes: ExploitNode[] = [
    { id: 'bb-vs-btn-cbet', reach: 0.2, bbPerOccurrence: 1.5 }, // 0.30
    { id: 'sb-turn-probe', reach: 0.05, bbPerOccurrence: 4.0 }, // 0.20
    { id: 'co-river-jam', reach: 0.01, bbPerOccurrence: 12.0 }, // 0.12
    { id: 'utg-open-fold', reach: 0.5, bbPerOccurrence: 0.1 }, // 0.05
  ];

  it('ranks by reach x bb per occurrence, not by either factor alone', () => {
    expect(rankNodes(nodes).map((n) => n.id)).toEqual([
      'bb-vs-btn-cbet',
      'sb-turn-probe',
      'co-river-jam',
      'utg-open-fold',
    ]);
    expect(nodeValue(nodes[2])).toBeCloseTo(0.12, 12);
  });

  it('selects the top two nodes and nowhere else', () => {
    const selected = selectDeviationNodes(nodes);
    expect(selected).toHaveLength(MAX_DEVIATION_NODES);
    expect(selected.map((n) => n.id)).toEqual(['bb-vs-btn-cbet', 'sb-turn-probe']);
  });

  it('breaks ties on id so a plan is deterministic', () => {
    const tied: ExploitNode[] = [
      { id: 'b', reach: 0.1, bbPerOccurrence: 1 },
      { id: 'a', reach: 0.2, bbPerOccurrence: 0.5 },
    ];
    expect(rankNodes(tied).map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('degenerates gracefully with fewer than two nodes', () => {
    expect(selectDeviationNodes([])).toEqual([]);
    expect(selectDeviationNodes([nodes[0]])).toHaveLength(1);
  });

  it('caps active deviations at three, keeping the largest', () => {
    const reads: Read[] = [
      read({ id: 'a', fullExploitBb: 0.4 }),
      read({ id: 'b', fullExploitBb: 3.0 }),
      read({ id: 'c', fullExploitBb: 1.0 }),
      read({ id: 'd', fullExploitBb: 2.0 }),
    ];
    const plan = planDeviations(reads, nodes);
    expect(plan.active).toHaveLength(MAX_ACTIVE_DEVIATIONS);
    expect(plan.active.map((a) => a.readId)).toEqual(['b', 'd', 'c']);
    expect(plan.dropped).toEqual([{ readId: 'a', reason: 'breadth-cap' }]);
  });

  it('applies each active deviation at the top two nodes only', () => {
    const plan = planDeviations([read()], nodes);
    expect(plan.nodeIds).toEqual(['bb-vs-btn-cbet', 'sb-turn-probe']);
    expect(plan.active[0].nodeIds).toEqual(plan.nodeIds);
    expect(plan.active[0].appliedBb).toBeCloseTo((2 / 3) * 2, 12);
  });

  it('R2 — an opportunistic read is dropped however strong the evidence', () => {
    const plan = planDeviations(
      [read({ id: 'noticed-mid-session', n: 400, observedFrequency: 0.95, preRegistered: false })],
      nodes,
    );
    expect(plan.active).toEqual([]);
    expect(plan.dropped).toEqual([{ readId: 'noticed-mid-session', reason: 'not-pre-registered' }]);
  });

  it('reports why each ungated read was dropped', () => {
    const plan = planDeviations(
      [
        read({ id: 'thin-sample', n: 19 }),
        read({ id: 'small-edge', observedFrequency: 0.6 }),
        read({ id: 'burned', counterActions: 3 }),
        read({ id: 'contradicted', contraryObservations: 6 }),
      ],
      nodes,
    );
    expect(plan.active).toEqual([]);
    expect(plan.dropped).toEqual([
      { readId: 'thin-sample', reason: 'sample-gate' },
      { readId: 'small-edge', reason: 'deviation-gate' },
      { readId: 'burned', reason: 'reverted-to-baseline' },
      { readId: 'contradicted', reason: 'gate-re-closed' },
    ]);
  });

  it('a halved read stays active at half weight', () => {
    const plan = planDeviations([read({ counterActions: 2 })], nodes);
    expect(plan.active[0].weight).toBeCloseTo((2 / 3) * 0.5, 12);
    expect(plan.active[0].appliedBb).toBeCloseTo((2 / 3) * 0.5 * 2, 12);
  });

  it('no reads means no deviations', () => {
    expect(planDeviations([], nodes).active).toEqual([]);
  });
});

describe('O4 — Brier score against the node base rate', () => {
  const forecast = (base: number, guess: number, occurred: boolean): Forecast => ({
    nodeId: 'bb-vs-btn-cbet',
    forecast: guess,
    nodeBaseRate: base,
    occurred,
  });

  /** Eight of ten occurrences at a node whose true frequency is 80%. */
  const skewedNode = [
    ...Array.from({ length: 8 }, () => forecast(0.8, 0.8, true)),
    ...Array.from({ length: 2 }, () => forecast(0.8, 0.8, false)),
  ];

  it('the two benchmarks differ, and that gap is the whole point', () => {
    const accuracy = readAccuracy(skewedNode);
    expect(accuracy.brier).toBeCloseTo(0.16, 12);
    expect(accuracy.baseRateBrier).toBeCloseTo(0.16, 12);
    expect(accuracy.uniformBrier).toBeCloseTo(0.25, 12);
    // Quoting the base rate scores +36% against uniform and 0 against the base rate. Beating
    // uniform is arithmetic; only beating the base rate is a read.
    expect(accuracy.skillVsUniform).toBeCloseTo(0.36, 12);
    expect(accuracy.skillVsBaseRate).toBeCloseTo(0, 12);
  });

  it('credits a forecast that actually beats the base rate', () => {
    const sharper = [
      ...Array.from({ length: 8 }, () => forecast(0.8, 0.95, true)),
      ...Array.from({ length: 2 }, () => forecast(0.8, 0.5, false)),
    ];
    const accuracy = readAccuracy(sharper);
    expect(accuracy.brier).toBeCloseTo(0.052, 12);
    expect(accuracy.skillVsBaseRate).toBeGreaterThan(0);
    expect(accuracy.skillVsBaseRate).toBeCloseTo(1 - 0.052 / 0.16, 12);
  });

  it('penalises a forecast worse than the base rate even when it beats uniform', () => {
    const wrongDirection = [
      ...Array.from({ length: 8 }, () => forecast(0.8, 0.65, true)),
      ...Array.from({ length: 2 }, () => forecast(0.8, 0.65, false)),
    ];
    const accuracy = readAccuracy(wrongDirection);
    expect(accuracy.skillVsUniform).toBeGreaterThan(0);
    expect(accuracy.skillVsBaseRate).toBeLessThan(0);
  });

  it('a perfect forecast scores 1 against both benchmarks', () => {
    const perfect = [forecast(0.8, 1, true), forecast(0.8, 0, false)];
    const accuracy = readAccuracy(perfect);
    expect(accuracy.brier).toBe(0);
    expect(accuracy.skillVsBaseRate).toBe(1);
    expect(accuracy.skillVsUniform).toBe(1);
  });

  it('handles a degenerate node where the base rate is already perfect', () => {
    const deterministic = [forecast(1, 0.5, true), forecast(1, 0.5, true)];
    const accuracy = readAccuracy(deterministic);
    expect(accuracy.baseRateBrier).toBe(0);
    expect(accuracy.skillVsBaseRate).toBe(Number.NEGATIVE_INFINITY);
  });

  it('withholds the calibration curve below 400 forecasts', () => {
    const many = (count: number) => Array.from({ length: count }, () => forecast(0.5, 0.5, true));
    expect(readAccuracy([]).calibrationReleasable).toBe(false);
    expect(readAccuracy(many(399)).calibrationReleasable).toBe(false);
    expect(readAccuracy(many(CALIBRATION_RELEASE_FORECASTS)).calibrationReleasable).toBe(true);
    expect(readAccuracy(many(401)).calibrationReleasable).toBe(true);
  });

  it('no forecasts is not an error', () => {
    const empty = readAccuracy([]);
    expect(empty.forecasts).toBe(0);
    expect(empty.brier).toBe(0);
  });
});

describe('R2 — the false-read arithmetic, computed rather than asserted', () => {
  it('the per-observable rate falls as n rises, which is what the n>=20 gate buys', () => {
    const at10 = deviationProbability(10, 0.5);
    const at20 = deviationProbability(20, 0.5);
    const at100 = deviationProbability(100, 0.5);
    expect(at10).toBeCloseTo(0.3438, 4);
    expect(at20).toBeCloseTo(0.2632, 4);
    expect(at100).toBeCloseTo(0.0035, 4);
    expect(at20).toBeLessThan(at10);
    expect(at100).toBeLessThan(at20);
  });

  it('k=1 is exactly the per-observable rate', () => {
    const one = falseReadProbability(1, 10);
    expect(one.atLeastOne).toBeCloseTo(one.perObservable, 12);
    expect(one.atLeastOne).toBeCloseTo(0.3438, 4);
  });

  /**
   * The spec's first claim: "a baseline opponent scanned across ten stats at n=10 each shows a
   * 15-point leak 95% of the time". Exact binomial says 98.5% at a 50% baseline, and 98.3-99.8%
   * across baselines from 25% to 75% — so the claim holds and is if anything understated.
   */
  it('ten observables at n=10 is ~95% or worse (exact: 98.5%)', () => {
    const scanned = falseReadProbability(10, 10);
    expect(scanned.atLeastOne).toBeCloseTo(0.9852, 4);
    expect(scanned.atLeastOne).toBeGreaterThan(0.95);

    for (const baseline of [0.25, 0.4, 0.6, 0.75]) {
      expect(falseReadProbability(10, 10, baseline).atLeastOne).toBeGreaterThan(0.95);
    }
  });

  /**
   * The spec's second claim: pre-registration plus the n>=20 gate cuts the false-read rate to ~24%.
   * That number is the ONE-observable rate at n=20 — 26.3% at a 50% baseline, 19-26% across
   * baselines. R2's own cap is two pre-registered tendencies, and at k=2 the rate is 45.7%, so
   * "~24%" is the per-tendency figure and not the per-session one.
   */
  it('the n>=20 gate on one pre-registered observable is ~24% (exact: 26.3%)', () => {
    const one = falseReadProbability(1, 20);
    expect(one.atLeastOne).toBeCloseTo(0.2632, 4);
    expect(one.atLeastOne).toBeGreaterThan(0.19);
    expect(one.atLeastOne).toBeLessThan(0.3);

    for (const baseline of [0.25, 0.4, 0.6, 0.75]) {
      const rate = falseReadProbability(1, 20, baseline).atLeastOne;
      expect(rate).toBeGreaterThan(0.19);
      expect(rate).toBeLessThan(0.27);
    }
  });

  it('two pre-registered tendencies at n=20 nearly double it, to 45.7%', () => {
    expect(falseReadProbability(2, 20).atLeastOne).toBeCloseTo(0.4571, 4);
  });

  it('the n>=20 gate alone does not save a ten-stat scan: still 95.3%', () => {
    // Which is the point of R2: the gate cuts the per-stat rate, pre-registration cuts k.
    expect(falseReadProbability(10, 20).atLeastOne).toBeCloseTo(0.9528, 4);
  });

  it('degenerate inputs', () => {
    expect(deviationProbability(0, 0.5)).toBe(0);
    expect(falseReadProbability(0, 20).atLeastOne).toBe(0);
    // A deterministic observable never deviates from its own baseline.
    expect(deviationProbability(20, 0)).toBe(0);
    expect(deviationProbability(20, 1)).toBe(0);
    // A zero threshold means everything "deviates".
    expect(deviationProbability(20, 0.5, 0)).toBeCloseTo(1, 9);
    // 60 points of 20 observations is 12 counts from an expectation of 10 — off the support.
    expect(deviationProbability(20, 0.5, 60)).toBe(0);
  });

  it('is symmetric in the baseline, since the gate is two-tailed', () => {
    expect(deviationProbability(20, 0.3)).toBeCloseTo(deviationProbability(20, 0.7), 12);
  });

  it('uses the same threshold constant as the gate', () => {
    expect(deviationProbability(20, 0.5)).toBeCloseTo(
      deviationProbability(20, 0.5, DEVIATION_THRESHOLD_POINTS),
      12,
    );
  });
});
