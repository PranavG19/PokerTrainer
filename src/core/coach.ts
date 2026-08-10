import type { Card } from './cards.js';
import { DISPLAY_ITERATIONS, equityVsRandom } from './equity.js';

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

  const eq = equityVsRandom(hole, board, opponents, DISPLAY_ITERATIONS, seed ?? 1);
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
      // Folding for free is never merely neutral: checking was available and costs nothing, so
      // surrendering the pot throws away every chip already in it. Grading it 0 made the coach
      // prefer folding the nuts to checking them — measured on a river with quad aces into a 600
      // pot, folding graded 0.00bb 'free' while checking the same hand graded 2.70bb 'serious'.
      // `fold` is always in legalActions (table.ts:273) including at toCall 0, so this is a spot a
      // real learner can reach and be actively taught the wrong play in.
      // Charged against a CHECK, not against winning the pot outright. Checking does not collect
      // the pot — it sees a free card and plays on — so the loss is the share a free continuation
      // would realise. Halving equity is the standard crude realisation haircut and it keeps the
      // most common correct beginner play, folding trash preflop for free, inside the silence
      // threshold: raw equity charged 0.52bb ('notable') for folding 72o, which would nag at a
      // learner doing the right thing. It still ranks fold behind check with a real hand.
      evLossBb = (equity * 0.5 * pot) / bb;
      // 'value or bluff', not 'pot odds'. Nothing was owed, so no price was misjudged — what was
      // thrown away is the equity a free continuation would have realised. Tagging it 'pot odds'
      // filed every free fold under the arithmetic leak in the profile's leak list, so a learner
      // whose actual weakness is surrendering free cards would be shown pot-odds drills. G7
      // aggregates by error tag, which makes the tag load-bearing rather than cosmetic.
      if (evLossBb >= 0.5) principle = 'value or bluff';
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
  // A non-finite loss is silence, not an alarm. Every `<` against NaN is false, so NaN fell through
  // both bands to 'serious' — the harshest tier, the loudest channel, reached by a division the
  // grader could not carry out. Measured on bb 0, which produced "costs ~NaN bb" graded serious.
  // Interrupting a learner over an arithmetic failure destroys trust in the one channel that has to
  // keep it; declining to speak is the honest fallback.
  if (!Number.isFinite(evLossBb)) return 'free';
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
  // "pot share", never "equity": this is win + tie/2, while the stats sheet shows raw Win% with
  // Tie% beside it. Both are right, but calling them the same thing put "66% equity" on screen
  // next to "Win 70%" and a learner has no way to reconcile two numbers for one quantity.
  const sharePct = Math.round(equity * 100);
  const reqPct = Math.round(required * 100);

  if (action === 'call') {
    return `Calling ${toCall} into a ${pot} pot needs ${reqPct}% pot share; you had ${sharePct}%.`;
  }
  if (action === 'fold') {
    // Folding at toCall 0 is a different mistake and needs different words. `required` is 0 there
    // because nothing was owed, so the shared phrasing read "when only 0% was needed" — which sounds
    // like the fold was free and cheap, the exact opposite of a 7.3bb verdict, and it appeared in 254
    // of 2234 generated messages. Checking was free; that is what the fold gave up.
    if (toCall === 0) {
      return `Checking was free and holds ${sharePct}% pot share; folding it away costs ~${evLossBb.toFixed(1)} bb.`;
    }
    return `Folding with ${sharePct}% pot share when only ${reqPct}% was needed costs ~${evLossBb.toFixed(1)} bb.`;
  }
  if (action === 'check') {
    return `Checking ${sharePct}% pot share on a later street misses value worth ~${evLossBb.toFixed(1)} bb.`;
  }
  return `Betting with only ${sharePct}% pot share against this action risks ~${evLossBb.toFixed(1)} bb.`;
}
