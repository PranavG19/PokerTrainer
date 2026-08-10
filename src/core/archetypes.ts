/**
 * THE SIX RULE-BASED ARCHETYPES — PRODUCT-SPEC O1, O2, O3.
 *
 * O1: "Six rule-based archetypes: nit, station, LAG, TAG-reg, over-folder, maniac. Never a
 * dialled-down solver — weakening a strong engine does not produce human-like play, and a loosened
 * GTO bot teaches exploits nobody offers." So each archetype here is a hand-authored behavioural
 * signature — a bag of frequency parameters — and the decision function reads those frequencies
 * directly. There is no equilibrium strategy being degraded: the leaks are the design.
 *
 * O2: "TAG-reg exists so 'I don't know' has a home. It maps to baseline, and the learner is scored
 * for NOT deviating against it." So `tag-reg`'s exploit text names the absence of an exploit — the
 * correct read against it is to play your standard line — and it sits behaviourally between the two
 * extremes rather than leaning toward either.
 *
 * WHY THIS IS ADDITIVE TO ai.ts AND DOES NOT TOUCH IT. ai.ts ships THREE archetypes (nit, tag,
 * station) and the table/gameplay e2e drives villains through its `decideAction`. Widening ai.ts to
 * six would change the seat-assignment cycle and the action stream those tests assert on. So the six
 * live here as their own data and their own decision function. The decision logic is deliberately a
 * copy of ai.ts's proven `decideActionAs` shape — its helpers (`handStrength`, `aggressiveAction`,
 * `callOrAllIn`, `clampRaise`) and its `Profile` type are module-private in ai.ts and cannot be
 * imported, and reproducing the exact control flow is what keeps "returns only legal actions" true
 * here without re-deriving it.
 *
 * WHY THE DECISION FUNCTION TAKES A PROFILE, NOT AN ARCHETYPE NAME. O3 (jitter.ts) moves the true
 * frequencies per session, and its header is explicit that "the jittered parameters ARE the truth
 * for the session" — a read is graded against them, not against the nominal archetype. A decision
 * function keyed on a name would silently re-derive the nominal profile and ignore the jitter. So it
 * consumes an `ArchetypeProfile` directly: the caller draws `sessionProfile(name, sessionSeed)` once
 * per session (composing jitter.ts) and feeds the result to every decision that session.
 */

import type { Card } from './cards.js';
import type { Rng } from './rng.js';
import type { Action, ActionKind, TableState } from './table.js';
import { legalActions, minRaiseTo, maxRaiseTo } from './table.js';
import { equityVsRandom } from './equity.js';
import { jitterParameters } from './jitter.js';

/** O1's six, in the order the spec lists them. The id doubles as jitter.ts's `archetypeId`. */
export const ARCHETYPE_NAMES = ['nit', 'station', 'lag', 'tag-reg', 'over-folder', 'maniac'] as const;

export type ArchetypeName = (typeof ARCHETYPE_NAMES)[number];

/**
 * A flat bag of behavioural frequencies. Every field is a number so it satisfies jitter.ts's
 * `ArchetypeParameters<T>` constraint directly and the whole profile can be jittered per session.
 * The semantics match ai.ts's `Profile`, which is why the decision logic below mirrors ai.ts.
 */
export interface ArchetypeProfile {
  /** Min hand strength (0..1 equity-vs-random) to keep calling a bet. */
  readonly callStrength: number;
  /** Min hand strength to consider betting/raising for value. */
  readonly raiseStrength: number;
  /** How often it actually raises once strong enough. */
  readonly raiseFreq: number;
  /** How often it stabs at an unopened pot without the strength to. */
  readonly bluffBetFreq: number;
  /** How often it bluff-RAISES a bet — a far more expensive lie, so much rarer. */
  readonly bluffRaiseFreq: number;
  /** How often it calls a bet its strength says to fold. */
  readonly loosecallFreq: number;
  readonly betPotFraction: number;
}

/**
 * The six signatures as data. The numbers are chosen so the archetypes are behaviourally distinct
 * and each ordering below is a real, nameable read:
 *
 *  - bluffBetFreq (stabbing an unopened pot): maniac > lag > tag-reg > over-folder ≳ nit ≈ station.
 *  - callStrength (how strong a hand it needs to continue): over-folder > nit > tag-reg > lag >
 *    station > maniac, i.e. over-folder folds the most to a bet and station/maniac the least.
 *  - loosecallFreq: station calls off far more than anyone; nit and over-folder never do (0).
 *
 * A parameter that is exactly 0 is a STRUCTURAL fact about the archetype, not a small number — a nit
 * never bluff-raises, an over-folder never makes a loose call — and jitter.ts leaves an exact zero at
 * zero, so these stay off.
 */
export const ARCHETYPE_PROFILES: Record<ArchetypeName, ArchetypeProfile> = {
  // Very tight, only value, almost never bluffs. Fold to its aggression, steal its blinds.
  nit: { callStrength: 0.68, raiseStrength: 0.8, raiseFreq: 0.8, bluffBetFreq: 0.05, bluffRaiseFreq: 0, loosecallFreq: 0, betPotFraction: 0.6 },
  // Calls far too much, almost never folds, rarely raises. Value bet thin, never bluff it.
  station: { callStrength: 0.4, raiseStrength: 0.85, raiseFreq: 0.15, bluffBetFreq: 0.05, bluffRaiseFreq: 0.02, loosecallFreq: 0.85, betPotFraction: 0.5 },
  // Loose-aggressive: wide value range, bluffs and bluff-raises a lot. Call it down, don't out-bluff it.
  lag: { callStrength: 0.42, raiseStrength: 0.5, raiseFreq: 0.8, bluffBetFreq: 0.5, bluffRaiseFreq: 0.3, loosecallFreq: 0.35, betPotFraction: 0.75 },
  // Balanced baseline — O2's "I don't know" home. Sits between the extremes; no reliable leak.
  'tag-reg': { callStrength: 0.55, raiseStrength: 0.62, raiseFreq: 0.7, bluffBetFreq: 0.3, bluffRaiseFreq: 0.12, loosecallFreq: 0.05, betPotFraction: 0.66 },
  // Folds too much to a bet and never fights back (bluffRaiseFreq 0). Bet and raise relentlessly.
  'over-folder': { callStrength: 0.75, raiseStrength: 0.78, raiseFreq: 0.5, bluffBetFreq: 0.08, bluffRaiseFreq: 0, loosecallFreq: 0, betPotFraction: 0.55 },
  // Hyper-aggressive: bets and raises almost everything, huge sizings. Trap it and call down light.
  maniac: { callStrength: 0.3, raiseStrength: 0.4, raiseFreq: 0.9, bluffBetFreq: 0.8, bluffRaiseFreq: 0.55, loosecallFreq: 0.4, betPotFraction: 1.0 },
};

/**
 * Renderer-facing copy the learner reads to name the exploit. `exploit` is the load-bearing line:
 * each is a real, actionable read a learner can state and be graded on. `tag-reg`'s exploit is the
 * absence of one, per O2 — the scored answer against it is to NOT deviate.
 */
export interface ArchetypeExploit {
  readonly label: string;
  readonly description: string;
  readonly exploit: string;
}

export const ARCHETYPE_EXPLOITS: Record<ArchetypeName, ArchetypeExploit> = {
  nit: {
    label: 'Nit',
    description: 'Extremely tight. Folds most hands, only commits with strong ones, almost never bluffs.',
    exploit: 'Steal relentlessly and give up the moment it puts money in — when a nit bets, it has it.',
  },
  station: {
    label: 'Station',
    description: 'Calling station. Calls far too much, almost never folds to a bet, rarely raises.',
    exploit: 'Value bet thin and never bluff — it pays off your good hands and folds to nothing.',
  },
  lag: {
    label: 'LAG',
    description: 'Loose-aggressive. Plays a wide range and bets, raises and bluff-raises constantly.',
    exploit: 'Widen your calling range and let it barrel into you; do not try to out-bluff a bluffer.',
  },
  'tag-reg': {
    label: 'TAG-reg',
    description: 'Tight-aggressive regular. Solid, balanced ranges with reasonable aggression.',
    exploit: 'No reliable leak — this is the baseline. Play your standard line; deviating loses EV.',
  },
  'over-folder': {
    label: 'Over-folder',
    description: 'Folds too much to aggression, surrendering far more often than the pot odds justify.',
    exploit: 'Bet and raise relentlessly, especially as a bluff — it gives up too easily.',
  },
  maniac: {
    label: 'Maniac',
    description: 'Hyper-aggressive. Bets and raises almost any two cards, with oversized sizings.',
    exploit: 'Trap with strong hands and call down light — let its constant aggression pay you off.',
  },
};

/**
 * O3's per-session jitter, composed. Draw this ONCE per session (the session seed is the only
 * variation) and reuse the returned profile for every decision that session; feeding a name to the
 * decision function instead would ignore the jitter. Structural zeros stay zero (jitter.ts).
 */
export function sessionProfile(archetype: ArchetypeName, sessionSeed: number): ArchetypeProfile {
  return jitterParameters(sessionSeed, archetype, ARCHETYPE_PROFILES[archetype]);
}

/**
 * Pick a legal action for the seat, given its (possibly jittered) behavioural profile, the visible
 * table state, and a seeded Rng. Pure and deterministic: the only randomness is `rng`.
 *
 * Mirrors ai.ts's `decideActionAs` control flow deliberately — see the module header for why the
 * duplication is intentional rather than a candidate for extraction.
 */
export function decideArchetypeAction(
  profile: ArchetypeProfile,
  state: TableState,
  seatId: number,
  rng: Rng,
): Action {
  if (state.toAct !== seatId) throw new Error(`seat ${seatId} is not to act`);
  const legal = legalActions(state);
  if (legal.length === 0) throw new Error(`seat ${seatId} has no legal action`);

  const seat = state.seats[seatId];
  const strength = handStrength(seat.hole, state.board, Math.floor(rng() * 0xffffffff));
  const aggressionRoll = rng();
  const callRoll = rng();

  // Extra opponents mean the same hand has to beat more people, so demand more of it.
  const opponents = state.seats.filter((s) => !s.folded && s.id !== seatId).length;
  const crowdTax = 0.03 * Math.max(0, opponents - 1);
  const canAggress = legal.includes('raise') || legal.includes('bet') || legal.includes('allin');
  const toCall = state.currentBet - seat.committed;

  const bluffFreq = toCall > 0 ? profile.bluffRaiseFreq : profile.bluffBetFreq;
  const wantsAggression =
    strength >= profile.raiseStrength + crowdTax
      ? aggressionRoll < profile.raiseFreq
      : aggressionRoll < bluffFreq;

  if (wantsAggression && canAggress) return aggressiveAction(state, legal, profile.betPotFraction);

  if (toCall <= 0) return { kind: 'check' };

  if (strength >= profile.callStrength + crowdTax) return callOrAllIn(legal);
  if (callRoll < profile.loosecallFreq) return callOrAllIn(legal);
  return { kind: 'fold' };
}

/**
 * Equity vs one random hand: a 0..1 quality scale that doesn't shift with table size. 300 iterations,
 * matching ai.ts — an AI decision runs on every villain turn and must not stall the UI, and its
 * estimate is never shown, so the ~3% Monte-Carlo noise is far smaller than the gaps between these
 * archetypes' frequencies.
 */
function handStrength(hole: Card[], board: Card[], seed: number): number {
  const eq = equityVsRandom(hole, board, 1, 300, seed);
  return eq.win + eq.tie * 0.5;
}

function aggressiveAction(state: TableState, legal: ActionKind[], potFraction: number): Action {
  const amount = clampRaise(state, state.currentBet + Math.round(state.pot * potFraction));
  if (legal.includes('raise')) return { kind: 'raise', amount };
  if (legal.includes('bet')) return { kind: 'bet', amount };
  return { kind: 'allin' };
}

function callOrAllIn(legal: ActionKind[]): Action {
  if (legal.includes('call')) return { kind: 'call' };
  return { kind: 'allin' }; // too short to call in full — all-in IS the call
}

function clampRaise(state: TableState, target: number): number {
  return Math.min(Math.max(target, minRaiseTo(state)), maxRaiseTo(state));
}
