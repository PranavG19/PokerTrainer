/**
 * THE ROBUSTNESS DRILL — PRODUCT-SPEC O7.
 *
 * After a decision, the learner's line is replayed against four opponent continuations —
 * equilibrium-ish, fold-biased, call-biased, raise-biased. A line best against exactly one and bad
 * against the others is a leak; a line fine against all four is robust. The point of the drill is
 * that it BUYS EXPLOITABILITY INTUITION WITH ZERO EXPLOITABILITY COMPUTATION: nothing here solves a
 * game, and the four continuations are RE-WEIGHTINGS of the archetype frequencies already in ai.ts,
 * not new game trees.
 *
 * IT IS A HEURISTIC, NEVER A BOUND. A learner who reads a tight spread as "my line is at most this
 * exploitable" has learned something false. Four hand-picked opponent tilts are not a best response,
 * the EV model below is one betting round with a uniform-strength villain, and the equity is a
 * seeded Monte Carlo estimate with its own noise. So nothing in this module — module name, field
 * name or copy — may say `exploitability`, `worstCase`, `bound`, `guaranteed` or `maxLoss`. The
 * output is a SPREAD across four guesses about how an opponent might lean, and that is all.
 *
 * The spread is the signal, not any single continuation's number, so `spreadBb` is the headline
 * field rather than something the caller derives.
 *
 * Robustness is about SPREAD ONLY, deliberately. Whether the line makes money is coach.ts's job
 * (EV loss vs the best alternative); duplicating that here would give the learner two different
 * verdicts on one decision. A line that loses a little against all four is `robust` and still a bad
 * call — the coach says so, this module does not.
 */

import type { Card } from './cards.js';
import type { Archetype } from './ai.js';
import { PROFILES } from './ai.js';
import { DISPLAY_ITERATIONS, equityVsRandom } from './equity.js';

export type ContinuationId = 'equilibrium' | 'foldBiased' | 'callBiased' | 'raiseBiased';

/** The hero action being stress-tested. Same vocabulary as coach.ts's `chosen`. */
export type HeroLine = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface ResponseWeights {
  /** Facing hero aggression: these three sum to 1. */
  fold: number;
  call: number;
  raise: number;
  /** Facing a passive hero (check/call): how often the villain bets into them instead of checking. */
  stab: number;
}

export interface ContinuationOutcome {
  id: ContinuationId;
  label: string;
  /** Hero's chips won or lost by this line against this continuation, in big blinds. */
  evBb: number;
  weights: ResponseWeights;
}

export interface RobustnessReport {
  /** HEADLINE. Widest gap between the four continuations' EV, in big blinds. */
  spreadBb: number;
  /**
   * Spread as a multiple of the pot. The verdict uses this, not `spreadBb`: a 3bb spread is nothing
   * in a 200bb pot and enormous in a 4bb one, so a bb threshold would call the same line robust or
   * fragile depending only on stakes.
   */
  spreadPotFraction: number;
  verdict: 'robust' | 'mixed' | 'leak' | 'no-continuation';
  /** In CONTINUATIONS order, so callers can render four stable columns. */
  outcomes: ContinuationOutcome[];
  best: ContinuationId;
  worst: ContinuationId;
  /** How many of the four this line makes money against. Exactly one is the classic leak shape. */
  profitableAgainst: number;
  /** Null when robust — G3 silence. A line with nothing to fix gets no comment, and silence is not praise. */
  message: string | null;
}

export const CONTINUATION_LABELS: Record<ContinuationId, string> = {
  equilibrium: 'Equilibrium-ish',
  foldBiased: 'Fold-biased',
  callBiased: 'Call-biased',
  raiseBiased: 'Raise-biased',
};

export const CONTINUATIONS: ContinuationId[] = ['equilibrium', 'foldBiased', 'callBiased', 'raiseBiased'];

/** Renderer copy. Must accompany any spread shown on screen — see the header on heuristic vs bound. */
export const HEURISTIC_DISCLAIMER =
  'Four guesses at how an opponent might lean, not a solve — a wide spread flags a line that needs the read to be right.';

/**
 * Each continuation is a mixture over the three archetypes in ai.ts, mixed FIELD BY FIELD across
 * their frequencies. TAG carries the equilibrium-ish weight because it is the only archetype with a
 * mixed strategy (it both bluffs and folds); the nit and the station are still mixed in so that
 * continuation is a blend rather than a copy of one bot.
 */
const MIX: Record<ContinuationId, Record<Archetype, number>> = {
  equilibrium: { nit: 0.25, tag: 0.5, station: 0.25 },
  foldBiased: { nit: 0.85, tag: 0.15, station: 0 },
  callBiased: { nit: 0, tag: 0.15, station: 0.85 },
  raiseBiased: { nit: 0.15, tag: 0.85, station: 0 },
};

/**
 * None of the three archetypes is raise-happy — TAG tops out at raiseFreq 0.7 and bluffRaiseFreq
 * 0.12 — so no mixture of the three can span a raise-biased opponent. That one continuation gets an
 * explicit tilt on top of its mixture. Without this the fourth continuation would sit on top of
 * equilibrium-ish and the drill would be three continuations wearing four labels.
 */
const RAISE_TILT = {
  raiseFreqMul: 1.35,
  bluffRaiseFreqMul: 5,
  bluffBetFreqMul: 1.6,
  raiseStrengthDrop: 0.12,
};

/** Spread-as-pot-fraction cutoffs for the verdict. Hand-set; nothing derives them. */
const ROBUST_SPREAD = 0.3;
const LEAK_SPREAD = 0.6;

interface Frequencies {
  callStrength: number;
  raiseStrength: number;
  raiseFreq: number;
  bluffBetFreq: number;
  bluffRaiseFreq: number;
  loosecallFreq: number;
  betPotFraction: number;
}

export interface RobustnessInput {
  hole: Card[];
  board: Card[];
  /** Pot before the hero acts, INCLUDING the villain's outstanding bet (same convention as coach.ts). */
  pot: number;
  /** What the hero owes to continue. 0 when they could check. */
  toCall: number;
  line: HeroLine;
  /** Chips the hero puts in on this action, call portion included. Required for bet/raise/allin. */
  betSize?: number;
  bb: number;
  seed: number;
  /** Only used for the equity estimate; the continuation model itself is one responding villain. */
  opponents?: number;
}

export function robustnessDrill(input: RobustnessInput): RobustnessReport {
  const { pot, toCall, line, bb } = input;
  const isAggressive = line === 'bet' || line === 'raise' || line === 'allin';
  // Defaulting a missing size to 0 would model a zero-chip "bet" and return a confident report about
  // a line nobody played, so refuse instead.
  if (isAggressive && !input.betSize) throw new Error(`robustnessDrill: ${line} needs a betSize`);
  if (bb <= 0) throw new Error('robustnessDrill: bb must be positive');

  const equity = heroEquity(input);

  const outcomes = CONTINUATIONS.map((id) => {
    const freqs = continuationFrequencies(id);
    const weights = responseWeights(freqs);
    return {
      id,
      label: CONTINUATION_LABELS[id],
      evBb: lineEv(line, { pot, toCall, betSize: input.betSize ?? 0, equity, freqs, weights }) / bb,
      weights,
    };
  });

  const evs = outcomes.map((o) => o.evBb);
  const spreadBb = Math.max(...evs) - Math.min(...evs);
  const potBb = pot / bb;
  const spreadPotFraction = potBb === 0 ? 0 : spreadBb / potBb;
  const profitableAgainst = evs.filter((ev) => ev > 0).length;
  const best = outcomes[evs.indexOf(Math.max(...evs))].id;
  const worst = outcomes[evs.indexOf(Math.min(...evs))].id;

  const verdict = classify(line, spreadPotFraction, profitableAgainst);

  return {
    spreadBb,
    spreadPotFraction,
    verdict,
    outcomes,
    best,
    worst,
    profitableAgainst,
    message: verdict === 'robust' || verdict === 'no-continuation' ? null : buildMessage(verdict, best, worst, spreadBb),
  };
}

function classify(
  line: HeroLine,
  spreadPotFraction: number,
  profitableAgainst: number,
): RobustnessReport['verdict'] {
  // A fold ends the hand, so there is no continuation to be exploited by and all four outcomes are
  // identical by construction. Calling that `robust` would teach the learner that folding the nuts
  // is a robust line, so it gets its own verdict and no praise.
  if (line === 'fold') return 'no-continuation';
  // "A line fine against all four is robust" — O7's own words, and they override the spread here.
  // UPSIDE variance is not fragility: betting the nuts wins ~10bb against a fold-biased opponent
  // and ~20bb against a raise-biased one, a spread of 0.9 pots that a magnitude-only rule calls
  // `mixed` and then nags about. G3 silence says a decision costing ~nothing gets no comment.
  if (profitableAgainst === CONTINUATIONS.length) return 'robust';
  if (spreadPotFraction <= ROBUST_SPREAD) return 'robust';
  if (spreadPotFraction >= LEAK_SPREAD && profitableAgainst <= 1) return 'leak';
  return 'mixed';
}

function buildMessage(
  verdict: RobustnessReport['verdict'],
  best: ContinuationId,
  worst: ContinuationId,
  spreadBb: number,
): string {
  const bestLabel = CONTINUATION_LABELS[best].toLowerCase();
  const worstLabel = CONTINUATION_LABELS[worst].toLowerCase();
  const gap = spreadBb.toFixed(1);
  if (verdict === 'leak') {
    return `This line only shows a profit against a ${bestLabel} opponent and swings ~${gap} bb by the time you reach a ${worstLabel} one — it needs the read to be right.`;
  }
  return `This line swings ~${gap} bb between a ${bestLabel} and a ${worstLabel} opponent, so how much it wins depends on which one you are facing.`;
}

/** Exposed so the re-weightings can be inspected directly, not only through their EV. */
export function continuationWeights(id: ContinuationId): ResponseWeights {
  return responseWeights(continuationFrequencies(id));
}

/** Field-by-field re-weighting of the ai.ts profiles, plus the raise tilt where the mixture cannot reach. */
function continuationFrequencies(id: ContinuationId): Frequencies {
  const mix = MIX[id];
  const blend = (pick: (f: Frequencies) => number): number =>
    (Object.keys(mix) as Archetype[]).reduce((sum, a) => sum + mix[a] * pick(PROFILES[a]), 0);

  const base: Frequencies = {
    callStrength: blend((f) => f.callStrength),
    raiseStrength: blend((f) => f.raiseStrength),
    raiseFreq: blend((f) => f.raiseFreq),
    bluffBetFreq: blend((f) => f.bluffBetFreq),
    bluffRaiseFreq: blend((f) => f.bluffRaiseFreq),
    loosecallFreq: blend((f) => f.loosecallFreq),
    betPotFraction: blend((f) => f.betPotFraction),
  };

  if (id !== 'raiseBiased') return base;

  return {
    ...base,
    raiseStrength: Math.max(base.callStrength, base.raiseStrength - RAISE_TILT.raiseStrengthDrop),
    raiseFreq: Math.min(1, base.raiseFreq * RAISE_TILT.raiseFreqMul),
    bluffRaiseFreq: Math.min(1, base.bluffRaiseFreq * RAISE_TILT.bluffRaiseFreqMul),
    bluffBetFreq: Math.min(1, base.bluffBetFreq * RAISE_TILT.bluffBetFreqMul),
  };
}

/**
 * Turns ai.ts's strength thresholds into a response distribution by integrating its decision order
 * (aggress → check → call by strength → loose-call) over a villain strength drawn uniform on 0..1.
 * Uniform is the crude part: `handStrength` in ai.ts is equity vs one random hand, which is roughly
 * but not exactly uniform over random holdings. The crowd tax is dropped because this model has one
 * responding villain, where ai.ts's tax is zero anyway.
 */
function responseWeights(f: Frequencies): ResponseWeights {
  const strong = 1 - f.raiseStrength;
  const middling = f.raiseStrength - f.callStrength;
  const weak = f.callStrength;

  const raise = strong * f.raiseFreq + (middling + weak) * f.bluffRaiseFreq;
  const call =
    strong * (1 - f.raiseFreq) +
    middling * (1 - f.bluffRaiseFreq) +
    weak * (1 - f.bluffRaiseFreq) * f.loosecallFreq;

  return {
    fold: clamp01(1 - raise - call),
    call: clamp01(call),
    raise: clamp01(raise),
    stab: clamp01(strong * f.raiseFreq + (middling + weak) * f.bluffBetFreq),
  };
}

interface EvContext {
  pot: number;
  toCall: number;
  betSize: number;
  equity: number;
  freqs: Frequencies;
  weights: ResponseWeights;
}

/**
 * One betting round, chips relative to before the hero acts. Everything past the villain's response
 * collapses to a showdown at the hero's equity — the drill compares four continuations against each
 * other, and a deeper tree would move all four together without changing the spread's story.
 */
function lineEv(line: HeroLine, ctx: EvContext): number {
  if (line === 'fold') return 0;
  if (line === 'check' || line === 'call') return passiveEv(ctx);
  return aggressiveEv(ctx);
}

function passiveEv(ctx: EvContext): number {
  const { pot, toCall, equity, freqs, weights } = ctx;
  const potAfter = pot + toCall;
  const showdown = equity * potAfter - toCall;

  const stabSize = Math.round(freqs.betPotFraction * potAfter);
  const facingStab = Math.max(
    equityWhenContested(ctx) * (potAfter + 2 * stabSize) - toCall - stabSize,
    -toCall,
  );

  return weights.stab * facingStab + (1 - weights.stab) * showdown;
}

function aggressiveEv(ctx: EvContext): number {
  const { pot, toCall, betSize, weights, freqs } = ctx;
  const potIfCalled = pot + 2 * betSize - toCall;

  // The villain folding hands the hero the pot as it stood; their own bet is returned, not won.
  const ifFold = pot;
  const ifCall = equityWhenContested(ctx) * potIfCalled - betSize;

  const raiseTo = betSize + Math.round(freqs.betPotFraction * potIfCalled);
  const potIfRaiseCalled = pot + 2 * raiseTo - toCall;
  const ifRaise = Math.max(equityWhenContested(ctx) * potIfRaiseCalled - raiseTo, -betSize);

  return weights.fold * ifFold + weights.call * ifCall + weights.raise * ifRaise;
}

/**
 * Equity vs the slice of hands a continuation keeps playing, not vs a random hand. Crude and
 * deliberately so: a straight linear haircut in the continue fraction, halving the hero's share in
 * the limit where the villain continues with nothing but the top of their range. It has no
 * pretension to accuracy; it exists because ignoring it would say a nit's call and a station's call
 * are equally bad news for the hero, which is the single biggest thing a fold/call re-weighting is
 * supposed to teach.
 */
function equityWhenContested(ctx: EvContext): number {
  const continueFraction = clamp01(ctx.weights.call + ctx.weights.raise);
  return ctx.equity * (0.5 + 0.5 * continueFraction);
}

/**
 * DISPLAY_ITERATIONS, matching coach.ts: two Monte Carlo counts give two different numbers for one
 * spot, and a robustness spread that contradicts the coach's pot share on the same screen is worse
 * than either alone.
 */
function heroEquity(input: RobustnessInput): number {
  const eq = equityVsRandom(input.hole, input.board, input.opponents ?? 1, DISPLAY_ITERATIONS, input.seed);
  return eq.win + eq.tie * 0.5;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
