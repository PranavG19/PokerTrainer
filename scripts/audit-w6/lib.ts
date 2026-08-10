// Shared harness helpers for the W6 invariant audit. Throwaway; not part of the app.
import type { Action, ActionKind, Seat, TableState } from '../../src/core/table.js';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  maxRaiseTo,
  minRaiseTo,
  settle,
  startHand,
} from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';

export type Rng = () => number;

export interface Violation {
  kind: string;
  detail: string;
}

export function makeTable(stacks: number[], sb: number, bb: number, seed: number): TableState {
  return createTable({
    seats: stacks.map((stack, i) => ({ name: `S${i}`, stack, isHero: i === 0 })),
    sb,
    bb,
    seed,
  });
}

export function chipsOnTable(state: TableState): number {
  return state.seats.reduce((n, s) => n + s.stack, 0) + state.pot;
}

export function sumCommitted(state: TableState): number {
  return state.seats.reduce((n, s) => n + s.committed, 0);
}

export function startStacksOf(state: TableState): number[] {
  return (state as unknown as { _startStacks: number[] })._startStacks;
}

export function raiseCappedOf(state: TableState): boolean[] {
  return (state as unknown as { _raiseCapped: boolean[] })._raiseCapped;
}

export function streetActedOf(state: TableState): boolean[] {
  return (state as unknown as { _streetActed: boolean[] })._streetActed;
}

/** Pick a random action out of legalActions, with a legal amount when one is required. */
export function randomLegalAction(state: TableState, rng: Rng): Action | null {
  const legal = legalActions(state);
  if (legal.length === 0) return null;
  const kind = legal[Math.floor(rng() * legal.length)] as ActionKind;
  if (kind === 'bet' || kind === 'raise') {
    const lo = minRaiseTo(state);
    const hi = maxRaiseTo(state);
    const amount = lo + Math.floor(rng() * (hi - lo + 1));
    return { kind, amount };
  }
  return { kind };
}

export interface HandTrace {
  seed: number;
  handNumber: number;
  actions: string[];
  violations: Violation[];
  /** True if the hand needed more than the action cap to resolve. */
  hung: boolean;
  finalState: TableState;
  preSettle: TableState;
}

const ACTION_CAP = 400;

export function describeAction(state: TableState, a: Action): string {
  return `seat${state.toAct}:${a.kind}${a.amount !== undefined ? `@${a.amount}` : ''}`;
}

/**
 * Drive one hand with random legal actions and check the invariants at every step.
 * Returns the trace so a caller can print a minimal repro.
 */
export function playHand(state: TableState, rng: Rng, expectTotal: number): HandTrace {
  const violations: Violation[] = [];
  const actions: string[] = [];
  let s = startHand(state);
  const record = (kind: string, detail: string): void => void violations.push({ kind, detail });

  const check = (where: string): void => {
    const total = chipsOnTable(s);
    if (total !== expectTotal) {
      record('conservation', `${where}: chips ${total} != ${expectTotal}`);
    }
    if (sumCommitted(s) > s.pot) {
      record('committed-exceeds-pot', `${where}: sum(committed)=${sumCommitted(s)} > pot=${s.pot}`);
    }
    if (s.currentBet > 0 && s.pot === 0) {
      record('unbacked-bet', `${where}: currentBet=${s.currentBet} with pot=0`);
    }
    const maxCommitted = Math.max(...s.seats.map((x) => x.committed));
    if (s.currentBet > maxCommitted && s.street !== 'preflop') {
      record(
        'currentbet-above-any-commitment',
        `${where}: currentBet=${s.currentBet} > max committed=${maxCommitted} on ${s.street}`,
      );
    }
    for (const seat of s.seats) {
      if (seat.stack < 0) record('negative-stack', `${where}: seat${seat.id} stack=${seat.stack}`);
      if (seat.committed < 0) record('negative-committed', `${where}: seat${seat.id}`);
      if (seat.stack === 0 && !seat.allIn && !seat.folded) {
        record('zero-stack-not-allin', `${where}: seat${seat.id} stack 0 but allIn=false folded=false`);
      }
    }
    if (!isHandOver(s) && s.street !== 'showdown') {
      const actor = s.seats[s.toAct];
      if (!actor) record('toAct-out-of-range', `${where}: toAct=${s.toAct}`);
      else if (actor.folded || actor.allIn) {
        record(
          'toAct-cannot-act',
          `${where}: toAct=seat${s.toAct} folded=${actor.folded} allIn=${actor.allIn} street=${s.street}`,
        );
      }
    }
  };

  check('after startHand');

  let steps = 0;
  let hung = false;
  while (!isHandOver(s)) {
    if (steps++ > ACTION_CAP) {
      hung = true;
      break;
    }
    const a = randomLegalAction(s, rng);
    if (a === null) {
      record(
        'no-legal-action-but-hand-live',
        `street=${s.street} toAct=${s.toAct} folded=${s.seats[s.toAct].folded} allIn=${s.seats[s.toAct].allIn}`,
      );
      hung = true;
      break;
    }
    actions.push(describeAction(s, a));
    let next: TableState;
    try {
      next = applyAction(s, a);
    } catch (err) {
      record('legal-action-threw', `${describeAction(s, a)} -> ${(err as Error).message}`);
      break;
    }
    s = next;
    check(`after ${actions[actions.length - 1]}`);
  }

  const preSettle = s;
  let settled = s;
  if (!hung) {
    try {
      settled = settle(s);
    } catch (err) {
      record('settle-threw', (err as Error).message);
    }
    const total = chipsOnTable(settled);
    if (total !== expectTotal) {
      record('conservation-settle', `after settle: chips ${total} != ${expectTotal}`);
    }
    if (settled.pot !== 0) record('pot-not-emptied', `pot=${settled.pot}`);
    if (settled.winners === null) record('no-winners', 'settle produced winners=null');
    else {
      const start = startStacksOf(preSettle);
      const paidIn = preSettle.seats.map((seat, i) => start[i] - seat.stack);
      const awarded = new Map<number, number>();
      for (const w of settled.winners) {
        awarded.set(w.seatId, (awarded.get(w.seatId) ?? 0) + w.amount);
        if (paidIn[w.seatId] <= 0) {
          record(
            'winner-paid-nothing',
            `seat${w.seatId} won ${w.amount} having contributed ${paidIn[w.seatId]}`,
          );
        }
        if (preSettle.seats[w.seatId].hole.length === 0) {
          record('winner-had-no-cards', `seat${w.seatId} won ${w.amount} with no hole cards`);
        }
        // A seat can never win more than its own stake, matched once by each rival.
        const mine = paidIn[w.seatId];
        let cap = mine;
        for (let i = 0; i < paidIn.length; i++) if (i !== w.seatId) cap += Math.min(mine, paidIn[i]);
        if ((awarded.get(w.seatId) ?? 0) > cap) {
          record('winner-over-entitlement', `seat${w.seatId} collected ${awarded.get(w.seatId)} but staked only ${mine} (cap ${cap})`);
        }
      }
      const totalAwarded = [...awarded.values()].reduce((a, b) => a + b, 0);
      // settle() refunds uncontested chips to their contributor, so the pot splits into
      // winnings + refunds.
      const refunded = preSettle.seats.reduce(
        (n, seat, i) => n + (settled.seats[i].stack - seat.stack) - (awarded.get(i) ?? 0),
        0,
      );
      if (totalAwarded + refunded !== preSettle.pot) {
        record('award-mismatch', `awarded ${totalAwarded} + refunded ${refunded} != pot ${preSettle.pot}`);
      }
    }
  }

  return { seed: 0, handNumber: s.handNumber, actions, violations, hung, finalState: settled, preSettle };
}

export function fuzz(opts: {
  seeds: number[];
  stacks: number[];
  sb: number;
  bb: number;
  handsPerSeed: number;
  label: string;
}): { traces: HandTrace[]; hands: number } {
  const bad: HandTrace[] = [];
  let hands = 0;
  for (const seed of opts.seeds) {
    let table = makeTable(opts.stacks, opts.sb, opts.bb, seed);
    const total = opts.stacks.reduce((a, b) => a + b, 0);
    const rng = mulberry32(seed ^ 0x9e3779b9);
    for (let hn = 0; hn < opts.handsPerSeed; hn++) {
      const funded = table.seats.filter((s) => s.stack > 0).length;
      if (funded < 2) break;
      const trace = playHand(table, rng, total);
      trace.seed = seed;
      hands++;
      if (trace.violations.length > 0 || trace.hung) bad.push(trace);
      table = trace.hung ? trace.preSettle : trace.finalState;
      if (trace.hung) break;
    }
  }
  return { traces: bad, hands };
}

export function printReport(label: string, out: { traces: HandTrace[]; hands: number }): void {
  const counts = new Map<string, number>();
  for (const t of out.traces) {
    if (t.hung) counts.set('HUNG', (counts.get('HUNG') ?? 0) + 1);
    for (const v of t.violations) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  }
  console.log(`\n=== ${label}: ${out.hands} hands, ${out.traces.length} bad ===`);
  if (counts.size === 0) {
    console.log('  CLEAN');
    return;
  }
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  // First example per kind, with a repro.
  const shown = new Set<string>();
  for (const t of out.traces) {
    const kinds = t.hung ? ['HUNG'] : t.violations.map((v) => v.kind);
    for (const k of kinds) {
      if (shown.has(k)) continue;
      shown.add(k);
      console.log(`\n  --- repro for ${k} ---`);
      console.log(`  seed=${t.seed} hand#=${t.handNumber}`);
      console.log(`  stacks at start: ${JSON.stringify(startStacksOf(t.preSettle))}`);
      console.log(`  actions: ${t.actions.join(' ')}`);
      const v = t.violations.find((x) => x.kind === k);
      if (v) console.log(`  ${v.detail}`);
      console.log(`  log: ${t.preSettle.log.join(' | ')}`);
    }
  }
}

export { applyAction, legalActions, minRaiseTo, maxRaiseTo, settle, startHand, isHandOver, createTable, mulberry32 };
export type { Action, ActionKind, Seat, TableState };
