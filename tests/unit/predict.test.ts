import { describe, it, expect } from 'vitest';
import type { ActionKind } from '../../src/core/table.js';
import type { Calibration, Confidence, PredictOutcome, Prediction } from '../../src/core/predict.js';
import {
  PREDICTED_ACTIONS,
  calibrationAccuracy,
  calibrationLine,
  emptyCalibration,
  guessAccuracy,
  predictOutcome,
  predictResultText,
  predictionMatches,
  sureAccuracy,
  tally,
} from '../../src/core/predict.js';
import {
  deserialize,
  emptySession,
  recordHand,
  recordPrediction,
  serialize,
  setCoachedMode,
} from '../../src/core/session.js';

const sure = (action: Prediction['action']): Prediction => ({ action, confidence: 'sure' });
const guess = (action: Prediction['action']): Prediction => ({ action, confidence: 'guess' });

const ALL_ACTIONS: ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

/**
 * Fold a run of graded predictions into a calibration. Each entry is an [outcome, confidence] pair,
 * because tally now needs the confidence a 'match' outcome drops. A bare outcome defaults to the
 * confidence it implies where one exists (sure-wrong => sure, guess-wrong => guess) and to 'guess'
 * otherwise, so the older flat-total assertions can pass a plain outcome list unchanged.
 */
type Graded = PredictOutcome | [PredictOutcome, Confidence];

function confidenceFor(outcome: PredictOutcome): Confidence {
  return outcome === 'sure-wrong' ? 'sure' : 'guess';
}

function feed(entries: Graded[]): Calibration {
  return entries.reduce<Calibration>((cal, entry) => {
    const [outcome, confidence] = Array.isArray(entry) ? entry : [entry, confidenceFor(entry)];
    return tally(cal, outcome, confidence);
  }, emptyCalibration());
}

describe('predictionMatches — the equivalence table', () => {
  it('fold matches only fold', () => {
    expect(predictionMatches('fold', 'fold')).toBe(true);
    for (const played of ALL_ACTIONS.filter((a) => a !== 'fold')) {
      expect(predictionMatches('fold', played), `fold vs ${played}`).toBe(false);
    }
  });

  it('check matches only check — it never counts as a call', () => {
    expect(predictionMatches('check', 'check')).toBe(true);
    // The distinction is the whole point: continuing free is not the same decision as paying.
    expect(predictionMatches('check', 'call')).toBe(false);
    expect(predictionMatches('check', 'fold')).toBe(false);
    expect(predictionMatches('check', 'allin')).toBe(false);
  });

  it('call matches call, and an all-in because an all-in IS the call the hero cannot cover', () => {
    expect(predictionMatches('call', 'call')).toBe(true);
    expect(predictionMatches('call', 'allin')).toBe(true);
    expect(predictionMatches('call', 'check')).toBe(false);
    expect(predictionMatches('call', 'bet')).toBe(false);
    expect(predictionMatches('call', 'raise')).toBe(false);
    expect(predictionMatches('call', 'fold')).toBe(false);
  });

  it('raise matches raise and bet — the engine names the street-opening wager differently', () => {
    expect(predictionMatches('raise', 'raise')).toBe(true);
    expect(predictionMatches('raise', 'bet')).toBe(true);
  });

  it('raise matches all-in too — the Raise/All-in pills both put the stack in', () => {
    expect(predictionMatches('raise', 'allin')).toBe(true);
    expect(predictionMatches('raise', 'check')).toBe(false);
    expect(predictionMatches('raise', 'call')).toBe(false);
    expect(predictionMatches('raise', 'fold')).toBe(false);
  });

  it('all-in is the only action two predictions can claim; nothing else overlaps', () => {
    const claimants = (played: ActionKind): number =>
      PREDICTED_ACTIONS.filter((p) => predictionMatches(p, played)).length;
    expect(claimants('allin')).toBe(2);
    for (const played of ALL_ACTIONS.filter((a) => a !== 'allin')) {
      expect(claimants(played), `${played} should have exactly one claimant`).toBe(1);
    }
  });

  it('every engine action is claimed by at least one prediction', () => {
    for (const played of ALL_ACTIONS) {
      expect(
        PREDICTED_ACTIONS.some((p) => predictionMatches(p, played)),
        `${played} is unpredictable`,
      ).toBe(true);
    }
  });
});

describe('predictOutcome', () => {
  it('a matching action the coach stays silent about is a match', () => {
    expect(predictOutcome(sure('call'), 'call', true)).toBe('match');
    expect(predictOutcome(guess('call'), 'call', true)).toBe('match');
  });

  it('SURE and graded is flagged distinctly from GUESS and graded', () => {
    expect(predictOutcome(sure('fold'), 'fold', false)).toBe('sure-wrong');
    expect(predictOutcome(guess('fold'), 'fold', false)).toBe('guess-wrong');
  });

  it('playing something other than the commitment tests nothing', () => {
    expect(predictOutcome(sure('fold'), 'call', true)).toBe('deviated');
    expect(predictOutcome(sure('fold'), 'call', false)).toBe('deviated');
    expect(predictOutcome(guess('check'), 'raise', false)).toBe('deviated');
  });

  it('confidence never changes whether a prediction matched, only how the miss is labelled', () => {
    for (const played of ALL_ACTIONS) {
      for (const action of PREDICTED_ACTIONS) {
        const asSure = predictOutcome(sure(action), played, false);
        const asGuess = predictOutcome(guess(action), played, false);
        expect(asSure === 'deviated').toBe(asGuess === 'deviated');
      }
    }
  });

  it('an equivalence match still grades: SURE on raise, played bet, coach objects', () => {
    expect(predictOutcome(sure('raise'), 'bet', false)).toBe('sure-wrong');
    expect(predictOutcome(guess('call'), 'allin', false)).toBe('guess-wrong');
    expect(predictOutcome(sure('call'), 'allin', true)).toBe('match');
  });
});

describe('calibration tally', () => {
  it('starts empty and emptyCalibration is a fresh object', () => {
    expect(emptyCalibration()).toEqual({
      total: 0,
      correct: 0,
      sureWrong: 0,
      sureTotal: 0,
      sureCorrect: 0,
      guessTotal: 0,
      guessCorrect: 0,
    });
    expect(emptyCalibration()).not.toBe(emptyCalibration());
  });

  it('counts matches as correct', () => {
    expect(feed(['match', 'match'])).toMatchObject({ total: 2, correct: 2, sureWrong: 0 });
  });

  it('counts sure-but-wrong separately from guess-but-wrong', () => {
    expect(feed(['sure-wrong', 'guess-wrong', 'guess-wrong'])).toMatchObject({
      total: 3,
      correct: 0,
      sureWrong: 1,
    });
  });

  it('a deviation is not a tested prediction and moves nothing', () => {
    const before = feed(['match', 'sure-wrong']);
    expect(tally(before, 'deviated', 'sure')).toEqual(before);
    expect(tally(before, 'deviated', 'guess')).toEqual(before);
  });

  it('is pure — the input tally is never mutated', () => {
    const before = emptyCalibration();
    const snapshot = JSON.stringify(before);
    tally(tally(before, 'match', 'sure'), 'sure-wrong', 'sure');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('correct + wrong always equals total across a mixed run', () => {
    const cal = feed(['match', 'sure-wrong', 'guess-wrong', 'deviated', 'match', 'sure-wrong']);
    expect(cal).toMatchObject({ total: 5, correct: 2, sureWrong: 2 });
    expect(cal.correct).toBeLessThanOrEqual(cal.total);
    expect(cal.sureWrong).toBeLessThanOrEqual(cal.total - cal.correct);
  });

  it('splits the tested predictions into sure and guess buckets that sum to the total', () => {
    // A correct SURE and a correct GUESS are the same 'match' outcome but land in different buckets —
    // the split only exists because tally is told the confidence the outcome drops.
    const cal = feed([
      ['match', 'sure'],
      ['match', 'guess'],
      'sure-wrong', // sure, incorrect
      'guess-wrong', // guess, incorrect
      'deviated', // not tested, touches nothing
    ]);
    expect(cal.sureTotal + cal.guessTotal).toBe(cal.total);
    expect(cal).toMatchObject({
      total: 4,
      sureTotal: 2,
      sureCorrect: 1,
      guessTotal: 2,
      guessCorrect: 1,
    });
  });

  it('a bucket total is never exceeded by its correct count', () => {
    const cal = feed([['match', 'sure'], ['match', 'sure'], 'sure-wrong', ['match', 'guess']]);
    expect(cal.sureCorrect).toBeLessThanOrEqual(cal.sureTotal);
    expect(cal.guessCorrect).toBeLessThanOrEqual(cal.guessTotal);
  });
});

describe('sureAccuracy / guessAccuracy — the calibration split', () => {
  it('are 0 with an empty bucket, never NaN', () => {
    expect(sureAccuracy(emptyCalibration())).toBe(0);
    expect(guessAccuracy(emptyCalibration())).toBe(0);
    expect(Number.isNaN(sureAccuracy(emptyCalibration()))).toBe(false);
  });

  it('are computed independently over their own bucket', () => {
    // Sure: 3 of 4 correct (75%). Guess: 1 of 2 correct (50%). Neither reads off the other's count.
    const cal = feed([
      ['match', 'sure'],
      ['match', 'sure'],
      ['match', 'sure'],
      'sure-wrong',
      ['match', 'guess'],
      'guess-wrong',
    ]);
    expect(sureAccuracy(cal)).toBe(75);
    expect(guessAccuracy(cal)).toBe(50);
  });

  it('a one-sided sample leaves the untouched bucket at 0, not NaN', () => {
    const cal = feed([['match', 'sure'], 'sure-wrong']);
    expect(sureAccuracy(cal)).toBe(50);
    expect(guessAccuracy(cal)).toBe(0);
    expect(cal.guessTotal).toBe(0);
  });
});

describe('calibrationAccuracy — no division by zero', () => {
  it('is 0 with no predictions, never NaN', () => {
    const accuracy = calibrationAccuracy(emptyCalibration());
    expect(accuracy).toBe(0);
    expect(Number.isNaN(accuracy)).toBe(false);
  });

  it('deviations alone still leave total at 0 and accuracy finite', () => {
    const accuracy = calibrationAccuracy(feed(['deviated', 'deviated']));
    expect(accuracy).toBe(0);
    expect(Number.isFinite(accuracy)).toBe(true);
  });

  it('is a percentage', () => {
    expect(calibrationAccuracy(feed(['match', 'guess-wrong']))).toBe(50);
    expect(calibrationAccuracy(feed(['match', 'match', 'match', 'sure-wrong']))).toBe(75);
  });

  it('the line reads sensibly at zero and once populated', () => {
    expect(calibrationLine(emptyCalibration())).toBe('No predictions yet');
    const line = calibrationLine(feed(['match', 'sure-wrong', 'guess-wrong', 'match']));
    expect(line).toContain('2/4');
    expect(line).toContain('50%');
    expect(line).toContain('1 sure-but-wrong');
    expect(line).not.toMatch(/NaN|Infinity|undefined/);
  });
});

describe('predictResultText', () => {
  it('names the committed action and flags a confident error loudest', () => {
    expect(predictResultText(sure('raise'), 'raise', 'sure-wrong')).toMatch(/SURE/);
    expect(predictResultText(guess('raise'), 'raise', 'guess-wrong')).toMatch(/guess/i);
    expect(predictResultText(sure('call'), 'call', 'match')).toMatch(/agree/);
    expect(predictResultText(sure('fold'), 'call', 'deviated')).toContain('call');
  });

  it('produces distinct text for every outcome so the reveal is never ambiguous', () => {
    const outcomes: PredictOutcome[] = ['match', 'sure-wrong', 'guess-wrong', 'deviated'];
    const texts = outcomes.map((o) => predictResultText(sure('call'), 'call', o));
    expect(new Set(texts).size).toBe(outcomes.length);
  });
});

describe('session calibration counters', () => {
  it('a fresh session has an empty tally and coached mode OFF', () => {
    expect(emptySession().calibration).toEqual(emptyCalibration());
    expect(emptySession().coachedMode).toBe(false);
  });

  it('recordPrediction accumulates and does not mutate', () => {
    const before = emptySession();
    const snapshot = JSON.stringify(before);
    const after = recordPrediction(recordPrediction(before, 'match', 'guess'), 'sure-wrong', 'sure');
    expect(after.calibration).toMatchObject({ total: 2, correct: 1, sureWrong: 1 });
    // The confidence threads through: one correct guess, one incorrect sure.
    expect(after.calibration).toMatchObject({ guessTotal: 1, guessCorrect: 1, sureTotal: 1, sureCorrect: 0 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('setCoachedMode flips the flag without touching anything else', () => {
    const on = setCoachedMode(emptySession(), true);
    expect(on.coachedMode).toBe(true);
    expect(setCoachedMode(on, false).coachedMode).toBe(false);
    expect({ ...on, coachedMode: false }).toEqual(emptySession());
  });

  it('recording a hand preserves the calibration tally and the toggle', () => {
    const primed = setCoachedMode(recordPrediction(emptySession(), 'sure-wrong', 'sure'), true);
    const after = recordHand(primed, {
      handNumber: 1,
      hole: ['As', 'Kd'],
      board: [],
      net: -50,
      vpip: true,
      pfr: false,
      grades: [],
    });
    expect(after.calibration).toMatchObject({ total: 1, correct: 0, sureWrong: 1 });
    expect(after.coachedMode).toBe(true);
  });
});

describe('persistence of the new fields', () => {
  it('round-trips a populated tally and the toggle', () => {
    const graded: [PredictOutcome, Confidence][] = [
      ['match', 'sure'],
      ['match', 'guess'],
      ['sure-wrong', 'sure'],
      ['guess-wrong', 'guess'],
      ['deviated', 'guess'],
    ];
    const state = setCoachedMode(
      graded.reduce((s, [outcome, confidence]) => recordPrediction(s, outcome, confidence), emptySession()),
      true,
    );
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(revived).toEqual(state);
    expect(revived.calibration).toMatchObject({
      total: 4,
      correct: 2,
      sureWrong: 1,
      sureTotal: 2,
      sureCorrect: 1,
      guessTotal: 2,
      guessCorrect: 1,
    });
    expect(revived.coachedMode).toBe(true);
  });

  it('serialize hands back a detached tally', () => {
    const state = recordPrediction(emptySession(), 'match', 'sure');
    const out = serialize(state) as { calibration: { total: number } };
    out.calibration.total = 999;
    expect(state.calibration.total).toBe(1);
  });

  it('a legacy save with no calibration and no coachedMode loads at zero and OFF', () => {
    const legacy = {
      bankroll: 12000,
      hands: [],
      rebuys: 1,
      stats: { handsPlayed: 3, vpipHands: 1, pfrHands: 0, evLossBb: 2, leaks: { 'pot odds': 2 } },
    };
    const revived = deserialize(legacy);
    expect(revived.calibration).toEqual(emptyCalibration());
    // Default OFF matters: an inherited gate on the action buttons would look like a broken app.
    expect(revived.coachedMode).toBe(false);
    expect(calibrationLine(revived.calibration)).toBe('No predictions yet');
  });

  it('a corrupt calibration block degrades to zeros rather than NaN', () => {
    const revived = deserialize({
      bankroll: 500,
      hands: [],
      stats: {},
      calibration: { total: 'lots', correct: null, sureWrong: -4.7 },
      coachedMode: 'yes',
    });
    expect(revived.calibration).toEqual(emptyCalibration());
    // Only a real boolean true turns the gate on; a truthy string must not.
    expect(revived.coachedMode).toBe(false);
    expect(Number.isNaN(calibrationAccuracy(revived.calibration))).toBe(false);
  });
});
