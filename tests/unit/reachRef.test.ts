import { describe, expect, it } from 'vitest';
import {
  REFERENCE_POP_ID,
  REFERENCE_REACH,
  classDecisionsFor,
  type GradedDecision,
} from '../../src/core/reachRef.js';
import { classKey, reachWeightedLoss, scoreboardRw } from '../../src/core/rw.js';
import type { Street } from '../../src/core/table.js';

/**
 * reachRef is the composition-root glue that turns graded hero decisions into rw.ts's ClassDecisions
 * and supplies the frozen reference reach table the recommender reach-weights against. rw.ts itself is
 * already exhaustively tested; what needs its own oracle here is the BRIDGE: that every (street ×
 * coach principle) a decision can actually carry has a reach in the table (so reachWeightedLoss never
 * throws in the live path), and that unknown classes are dropped rather than exploding Home.
 */

// The coach's full principle vocabulary (coach.ts) and the streets a hero decision can occur on.
const PRINCIPLES = ['pot odds', 'ranges', 'value or bluff'] as const;
const DECISION_STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

describe('REFERENCE_REACH — the frozen reference population', () => {
  it('binds every reach to one auditable reference population id', () => {
    expect(REFERENCE_REACH.referencePopId).toBe(REFERENCE_POP_ID);
    expect(REFERENCE_POP_ID.length).toBeGreaterThan(0);
  });

  it('carries a reach for every (street × coach principle) a decision can carry', () => {
    // reachWeightedLoss THROWS on a decided class with no reach. If the app ever grades a spot whose
    // (street, principle) is missing here, Home would crash — so every real combination must be present.
    for (const street of DECISION_STREETS) {
      for (const principle of PRINCIPLES) {
        expect(
          REFERENCE_REACH.byClass.has(classKey(street, principle)),
          `no reference reach for ${street} / ${principle}`,
        ).toBe(true);
      }
    }
  });

  it('every reach is a probability in [0, 1]', () => {
    for (const reach of REFERENCE_REACH.byClass.values()) {
      expect(reach).toBeGreaterThanOrEqual(0);
      expect(reach).toBeLessThanOrEqual(1);
    }
  });

  it('reach decays down the streets for a fixed class — later streets are reached less often', () => {
    // A structural ordering claim, not a magic value: you face a given decision class less often the
    // deeper the street, because fewer hands survive to it. Asserted on 'pot odds' as a representative.
    const potOdds = (s: Street) => REFERENCE_REACH.byClass.get(classKey(s, 'pot odds'))!;
    expect(potOdds('preflop')).toBeGreaterThan(potOdds('flop'));
    expect(potOdds('flop')).toBeGreaterThan(potOdds('turn'));
    expect(potOdds('turn')).toBeGreaterThan(potOdds('river'));
  });
});

describe('classDecisionsFor — grades → ClassDecisions', () => {
  it('maps a graded decision to its (street × principle) class, carrying ΔEV unchanged', () => {
    const graded: GradedDecision[] = [
      { street: 'flop', principle: 'pot odds', deltaEvBb: 2.5 },
    ];
    const decisions = classDecisionsFor(graded);
    expect(decisions).toEqual([{ street: 'flop', actionClass: 'pot odds', deltaEvBb: 2.5 }]);
  });

  it('drops a decision whose class is not in the reference table, rather than throwing', () => {
    // 'showdown' carries no hero action and is not in the table; a principle the table never authored
    // must also be dropped. The live path must never throw just because an unexpected class appeared.
    const graded: GradedDecision[] = [
      { street: 'showdown' as Street, principle: 'pot odds', deltaEvBb: 3 },
      { street: 'flop', principle: 'nonsense-principle', deltaEvBb: 3 },
      { street: 'turn', principle: 'ranges', deltaEvBb: 1 },
    ];
    const decisions = classDecisionsFor(graded);
    expect(decisions).toEqual([{ street: 'turn', actionClass: 'ranges', deltaEvBb: 1 }]);
    // And the survivors feed reachWeightedLoss without throwing.
    expect(() => reachWeightedLoss(decisions, REFERENCE_REACH)).not.toThrow();
  });

  it('feeds reachWeightedLoss so a high-reach class outranks an equal-loss low-reach one', () => {
    // Same ΔEV on preflop (high reach) and river (low reach): the preflop class must rank first.
    const graded: GradedDecision[] = [
      { street: 'river', principle: 'pot odds', deltaEvBb: 2 },
      { street: 'preflop', principle: 'pot odds', deltaEvBb: 2 },
    ];
    const report = reachWeightedLoss(classDecisionsFor(graded), REFERENCE_REACH);
    expect(report.classes[0].street).toBe('preflop');
    expect(report.classes[0].rw).toBeGreaterThan(report.classes[1].rw);
    // The scoreboard figure is the coherent sum of the two class RWs.
    expect(scoreboardRw(report)).toBeCloseTo(report.classes[0].rw + report.classes[1].rw, 10);
  });

  it('returns nothing for no graded decisions', () => {
    expect(classDecisionsFor([])).toEqual([]);
  });
});
