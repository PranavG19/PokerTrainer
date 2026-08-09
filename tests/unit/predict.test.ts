import { describe, it, expect } from 'vitest';
import type { ActionKind } from '../../src/core/table.js';
import type { Calibration, PredictOutcome, Prediction } from '../../src/core/predict.js';
import {
  PREDICTED_ACTIONS,
  calibrationAccuracy,
  calibrationLine,
  emptyCalibration,
  predictOutcome,
  predictResultText,
  predictionMatches,
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

function feed(outcomes: PredictOutcome[]): Calibration {
  return outcomes.reduce(tally, emptyCalibration());
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
    expect(emptyCalibration()).toEqual({ total: 0, correct: 0, sureWrong: 0 });
    expect(emptyCalibration()).not.toBe(emptyCalibration());
  });

  it('counts matches as correct', () => {
    expect(feed(['match', 'match'])).toEqual({ total: 2, correct: 2, sureWrong: 0 });
  });

  it('counts sure-but-wrong separately from guess-but-wrong', () => {
    expect(feed(['sure-wrong', 'guess-wrong', 'guess-wrong'])).toEqual({
      total: 3,
      correct: 0,
      sureWrong: 1,
    });
  });

  it('a deviation is not a tested prediction and moves nothing', () => {
    const before = feed(['match', 'sure-wrong']);
    expect(tally(before, 'deviated')).toEqual(before);
  });

  it('is pure — the input tally is never mutated', () => {
    const before = emptyCalibration();
    const snapshot = JSON.stringify(before);
    tally(tally(before, 'match'), 'sure-wrong');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('correct + wrong always equals total across a mixed run', () => {
    const cal = feed(['match', 'sure-wrong', 'guess-wrong', 'deviated', 'match', 'sure-wrong']);
    expect(cal).toEqual({ total: 5, correct: 2, sureWrong: 2 });
    expect(cal.correct).toBeLessThanOrEqual(cal.total);
    expect(cal.sureWrong).toBeLessThanOrEqual(cal.total - cal.correct);
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
    expect(emptySession().calibration).toEqual({ total: 0, correct: 0, sureWrong: 0 });
    expect(emptySession().coachedMode).toBe(false);
  });

  it('recordPrediction accumulates and does not mutate', () => {
    const before = emptySession();
    const snapshot = JSON.stringify(before);
    const after = recordPrediction(recordPrediction(before, 'match'), 'sure-wrong');
    expect(after.calibration).toEqual({ total: 2, correct: 1, sureWrong: 1 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('setCoachedMode flips the flag without touching anything else', () => {
    const on = setCoachedMode(emptySession(), true);
    expect(on.coachedMode).toBe(true);
    expect(setCoachedMode(on, false).coachedMode).toBe(false);
    expect({ ...on, coachedMode: false }).toEqual(emptySession());
  });

  it('recording a hand preserves the calibration tally and the toggle', () => {
    const primed = setCoachedMode(recordPrediction(emptySession(), 'sure-wrong'), true);
    const after = recordHand(primed, {
      handNumber: 1,
      hole: ['As', 'Kd'],
      board: [],
      net: -50,
      vpip: true,
      pfr: false,
      grades: [],
    });
    expect(after.calibration).toEqual({ total: 1, correct: 0, sureWrong: 1 });
    expect(after.coachedMode).toBe(true);
  });
});

describe('persistence of the new fields', () => {
  it('round-trips a populated tally and the toggle', () => {
    const state = setCoachedMode(
      ['match', 'match', 'sure-wrong', 'guess-wrong', 'deviated'].reduce(
        (s, outcome) => recordPrediction(s, outcome as PredictOutcome),
        emptySession(),
      ),
      true,
    );
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(revived).toEqual(state);
    expect(revived.calibration).toEqual({ total: 4, correct: 2, sureWrong: 1 });
    expect(revived.coachedMode).toBe(true);
  });

  it('serialize hands back a detached tally', () => {
    const state = recordPrediction(emptySession(), 'match');
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
    expect(revived.calibration).toEqual({ total: 0, correct: 0, sureWrong: 0 });
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
    expect(revived.calibration).toEqual({ total: 0, correct: 0, sureWrong: 0 });
    // Only a real boolean true turns the gate on; a truthy string must not.
    expect(revived.coachedMode).toBe(false);
    expect(Number.isNaN(calibrationAccuracy(revived.calibration))).toBe(false);
  });
});
