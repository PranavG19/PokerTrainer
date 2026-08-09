import type { Card } from './cards.js';
import { equityVsRandom } from './equity.js';

export type Severity = 'free' | 'notable' | 'serious';

export interface Grade {
  severity: Severity;
  evLossBb: number;
  message: string | null;
  principle: string | null;
}

export function potOddsRequired(pot: number, toCall: number): number {
  if (pot + toCall === 0) return 0;
  return toCall / (pot + toCall);
}

type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export function gradeDecision(input: {
  hole: Card[];
  board: Card[];
  street: string;
  pot: number;
  toCall: number;
  stack: number;
  bb: number;
  chosen: Action;
  betSize?: number;
  opponents: number;
  seed?: number;
}): Grade {
  const { hole, board, pot, toCall, bb, chosen, opponents, seed } = input;

  const eq = equityVsRandom(hole, board, opponents, 2000, seed ?? 1);
  const equity = eq.win + eq.tie * 0.5;

  const required = potOddsRequired(pot, toCall);

  let evLossBb = 0;
  let principle: string | null = null;

  if (chosen === 'call') {
    if (equity >= required) {
      evLossBb = 0;
    } else {
      evLossBb = ((required - equity) * (pot + toCall)) / bb;
      principle = 'pot odds';
    }
  } else if (chosen === 'fold') {
    if (toCall === 0) {
      evLossBb = 0;
    } else if (equity > required) {
      evLossBb = ((equity - required) * (pot + toCall)) / bb;
      principle = 'pot odds';
    } else {
      evLossBb = 0;
    }
  } else if (chosen === 'check') {
    const isLateStreet = input.street === 'turn' || input.street === 'river';
    if (isLateStreet && equity > 0.55) {
      const missedValue = (equity - 0.55) * pot * 0.5;
      evLossBb = missedValue / bb;
      principle = 'value or bluff';
    } else {
      evLossBb = 0;
    }
  } else if (chosen === 'bet' || chosen === 'raise' || chosen === 'allin') {
    if (equity < 0.35 && toCall > 0) {
      const overcommit = (0.35 - equity) * (pot + toCall);
      evLossBb = overcommit / bb;
      principle = 'ranges';
    } else if (equity >= 0.55) {
      evLossBb = 0;
    } else if (equity < 0.35 && toCall === 0) {
      const penalty = (0.35 - equity) * pot * 0.4;
      evLossBb = penalty / bb;
      principle = 'value or bluff';
    } else {
      evLossBb = 0;
    }
  }

  const severity = classifySeverity(evLossBb);
  const message = severity === 'free' ? null : buildMessage(chosen, equity, required, pot, toCall, evLossBb);
  if (severity === 'free') principle = null;

  return { severity, evLossBb, message, principle };
}

function classifySeverity(evLossBb: number): Severity {
  if (evLossBb < 0.5) return 'free';
  if (evLossBb < 2.0) return 'notable';
  return 'serious';
}

function buildMessage(
  action: Action,
  equity: number,
  required: number,
  pot: number,
  toCall: number,
  evLossBb: number,
): string {
  const eqPct = Math.round(equity * 100);
  const reqPct = Math.round(required * 100);

  if (action === 'call') {
    return `Calling ${toCall} into a ${pot} pot needs ${reqPct}% equity; you had ${eqPct}%.`;
  }
  if (action === 'fold') {
    return `Folding with ${eqPct}% equity when only ${reqPct}% was needed costs ~${evLossBb.toFixed(1)} bb.`;
  }
  if (action === 'check') {
    return `Checking ${eqPct}% equity on a later street misses value worth ~${evLossBb.toFixed(1)} bb.`;
  }
  return `Betting with only ${eqPct}% equity against this action risks ~${evLossBb.toFixed(1)} bb.`;
}
