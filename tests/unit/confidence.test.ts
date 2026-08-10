import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_CELLS,
  CONFIDENCE_WEIGHT,
  COMMIT_BUDGET_MS,
  GUESS_MIN_MS,
  LATENCY_WINDOW,
  PERSISTENT_DISAGREEMENTS,
  ROUTES,
  SUPPORT_RANK,
  SURE_MAX_MS,
  SURE_WRONG_SCHEDULE,
  assertSureWrongSpacing,
  cellFor,
  confidenceOf,
  isWrongCell,
  latencyCrossCheck,
  latencyDisagreement,
  rankRemediation,
  route,
  routeFor,
  supportRank,
  type ConfidenceCell,
  type LatencyCheck,
  type RemediationCandidate,
  type ScheduledRep,
} from '../../src/core/confidence.js';
import { RT_THRESHOLD_MS } from '../../src/core/anomaly.js';
import { WAVES } from '../../src/core/schedule.js';
import type { Confidence, PredictOutcome, Prediction } from '../../src/core/predict.js';
import { predictOutcome } from '../../src/core/predict.js';

const commit = (confidence: Confidence): Prediction => ({ action: 'raise', confidence });

const checks = (...pairs: [Confidence, number][]): LatencyCheck[] =>
  pairs.map(([confidence, commitMs]) => ({ confidence, commitMs }));

const repeat = (confidence: Confidence, commitMs: number, times: number): LatencyCheck[] =>
  Array.from({ length: times }, () => ({ confidence, commitMs }));

describe('the 2x2 — G8, every cell present exactly once', () => {
  it('has four cells and a route for each', () => {
    expect(CONFIDENCE_CELLS).toEqual(['sure-correct', 'sure-wrong', 'guess-correct', 'guess-wrong']);
    for (const cell of CONFIDENCE_CELLS) {
      expect(route(cell).cell, cell).toBe(cell);
    }
  });

  it('gives the four cells four DIFFERENT support levels — no two cells share a treatment', () => {
    const supports = CONFIDENCE_CELLS.map((cell) => route(cell).support);
    expect(new Set(supports).size).toBe(4);
  });

  it('SURE-correct is the principle name and nothing else', () => {
    const r = route('sure-correct');
    expect(r.support).toBe('principle-name-only');
    expect(r.workedExample).toBe(false);
    expect(r.schedule).toEqual([]);
    expect(r.immediateReserve).toBe(false);
    expect(r.difficultyUp).toBe(false);
    expect(r.repetition).toBe('standard');
    expect(r.highestValue).toBe(false);
  });

  it('GUESS-correct gets the full elaboration', () => {
    expect(route('guess-correct').support).toBe('full-elaboration');
  });

  it('GUESS-wrong gets a terse correction plus a worked example and higher repetition', () => {
    const r = route('guess-wrong');
    expect(r.support).toBe('terse-correction-plus-worked-example');
    expect(r.workedExample).toBe(true);
    expect(r.repetition).toBe('higher');
    // The worked example is the only extra; the correction itself stays terse, so no schedule.
    expect(r.schedule).toEqual([]);
    expect(r.immediateReserve).toBe(false);
  });

  it('SURE-wrong carries the causal chain, difficulty up, and is the highest-value event', () => {
    const r = route('sure-wrong');
    expect(r.support).toBe('full-causal-chain');
    expect(r.difficultyUp).toBe(true);
    expect(r.highestValue).toBe(true);
    expect(r.immediateReserve).toBe(true);
  });

  it('exactly one cell is the highest-value event, and exactly one raises difficulty', () => {
    expect(CONFIDENCE_CELLS.filter((c) => route(c).highestValue)).toEqual(['sure-wrong']);
    expect(CONFIDENCE_CELLS.filter((c) => route(c).difficultyUp)).toEqual(['sure-wrong']);
  });

  it('only GUESS-wrong carries a worked example', () => {
    expect(CONFIDENCE_CELLS.filter((c) => route(c).workedExample)).toEqual(['guess-wrong']);
  });

  it('only GUESS-wrong raises repetition — G8 attaches "higher repetition" to that cell alone', () => {
    expect(CONFIDENCE_CELLS.filter((c) => route(c).repetition === 'higher')).toEqual(['guess-wrong']);
  });

  it('every route explains itself without praising or labelling the learner', () => {
    for (const cell of CONFIDENCE_CELLS) {
      const { rationale } = route(cell);
      expect(rationale.length, cell).toBeGreaterThan(20);
      // G3/V2: no congratulation anywhere in the routing layer. G7: no trait labels.
      expect(rationale.toLowerCase(), cell).not.toMatch(/\b(nice|great|well done|good job|you're|you are)\b/);
    }
  });
});

/**
 * THE ASYMMETRY. This is the defect most likely to ship: giving the confident correct answer more
 * explanation than the lucky guess is the intuitive arrangement and it is the wrong one. Asserted
 * from both directions — by name and by rank — so flipping either the support strings or the rank
 * table alone still fails.
 */
describe('the counter-intuitive asymmetry — GUESS-correct outranks SURE-correct in support', () => {
  it('SURE-correct gets LESS support than GUESS-correct even though both were right', () => {
    expect(supportRank('sure-correct')).toBeLessThan(supportRank('guess-correct'));
  });

  it('SURE-correct is the least-supported cell of all four', () => {
    const others = CONFIDENCE_CELLS.filter((c) => c !== 'sure-correct');
    for (const cell of others) {
      expect(supportRank('sure-correct'), `sure-correct vs ${cell}`).toBeLessThan(supportRank(cell));
    }
  });

  it('a correct GUESS gets more support than a wrong GUESS — being right is not what earns less', () => {
    // The axis is "was there a rule behind it", not "was it correct": the lucky guess needs the rule
    // supplied in full, while the wrong guess gets the terse correction its own guess predicted.
    expect(supportRank('guess-wrong')).toBeLessThan(supportRank('guess-correct'));
  });

  it('both wrong cells outrank SURE-correct, so support does not track correctness at all', () => {
    expect(supportRank('sure-correct')).toBeLessThan(supportRank('guess-wrong'));
    expect(supportRank('sure-correct')).toBeLessThan(supportRank('sure-wrong'));
  });

  it('the two full treatments tie — G8 does not order a causal chain against an elaboration', () => {
    expect(SUPPORT_RANK['full-causal-chain']).toBe(SUPPORT_RANK['full-elaboration']);
  });
});

describe('cellFor — routing a graded prediction into the 2x2', () => {
  it('maps each outcome-plus-confidence pair to its cell', () => {
    expect(cellFor(commit('sure'), 'match')).toBe('sure-correct');
    expect(cellFor(commit('guess'), 'match')).toBe('guess-correct');
    expect(cellFor(commit('sure'), 'sure-wrong')).toBe('sure-wrong');
    expect(cellFor(commit('guess'), 'guess-wrong')).toBe('guess-wrong');
  });

  it('a deviation routes nowhere — the 2x2 has no cell for an untested commitment', () => {
    expect(cellFor(commit('sure'), 'deviated')).toBeNull();
    expect(cellFor(commit('guess'), 'deviated')).toBeNull();
    expect(routeFor(commit('sure'), 'deviated')).toBeNull();
  });

  it('throws rather than guess when the outcome contradicts the commitment', () => {
    expect(() => cellFor(commit('guess'), 'sure-wrong')).toThrow(/contradicts/);
    expect(() => cellFor(commit('sure'), 'guess-wrong')).toThrow(/contradicts/);
  });

  it('routes what predict.ts actually produces, end to end', () => {
    // predictOutcome is the real grader: 'raise' predicted, 'bet' played is a match by the engine's
    // own equivalence table, and gradedFree false is the coach finding something to say.
    const sureWrong: PredictOutcome = predictOutcome(commit('sure'), 'bet', false);
    expect(sureWrong).toBe('sure-wrong');
    expect(routeFor(commit('sure'), sureWrong)?.highestValue).toBe(true);

    const sureCorrect = predictOutcome(commit('sure'), 'bet', true);
    expect(routeFor(commit('sure'), sureCorrect)?.support).toBe('principle-name-only');

    const guessCorrect = predictOutcome(commit('guess'), 'bet', true);
    expect(routeFor(commit('guess'), guessCorrect)?.support).toBe('full-elaboration');

    const deviated = predictOutcome(commit('sure'), 'fold', false);
    expect(deviated).toBe('deviated');
    expect(routeFor(commit('sure'), deviated)).toBeNull();
  });
});

describe('SURE-wrong schedule — immediate re-serve, then day 2 AND day 7', () => {
  it('is exactly three reps at days 0, 2 and 7', () => {
    expect(SURE_WRONG_SCHEDULE.map((rep) => rep.day)).toEqual([0, 2, 7]);
  });

  it('day 0 IS the immediate re-serve, and immediateReserve reports it', () => {
    const r = route('sure-wrong');
    expect(r.schedule[0].day).toBe(0);
    expect(r.immediateReserve).toBe(true);
  });

  it('schedules both day 2 and day 7 — neither alone satisfies G8', () => {
    const days = route('sure-wrong').schedule.map((rep) => rep.day);
    expect(days).toContain(2);
    expect(days).toContain(7);
  });

  it('reuses schedule.ts wave modes rather than inventing a vocabulary', () => {
    const modes = new Set(WAVES.map((w) => w.mode));
    for (const rep of SURE_WRONG_SCHEDULE) {
      expect(modes.has(rep.mode), `${rep.day}:${rep.mode}`).toBe(true);
    }
    expect(SURE_WRONG_SCHEDULE[0].mode).toBe('blocked');
  });

  it('no other cell schedules anything — G8 attaches the chain to SURE-wrong alone', () => {
    for (const cell of CONFIDENCE_CELLS.filter((c) => c !== 'sure-wrong')) {
      expect(route(cell).schedule, cell).toEqual([]);
      expect(route(cell).immediateReserve, cell).toBe(false);
    }
  });

  it('assertSureWrongSpacing passes the shipped schedule', () => {
    expect(() => assertSureWrongSpacing()).not.toThrow();
  });

  it('rejects a schedule with no immediate re-serve', () => {
    const late: ScheduledRep[] = [
      { day: 2, mode: 'interleaved' },
      { day: 7, mode: 'interleaved' },
    ];
    expect(() => assertSureWrongSpacing(late)).toThrow(/immediate re-serve/);
  });

  it('rejects a schedule missing day 2 or day 7', () => {
    const noSeven: ScheduledRep[] = [
      { day: 0, mode: 'blocked' },
      { day: 2, mode: 'interleaved' },
    ];
    expect(() => assertSureWrongSpacing(noSeven)).toThrow(/day 2 AND day 7/);
    const noTwo: ScheduledRep[] = [
      { day: 0, mode: 'blocked' },
      { day: 7, mode: 'interleaved' },
    ];
    expect(() => assertSureWrongSpacing(noTwo)).toThrow(/day 2 AND day 7/);
  });

  it('rejects an expanding ladder via schedule.ts own flat-gap rule', () => {
    // 0, 2, 7, 17: gaps 2, 5, 10 — the doubling Q4 forbids, caught by schedule.ts assertFlatGaps
    // rather than by a copy of the rule living here. Days 0/2/7 are all present, so this reaches
    // the gap check instead of tripping the earlier "day 2 AND day 7" guard.
    const ladder: ScheduledRep[] = [
      { day: 0, mode: 'blocked' },
      { day: 2, mode: 'interleaved' },
      { day: 7, mode: 'interleaved' },
      { day: 17, mode: 'interleaved' },
    ];
    expect(() => assertSureWrongSpacing(ladder)).toThrow(/expanding gaps/);
  });
});

describe('remediation ranking — confidence x class-level RW', () => {
  const candidate = (
    classId: string,
    cell: ConfidenceCell,
    classRwBbPer100: number,
  ): RemediationCandidate => ({ classId, cell, classRwBbPer100 });

  it('weights SURE at twice GUESS', () => {
    expect(CONFIDENCE_WEIGHT.sure).toBe(2 * CONFIDENCE_WEIGHT.guess);
  });

  it('scores each entry as confidence weight times the class RW', () => {
    const ranked = rankRemediation([candidate('flop-cbet-face', 'sure-wrong', 1.5)]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].confidenceWeight).toBe(2);
    expect(ranked[0].score).toBeCloseTo(3, 10);
  });

  it('a SURE miss outranks a GUESS miss at EQUAL class RW', () => {
    const ranked = rankRemediation([
      candidate('a-guess-class', 'guess-wrong', 2),
      candidate('b-sure-class', 'sure-wrong', 2),
    ]);
    // Alphabetical order would put the guess first, so this fails if confidence is ignored.
    expect(ranked.map((r) => r.classId)).toEqual(['b-sure-class', 'a-guess-class']);
    expect(ranked.map((r) => r.score)).toEqual([4, 2]);
  });

  it('a GUESS miss in a much more expensive class outranks a SURE miss in a cheap one', () => {
    // RW is not a tiebreak behind confidence: it is a factor, so 1 x 5 beats 2 x 2.
    const ranked = rankRemediation([
      candidate('cheap-sure', 'sure-wrong', 2),
      candidate('expensive-guess', 'guess-wrong', 5),
    ]);
    expect(ranked.map((r) => r.classId)).toEqual(['expensive-guess', 'cheap-sure']);
    expect(ranked.map((r) => r.score)).toEqual([5, 4]);
  });

  it('and loses to it once the SURE class is more than twice as expensive', () => {
    const ranked = rankRemediation([
      candidate('sure-class', 'sure-wrong', 2.6),
      candidate('guess-class', 'guess-wrong', 5),
    ]);
    expect(ranked.map((r) => r.classId)).toEqual(['sure-class', 'guess-class']);
  });

  it('orders a realistic queue by the product, not by either factor alone', () => {
    const ranked = rankRemediation([
      candidate('river-bluffcatch', 'guess-wrong', 3.0), // 3.0
      candidate('flop-cbet-face', 'sure-wrong', 1.9), // 3.8
      candidate('turn-probe', 'sure-wrong', 0.4), // 0.8
      candidate('bb-defence', 'guess-wrong', 2.2), // 2.2
    ]);
    expect(ranked.map((r) => r.classId)).toEqual([
      'flop-cbet-face',
      'river-bluffcatch',
      'bb-defence',
      'turn-probe',
    ]);
    // Neither factor alone produces that order: by RW alone river-bluffcatch would lead.
    expect(ranked.map((r) => r.score)).toEqual([3.8, 3.0, 2.2, 0.8]);
  });

  it('queues only the wrong cells — a correct decision has no repair to rank', () => {
    const ranked = rankRemediation([
      candidate('was-sure-right', 'sure-correct', 9),
      candidate('was-lucky', 'guess-correct', 9),
      candidate('needs-repair', 'guess-wrong', 0.1),
    ]);
    expect(ranked.map((r) => r.classId)).toEqual(['needs-repair']);
  });

  it('breaks ties on classId so the queue order is deterministic', () => {
    const ranked = rankRemediation([
      candidate('zulu', 'sure-wrong', 1),
      candidate('alpha', 'sure-wrong', 1),
    ]);
    expect(ranked.map((r) => r.classId)).toEqual(['alpha', 'zulu']);
  });

  it('an empty queue is empty, not an error', () => {
    expect(rankRemediation([])).toEqual([]);
  });

  it('isWrongCell and confidenceOf split the 2x2 along both axes', () => {
    expect(CONFIDENCE_CELLS.filter(isWrongCell)).toEqual(['sure-wrong', 'guess-wrong']);
    expect(CONFIDENCE_CELLS.filter((c) => confidenceOf(c) === 'sure')).toEqual([
      'sure-correct',
      'sure-wrong',
    ]);
    expect(CONFIDENCE_CELLS.filter((c) => confidenceOf(c) === 'guess')).toEqual([
      'guess-correct',
      'guess-wrong',
    ]);
  });
});

describe('latency cross-check — the thresholds', () => {
  it('borrows anomaly.ts recognition threshold rather than picking a second definition of fast', () => {
    expect(GUESS_MIN_MS).toBe(RT_THRESHOLD_MS);
  });

  it('takes SURE_MAX_MS as half of G5a 20 s commit budget', () => {
    expect(COMMIT_BUDGET_MS).toBe(20_000);
    expect(SURE_MAX_MS).toBe(10_000);
  });

  it('flags a GUESS delivered at recognition speed, inclusive at the boundary', () => {
    expect(latencyDisagreement({ confidence: 'guess', commitMs: GUESS_MIN_MS })).toBe('guess-but-fast');
    expect(latencyDisagreement({ confidence: 'guess', commitMs: 400 })).toBe('guess-but-fast');
  });

  it('does not flag a GUESS that took real time', () => {
    expect(latencyDisagreement({ confidence: 'guess', commitMs: GUESS_MIN_MS + 1 })).toBeNull();
    expect(latencyDisagreement({ confidence: 'guess', commitMs: 15_000 })).toBeNull();
  });

  it('flags SURE that took longer than half the commit budget, exclusive at the boundary', () => {
    expect(latencyDisagreement({ confidence: 'sure', commitMs: SURE_MAX_MS + 1 })).toBe('sure-but-slow');
    expect(latencyDisagreement({ confidence: 'sure', commitMs: SURE_MAX_MS })).toBeNull();
  });

  it('does not flag a fast SURE or a slow GUESS — those are the two agreeing combinations', () => {
    expect(latencyDisagreement({ confidence: 'sure', commitMs: 900 })).toBeNull();
    expect(latencyDisagreement({ confidence: 'guess', commitMs: 12_000 })).toBeNull();
  });
});

describe('latency cross-check — PERSISTENTLY, which is the operative word', () => {
  it('threshold is above one, so a single disagreement cannot be a signal', () => {
    expect(PERSISTENT_DISAGREEMENTS).toBeGreaterThan(1);
  });

  it('ONE fast guess does not flag', () => {
    const flags = latencyCrossCheck(checks(['guess', 300], ['guess', 14_000], ['sure', 800]));
    expect(flags).toEqual([]);
  });

  it('an isolated fast guess buried in a window of agreeing decisions does not flag', () => {
    const window = [...repeat('sure', 1200, 9), ...checks(['guess', 200])];
    expect(latencyCrossCheck(window)).toEqual([]);
  });

  it('TWO fast guesses still do not flag — one below the threshold is not persistent', () => {
    const window = [...repeat('guess', 250, 2), ...repeat('sure', 1000, 5)];
    expect(latencyCrossCheck(window)).toEqual([]);
  });

  it('THREE fast guesses inside the window flag, with the count and window reported', () => {
    const window = [...repeat('guess', 250, 3), ...repeat('sure', 1000, 5)];
    const flags = latencyCrossCheck(window);
    expect(flags).toHaveLength(1);
    expect(flags[0].disagreement).toBe('guess-but-fast');
    expect(flags[0].count).toBe(3);
    expect(flags[0].window).toBe(8);
    expect(flags[0].message).toMatch(/GUESS/);
  });

  it('three slow SUREs flag the other direction', () => {
    const window = [...repeat('sure', 14_000, 3), ...repeat('guess', 13_000, 4)];
    const flags = latencyCrossCheck(window);
    expect(flags.map((f) => f.disagreement)).toEqual(['sure-but-slow']);
    expect(flags[0].message).toMatch(/SURE/);
  });

  it('counts the two directions separately: two of each is not three of either', () => {
    const window = [...repeat('guess', 200, 2), ...repeat('sure', 15_000, 2), ...repeat('sure', 900, 3)];
    expect(latencyCrossCheck(window)).toEqual([]);
  });

  it('reports both directions when both are persistent, most frequent first', () => {
    const window = [...repeat('guess', 200, 3), ...repeat('sure', 15_000, 4)];
    const flags = latencyCrossCheck(window);
    expect(flags.map((f) => f.disagreement)).toEqual(['sure-but-slow', 'guess-but-fast']);
    expect(flags.map((f) => f.count)).toEqual([4, 3]);
  });

  it('only the last LATENCY_WINDOW decisions count, so an old pattern stops flagging', () => {
    const stale = [...repeat('guess', 200, 3), ...repeat('sure', 1000, LATENCY_WINDOW)];
    expect(stale.length).toBeGreaterThan(LATENCY_WINDOW);
    expect(latencyCrossCheck(stale)).toEqual([]);
    // The same three disagreements still flag while they are inside the window.
    expect(latencyCrossCheck(stale.slice(0, 3 + LATENCY_WINDOW - 3))).toHaveLength(1);
  });

  it('window is LATENCY_WINDOW at most and the sample size early on', () => {
    const flags = latencyCrossCheck(repeat('guess', 100, 40));
    expect(flags[0].window).toBe(LATENCY_WINDOW);
    expect(flags[0].count).toBe(LATENCY_WINDOW);
  });

  it('an empty history flags nothing', () => {
    expect(latencyCrossCheck([])).toEqual([]);
  });

  it('agreeing decisions dilute rather than vanish, making the count a rate inside the window', () => {
    // Three fast guesses at the head of a 13-decision history: the window keeps only the last 10,
    // which contains none of them.
    const history = [...repeat('guess', 150, 3), ...repeat('guess', 13_000, 10)];
    expect(latencyCrossCheck(history)).toEqual([]);
  });
});

describe('the routing layer never contradicts predict.ts', () => {
  it('uses predict.ts Confidence values, not a parallel set', () => {
    const both: Confidence[] = ['sure', 'guess'];
    expect(Object.keys(CONFIDENCE_WEIGHT).sort()).toEqual([...both].sort());
    for (const confidence of both) {
      expect(CONFIDENCE_CELLS.filter((c) => confidenceOf(c) === confidence)).toHaveLength(2);
    }
  });

  it('ROUTES is keyed by exactly the four cells, with no extras', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...CONFIDENCE_CELLS].sort());
  });
});
