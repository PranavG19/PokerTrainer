import { describe, it, expect } from 'vitest';
import {
  BLOCK_KINDS,
  CUT_ORDER,
  DEFAULT_SESSION_MINUTES,
  MINUTES_PER_GRADED_SPOT,
  MIN_GRADED_SPOTS,
  SESSION_LENGTHS,
  SHARES,
  assemble,
  minutesByKind,
  type PlanResult,
  type SessionPlan,
} from '../../src/core/sessionPlan.js';

/**
 * SESSION ASSEMBLY — the oracle PRODUCT-SPEC's testing table names:
 *
 *   "30- and 50-minute assemblies asserted against the S1 table and the S2 drop order; assert that no
 *    15-minute session can be constructed (S2a)"
 *
 * sessionPlan.ts is fully written and had NO test file at all, which is why this exists. Every
 * expectation below comes from the SPEC's numbers rather than from whatever the module returns — a
 * test that reads its expectations out of the implementation is self-consistency, not verification.
 */

/** Fail loudly rather than silently skipping: an `ok: false` where a plan was expected is a finding. */
function planOf(result: PlanResult, where: string): SessionPlan {
  if (!result.ok) throw new Error(`${where}: assemble refused — ${result.reason}`);
  return result.plan;
}

const sessionAt = (durationMinutes: number, dueProbes = 4): PlanResult =>
  assemble({ durationMinutes, mode: 'session', dueProbes });

describe('S1 — one button, two lengths', () => {
  it('offers exactly 30 and 50 minutes, defaulting to 30', () => {
    // S2a: 15 is not a session length. Asserting the exact set is what stops one being added quietly.
    expect([...SESSION_LENGTHS].sort((a, b) => a - b)).toEqual([30, 50]);
    expect(DEFAULT_SESSION_MINUTES).toBe(30);
    expect([...SESSION_LENGTHS]).not.toContain(15);
  });

  it('assembles both documented lengths within their budget', () => {
    for (const minutes of SESSION_LENGTHS) {
      const plan = planOf(sessionAt(minutes), `${minutes} minutes`);
      expect(plan.totalMinutes, `${minutes}-minute assembly overruns its budget`).toBeLessThanOrEqual(
        minutes,
      );
      // A plan that assembled nothing would satisfy the bound above, so assert it is real work.
      expect(plan.blocks.length, `${minutes}-minute assembly is empty`).toBeGreaterThan(0);
      // totalMinutes must describe the blocks, not be tracked separately and allowed to drift.
      const summed = plan.blocks.reduce((sum, block) => sum + block.minutes, 0);
      expect(plan.totalMinutes, `${minutes}: totalMinutes disagrees with its own blocks`).toBeCloseTo(
        summed,
        6,
      );
    }
  });

  it('matches the S1 share ordering at 50 minutes, where every block scales', () => {
    // 50 is the reference row of the spec's table: at 30 the non-scaling floors distort the shares,
    // so the proportions are only checkable at the length the table is written for.
    const byKind = minutesByKind(planOf(sessionAt(50), '50 minutes'));

    // Graded spots are the largest block by design (48%).
    for (const kind of BLOCK_KINDS) {
      if (kind === 'graded-spots') continue;
      expect(
        byKind['graded-spots'],
        `graded-spots (${byKind['graded-spots']}) should be >= ${kind} (${byKind[kind]})`,
      ).toBeGreaterThanOrEqual(byKind[kind]);
    }
    // Remediation (20%) is second, ahead of whole-task live play (14%).
    expect(byKind['contrast-remediation']).toBeGreaterThanOrEqual(byKind['whole-task']);
  });

  it('declares a share for every block kind, with no orphan on either side', () => {
    // A kind with no share, or a share with no kind, means one of the two lists was edited alone.
    expect(Object.keys(SHARES).sort()).toEqual([...BLOCK_KINDS].sort());
    const total = BLOCK_KINDS.reduce((sum, kind) => sum + SHARES[kind], 0);
    expect(total, 'the S1 shares must sum to 1').toBeCloseTo(1, 6);
  });
});

describe('S2 — the degradation order is explicit', () => {
  /**
   * "Under time pressure, cut in this order: whole-task → warm-up length → graded spot count. Never
   * cut decay probes and never cut remediation below one contrast set."
   */
  it('never cuts decay probes when probes are owed', () => {
    for (const minutes of SESSION_LENGTHS) {
      const byKind = minutesByKind(planOf(sessionAt(minutes), `${minutes} minutes`));
      expect(byKind['decay-probes'], `${minutes} minutes dropped the decay probes`).toBeGreaterThan(0);
    }
  });

  it('never cuts remediation below one contrast set', () => {
    for (const minutes of SESSION_LENGTHS) {
      const byKind = minutesByKind(planOf(sessionAt(minutes), `${minutes} minutes`));
      expect(byKind['contrast-remediation'], `${minutes} minutes dropped remediation`).toBeGreaterThan(0);
    }
  });

  it('keeps at least one warm-up block, the S2b floor', () => {
    // S2b: the cut order applies to warm-up length ABOVE one block, never below it, because a partial
    // PLM block is not a fluency measurement.
    for (const minutes of SESSION_LENGTHS) {
      const byKind = minutesByKind(planOf(sessionAt(minutes), `${minutes} minutes`));
      expect(byKind['warm-up'], `${minutes} minutes has no warm-up`).toBeGreaterThan(0);
    }
  });

  it('cuts whole-task before anything else, and names what it cut', () => {
    const short = planOf(sessionAt(30), '30 minutes');
    const long = planOf(sessionAt(50), '50 minutes');
    expect(minutesByKind(short)['whole-task']).toBeLessThanOrEqual(
      minutesByKind(long)['whole-task'],
    );

    /*
     * The cuts are reported, not silent: a learner told "30 minutes" should be able to see what a
     * shorter sitting gave up.
     *
     * A Cut names a `target` from CUT_ORDER — NOT a BlockKind. I first wrote `cut.kind` against the
     * block vocabulary, which typechecks nowhere and made the assertion vacuous (`.not.toContain(
     * undefined)` is always true). The structural guarantee is stronger than an exclusion list anyway:
     * probes and remediation are not expressible as cut targets at all, so S2's two protected blocks
     * cannot be cut even by a future bug.
     */
    expect(short.cuts.length, 'a 30-minute session cuts something and must say so').toBeGreaterThan(0);
    for (const cut of short.cuts) {
      expect(CUT_ORDER, `${cut.target} is not a declared cut target`).toContain(cut.target);
      expect(cut.minutesRemoved, `${cut.target} was reported as a cut of zero minutes`).toBeGreaterThan(0);
    }
    expect(short.cuts[0].target, 'whole-task must be the first thing cut').toBe('whole-task');
  });

  it('reports multiple cuts in CUT_ORDER, not in the order they were discovered', () => {
    /*
     * ASSERTED AT 24 MINUTES, NOT 30, and that is the whole point of this test existing separately.
     * A 30-minute session records exactly ONE cut (whole-task), so an ordering assertion there is
     * blind — I proved it: reversing the cut list in the source left the test green, because reversing
     * a one-element list is a no-op. 24 minutes is the shortest duration that cuts twice
     * (scripts/audit-w6/a25-session-floor.ts), so it is the only place the ORDER is observable.
     */
    const plan = planOf(sessionAt(24), '24 minutes');
    const targets = plan.cuts.map((cut) => cut.target);
    expect(targets.length, '24 minutes must cut more than once for this test to mean anything').toBeGreaterThan(
      1,
    );
    expect(targets, 'S2 requires whole-task to be cut before graded spots').toEqual([
      'whole-task',
      'graded-spot-count',
    ]);

    const positions = targets.map((target) => CUT_ORDER.indexOf(target));
    expect(positions, 'cuts are not reported in CUT_ORDER').toEqual([...positions].sort((a, b) => a - b));
  });

  it('reports fewer probe minutes when fewer are owed, rather than inventing them', () => {
    // "fixed count 4, or fewer if none due". A probe with nothing to probe is a fabricated
    // measurement, which is worse than a shorter session.
    const none = minutesByKind(planOf(sessionAt(50, 0), '50 minutes, no probes due'));
    const some = minutesByKind(planOf(sessionAt(50, 4), '50 minutes, 4 probes due'));
    expect(none['decay-probes']).toBeLessThan(some['decay-probes']);
    expect(none['decay-probes']).toBe(0);
  });

  it('gives the time freed by unowed probes to graded spots rather than losing it', () => {
    /*
     * The empty-spacing-queue edge case: with nothing owed, the sitting must not simply be shorter.
     *
     * MEASURED IN SPOTS, NOT MINUTES — my first version of this compared totalMinutes and failed at
     * 49.25 vs 49.5, which is not a defect: 3 freed probe minutes buy 2 whole graded spots (2.5 min)
     * and the 0.5 min remainder is deliberately unspent, because the module floors every proportional
     * budget to whole units ("half an atom is not a smaller measurement, it is no measurement"). Spot
     * count is the quantity the reallocation is actually denominated in, so it is what to assert:
     * 21 spots at 0 probes due against 19 at 4 (scripts/audit-w6/a25-session-floor.ts).
     */
    const spotsAt = (dueProbes: number): number => {
      const plan = planOf(sessionAt(50, dueProbes), `50 minutes, ${dueProbes} probes due`);
      return plan.blocks.find((b) => b.kind === 'graded-spots')?.units ?? 0;
    };
    expect(spotsAt(0)).toBeGreaterThan(spotsAt(4));

    // And monotonically: every probe not owed is time back, never time lost.
    let previous = Infinity;
    for (const due of [0, 1, 2, 3, 4]) {
      const spots = spotsAt(due);
      expect(spots, `${due} probes due bought MORE graded spots than ${due - 1} did`).toBeLessThanOrEqual(
        previous,
      );
      previous = spots;
    }
  });
});

describe('S2a — a 15-minute session cannot be constructed', () => {
  /**
   * The spec's reasoning: at 15 minutes the non-scaling floors — one warm-up block (~4 min), four
   * decay probes (~3 min), one contrast set (~5 min), scoreboard (~2 min) — consume ~14 of the 15,
   * leaving room for about one graded spot, which cannot satisfy Q1's interleaving constraint. Since
   * S2 forbids cutting the floors, a 15-minute "session" is a warm-up mislabelled as practice.
   *
   * The honest outcome is a REFUSAL WITH A REASON — free-roam is what serves a short sitting.
   */
  it('refuses, and says why', () => {
    const result = sessionAt(15);
    expect(result.ok, '15 minutes assembled a session, which S2a forbids').toBe(false);
    if (!result.ok) {
      expect(result.reason.length, 'a refusal with no reason is not honest').toBeGreaterThan(0);
    }
  });

  it('refuses on the interleaving floor, at exactly 22.75 minutes', () => {
    /*
     * The boundary, derived rather than picked. S2a refuses 15 minutes because the uncuttable floors
     * (4 warm-up + 3 probes + 5 contrast + 2 scoreboard = 14) leave no room for Q1's 7 interleaved
     * graded spots at 1.25 min each — so the shortest assemblable session is 14 + 8.75 = 22.75.
     *
     * NOT "anything under 30". I asserted that first and it is false: 23 and 29 both assemble, and
     * they should — SESSION_LENGTHS is what the UI OFFERS, while assemble() is a pure function whose
     * floor is the interleaving requirement. Conflating the two would have pinned a UI choice as an
     * engine invariant.
     */
    const SHORTEST_SESSION = 14 + MIN_GRADED_SPOTS * MINUTES_PER_GRADED_SPOT;
    expect(SHORTEST_SESSION).toBe(22.75);

    for (const minutes of [1, 5, 15, 20, 22, 22.5]) {
      const result = sessionAt(minutes);
      expect(result.ok, `${minutes} minutes should not assemble a session`).toBe(false);
      // The refusal must name the real obstacle, so a learner is not told "no" without a route.
      if (!result.ok) expect(result.reason).toMatch(/free-roam|uncuttable/);
    }
    expect(sessionAt(SHORTEST_SESSION).ok, `${SHORTEST_SESSION} min is the floor and must assemble`).toBe(
      true,
    );

    // Every spot below the floor is short by design: fewer than 7 graded spots fit.
    const justBelow = sessionAt(22.5);
    if (!justBelow.ok) expect(justBelow.reason).toContain(`needs ${MIN_GRADED_SPOTS}`);
  });

  it('serves the same short sitting as free-roam instead', () => {
    // The refusal is only honest if there IS another route — otherwise it is a locked door, which N1
    // forbids. Free-roam must accept exactly what a session refuses.
    const roam = assemble({ durationMinutes: 15, mode: 'free-roam', dueProbes: 4 });
    expect(roam.ok, 'free-roam refused a short sitting, leaving no way to practise at all').toBe(true);
  });
});

describe('S3 — free-roam is first-class', () => {
  it('fires no decay probes, which is what makes it not a session', () => {
    // "Modes entered outside a session behave identically except: decay probes never fire, and
    // remediation defers to the next session rather than firing inline."
    const plan = planOf(
      assemble({ durationMinutes: 30, mode: 'free-roam', dueProbes: 4 }),
      'free-roam 30',
    );
    expect(
      minutesByKind(plan)['decay-probes'],
      'free-roam fired decay probes, so it is a session wearing another name',
    ).toBe(0);
  });

  it('defers remediation rather than skipping it', () => {
    // Deferred and skipped are different facts: a skipped repair never happens, a deferred one is
    // owed. The flag exists so the next session can collect it.
    const plan = planOf(
      assemble({ durationMinutes: 30, mode: 'free-roam', dueProbes: 4 }),
      'free-roam 30',
    );
    expect(plan.remediationDeferred).toBe(true);

    const session = planOf(sessionAt(30), 'session 30');
    expect(session.remediationDeferred).toBe(false);
  });

  it('still assembles real work, so a short sitting is practice rather than nothing', () => {
    for (const minutes of [15, 30, 50]) {
      const plan = planOf(
        assemble({ durationMinutes: minutes, mode: 'free-roam', dueProbes: 4 }),
        `free-roam ${minutes}`,
      );
      expect(plan.blocks.length, `free-roam at ${minutes} minutes assembled nothing`).toBeGreaterThan(0);
      expect(plan.totalMinutes).toBeLessThanOrEqual(minutes);
    }
  });
});

describe('the assembly is a pure function of its request', () => {
  it('is deterministic — no clock, no RNG', () => {
    // sessionPlan.ts's header claims "nothing reads the clock or the RNG, so assemble at 23 minutes is
    // as testable as at 50". Asserted rather than trusted: two identical requests must agree exactly.
    for (const minutes of [23, 30, 37, 50]) {
      const first = sessionAt(minutes, 2);
      const second = sessionAt(minutes, 2);
      expect(JSON.stringify(second), `${minutes} minutes is not deterministic`).toBe(
        JSON.stringify(first),
      );
    }
  });

  it('never overruns its budget at any duration, documented or not', () => {
    // assemble() is a pure function and a caller can pass anything; overrunning silently is the
    // failure mode worth pinning, and a refusal is always an acceptable answer.
    for (const minutes of [0, 1, 23, 37, 120, 600]) {
      for (const mode of ['session', 'free-roam'] as const) {
        const result = assemble({ durationMinutes: minutes, mode, dueProbes: 4 });
        if (result.ok) {
          expect(
            result.plan.totalMinutes,
            `${mode} at ${minutes} minutes overran its budget`,
          ).toBeLessThanOrEqual(minutes);
        }
      }
    }
  });

  it('is monotone in duration: more time never yields less work', () => {
    // A longer sitting producing a smaller plan would mean the share arithmetic inverts somewhere.
    let previous = 0;
    for (const minutes of [30, 40, 50, 60]) {
      const result = sessionAt(minutes);
      if (!result.ok) continue;
      expect(result.plan.totalMinutes, `${minutes} minutes yielded less than a shorter session`).toBeGreaterThanOrEqual(
        previous - 0.25,
      );
      previous = result.plan.totalMinutes;
    }
  });
});
