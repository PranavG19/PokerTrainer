import { describe, it, expect } from 'vitest';
import type { ConceptState, Opportunity } from '../../src/core/schedule.js';
import {
  DECAY_HALF_LIFE_DAYS,
  MAX_OPPORTUNITIES,
  MIN_OPPORTUNITIES,
  MS_PER_DAY,
  WAVES,
  assertFlatGaps,
  dueNow,
  gate,
  nextDue,
  onProbeMiss,
  posterior,
  remediationDays,
} from '../../src/core/schedule.js';

/**
 * SPACED REPETITION — the tests the spec's own oracle table asks for.
 *
 * The headline one is the simulated 60-day timeline: "assert reps land at day 0/1-2/7/21/30-45 per
 * concept, and that intervals are flat rather than expanding". A scheduler is only testable if the
 * clock is a parameter, which is why every function here takes `now`.
 *
 * The other load-bearing assertions are negative: that an expanding 1/2/4/8/16 ladder is rejected,
 * that remediation cannot be compressed into consecutive days, and that no "N correct in a row"
 * path exists anywhere. Each is something a well-meaning future change would reintroduce.
 */

/** An arbitrary fixed epoch. Any value works; a constant keeps failures readable. */
const T0 = 1_700_000_000_000;

const at = (day: number, correct: boolean): Opportunity => ({
  at: T0 + day * MS_PER_DAY,
  correct,
});

function concept(opportunities: Opportunity[], probeMisses = 0): ConceptState {
  return { id: 'polarity-wants-size', firstSeen: T0, opportunities, probeMisses };
}

const day = (n: number): number => T0 + n * MS_PER_DAY;

describe('the wave schedule', () => {
  it('is the spec table: day 0/1/7/21/30 with 10/4/4/3/2 reps', () => {
    expect(WAVES.map((w) => w.day)).toEqual([0, 1, 7, 21, 30]);
    expect(WAVES.map((w) => w.reps)).toEqual([10, 4, 4, 3, 2]);
    // Day 0 is blocked (first exposure), the middle waves interleave, the last is an unannounced probe.
    expect(WAVES.map((w) => w.mode)).toEqual([
      'blocked',
      'interleaved',
      'interleaved',
      'interleaved',
      'probe',
    ]);
  });

  it('has flat gaps, and rejects an expanding 1/2/4/8/16 ladder', () => {
    expect(() => assertFlatGaps()).not.toThrow();
    // The exact ladder the spec forbids. If someone "fixes" the schedule to this, the guard fires.
    expect(() => assertFlatGaps([1, 2, 4, 8, 16])).toThrow(/expanding gaps/);
    expect(() => assertFlatGaps([0, 1, 2, 4])).toThrow(/expanding gaps/);
  });

  it('refuses a massed remediation chain', () => {
    expect(remediationDays()).toEqual([2, 9, 23]);
    // 1/2/3-day chains are massing wearing spacing's clothes.
    expect(() => remediationDays(0)).not.toThrow();
    const gaps = remediationDays().slice(1).map((d, i) => d - remediationDays()[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5);
  });
});

describe('a simulated 60-day timeline', () => {
  it('serves each wave once, on its own day, in order', () => {
    // Walk day by day, doing whatever is due. This is the spec's oracle: the schedule is correct if
    // a learner who simply complies lands on 0, 1-2, 7, 21 and 30-45 and nowhere else.
    const served: { day: number; wave: number }[] = [];
    let state = concept([]);

    for (let d = 0; d <= 60; d++) {
      const due = nextDue(state, day(d));
      if (due === null) continue;
      served.push({ day: d, wave: due.waveDay });
      state = concept([...state.opportunities, at(d, true)], state.probeMisses);
    }

    expect(served.map((s) => s.wave)).toEqual([0, 1, 7, 21, 30]);
    expect(served.map((s) => s.day)).toEqual([0, 1, 7, 21, 30]);
  });

  it('nothing is due before the first wave window opens', () => {
    // Day 0 done, so the next owed wave is day 1: it must not be served on day 0.
    const state = concept([at(0, true)]);
    expect(nextDue(state, day(0))).toBeNull();
    expect(nextDue(state, day(1))?.waveDay).toBe(1);
  });

  it('accepts a rep anywhere inside the day-1-2 and day-30-45 windows', () => {
    // The spec writes these two waves as ranges, so a rep on day 2 must satisfy the day-1 wave.
    const late = concept([at(0, true), at(2, true)]);
    expect(nextDue(late, day(2))).toBeNull();
    expect(nextDue(late, day(7))?.waveDay).toBe(7);

    const probed = concept([at(0, true), at(1, true), at(7, true), at(21, true), at(44, true)]);
    expect(nextDue(probed, day(44))).toBeNull();
  });

  it('reports how overdue a wave is, so spacing debt can be ranked', () => {
    const state = concept([at(0, true)]);
    expect(nextDue(state, day(9))?.overdueDays).toBe(8);
  });

  /**
   * THE IDS RUN AGAINST THE DEBT ORDER ON PURPOSE, and that is the whole content of this test.
   *
   * It used to use `a-stale` and `b-fresh`, which are alphabetically in the same order as they are by
   * spacing debt — so the correct comparator and a plain id sort produced identical output and the
   * test could not tell them apart. Measured: deleting `b.overdueDays - a.overdueDays` from
   * schedule.ts's comparator left all 23 tests in this file green, and the e2e spacing suite green
   * too, because its fixtures had the same shape. Q4's "longest-owed first" was unenforced
   * everywhere.
   *
   * So `z-stale` is the most overdue and LAST alphabetically, and `a-fresh` is the least overdue and
   * first. Debt order and id order now disagree, and only the real comparator gives debt order. The
   * id tiebreak still gets its own coverage below, where the debts are genuinely equal.
   */
  it('orders the due list most-overdue first, not by id', () => {
    const stale: ConceptState = { id: 'z-stale', firstSeen: T0, opportunities: [at(0, true)], probeMisses: 0 };
    const fresh: ConceptState = {
      id: 'a-fresh',
      firstSeen: day(8),
      opportunities: [{ at: day(8), correct: true }],
      probeMisses: 0,
    };
    const due = dueNow([fresh, stale], day(10));
    expect(due.map((d) => d.conceptId)).toEqual(['z-stale', 'a-fresh']);
    // The debts really are different, so the ordering above is a ranking and not a coincidence.
    expect(due[0].overdueDays).toBeGreaterThan(due[1].overdueDays);
  });

  /**
   * The tiebreak, which is the only thing the id comparison is for: two concepts with the SAME debt
   * must come back in a stable, documented order rather than in input order, so the queue does not
   * shuffle between paints. Input order here is deliberately the reverse of the expected output.
   */
  it('breaks a tie in spacing debt by id, so the queue is stable', () => {
    const second: ConceptState = { id: 'b-tied', firstSeen: T0, opportunities: [at(0, true)], probeMisses: 0 };
    const first: ConceptState = { id: 'a-tied', firstSeen: T0, opportunities: [at(0, true)], probeMisses: 0 };
    const due = dueNow([second, first], day(10));
    expect(due.map((d) => d.conceptId)).toEqual(['a-tied', 'b-tied']);
    expect(due[0].overdueDays, 'the debts must be equal for this to test the tiebreak').toBe(
      due[1].overdueDays,
    );
  });
});

describe('the beta-binomial posterior', () => {
  it('starts at the prior mean with no evidence, not at 0 or 1', () => {
    const p = posterior(concept([]), T0);
    expect(p.mean).toBeCloseTo(0.5, 10);
    expect(p.opportunities).toBe(0);
  });

  it('a single correct rep is not mastery', () => {
    // The prior exists precisely to refuse this: one lucky rep must not certify a skill.
    const p = posterior(concept([at(0, true)]), day(0));
    expect(p.mean).toBeLessThan(0.75);
    expect(gate(concept([at(0, true)]), day(0)).status).toBe('learning');
  });

  it('moves toward 1 with successes and toward 0 with failures', () => {
    const good = posterior(concept(Array.from({ length: 10 }, () => at(0, true))), day(0));
    const bad = posterior(concept(Array.from({ length: 10 }, () => at(0, false))), day(0));
    expect(good.mean).toBeGreaterThan(0.8);
    expect(bad.mean).toBeLessThan(0.2);
  });

  it('decays stale evidence by half over the half-life', () => {
    // The same twelve successes, read fresh and read one half-life later. Stale evidence must not
    // certify current skill, which is the whole reason P6 asks for a decay term.
    const reps = Array.from({ length: 12 }, () => at(0, true));
    const fresh = posterior(concept(reps), day(0));
    const stale = posterior(concept(reps), day(DECAY_HALF_LIFE_DAYS));
    expect(stale.mean).toBeLessThan(fresh.mean);
    // Twelve successes weighted 0.5 each is six, so alpha moves from 2+12 to 2+6.
    expect(stale.alpha).toBeCloseTo(PRIOR_PLUS(6), 6);
    expect(fresh.alpha).toBeCloseTo(PRIOR_PLUS(12), 6);
  });

  it('keeps the credible interval inside [0, 1]', () => {
    // A wide interval on thin evidence must not render as a negative or >100% bar.
    for (const n of [0, 1, 2, 5, 30]) {
      const p = posterior(concept(Array.from({ length: n }, () => at(0, true))), day(0));
      expect(p.ciLower).toBeGreaterThanOrEqual(0);
      expect(p.ciUpper).toBeLessThanOrEqual(1);
      expect(p.ciLower).toBeLessThanOrEqual(p.mean);
      expect(p.ciUpper).toBeGreaterThanOrEqual(p.mean);
    }
  });
});

/** Prior alpha plus weighted successes; spelled out so the decay assertion reads as arithmetic. */
function PRIOR_PLUS(successes: number): number {
  return 2 + successes;
}

describe('mastery gates (P5 gate B)', () => {
  it('will not certify mastery below the opportunity floor, however perfect', () => {
    // 11 straight successes is a better record than 12, and still must not pass: the floor is a
    // claim about evidence, not about performance.
    const eleven = concept(Array.from({ length: MIN_OPPORTUNITIES - 1 }, () => at(0, true)));
    expect(gate(eleven, day(0)).status).toBe('learning');
    expect(gate(eleven, day(0)).reason).toContain(`${MIN_OPPORTUNITIES - 1} of ${MIN_OPPORTUNITIES}`);
  });

  it('certifies at the floor when the posterior and its lower bound both clear', () => {
    const many = concept(Array.from({ length: 40 }, () => at(0, true)));
    const g = gate(many, day(0));
    expect(g.status).toBe('mastered');

    const p = posterior(many, day(0));
    expect(p.mean).toBeGreaterThanOrEqual(0.9);
    expect(p.ciLower).toBeGreaterThanOrEqual(0.85);
  });

  it('freezes at the hard cap instead of spinning, and says a worked example is next', () => {
    // 25 opportunities at ~60% never reaches 0.90, so more reps are wasted motion.
    const mixed = Array.from({ length: MAX_OPPORTUNITIES }, (_, i) => at(0, i % 5 !== 0));
    const g = gate(concept(mixed), day(0));
    expect(g.status).toBe('frozen');
    expect(g.reason).toContain('worked example');
  });

  it('a frozen concept stops being served', () => {
    const mixed = Array.from({ length: MAX_OPPORTUNITIES }, (_, i) => at(0, i % 5 !== 0));
    expect(nextDue(concept(mixed), day(60))).toBeNull();
  });

  it('a mastered concept NEVER exits rotation (Q5)', () => {
    // The distinction from freezing: mastery keeps its place in the queue, because the day-21 and
    // day-30-45 waves are what make the mastery durable rather than momentary.
    // Enough recent evidence to clear the gate at the moment it is read: reps decay, so a record
    // spread thinly across the waves is deliberately NOT mastery, and stacking them near `now` is
    // what a learner who actually did the 10-rep day-0 block plus both interleaved waves looks like.
    const mastered = concept([
      at(0, true),
      at(1, true),
      ...Array.from({ length: 30 }, () => at(7, true)),
    ]);
    expect(gate(mastered, day(7)).status).toBe('mastered');
    // Mastered, and still owed its day-21 wave — that is the whole of Q5.
    expect(nextDue(mastered, day(21))?.waveDay).toBe(21);
  });

  it('has no "N correct in a row" path: a streak alone certifies nothing', () => {
    // Explicitly forbidden by P5. Eight consecutive successes is a streak by any definition and
    // must still read as learning, because the opportunity floor has not been met.
    const streak = concept(Array.from({ length: 8 }, (_, i) => at(i, true)));
    expect(gate(streak, day(8)).status).toBe('learning');
  });
});

describe('probe misses (Q5)', () => {
  it('one miss reopens the contrast set and resets to a 7-day gap', () => {
    const outcome = onProbeMiss(concept([], 0));
    expect(outcome.reopenContrastSet).toBe(true);
    expect(outcome.nextGapDays).toBe(7);
    expect(outcome.returnToActiveLearning).toBe(false);
    expect(outcome.remainingOpportunities).toBeNull();
  });

  it('two misses return the concept to active learning with 6 opportunities, not a full reset', () => {
    // The asymmetry is deliberate: a full reset would discard the evidence of what WAS learned.
    const outcome = onProbeMiss(concept([], 1));
    expect(outcome.returnToActiveLearning).toBe(true);
    expect(outcome.remainingOpportunities).toBe(6);
  });
});

describe('freezing judges history, mastery judges freshness', () => {
  /**
   * The bug this guards, which I shipped and caught here: freezing originally read the DECAYED
   * posterior, so a concept with 30 successes — mastered on the day it was learned — slid into
   * 'frozen' six weeks later purely by going stale. Frozen concepts stop being served, so that
   * silently dropped a mastered concept out of rotation and contradicted Q5 outright. The learner
   * would simply never see it again, which is the exact failure spaced repetition exists to prevent.
   */
  it('a concept mastered long ago does not decay into frozen', () => {
    const learned = concept(Array.from({ length: 30 }, () => at(0, true)));
    expect(gate(learned, day(0)).status).toBe('mastered');

    // Six weeks later the same record must not read as frozen, however stale.
    const later = gate(learned, day(42));
    expect(later.status).not.toBe('frozen');
    // And it must still be served — that is the Q5 consequence the bug destroyed.
    expect(nextDue(learned, day(42))).not.toBeNull();
  });

  it('still freezes a concept that genuinely never learned, whenever it is read', () => {
    // The other half: the freeze must not become unreachable. 25 reps at ~60% is never mastery, so
    // it freezes both on the day it happened and long afterwards.
    const struggled = Array.from({ length: MAX_OPPORTUNITIES }, (_, i) => at(0, i % 5 !== 0));
    expect(gate(concept(struggled), day(0)).status).toBe('frozen');
    expect(gate(concept(struggled), day(60)).status).toBe('frozen');
  });
});
