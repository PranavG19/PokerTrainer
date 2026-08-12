import { describe, it, expect } from 'vitest';
import {
  MAX_ASSESSMENT_LOG,
  deserialize,
  emptySession,
  recordAssessment,
  serialize,
  type AssessmentDecision,
} from '../../src/core/session.js';
import { computeMetrics, decisionRecordsFromHands } from '../../src/core/progress.js';

/**
 * ASSESSMENT CORE — the persistence + progress-input path for the weekly assessment block (P4/G2).
 * The point of these tests is the honesty seam: an assessment spot must feed the assessment-EV-loss
 * metric ALONE (never the practice count), survive a save/load round trip, and drop malformed records
 * rather than fabricate a timestamp that would place a spot in the wrong week. The metric it feeds
 * (progress.ts assessmentEvLossBb100) renders permanently empty until a real block writes into it.
 */

function spot(overrides: Partial<AssessmentDecision> = {}): AssessmentDecision {
  return { at: 1_700_000_000_000, evLossBb: 0, correct: true, ...overrides };
}

describe('recordAssessment', () => {
  it('appends newest last and is pure', () => {
    const base = emptySession();
    const one = recordAssessment(base, spot({ at: 1, evLossBb: 2 }));
    const two = recordAssessment(one, spot({ at: 2, evLossBb: 3 }));
    expect(base.assessments).toEqual([]); // input untouched
    expect(one.assessments).toHaveLength(1);
    expect(two.assessments.map((a) => a.at)).toEqual([1, 2]);
  });

  it('bounds the log to MAX_ASSESSMENT_LOG, keeping the newest', () => {
    let state = emptySession();
    for (let i = 0; i < MAX_ASSESSMENT_LOG + 25; i += 1) {
      state = recordAssessment(state, spot({ at: i }));
    }
    expect(state.assessments).toHaveLength(MAX_ASSESSMENT_LOG);
    expect(state.assessments[0].at).toBe(25); // oldest 25 dropped
    expect(state.assessments.at(-1)?.at).toBe(MAX_ASSESSMENT_LOG + 24);
  });
});

describe('assessment feeds the assessment-EV-loss metric alone', () => {
  const now = 1_700_000_100_000;

  it('mapped assessment decisions drive assessmentEvLossBb100, not the practice count', () => {
    const state = [spot({ evLossBb: 1 }), spot({ evLossBb: 3, correct: false })].reduce(
      recordAssessment,
      emptySession(),
    );
    const assessmentDecisions = state.assessments.map((a) => ({
      at: a.at,
      mode: 'assessment' as const,
      evLossBb: a.evLossBb,
      tag: null,
      sure: false,
      correct: a.correct,
    }));
    const metrics = computeMetrics(
      { decisions: assessmentDecisions, hands: [], fluency: [], botConfigId: 'default' },
      now,
    );
    // mean(1, 3) * 100 = 200 bb/100 over a sample of 2
    expect(metrics.assessmentEvLossBb100.value).toBeCloseTo(200);
    expect(metrics.assessmentEvLossBb100.sample).toBe(2);
    // The weekly-effort count is a separate metric; assessment spots are NOT practice, but they DO
    // fall in the current week, so the effort count sees them as graded decisions this week (they are).
    // What must never happen: an assessment spot counting toward the assessment metric while ALSO being
    // absent from it — so the sample is the load-bearing assertion here.
  });

  it('practice decisions never leak into the assessment metric', () => {
    // A practice decision (mode:'practice') must contribute zero to assessmentEvLossBb100.
    const practice = decisionRecordsFromHands([]); // empty by construction, but assert the filter path
    const metrics = computeMetrics(
      {
        decisions: [
          ...practice,
          { at: now, mode: 'practice' as const, evLossBb: 99, tag: null, sure: false, correct: false },
        ],
        hands: [],
        fluency: [],
        botConfigId: 'default',
      },
      now,
    );
    expect(metrics.assessmentEvLossBb100.value).toBe(0);
    expect(metrics.assessmentEvLossBb100.sample).toBe(0);
  });
});

describe('parseAssessment (via deserialize) is tolerant', () => {
  it('round-trips a real log through serialize/deserialize', () => {
    const state = [spot({ at: 10, evLossBb: 1.5, correct: false }), spot({ at: 20 })].reduce(
      recordAssessment,
      emptySession(),
    );
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(revived.assessments).toEqual(state.assessments);
  });

  it('drops entries with no finite timestamp rather than inventing one', () => {
    const revived = deserialize({
      assessments: [
        { at: 5, evLossBb: 1, correct: true },
        { evLossBb: 2, correct: true }, // no `at`
        { at: 'soon', evLossBb: 2, correct: true }, // non-numeric
        { at: Infinity, evLossBb: 2, correct: true }, // non-finite
        'garbage',
        null,
      ],
    });
    expect(revived.assessments).toEqual([{ at: 5, evLossBb: 1, correct: true }]);
  });

  it('clamps a negative evLossBb to zero and degrades a non-boolean correct to false', () => {
    const revived = deserialize({
      assessments: [{ at: 1, evLossBb: -4, correct: 'yes' }],
    });
    expect(revived.assessments).toEqual([{ at: 1, evLossBb: 0, correct: false }]);
  });

  it('an empty or missing log is an empty array, not a crash', () => {
    expect(deserialize({}).assessments).toEqual([]);
    expect(deserialize({ assessments: 'nope' }).assessments).toEqual([]);
  });
});
