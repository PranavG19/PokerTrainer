/**
 * ARITHMETIC — PRODUCT-SPEC spine phase 2: "pot odds in natural frequencies, MDF, alpha, combos,
 * SPR, the variance table", advancing when "each reproducible to a number under time".
 *
 * Three things in here are deliberate and would look like over-engineering without the reason:
 *
 * FREQUENCIES, NOT PERCENTAGES. `naturalFrequency` exists because "you need 28.6% equity" is the
 * form beginners reason about badly and "about 2 times in 7" is the form they reason about well.
 * The rendering is the teaching mechanism, not decoration, so it is a first-class return value of
 * `potOdds` rather than a display helper somewhere in the renderer.
 *
 * ONE PARAMETER CONVENTION, STATED. Every function facing a bet takes `potBeforeBet` — the pot as
 * it stood before the opponent's bet went in. Pot odds then use `potBeforeBet + 2 * bet` (both the
 * bet and the call land in the pot), while MDF/alpha use `potBeforeBet + bet`. Mixing the two
 * conventions is the single most common way this arithmetic comes out wrong, so the parameter is
 * never just called `pot`.
 *
 * NO CLOCK, NO AMBIENT RNG. The problem generator takes a seed and builds its own mulberry32, so a
 * drill is reproducible from its seed alone.
 */

import type { Card, Rank } from './cards.js';
import { RANKS, SUITS, shuffledDeck } from './cards.js';
import { mulberry32 } from './rng.js';

// ---------------------------------------------------------------------------
// 1. POT ODDS AND NATURAL FREQUENCIES
// ---------------------------------------------------------------------------

export interface NaturalFrequency {
  readonly times: number;
  readonly outOf: number;
  /** Signed: rendered fraction minus the true probability. Lets a caller see the rounding cost. */
  readonly error: number;
  readonly text: string;
}

/**
 * Denominators above ~12 stop being imageable — "3 times in 17" is a percentage wearing a
 * costume, which defeats the point. The cost is that probabilities below 1/12 have no honest
 * frequency form; `error` reports it rather than hiding it.
 */
export const MAX_FREQUENCY_DENOMINATOR = 12;

/** Smallest-denominator fraction approximating `probability`. Ties go to the smaller denominator. */
export function naturalFrequency(
  probability: number,
  maxDenominator: number = MAX_FREQUENCY_DENOMINATOR,
): NaturalFrequency {
  if (probability <= 0) return { times: 0, outOf: 1, error: -probability, text: 'never' };
  if (probability >= 1) return { times: 1, outOf: 1, error: 1 - probability, text: 'always' };

  let best = { times: 1, outOf: 2 };
  let bestError = Math.abs(0.5 - probability);
  for (let outOf = 2; outOf <= maxDenominator; outOf++) {
    const times = Math.min(outOf - 1, Math.max(1, Math.round(probability * outOf)));
    const error = Math.abs(times / outOf - probability);
    // Strictly-better only, so the first (smallest) denominator wins ties.
    if (error < bestError - 1e-12) {
      best = { times, outOf };
      bestError = error;
    }
  }

  const unit = best.times === 1 ? 'time' : 'times';
  return {
    ...best,
    error: best.times / best.outOf - probability,
    text: `about ${best.times} ${unit} in ${best.outOf}`,
  };
}

export interface PotOdds {
  readonly potBeforeBet: number;
  readonly bet: number;
  /** What the caller actually puts in — capped by their stack. */
  readonly toCall: number;
  /** The denominator of the price: potBeforeBet + bet + call, with any uncalled excess removed. */
  readonly potAfterCall: number;
  readonly requiredEquity: number;
  readonly frequency: NaturalFrequency;
}

/**
 * The price of a call. `callerStack` caps the call: a bet larger than the stack is only contested
 * up to the stack, and the bettor's excess is returned rather than sitting in the pot, so it
 * shrinks the denominator too.
 */
export function potOdds(
  potBeforeBet: number,
  bet: number,
  callerStack: number = Infinity,
): PotOdds {
  const toCall = Math.min(bet, callerStack);
  const potAfterCall = potBeforeBet + 2 * toCall;
  const requiredEquity = potAfterCall > 0 ? toCall / potAfterCall : 0;
  return {
    potBeforeBet,
    bet,
    toCall,
    potAfterCall,
    requiredEquity,
    frequency: naturalFrequency(requiredEquity),
  };
}

// ---------------------------------------------------------------------------
// 2. MDF AND ALPHA
// ---------------------------------------------------------------------------

export interface Defence {
  readonly mdf: number;
  readonly alpha: number;
}

/**
 * MDF = pot/(pot+bet) and alpha = bet/(pot+bet) are THE SAME ARITHMETIC SEEN FROM THE TWO SEATS:
 * alpha is the share of the time the bettor needs a fold, MDF is the share of the time the
 * defender must not give it, and `mdf + alpha === 1` always. Teaching them as two unrelated
 * formulas is the failure mode this file exists to prevent, which is why one function returns both
 * and there is no separate `mdf()`.
 *
 * `mdf` is derived as `1 - alpha` rather than computed independently so the invariant holds in
 * floating point by construction, not by luck.
 */
export function defence(potBeforeBet: number, bet: number): Defence {
  const total = potBeforeBet + bet;
  if (total <= 0) return { mdf: 1, alpha: 0 };
  const alpha = bet / total;
  return { mdf: 1 - alpha, alpha };
}

// ---------------------------------------------------------------------------
// 3. COMBO COUNTING
// ---------------------------------------------------------------------------

export type Suitedness = 'suited' | 'offsuit' | 'any';

export interface Holding {
  readonly ranks: readonly [Rank, Rank];
  readonly suitedness: Suitedness;
}

/** "AKs" | "A5o" | "77" | "AK" (either). A pair may not be suited. */
export function parseHolding(text: string): Holding {
  const first = text[0] as Rank;
  const second = text[1] as Rank;
  if (!RANKS.includes(first) || !RANKS.includes(second)) throw new Error(`bad holding: ${text}`);
  const tail = text.slice(2).toLowerCase();
  const suitedness: Suitedness = tail === 's' ? 'suited' : tail === 'o' ? 'offsuit' : 'any';
  if (first === second && suitedness === 'suited') throw new Error(`bad holding: ${text}`);
  return { ranks: [first, second], suitedness };
}

/**
 * How many combinations of `holding` are still available. `dead` takes every card you can see —
 * board, your own hole cards, exposed cards — since combinatorially they are the same thing.
 *
 * Closed form rather than enumeration: pairs are C(n,2) over the surviving cards of that rank,
 * suited combos are the count of suits where both cards survive, and offsuit is the rest of the
 * n1*n2 cross product. The test checks this against brute-force enumeration.
 */
export function comboCount(holding: Holding, dead: readonly Card[] = []): number {
  const gone = new Set(dead);
  const [a, b] = holding.ranks;
  const alive = (rank: Rank, suit: string): boolean => !gone.has(rank + suit);

  if (a === b) {
    const n = SUITS.filter((suit) => alive(a, suit)).length;
    // Guarded rather than computed: C(0,2) via n*(n-1)/2 evaluates to -0, which fails Object.is(0).
    return n < 2 ? 0 : (n * (n - 1)) / 2;
  }

  const suited = SUITS.filter((suit) => alive(a, suit) && alive(b, suit)).length;
  if (holding.suitedness === 'suited') return suited;

  const cross =
    SUITS.filter((suit) => alive(a, suit)).length * SUITS.filter((suit) => alive(b, suit)).length;
  return holding.suitedness === 'any' ? cross : cross - suited;
}

/** Every concrete two-card combination of `holding` that survives `dead`. */
export function comboCards(holding: Holding, dead: readonly Card[] = []): Card[][] {
  const gone = new Set(dead);
  const [a, b] = holding.ranks;
  const combos: Card[][] = [];
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      const c1 = a + s1;
      const c2 = b + s2;
      if (c1 === c2 || gone.has(c1) || gone.has(c2)) continue;
      const isSuited = s1 === s2;
      if (holding.suitedness === 'suited' && !isSuited) continue;
      if (holding.suitedness === 'offsuit' && isSuited) continue;
      // Unordered pairs: keep one ordering only.
      if (combos.some(([x, y]) => x === c2 && y === c1)) continue;
      combos.push([c1, c2]);
    }
  }
  return combos;
}

// ---------------------------------------------------------------------------
// 4. SPR AND COMMITMENT
// ---------------------------------------------------------------------------

export type CommitmentBand = 'committed' | 'medium' | 'deep';

/**
 * At SPR 3 the entire effective stack fits inside two pot-sized bets — (3^n - 1)/2 = SPR gives
 * n = log_3(7) ≈ 1.77 — so the commitment decision is already made on the flop and one pair plays
 * for stacks. Above ~6 it takes three or more bets, which is room to fold one pair.
 */
export const COMMITTED_SPR = 3;
export const DEEP_SPR = 6;

export interface Spr {
  readonly spr: number;
  readonly band: CommitmentBand;
  /** How many pot-sized bet-and-call rounds until the stack is in. Infinite at zero pot. */
  readonly potSizedBetsToAllIn: number;
  /** True when a single pair is worth the stack, i.e. the stack is inside the committed band. */
  readonly committedWithOnePair: boolean;
}

export function spr(effectiveStack: number, pot: number): Spr {
  const ratio = pot > 0 ? effectiveStack / pot : Infinity;
  const band: CommitmentBand =
    ratio <= COMMITTED_SPR ? 'committed' : ratio <= DEEP_SPR ? 'medium' : 'deep';
  return {
    spr: ratio,
    band,
    potSizedBetsToAllIn: Number.isFinite(ratio) ? Math.log(2 * ratio + 1) / Math.log(3) : Infinity,
    committedWithOnePair: band === 'committed',
  };
}

// ---------------------------------------------------------------------------
// 5. THE VARIANCE FIGURE
// ---------------------------------------------------------------------------

/** PRODUCT-SPEC line 15: the feedback signal's standard deviation. */
export const SIGMA_BB_PER_100 = 100;
export const BB_PER_BUY_IN = 100;

/**
 * Zelen & Severo (Abramowitz & Stegun 26.2.17). |error| < 7.5e-8, which is six orders of magnitude
 * below anything this app displays; a double-precision erf is not worth the code here.
 */
export function normalCdf(z: number): number {
  if (z < 0) return 1 - normalCdf(-z);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const density = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  return 1 - density * poly;
}

export interface VarianceQuery {
  readonly hands: number;
  readonly winRateBbPer100: number;
  readonly buyIns: number;
  readonly sigmaBbPer100?: number;
  readonly bbPerBuyIn?: number;
}

export interface VarianceRisk {
  readonly probability: number;
  readonly frequency: NaturalFrequency;
  readonly expectedBb: number;
  readonly sigmaBb: number;
  readonly thresholdBb: number;
}

/**
 * Probability of finishing `hands` hands down `buyIns` or more, at a given win rate and sigma.
 * Sums to a normal by CLT: mean scales with hands, sigma with their square root.
 *
 * This is the number behind the spec's "~8% of 200-hand sessions lose two or more buy-ins at zero
 * strategic error" — computed, not asserted, so changing sigma or the session length moves it.
 */
export function riskOfLosing(query: VarianceQuery): VarianceRisk {
  const sigmaPer100 = query.sigmaBbPer100 ?? SIGMA_BB_PER_100;
  const bbPerBuyIn = query.bbPerBuyIn ?? BB_PER_BUY_IN;
  const blocks = query.hands / 100;
  const expectedBb = query.winRateBbPer100 * blocks;
  const sigmaBb = sigmaPer100 * Math.sqrt(blocks);
  const thresholdBb = -query.buyIns * bbPerBuyIn;

  // Zero variance is deterministic, not a division: the result is the mean with certainty.
  const probability =
    sigmaBb > 0
      ? normalCdf((thresholdBb - expectedBb) / sigmaBb)
      : expectedBb <= thresholdBb
        ? 1
        : 0;

  return {
    probability,
    frequency: naturalFrequency(probability),
    expectedBb,
    sigmaBb,
    thresholdBb,
  };
}

// ---------------------------------------------------------------------------
// 6. PROBLEM GENERATOR AND GRADING
// ---------------------------------------------------------------------------

export type DrillKind = 'pot-odds' | 'alpha' | 'mdf' | 'spr' | 'combos';

export const DRILL_KINDS: readonly DrillKind[] = ['pot-odds', 'alpha', 'mdf', 'spr', 'combos'];

export interface ArithmeticProblem {
  readonly kind: DrillKind;
  readonly potBeforeBet: number;
  readonly bet: number;
  readonly effectiveStack: number;
  readonly prompt: string;
  readonly answer: number;
  /**
   * The accepted band around `answer`. Real-valued kinds (pot-odds/alpha/mdf/spr) carry a nonzero band
   * because they are answered by a small-denominator frequency or a mental division; `combos` is an
   * EXACT integer count, so its tolerance is 0 — a band there would accept a wrong count.
   */
  readonly tolerance: number;
  /** Set only for `combos`: the holding whose combinations are counted, and the seen cards removing some. */
  readonly holding?: Holding;
  readonly dead?: readonly Card[];
}

/**
 * The combos drill's holdings — pairs (6 combos), suited (4), offsuit (12) and any (16) — so the learner
 * drills all four baselines. A uniform random board (below) then removes blockers, exactly as at a real
 * table; no bias toward blocker boards, since the honest distribution is the real one.
 */
const COMBO_HOLDINGS = [
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99',
  'AKs', 'AQs', 'KQs', 'JTs',
  'AKo', 'AQo', 'KQo',
  'AK', 'AQ', 'KQ',
] as const;

/** The prompt's holding phrase, spelling out "any two" so the count the learner owes is unambiguous. */
function holdingLabel(text: string, holding: Holding): string {
  if (holding.ranks[0] === holding.ranks[1]) return text; // "AA" — a pair reads for itself
  if (holding.suitedness === 'any') return `${text} (either suited or offsuit)`;
  return text; // "AKs" / "AKo" carry the suitedness in the notation
}

/** Bet sizes a real table produces, as a fraction of pot. */
const BET_FRACTIONS = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.25] as const;
const POTS_BB = [3, 4.5, 6, 8, 11, 14, 20, 28, 40, 60] as const;
const STACKS_BB = [40, 60, 75, 100, 150, 200] as const;

/**
 * Two percentage points. The taught method renders a price as a small-denominator frequency, and
 * the coarsest legitimate frequency (2 in 7 for 28.6%) is already ~0.3 points off exact while
 * neighbouring fractions sit ~1.3 points apart — so a band tighter than this fails a learner who
 * did the arithmetic correctly by the method being taught, and a much looser one accepts a
 * genuinely wrong price.
 */
export const PROBABILITY_TOLERANCE = 0.02;

/**
 * A quarter of an SPR unit or 5%, whichever is looser: SPR is computed by mental division and is
 * read in bands (3, 6), so one significant figure is the honest target at deep stacks.
 */
export function sprTolerance(answer: number): number {
  return Math.max(0.25, 0.05 * answer);
}

/** Halves keep the mental arithmetic tractable; a 7.33 bb pot tests division, not poker. */
const toHalf = (value: number): number => Math.round(value * 2) / 2;

const pick = <T,>(items: readonly T[], roll: number): T =>
  items[Math.min(items.length - 1, Math.floor(roll * items.length))];

export function generateProblem(seed: number, kind?: DrillKind): ArithmeticProblem {
  const rng = mulberry32(seed);
  const chosen = kind ?? pick(DRILL_KINDS, rng());
  const potBeforeBet = pick(POTS_BB, rng());
  const bet = Math.max(0.5, toHalf(potBeforeBet * pick(BET_FRACTIONS, rng())));
  // The stack must leave something BEHIND the call, not merely cover it. Clamping to `bet` exactly
  // made `effectiveStack - bet` zero, so the SPR problem read "0 bb behind. SPR?" with answer 0 and
  // tolerance 0.25 — every guess in [-0.25, 0.25] accepted, nothing to compute, and the worked method
  // then explained a ratio for a stack that was already all in. 7.0% of the SPR sequence the drill
  // screen serves (scripts/audit-w6/a24-spr-degenerate.ts). Half a big blind is the smallest unit the
  // rest of this generator works in, so it is the smallest honest floor.
  const MIN_BEHIND = 0.5;
  const effectiveStack = Math.max(bet + MIN_BEHIND, toHalf(pick(STACKS_BB, rng()) - potBeforeBet / 2));

  if (chosen === 'spr') {
    const pot = potBeforeBet + 2 * bet;
    const answer = spr(effectiveStack - bet, pot).spr;
    return {
      kind: chosen,
      potBeforeBet,
      bet,
      effectiveStack,
      prompt: `Pot ${pot} bb after the call, ${toHalf(effectiveStack - bet)} bb behind. SPR?`,
      answer,
      tolerance: sprTolerance(answer),
    };
  }

  if (chosen === 'combos') {
    const text = pick(COMBO_HOLDINGS, rng());
    const holding = parseHolding(text);
    // A uniform 3–5 card board off the same seeded shuffle. Some boards blank the holding's ranks
    // (full combos), ~a third hit one (a blocker) — the real distribution, so no case is manufactured.
    const boardSize = pick([3, 4, 5] as const, rng());
    const dead = shuffledDeck(rng).slice(0, boardSize);
    const answer = comboCount(holding, dead);
    return {
      kind: chosen,
      potBeforeBet,
      bet,
      effectiveStack,
      prompt: `A villain can hold ${holdingLabel(text, holding)}. Board: ${dead.join(' ')}. How many combinations remain?`,
      answer,
      tolerance: 0, // an exact integer count — a band would accept a wrong number
      holding,
      dead,
    };
  }

  const shared = { kind: chosen, potBeforeBet, bet, effectiveStack, tolerance: PROBABILITY_TOLERANCE };
  if (chosen === 'pot-odds') {
    const odds = potOdds(potBeforeBet, bet, effectiveStack);
    return {
      ...shared,
      prompt: `${bet} bb into ${potBeforeBet} bb. What equity do you need to call?`,
      answer: odds.requiredEquity,
    };
  }

  const { mdf, alpha } = defence(potBeforeBet, bet);
  return chosen === 'alpha'
    ? {
        ...shared,
        prompt: `You bet ${bet} bb into ${potBeforeBet} bb. How often do you need a fold?`,
        answer: alpha,
      }
    : {
        ...shared,
        prompt: `You face ${bet} bb into ${potBeforeBet} bb. What share must you defend?`,
        answer: mdf,
      };
}

export interface Grading {
  readonly correct: boolean;
  readonly error: number;
  readonly tolerance: number;
}

export function gradeAnswer(problem: ArithmeticProblem, given: number): Grading {
  const error = given - problem.answer;
  return {
    correct: Math.abs(error) <= problem.tolerance,
    error,
    tolerance: problem.tolerance,
  };
}
