import type { Card } from './cards.js';
import type { Rng } from './rng.js';
import type { Action, ActionKind, TableState } from './table.js';
import { legalActions, minRaiseTo, maxRaiseTo } from './table.js';
import { equityVsRandom } from './equity.js';

export type Archetype = 'nit' | 'tag' | 'station';

/** Renderer-facing copy: the student is meant to read these and exploit them. */
export const ARCHETYPES: Record<Archetype, { label: string; description: string }> = {
  nit: {
    label: 'Nit',
    description: 'Very tight. Folds most hands, only puts money in with strong ones, almost never bluffs.',
  },
  tag: {
    label: 'TAG',
    description: 'Tight-aggressive. Reasonable ranges, bets its good hands and semi-bluffs its draws.',
  },
  station: {
    label: 'Station',
    description: 'Calling station. Calls far too much, almost never folds to a bet, rarely raises.',
  },
};

const ORDER: Archetype[] = ['nit', 'tag', 'station'];

/** Villains cycle through all three so a full table always shows the student every type. */
export function archetypeForSeat(seatId: number): Archetype {
  return ORDER[seatId % ORDER.length];
}

interface Profile {
  /** Min hand strength to keep calling a bet. */
  callStrength: number;
  /** Min hand strength to consider betting/raising for value. */
  raiseStrength: number;
  /** How often it actually raises once strong enough. */
  raiseFreq: number;
  /** How often it stabs at an unopened pot without the strength to. */
  bluffBetFreq: number;
  /** How often it bluff-RAISES a bet — a far more expensive lie, so much rarer. A nit never does. */
  bluffRaiseFreq: number;
  /** How often it calls a bet its strength says to fold — the station's whole personality. */
  loosecallFreq: number;
  betPotFraction: number;
}

/**
 * Exported so robustness.ts can re-weight these frequencies instead of restating them. Profile holds
 * ONLY behavioural frequencies/thresholds — every field is a number in [0, ~1] that jitter.ts may move
 * per session ("the jittered parameters ARE the truth"). Structural personality coefficients that must
 * NOT jitter (like SPR discipline below) live in their own map, not here.
 */
export const PROFILES: Record<Archetype, Profile> = {
  nit: { callStrength: 0.68, raiseStrength: 0.8, raiseFreq: 0.8, bluffBetFreq: 0.05, bluffRaiseFreq: 0, loosecallFreq: 0, betPotFraction: 0.6 },
  tag: { callStrength: 0.55, raiseStrength: 0.68, raiseFreq: 0.7, bluffBetFreq: 0.35, bluffRaiseFreq: 0.12, loosecallFreq: 0.05, betPotFraction: 0.66 },
  station: { callStrength: 0.4, raiseStrength: 0.85, raiseFreq: 0.15, bluffBetFreq: 0.05, bluffRaiseFreq: 0.02, loosecallFreq: 0.85, betPotFraction: 0.5 },
};

/**
 * How much each archetype tightens its calling standard as stacks get DEEP — the pot-control-when-deep
 * discipline. A STRUCTURAL trait, not a frequency: it is deliberately NOT in Profile (so jitter.ts never
 * moves it — a bot's depth discipline is a fixed part of who it is, like "a nit never bluff-raises").
 * 0 = ignores stack depth entirely: the station stacks off one pair at 200bb exactly as at 40bb, which
 * IS its leak and the thing the student is meant to exploit. 1 = fully respects the depth tax. Left
 * honest for the station rather than "fixed" — the archetype is defined by NOT adjusting.
 */
export const SPR_DISCIPLINE: Record<Archetype, number> = {
  nit: 1,
  tag: 1,
  station: 0,
};

/**
 * The stack-depth commitment tax (pot control when deep). The bug it fixes: with no depth term the
 * villain calls off a deep stack with one pair exactly as readily as a short one, so a "pot control at
 * 200bb" lesson would train the WRONG behaviour — the student would profit by ALSO stacking off light,
 * because the bot does. This makes a value hand's calling standard RISE as the effective stack deepens,
 * so a disciplined villain folds one pair to big bets when there is a lot of money left behind.
 *
 * KEYED ON REMAINING STACK IN BIG BLINDS, RELATIVE TO A 100bb REFERENCE. The tax is exactly 0 at or
 * below 100bb, which is the depth EVERY table ran at before the standing-driven deep tables existed —
 * so this term cannot change a single decision at 100bb and leaves the whole existing test corpus (all
 * seed-pinned at 100bb) untouched. It fires only on the deeper 125bb/200bb tables the climb payoff
 * introduces, growing to its cap by 200bb.
 */
export const REFERENCE_BB = 100;
export const DEPTH_SCALE_BB = 100;
export const MAX_COMMIT_TAX = 0.15;

export function commitTax(remainingChips: number, bb: number, sprDiscipline: number): number {
  if (bb <= 0) return 0;
  const remainingBb = remainingChips / bb;
  const depthOver = Math.max(0, remainingBb - REFERENCE_BB) / DEPTH_SCALE_BB;
  return sprDiscipline * Math.min(1, depthOver) * MAX_COMMIT_TAX;
}

export function decideAction(state: TableState, seatId: number, rng: Rng): Action {
  return decideActionAs(archetypeForSeat(seatId), state, seatId, rng);
}

export function decideActionAs(
  archetype: Archetype,
  state: TableState,
  seatId: number,
  rng: Rng,
): Action {
  if (state.toAct !== seatId) throw new Error(`seat ${seatId} is not to act`);
  const legal = legalActions(state);
  if (legal.length === 0) throw new Error(`seat ${seatId} has no legal action`);

  const seat = state.seats[seatId];
  const profile = PROFILES[archetype];
  const strength = handStrength(seat.hole, state.board, Math.floor(rng() * 0xffffffff));
  const aggressionRoll = rng();
  const callRoll = rng();

  // Extra opponents mean the same hand has to beat more people, so demand more of it.
  const opponents = state.seats.filter((s) => !s.folded && s.id !== seatId).length;
  const crowdTax = 0.03 * Math.max(0, opponents - 1);
  const canAggress = legal.includes('raise') || legal.includes('bet') || legal.includes('allin');
  const toCall = state.currentBet - seat.committed;

  // Pot control when deep: with a lot of money left behind, demand more of a value hand before
  // committing it. Zero at/below 100bb (so no existing 100bb decision changes); grows on deep tables.
  const depthTax = commitTax(seat.stack, state.bb, SPR_DISCIPLINE[archetype]);

  const bluffFreq = toCall > 0 ? profile.bluffRaiseFreq : profile.bluffBetFreq;
  const wantsAggression =
    strength >= profile.raiseStrength + crowdTax + depthTax
      ? aggressionRoll < profile.raiseFreq
      : aggressionRoll < bluffFreq;

  if (wantsAggression && canAggress) return aggressiveAction(state, legal, profile.betPotFraction);

  if (toCall <= 0) return { kind: 'check' };

  if (strength >= profile.callStrength + crowdTax + depthTax) return callOrAllIn(legal);
  if (callRoll < profile.loosecallFreq) return callOrAllIn(legal);
  return { kind: 'fold' };
}

/**
 * Equity vs one random hand: a 0..1 quality scale that doesn't shift with table size.
 * 300 iterations, not 2000 — an AI decision runs on every villain turn and must not stall the UI.
 * That costs ~3% of noise, which is far smaller than the gap between these archetypes' frequencies.
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
