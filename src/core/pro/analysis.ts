/**
 * The Pro requests main serves, as pure functions over UNTRUSTED input (it arrives over IPC from the
 * renderer): each one validates its whole argument and refuses anything out of range rather than
 * clamping it into a spot nobody asked for. Results are plain arrays and numbers, safe to send back.
 */

import { ALL_COMBOS } from '../preflop.js';
import { bubbleFactor, icmEquities, MAX_ICM_PLAYERS, requiredEquity } from './icm.js';
import { rangeVsRange, topRange } from './preflopEquity.js';
import { MAX_SPOT_STACK_BB, shapeOf, solveShove, type ShoveResult, type ShoveSpot } from './pushFold.js';

/** How the players behind call: the equilibrium's own ranges, or everyone with the top `share` of hands. */
export type CallerModel = { readonly kind: 'equilibrium' } | { readonly kind: 'top'; readonly share: number };

export interface ShoveRequest {
  readonly spot: ShoveSpot;
  readonly callers: CallerModel;
}

const num = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/** A request from the renderer, or null when any part of it is not a spot that can happen. */
export function parseShoveRequest(raw: unknown): ShoveRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.stacks) || o.stacks.length < 2 || o.stacks.length > MAX_ICM_PLAYERS) return null;
  const stacks = o.stacks.map((s) => num(s, 0.1, MAX_SPOT_STACK_BB));
  if (stacks.some((s) => s === null)) return null;
  const n = stacks.length;
  const button = num(o.button, 0, n - 1);
  const hero = num(o.hero, 0, n - 1);
  const ante = num(o.ante, 0, 1);
  if (button === null || hero === null || ante === null || !Number.isInteger(button) || !Number.isInteger(hero)) return null;
  if (!Array.isArray(o.payouts) || o.payouts.length > n) return null;
  const payouts = o.payouts.map((p) => num(p, 0, 1));
  if (payouts.some((p) => p === null)) return null;
  const total = (payouts as number[]).reduce((a, b) => a + b, 0);
  if (payouts.length > 0 && Math.abs(total - 1) > 1e-6) return null;
  const c = o.callers as Record<string, unknown> | null | undefined;
  let callers: CallerModel;
  if (c?.kind === 'equilibrium') callers = { kind: 'equilibrium' };
  else if (c?.kind === 'top') {
    const share = num(c.share, 0.01, 1);
    if (share === null) return null;
    callers = { kind: 'top', share };
  } else return null;
  const spot: ShoveSpot = { stacks: stacks as number[], button, hero, ante, payouts: payouts as number[] };
  // Everything shapeOf refuses (the big blind first in, a hero or a non-last player already all in from
  // the blinds) is refused here, so main answers `invalid` instead of a solve failing in the worker.
  try {
    shapeOf(spot);
  } catch {
    return null;
  }
  return { spot, callers };
}

export interface ShoveView {
  /** Per class (ALL_COMBOS order), shove frequency 0..1 and shove-minus-fold gain. */
  readonly push: number[];
  readonly gain: number[];
  readonly pushShare: number;
  /** Per seat behind hero, in acting order. */
  readonly callers: readonly { readonly seat: number; readonly callShare: number; readonly equity: number | null }[];
}

export interface SeatView {
  readonly seat: number;
  readonly chipShare: number;
  /** Prize-pool share by ICM; null in a chip-EV spot (no payouts). */
  readonly icmShare: number | null;
  /** Hero's bubble factor against this seat and the equity a call-off needs; null for hero and in chip EV. */
  readonly bubbleFactor: number | null;
  readonly needs: number | null;
}

export interface ShoveAnswer {
  readonly combos: readonly string[];
  readonly seats: readonly SeatView[];
  /** The spot priced in prize equity (null without payouts) and in chips. */
  readonly icm: ShoveView | null;
  readonly chips: ShoveView;
}

function view(r: ShoveResult): ShoveView {
  return {
    push: Array.from(r.push),
    gain: Array.from(r.gain),
    pushShare: r.pushShare,
    callers: r.callers.map((seat, k) => ({ seat, callShare: r.callShares[k], equity: rangeVsRange(r.calls[k], r.push) })),
  };
}

export function answerShove(req: ShoveRequest): ShoveAnswer {
  const { spot, callers } = req;
  const ranges = (): 'equilibrium' | Float64Array[] => {
    if (callers.kind === 'equilibrium') return 'equilibrium';
    const n = spot.stacks.length;
    const sb = n === 2 ? spot.button : (spot.button + 1) % n;
    const bb = (sb + 1) % n;
    let behind = 0;
    for (let i = (spot.hero + 1) % n; ; i = (i + 1) % n) {
      behind++;
      if (i === bb) break;
    }
    return Array.from({ length: behind }, () => topRange(callers.share));
  };
  const total = spot.stacks.reduce((a, b) => a + b, 0);
  const icm = spot.payouts.length > 0 ? icmEquities(spot.stacks, spot.payouts) : null;
  const seats: SeatView[] = spot.stacks.map((s, i) => {
    const bf = icm !== null && i !== spot.hero ? bubbleFactor(spot.stacks, spot.payouts, spot.hero, i) : null;
    return { seat: i, chipShare: s / total, icmShare: icm?.[i] ?? null, bubbleFactor: bf, needs: bf === null ? null : requiredEquity(bf) };
  });
  return {
    combos: [...ALL_COMBOS],
    seats,
    icm: spot.payouts.length > 0 ? view(solveShove(spot, ranges())) : null,
    chips: view(solveShove({ ...spot, payouts: [] }, ranges())),
  };
}
