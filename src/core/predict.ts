import type { ActionKind } from './table.js';

/**
 * Prediction-before-reveal. The coach already grades the hero after the fact, which is the
 * d = 0.05 channel (Van der Kleij et al. 2015): a verdict with nothing to contradict. Feedback
 * only bites against a *committed* answer (Bangert-Drowns et al. 1991), so the hero commits an
 * action plus a confidence before the action buttons unlock, and the reveal compares the two.
 *
 * The high-value cell is SURE-but-wrong: a confident error is the correction worth studying,
 * where a wrong GUESS is exactly what a guess is for.
 */

/** The four choices the panel offers. Narrower than ActionKind on purpose: a beginner does not distinguish bet from raise. */
export type PredictedAction = 'fold' | 'check' | 'call' | 'raise';

export type Confidence = 'sure' | 'guess';

export interface Prediction {
  action: PredictedAction;
  confidence: Confidence;
}

export type PredictOutcome = 'match' | 'sure-wrong' | 'guess-wrong' | 'deviated';

export interface Calibration {
  /** Predictions actually tested — a deviation is not a test, so it is not counted. */
  total: number;
  correct: number;
  sureWrong: number;
  /**
   * The same tested predictions, split by the confidence declared at commit time. The whole point of
   * the confidence mechanic is "are you calibrated?" — a SURE prediction should be more accurate than a
   * GUESS — and that is invisible while only the flat total is kept, because a correct sure and a
   * correct guess both collapse to a 'match'. These carry the confidence a 'match' outcome drops, so
   * sure-accuracy and guess-accuracy can be read independently. total === sureTotal + guessTotal.
   */
  sureTotal: number;
  sureCorrect: number;
  guessTotal: number;
  guessCorrect: number;
}

export const PREDICTED_ACTIONS: readonly PredictedAction[] = ['fold', 'check', 'call', 'raise'];

export function emptyCalibration(): Calibration {
  return { total: 0, correct: 0, sureWrong: 0, sureTotal: 0, sureCorrect: 0, guessTotal: 0, guessCorrect: 0 };
}

/**
 * Which engine actions each predicted action covers.
 *
 * - `raise` covers `bet`: the engine names the first wager on a street differently, but it is the
 *   same decision, and the Raise button fires whichever of the two is legal.
 * - `raise` and `call` BOTH cover `allin`. An all-in is the call when the hero cannot cover the
 *   bet — that is precisely what the Call button and the C shortcut fire in that spot — and a
 *   raise otherwise, and this function is not given the stack or the price to tell them apart.
 *   `allin` is the only action matching two predictions; nothing else overlaps.
 * - `check` never matches `call`. Continuing for free and paying to continue are different
 *   decisions, and conflating them would hide the most common beginner error there is.
 */
export function predictionMatches(predicted: PredictedAction, played: ActionKind): boolean {
  switch (predicted) {
    case 'fold':
      return played === 'fold';
    case 'check':
      return played === 'check';
    case 'call':
      return played === 'call' || played === 'allin';
    case 'raise':
      return played === 'raise' || played === 'bet' || played === 'allin';
  }
}

/**
 * `gradedFree` is the coach's own silence rule: severity 'free' means it found nothing to say,
 * which is the coach agreeing with the action the hero committed to.
 */
export function predictOutcome(
  prediction: Prediction,
  played: ActionKind,
  gradedFree: boolean,
): PredictOutcome {
  if (!predictionMatches(prediction.action, played)) return 'deviated';
  if (gradedFree) return 'match';
  return prediction.confidence === 'sure' ? 'sure-wrong' : 'guess-wrong';
}

/**
 * Fold one graded prediction into the running calibration. `confidence` is taken explicitly rather
 * than re-derived from the outcome, because a 'match' outcome has already dropped it — a correct sure
 * and a correct guess are the same outcome but must land in different buckets. A 'sure-wrong' outcome
 * is by definition 'sure' and a 'guess-wrong' is 'guess', so passing the two consistently is the
 * caller's job; predictOutcome + the committed prediction give both from the same commit.
 */
export function tally(cal: Calibration, outcome: PredictOutcome, confidence: Confidence): Calibration {
  // A hero who committed to one action and played another never tested the prediction.
  if (outcome === 'deviated') return { ...cal };
  const correct = outcome === 'match' ? 1 : 0;
  const isSure = confidence === 'sure';
  return {
    total: cal.total + 1,
    correct: cal.correct + correct,
    sureWrong: cal.sureWrong + (outcome === 'sure-wrong' ? 1 : 0),
    sureTotal: cal.sureTotal + (isSure ? 1 : 0),
    sureCorrect: cal.sureCorrect + (isSure ? correct : 0),
    guessTotal: cal.guessTotal + (isSure ? 0 : 1),
    guessCorrect: cal.guessCorrect + (isSure ? 0 : correct),
  };
}

/** Sure-prediction accuracy as a percent, 0–100. No sure predictions is 0%, never NaN. */
export function sureAccuracy(cal: Calibration): number {
  if (cal.sureTotal === 0) return 0;
  return (cal.sureCorrect / cal.sureTotal) * 100;
}

/** Guess-prediction accuracy as a percent, 0–100. No guesses is 0%, never NaN. */
export function guessAccuracy(cal: Calibration): number {
  if (cal.guessTotal === 0) return 0;
  return (cal.guessCorrect / cal.guessTotal) * 100;
}

/** Percent, 0–100. Zero predictions is 0%, never NaN. */
export function calibrationAccuracy(cal: Calibration): number {
  if (cal.total === 0) return 0;
  return (cal.correct / cal.total) * 100;
}

export function calibrationLine(cal: Calibration): string {
  if (cal.total === 0) return 'No predictions yet';
  const base = `${cal.correct}/${cal.total} correct (${calibrationAccuracy(cal).toFixed(0)}%) · ${cal.sureWrong} sure-but-wrong`;
  // The calibration split is the teaching: is a SURE prediction actually more accurate than a GUESS?
  // Only shown once each side has been tested, so a one-sided sample never prints a misleading 0%.
  if (cal.sureTotal > 0 && cal.guessTotal > 0) {
    return `${base} · sure ${sureAccuracy(cal).toFixed(0)}% vs guess ${guessAccuracy(cal).toFixed(0)}%`;
  }
  return base;
}

export function predictResultText(
  prediction: Prediction,
  played: ActionKind,
  outcome: PredictOutcome,
): string {
  switch (outcome) {
    case 'match':
      return `You predicted ${prediction.action} and the coach agrees.`;
    case 'sure-wrong':
      return `You were SURE about ${prediction.action} and it was a mistake — study this one.`;
    case 'guess-wrong':
      return `You guessed ${prediction.action} and it was a mistake — an expected miss.`;
    case 'deviated':
      return `You committed to ${prediction.action} but played ${played}, so nothing was tested.`;
  }
}
