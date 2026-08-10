import { describe, expect, it } from 'vitest';
import {
  CONSECUTIVE_DECLINES_TO_ASK,
  LEARNING_POSTERIOR,
  SOURCES,
  accept,
  decline,
  emptyRecommender,
  prefer,
  recommend,
  shouldAskPreference,
  type RecommendInput,
  type Suggestion,
} from '../../src/core/recommend.js';
import { MS_PER_DAY, type ConceptState } from '../../src/core/schedule.js';

/**
 * THE RECOMMENDER — PRODUCT-SPEC N2 ("one recommended next action", never a queue) and N4 (the override
 * log and its ask-once trigger).
 *
 * WHAT THE ORACLES ARE HERE. N2's central claim is negative — "it NEVER shows a ranked list" — and a
 * negative claim needs a structural oracle rather than a value check: what is asserted is that the
 * return type carries ONE suggestion and a COUNT, so no caller can reconstruct the queue. That is
 * checked by asserting the shape, and separately by asserting that `otherCandidates` is a number that
 * agrees with how many candidates the inputs should have produced.
 *
 * The ordering claims are asserted as PRIORITIES rather than as fixed strings: spacing debt must beat a
 * fluency gate, a frozen KC must route to an example rather than to reps (P5's "never another rep"), and
 * a leak must be ranked by COST rather than by count. Each of those is a spec sentence, and each is a
 * different failure if it inverts.
 *
 * NOTHING READS THE CLOCK, so `now` is passed everywhere and every test places the learner at an exact
 * point in the spacing schedule. `DAY` below is that anchor.
 */

const DAY = MS_PER_DAY;
/** A fixed "now" so nothing depends on the real date. Day 100 of the learner's history. */
const NOW = 100 * DAY;

/**
 * A concept with `hits` of `reps` opportunities, all recorded `recordedDaysAgo` ago.
 *
 * `firstSeenDaysAgo: 0` IS THE "NOT YET DUE" CASE, and it has to be measured rather than guessed: the
 * day-0 wave window opens immediately, so a concept first seen even ONE day ago is already overdue and
 * spacing debt swallows every other family. My first version of these tests used 1-3 days for "not yet
 * due" and four assertions failed for that reason alone (scripts/audit-w6/a32-due-windows.ts).
 */
function concept(id: string, opts: { firstSeenDaysAgo: number; reps: number; hits: number; recordedDaysAgo?: number; probeMisses?: number }): ConceptState {
  const at = NOW - (opts.recordedDaysAgo ?? 0) * DAY;
  return {
    id,
    firstSeen: NOW - opts.firstSeenDaysAgo * DAY,
    opportunities: Array.from({ length: opts.reps }, (_, i) => ({ at, correct: i < opts.hits })),
    probeMisses: opts.probeMisses ?? 0,
  };
}

function input(over: Partial<RecommendInput> = {}): RecommendInput {
  return {
    concepts: [],
    leaks: [],
    recommender: emptyRecommender(),
    now: NOW,
    ...over,
  };
}

/** Fail loudly rather than optional-chaining past a null: a missing suggestion is a finding. */
function must(suggestion: Suggestion | null, where: string): Suggestion {
  if (suggestion === null) throw new Error(`${where}: expected a suggestion, got null`);
  return suggestion;
}

describe('N2 — one suggestion, never a queue', () => {
  it('returns a single suggestion object, not an array', () => {
    /*
     * THE STRUCTURAL ORACLE for N2's negative claim. A screen cannot render a queue it was never given,
     * so the type is the enforcement: if this ever becomes an array, every caller could paginate it and
     * the soft lock the spec forbids becomes one refactor away.
     */
    const suggestion = must(
      recommend(input({ concepts: [concept('c1', { firstSeenDaysAgo: 0, reps: 4, hits: 1 })] })),
      'single suggestion',
    );
    expect(Array.isArray(suggestion)).toBe(false);
    expect(typeof suggestion.action).toBe('string');
    expect(typeof suggestion.reason).toBe('string');
    // The count is a NUMBER, deliberately: honest about there being more without being a list.
    expect(typeof suggestion.otherCandidates).toBe('number');
    // And there is no field anywhere carrying the other candidates.
    for (const value of Object.values(suggestion)) {
      expect(Array.isArray(value), 'a suggestion carries a list, which N2 forbids').toBe(false);
    }
  });

  it('reports how many other candidates existed without naming them', () => {
    // Three overdue concepts: one is suggested and the other two are a count.
    const concepts = [
      concept('a', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 }),
      concept('b', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 }),
      concept('c', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 }),
    ];
    const suggestion = must(recommend(input({ concepts })), 'three candidates');
    expect(suggestion.otherCandidates).toBeGreaterThan(0);
    // The suggested subject is one of the three, and the others are not enumerated anywhere.
    expect(['a', 'b', 'c']).toContain(suggestion.subject);
  });

  it('carries the numbers in its reason, because a reason without them is a slogan', () => {
    // The spec's own example — "P4 range role: 8/10 correct but median 3.1 s, target 2.5 s" — is
    // numeric, so a reason with no digits in it fails the intent even if it reads well.
    const suggestion = must(
      recommend(input({ concepts: [concept('range-role', { firstSeenDaysAgo: 0, reps: 10, hits: 4 })] })),
      'numeric reason',
    );
    expect(suggestion.reason, `reason had no numbers: "${suggestion.reason}"`).toMatch(/\d/);
    expect(suggestion.reason.length).toBeGreaterThan(10);
  });

  it('returns null on a fresh profile rather than inventing an action', () => {
    // A fabricated suggestion on an empty profile would be the app pretending to know something.
    expect(recommend(input())).toBe(null);
  });

  it('is deterministic — the same inputs always give the same suggestion', () => {
    // Otherwise the recommendation would flicker between reloads, which reads as a bug and destroys
    // any trust in it.
    const concepts = [
      concept('alpha', { firstSeenDaysAgo: 40, reps: 2, hits: 1, recordedDaysAgo: 40 }),
      concept('beta', { firstSeenDaysAgo: 40, reps: 2, hits: 1, recordedDaysAgo: 40 }),
    ];
    const leaks = [{ principle: 'overfold', count: 3, costBb: 4 }];
    const first = must(recommend(input({ concepts, leaks })), 'first');
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(recommend(input({ concepts, leaks })))).toBe(JSON.stringify(first));
    }
  });
});

describe('the input families are ranked the way the spec orders them', () => {
  it('spacing debt outranks a fluency gate, because a decayed concept is losing what was paid for', () => {
    /*
     * Q4 calls the spacing schedule the only retention measurement in the system. A rep on an overdue
     * concept recovers something already learned; a rep on a weak new concept only adds. So debt wins,
     * and this test puts the two in direct competition rather than checking each alone.
     */
    const overdue = concept('spaced', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 });
    const weak = concept('weak', { firstSeenDaysAgo: 0, reps: 12, hits: 3 });
    const suggestion = must(recommend(input({ concepts: [weak, overdue] })), 'debt vs gate');
    expect(suggestion.source).toBe('spacing-debt');
    expect(suggestion.subject).toBe('spaced');
  });

  it('the MOST overdue concept wins among several debts', () => {
    const concepts = [
      concept('slightly', { firstSeenDaysAgo: 8, reps: 1, hits: 1, recordedDaysAgo: 8 }),
      concept('badly', { firstSeenDaysAgo: 60, reps: 1, hits: 1, recordedDaysAgo: 60 }),
    ];
    const suggestion = must(recommend(input({ concepts })), 'most overdue');
    expect(suggestion.subject).toBe('badly');
    expect(suggestion.reason).toMatch(/past its day-\d+ wave/);
  });

  it('ranks a leak by COST, not by how often it happened', () => {
    /*
     * The lesson session.ts already carries in a comment: ranking by frequency buries one 20 bb blunder
     * under five 0.6 bb ones. This is the test that would catch a revert to count-ranking.
     */
    const leaks = [
      { principle: 'frequent-cheap', count: 20, costBb: 2 },
      { principle: 'rare-expensive', count: 1, costBb: 25 },
    ];
    const suggestion = must(recommend(input({ leaks })), 'cost ranking');
    expect(suggestion.source).toBe('error-tag');
    expect(suggestion.subject, 'the recommender ranked a leak by count instead of cost').toBe(
      'rare-expensive',
    );
  });

  it('ignores a zero-cost leak, which is a tag rather than a leak', () => {
    const suggestion = recommend(input({ leaks: [{ principle: 'harmless', count: 9, costBb: 0 }] }));
    expect(suggestion, 'a costless tag was recommended as a leak').toBe(null);
  });

  it('every source can actually win, so no family is dead code', () => {
    /*
     * A ranking with an unreachable branch is a spec requirement that silently does not exist. Each
     * source is given a scenario where nothing else competes, which is the only honest way to show all
     * four families are live.
     */
    const wins = new Set<string>();

    wins.add(
      must(recommend(input({ concepts: [concept('d', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 })] })), 'debt').source,
    );
    // A weak, not-yet-due concept: learning, posterior below the threshold.
    wins.add(must(recommend(input({ concepts: [concept('w', { firstSeenDaysAgo: 0, reps: 12, hits: 2 })] })), 'gate').source);
    // A strong, not-yet-due concept: learning, posterior above the threshold.
    wins.add(must(recommend(input({ concepts: [concept('s', { firstSeenDaysAgo: 0, reps: 12, hits: 11 })] })), 'mastery').source);
    wins.add(must(recommend(input({ leaks: [{ principle: 'lk', count: 2, costBb: 6 }] })), 'leak').source);

    for (const source of SOURCES) {
      expect(wins, `no scenario lets ${source} win, so that branch is unreachable`).toContain(source);
    }
  });

  it('a concept below the learning threshold is a gate candidate, above it is a mastery one', () => {
    // The threshold is the boundary between "not approached" and "nearly passed", and the two produce
    // different advice, so it is asserted on both sides rather than at one point.
    const below = must(recommend(input({ concepts: [concept('lo', { firstSeenDaysAgo: 0, reps: 12, hits: 4 })] })), 'below');
    expect(below.source).toBe('fluency-gate');

    const above = must(recommend(input({ concepts: [concept('hi', { firstSeenDaysAgo: 0, reps: 12, hits: 11 })] })), 'above');
    expect(above.source).toBe('mastery');
    // And the boundary is the constant, not a magic number repeated here.
    expect(LEARNING_POSTERIOR).toBeGreaterThan(0);
    expect(LEARNING_POSTERIOR).toBeLessThan(1);
  });
});

describe('P5 — a frozen concept is routed to an example, never to another rep', () => {
  it('recommends the worked example and does not say "drill"', () => {
    /*
     * P5's hard cap: at 25 opportunities the KC freezes, "surface the error signature, route to a worked
     * example, NEVER another rep". A recommender that suggested more reps on a frozen KC would be
     * contradicting the gate that froze it — the exact contradiction this test exists to prevent.
     */
    const frozen = concept('capped', { firstSeenDaysAgo: 0, reps: 30, hits: 12 });
    const suggestion = must(recommend(input({ concepts: [frozen] })), 'frozen');
    expect(suggestion.source).toBe('fluency-gate');
    expect(suggestion.action.toLowerCase(), `a frozen KC was sent back to reps: "${suggestion.action}"`).not.toContain(
      'drill',
    );
    expect(suggestion.action.toLowerCase()).toContain('example');
    expect(suggestion.reason).toMatch(/cap/i);
  });

  it('prefers the frozen example over another concept ordinary reps', () => {
    const frozen = concept('capped', { firstSeenDaysAgo: 0, reps: 30, hits: 12 });
    const learning = concept('learning', { firstSeenDaysAgo: 0, reps: 12, hits: 4 });
    const suggestion = must(recommend(input({ concepts: [frozen, learning] })), 'frozen vs learning');
    expect(suggestion.subject).toBe('capped');
  });
});

describe('N4 — every override is logged, and five in a row asks once', () => {
  it('logs {timestamp, recommended, chosen} exactly as the spec names them', () => {
    const suggestion = must(recommend(input({ leaks: [{ principle: 'lk', count: 1, costBb: 5 }] })), 'to decline');
    const state = decline(emptyRecommender(), suggestion, 'charts', 12345);
    expect(state.overrides).toHaveLength(1);
    expect(state.overrides[0]).toEqual({ timestamp: 12345, recommended: 'lk', chosen: 'charts' });
  });

  it('records a decline with no named alternative honestly, rather than inventing one', () => {
    const suggestion = must(recommend(input({ leaks: [{ principle: 'lk', count: 1, costBb: 5 }] })), 'to decline');
    const state = decline(emptyRecommender(), suggestion, '', 1);
    expect(state.overrides[0].chosen, 'an unnamed alternative was fabricated').toBe('');
  });

  it('asks only after five CONSECUTIVE declines, and an acceptance resets the run', () => {
    /*
     * N4's trigger is about a pattern, not a tally: a learner who takes four suggestions and skips one
     * is not overriding the recommender. So the reset on acceptance is the load-bearing half, and it is
     * asserted by interrupting a run of declines.
     */
    const suggestion = must(recommend(input({ leaks: [{ principle: 'lk', count: 1, costBb: 5 }] })), 'to decline');
    let state = emptyRecommender();

    for (let i = 1; i < CONSECUTIVE_DECLINES_TO_ASK; i++) {
      state = decline(state, suggestion, '', i);
      expect(shouldAskPreference(state), `asked after only ${i} declines`).toBe(false);
    }
    state = decline(state, suggestion, '', CONSECUTIVE_DECLINES_TO_ASK);
    expect(shouldAskPreference(state), 'did not ask at the threshold').toBe(true);

    // Four declines, one acceptance, four more: still no ask, because the run was broken.
    let broken = emptyRecommender();
    for (let i = 0; i < 4; i++) broken = decline(broken, suggestion, '', i);
    broken = accept(broken);
    expect(broken.consecutiveDeclines).toBe(0);
    for (let i = 0; i < 4; i++) broken = decline(broken, suggestion, '', 10 + i);
    expect(shouldAskPreference(broken), 'an acceptance did not reset the decline run').toBe(false);
    // But the log keeps all eight: an acceptance forgives the run, it does not erase the history.
    expect(broken.overrides).toHaveLength(8);
  });

  it('a stated preference reorders families but cannot outrank spacing debt', () => {
    /*
     * The weighting adjustment N4 promises, bounded deliberately. A learner may say what they would
     * rather work on, and that reorders the families — but it must not switch off the only retention
     * mechanism in the system, so debt still wins. Both halves are asserted, because a preference that
     * changed nothing would satisfy a one-sided test.
     */
    const weak = concept('weak', { firstSeenDaysAgo: 0, reps: 12, hits: 3 });
    const leaks = [{ principle: 'lk', count: 1, costBb: 3 }];

    // Without a preference the weak concept's gate wins over the leak.
    expect(must(recommend(input({ concepts: [weak], leaks })), 'no preference').source).toBe('fluency-gate');

    // With error-tag preferred, the leak comes first: the preference DID something.
    const preferring = prefer(emptyRecommender(), 'error-tag');
    expect(
      must(recommend(input({ concepts: [weak], leaks, recommender: preferring })), 'preferring leaks').source,
    ).toBe('error-tag');

    // But debt still outranks the preferred family.
    const overdue = concept('spaced', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 });
    expect(
      must(recommend(input({ concepts: [weak, overdue], leaks, recommender: preferring })), 'debt vs preference')
        .source,
      'a stated preference overrode the spacing schedule',
    ).toBe('spacing-debt');
  });

  it('answering the question clears the run so it is asked ONCE', () => {
    const suggestion = must(recommend(input({ leaks: [{ principle: 'lk', count: 1, costBb: 5 }] })), 'to decline');
    let state = emptyRecommender();
    for (let i = 0; i < CONSECUTIVE_DECLINES_TO_ASK; i++) state = decline(state, suggestion, '', i);
    expect(shouldAskPreference(state)).toBe(true);
    state = prefer(state, 'mastery');
    expect(shouldAskPreference(state), 'the question would be asked again immediately').toBe(false);
    expect(state.preferred).toContain('mastery');
  });

  it('does not duplicate a preference stated twice', () => {
    const once = prefer(emptyRecommender(), 'mastery');
    const twice = prefer(once, 'mastery');
    expect(twice.preferred).toEqual(['mastery']);
  });
});

describe('N1 — a recommendation gates nothing', () => {
  it('never returns anything that reads as a lock or a requirement', () => {
    /*
     * N1 is a property of the WORDS here, because this module's output is rendered as prose. A
     * suggestion that says "locked", "unlock", or "you must" would install the soft lock the spec
     * forbids, even with every surface still reachable.
     */
    const scenarios: RecommendInput[] = [
      input({ concepts: [concept('a', { firstSeenDaysAgo: 40, reps: 1, hits: 1, recordedDaysAgo: 40 })] }),
      input({ concepts: [concept('b', { firstSeenDaysAgo: 0, reps: 12, hits: 2 })] }),
      input({ concepts: [concept('c', { firstSeenDaysAgo: 0, reps: 30, hits: 12 })] }),
      input({ leaks: [{ principle: 'lk', count: 4, costBb: 9 }] }),
    ];
    const banned = ['lock', 'unlock', 'you must', 'not allowed', 'complete first', 'required before'];
    for (const scenario of scenarios) {
      const suggestion = must(recommend(scenario), 'wording');
      const text = `${suggestion.action} ${suggestion.reason}`.toLowerCase();
      for (const word of banned) {
        expect(text, `"${word}" appears in "${text}" — N1 forbids gating language`).not.toContain(word);
      }
    }
  });
});
