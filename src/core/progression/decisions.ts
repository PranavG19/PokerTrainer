/**
 * "Decisions, not results" for Profile (1.13): the assessment block's EV loss by week and how often Sure was right.
 * Only graded decisions feed it (the assessment log and the calibration tally), never table stacks or pots.
 * Pure: the caller passes `now`.
 */

import type { AssessmentDecision } from '../session.js';
import type { Calibration } from '../predict.js';

const MS_PER_WEEK = 7 * 86_400_000;

export interface WeekPoint {
  /** 0 = the current week, 1 = last week … */
  readonly weeksAgo: number;
  /** Mean EV loss per decision × 100: bb per 100 decisions. */
  readonly bbPer100: number;
  readonly decisions: number;
}

/** The last `weeks` weeks that had assessment decisions, oldest first. Weeks with none are skipped, not zeroed. */
export function weeklyEvLoss(decisions: readonly AssessmentDecision[], now: number, weeks = 6): WeekPoint[] {
  const by = new Map<number, { sum: number; n: number }>();
  for (const d of decisions) {
    const ago = Math.floor((now - d.at) / MS_PER_WEEK);
    if (ago < 0 || ago >= weeks || !Number.isFinite(d.evLossBb)) continue;
    const w = by.get(ago) ?? { sum: 0, n: 0 };
    w.sum += Math.max(0, d.evLossBb);
    w.n += 1;
    by.set(ago, w);
  }
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([weeksAgo, w]) => ({ weeksAgo, bbPer100: Math.round((w.sum / w.n) * 1000) / 10, decisions: w.n }));
}

/** Sure calls right, in whole percent, or null before any Sure call was tested. */
export function sureRight(cal: Calibration): number | null {
  return cal.sureTotal > 0 ? Math.round((cal.sureCorrect / cal.sureTotal) * 100) : null;
}
