import type { Card } from './cards.js';
import { shuffledDeck } from './cards.js';
import { mulberry32 } from './rng.js';
import { evaluate, CATEGORY_NAMES } from './evaluate.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type Action = { kind: ActionKind; amount?: number };

export interface Seat {
  id: number;
  name: string;
  stack: number;
  hole: Card[];
  committed: number;
  folded: boolean;
  allIn: boolean;
  isHero: boolean;
  avatar: string;
}

export interface TableState {
  seats: Seat[];
  board: Card[];
  street: Street;
  pot: number;
  currentBet: number;
  minRaise: number;
  toAct: number;
  dealer: number;
  sb: number;
  bb: number;
  deck: Card[];
  handNumber: number;
  lastAggressor: number | null;
  log: string[];
  winners: { seatId: number; amount: number; description: string }[] | null;
}

// Hidden fields stored on state that survive JSON clone
interface HiddenState {
  _seed: number;
  _startStacks: number[];
  _streetActed: boolean[]; // who has acted this street (for round-closure)
  /**
   * Seats barred from raising because an all-in lifted currentBet without being a full
   * raise. They already matched the previous bet, so the action was never reopened for
   * them: they may only call the difference or fold.
   */
  _raiseCapped: boolean[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function h(state: TableState): HiddenState {
  return state as unknown as HiddenState;
}

function nextSeat(n: number, from: number): number {
  return (from + 1) % n;
}

function nextActive(seats: Seat[], from: number): number {
  const n = seats.length;
  let i = (from + 1) % n;
  let count = 0;
  while (count < n) {
    if (!seats[i].folded) return i;
    i = (i + 1) % n;
    count++;
  }
  return from;
}

function nextCanAct(seats: Seat[], from: number): number {
  const n = seats.length;
  let i = (from + 1) % n;
  let count = 0;
  while (count < n) {
    if (!seats[i].folded && !seats[i].allIn) return i;
    i = (i + 1) % n;
    count++;
  }
  return from;
}

function activeSeatCount(seats: Seat[]): number {
  return seats.filter((s) => !s.folded).length;
}

function canActCount(seats: Seat[]): number {
  return seats.filter((s) => !s.folded && !s.allIn).length;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createTable(opts: {
  seats: { name: string; stack: number; isHero?: boolean; avatar?: string }[];
  sb: number;
  bb: number;
  seed: number;
}): TableState {
  const seats: Seat[] = opts.seats.map((s, i) => ({
    id: i,
    name: s.name,
    stack: s.stack,
    hole: [],
    committed: 0,
    folded: false,
    allIn: false,
    isHero: s.isHero ?? false,
    avatar: s.avatar ?? '',
  }));

  const state: TableState = {
    seats,
    board: [],
    street: 'preflop',
    pot: 0,
    currentBet: 0,
    minRaise: opts.bb,
    toAct: 0,
    dealer: -1, // will be set to 0 on first startHand
    sb: opts.sb,
    bb: opts.bb,
    deck: [],
    handNumber: 0,
    lastAggressor: null,
    log: [],
    winners: null,
  };

  h(state)._seed = opts.seed;
  h(state)._startStacks = seats.map((s) => s.stack);
  h(state)._streetActed = seats.map(() => false);
  h(state)._raiseCapped = seats.map(() => false);

  return state;
}

export function startHand(state: TableState): TableState {
  const s = clone(state);
  s.handNumber += 1;
  s.board = [];
  s.pot = 0;
  s.currentBet = 0;
  s.minRaise = s.bb;
  s.street = 'preflop';
  s.lastAggressor = null;
  s.log = [];
  s.winners = null;

  for (const seat of s.seats) {
    seat.hole = [];
    seat.committed = 0;
    seat.folded = false;
    seat.allIn = false;
  }

  // Rotate dealer
  const n = s.seats.length;
  if (s.dealer === -1) {
    s.dealer = 0;
  } else {
    s.dealer = nextSeat(n, s.dealer);
  }

  // Shuffle deck: seed + handNumber for determinism
  const rng = mulberry32(h(s)._seed + s.handNumber);
  s.deck = shuffledDeck(rng);

  const isHeadsUp = n === 2;
  let sbIdx: number;
  let bbIdx: number;

  if (isHeadsUp) {
    sbIdx = s.dealer;
    bbIdx = nextSeat(n, s.dealer);
  } else {
    sbIdx = nextSeat(n, s.dealer);
    bbIdx = nextSeat(n, sbIdx);
  }

  // Post small blind
  const sbAmount = Math.min(s.sb, s.seats[sbIdx].stack);
  s.seats[sbIdx].stack -= sbAmount;
  s.seats[sbIdx].committed = sbAmount;
  if (s.seats[sbIdx].stack === 0) s.seats[sbIdx].allIn = true;
  s.pot += sbAmount;
  s.log.push(`${s.seats[sbIdx].name} posts SB ${sbAmount}`);

  // Post big blind
  const bbAmount = Math.min(s.bb, s.seats[bbIdx].stack);
  s.seats[bbIdx].stack -= bbAmount;
  s.seats[bbIdx].committed = bbAmount;
  if (s.seats[bbIdx].stack === 0) s.seats[bbIdx].allIn = true;
  s.pot += bbAmount;
  s.log.push(`${s.seats[bbIdx].name} posts BB ${bbAmount}`);

  s.currentBet = s.bb;

  // Deal 2 hole cards, starting left of dealer
  let dealStart = nextSeat(n, s.dealer);
  for (let round = 0; round < 2; round++) {
    let cur = dealStart;
    for (let p = 0; p < n; p++) {
      s.seats[cur].hole.push(s.deck.pop()!);
      cur = nextSeat(n, cur);
    }
  }

  // Store starting stacks for side pot calculation
  h(s)._startStacks = s.seats.map((seat) => seat.stack + seat.committed);

  // First to act preflop
  if (isHeadsUp) {
    s.toAct = sbIdx;
  } else {
    s.toAct = nextSeat(n, bbIdx);
  }

  // If toAct is all-in, advance
  if (s.seats[s.toAct].allIn) {
    s.toAct = nextCanAct(s.seats, s.toAct);
  }

  // Reset street-acted tracker
  h(s)._streetActed = s.seats.map(() => false);
  h(s)._raiseCapped = s.seats.map(() => false);

  // If nobody can act (all all-in from blinds), advance immediately
  if (canActCount(s.seats) === 0) {
    runOutBoard(s);
  }

  return s;
}

export function legalActions(state: TableState): ActionKind[] {
  const seat = state.seats[state.toAct];
  if (!seat || seat.folded || seat.allIn) return [];
  if (state.street === 'showdown') return [];

  const actions: ActionKind[] = ['fold'];
  const toCall = state.currentBet - seat.committed;
  const capped = h(state)._raiseCapped?.[seat.id] === true;

  if (toCall <= 0) {
    actions.push('check');
    if (seat.stack > 0) {
      if (state.currentBet === 0) {
        // No bet exists — opening bet
        if (seat.stack <= state.bb) {
          actions.push('allin');
        } else {
          actions.push('bet');
          actions.push('allin');
        }
      } else {
        // A bet already exists (e.g., BB option) — this is a raise
        const minTotal = minRaiseTo(state);
        const costToMinRaise = minTotal - seat.committed;
        if (seat.stack <= costToMinRaise) {
          actions.push('allin');
        } else {
          actions.push('raise');
          actions.push('allin');
        }
      }
    }
  } else {
    // Must call, raise, or fold
    if (seat.stack <= toCall) {
      // Can only all-in (not enough to call fully)
      actions.push('allin');
    } else {
      actions.push('call');
      // Can raise?
      const minTotal = minRaiseTo(state);
      const costToMinRaise = minTotal - seat.committed;
      if (seat.stack > toCall) {
        if (capped) {
          // Betting was not reopened for this seat by the short all-in: call or fold only.
        } else if (seat.stack < costToMinRaise) {
          // Not enough for a full min raise, but more than call → can all-in
          actions.push('allin');
        } else {
          actions.push('raise');
          actions.push('allin');
        }
      }
    }
  }

  return actions;
}

export function minRaiseTo(state: TableState): number {
  return state.currentBet + state.minRaise;
}

export function maxRaiseTo(state: TableState): number {
  const seat = state.seats[state.toAct];
  return seat.committed + seat.stack;
}

export function applyAction(state: TableState, action: Action): TableState {
  const s = clone(state);
  const seatIdx = s.toAct;
  const seat = s.seats[seatIdx];

  switch (action.kind) {
    case 'fold': {
      seat.folded = true;
      s.log.push(`${seat.name} folds`);
      break;
    }
    case 'check': {
      s.log.push(`${seat.name} checks`);
      break;
    }
    case 'call': {
      const toCall = Math.min(s.currentBet - seat.committed, seat.stack);
      seat.stack -= toCall;
      seat.committed += toCall;
      s.pot += toCall;
      if (seat.stack === 0) seat.allIn = true;
      s.log.push(`${seat.name} calls ${toCall}`);
      break;
    }
    case 'bet': {
      const totalBet = action.amount ?? s.bb;
      const cost = totalBet - seat.committed;
      seat.stack -= cost;
      seat.committed = totalBet;
      s.pot += cost;
      s.minRaise = totalBet; // first bet: raise increment = bet size
      s.currentBet = totalBet;
      if (seat.stack === 0) seat.allIn = true;
      s.lastAggressor = seatIdx;
      s.log.push(`${seat.name} bets ${totalBet}`);
      break;
    }
    case 'raise': {
      const raiseTo = action.amount!;
      const raiseIncrement = raiseTo - s.currentBet;
      const cost = raiseTo - seat.committed;
      seat.stack -= cost;
      seat.committed = raiseTo;
      s.pot += cost;
      if (raiseIncrement >= s.minRaise) {
        s.minRaise = raiseIncrement;
      }
      s.currentBet = raiseTo;
      if (seat.stack === 0) seat.allIn = true;
      s.lastAggressor = seatIdx;
      s.log.push(`${seat.name} raises to ${raiseTo}`);
      break;
    }
    case 'allin': {
      const allInTotal = seat.committed + seat.stack;
      const cost = seat.stack;
      seat.stack = 0;
      seat.allIn = true;
      s.pot += cost;

      if (allInTotal > s.currentBet) {
        const raiseIncrement = allInTotal - s.currentBet;
        const isFullRaise = raiseIncrement >= s.minRaise;
        if (isFullRaise) {
          s.minRaise = raiseIncrement;
          s.lastAggressor = seatIdx;
        } else {
          // An all-in short of a full raise lifts the bet but does not reopen the betting:
          // anyone who already matched the old bet may only call the difference or fold.
          for (const other of s.seats) {
            if (other.id !== seatIdx && !other.folded && h(s)._streetActed[other.id]) {
              h(s)._raiseCapped[other.id] = true;
            }
          }
        }
        s.currentBet = allInTotal;
      }
      seat.committed = allInTotal;
      s.log.push(`${seat.name} all-in ${allInTotal}`);
      break;
    }
  }

  // Mark this seat as having acted
  h(s)._streetActed[seatIdx] = true;

  // Check if only one player remains
  if (activeSeatCount(s.seats) === 1) {
    s.street = 'showdown';
    return s;
  }

  // Determine if betting round is complete
  if (isRoundComplete(s)) {
    advanceStreet(s);
  } else {
    // Advance toAct to next player who can act
    s.toAct = nextCanAct(s.seats, seatIdx);
  }

  return s;
}

function isRoundComplete(state: TableState): boolean {
  const active = state.seats.filter((s) => !s.folded && !s.allIn);

  // If no one can act, round is over
  if (active.length === 0) return true;

  // All active must have matched the current bet
  if (active.some((s) => s.committed < state.currentBet)) return false;

  // Everyone has matched, so the round ends once everyone who can act has had a
  // turn. A raise is already covered by the matched check above: it leaves the
  // others short of currentBet, which is what owes them a fresh turn. Comparing
  // against lastAggressor instead breaks when the aggressor is all-in (action can
  // never return to a seat that cannot act) and when an all-in for less lifts
  // currentBet without reopening the betting.
  return active.every((s) => h(state)._streetActed[s.id]);
}

function advanceStreet(state: TableState): void {
  // Reset per-street fields
  for (const seat of state.seats) {
    seat.committed = 0;
  }
  state.currentBet = 0;
  state.minRaise = state.bb;
  state.lastAggressor = null;
  h(state)._streetActed = state.seats.map(() => false);
  h(state)._raiseCapped = state.seats.map(() => false);

  const streetOrder: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const idx = streetOrder.indexOf(state.street);
  state.street = streetOrder[idx + 1] ?? 'showdown';

  // Deal community cards
  if (state.street === 'flop') {
    state.deck.pop(); // burn
    state.board.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
  } else if (state.street === 'turn') {
    state.deck.pop(); // burn
    state.board.push(state.deck.pop()!);
  } else if (state.street === 'river') {
    state.deck.pop(); // burn
    state.board.push(state.deck.pop()!);
  }

  if (state.street === 'showdown') return;

  // First to act postflop: first active player left of dealer
  setPostflopActor(state);

  // If 0 or 1 players can act, run out remaining streets
  if (canActCount(state.seats) <= 1) {
    const active = state.seats.filter((s) => !s.folded && !s.allIn);
    if (active.length <= 1) {
      advanceStreet(state);
    } else {
      // Multiple active but only via all-in — still advance
      advanceStreet(state);
    }
  }
}

function setPostflopActor(state: TableState): void {
  const n = state.seats.length;
  let i = nextSeat(n, state.dealer);
  for (let count = 0; count < n; count++) {
    if (!state.seats[i].folded && !state.seats[i].allIn) {
      state.toAct = i;
      return;
    }
    i = nextSeat(n, i);
  }
  state.toAct = state.dealer; // fallback
}

function runOutBoard(state: TableState): void {
  // Run out all remaining streets without action
  while (state.street !== 'showdown') {
    advanceStreet(state);
  }
}

export function isHandOver(state: TableState): boolean {
  if (state.street === 'showdown') return true;
  if (activeSeatCount(state.seats) === 1) return true;
  return false;
}

export function settle(state: TableState): TableState {
  const s = clone(state);
  const active = s.seats.filter((seat) => !seat.folded);

  // Everyone folded but one
  if (active.length === 1) {
    const winner = active[0];
    winner.stack += s.pot;
    s.winners = [{ seatId: winner.id, amount: s.pot, description: 'Last player standing' }];
    s.log.push(`${winner.name} wins ${s.winners[0].amount}`);
    s.pot = 0;
    return s;
  }

  // Ensure board is complete
  while (s.board.length < 5) {
    s.deck.pop(); // burn
    s.board.push(s.deck.pop()!);
  }

  // Build side pots
  const pots = buildSidePots(s);
  s.winners = [];

  for (const pot of pots) {
    const eligible = pot.eligible.filter((id) => !s.seats[id].folded);
    if (eligible.length === 0) continue;

    if (eligible.length === 1) {
      s.seats[eligible[0]].stack += pot.amount;
      const hand = evaluate([...s.seats[eligible[0]].hole, ...s.board]);
      s.winners.push({
        seatId: eligible[0],
        amount: pot.amount,
        description: CATEGORY_NAMES[hand.category],
      });
      s.log.push(`${s.seats[eligible[0]].name} wins ${pot.amount}`);
      continue;
    }

    // Evaluate hands for eligible players
    const scored = eligible.map((id) => ({
      id,
      hand: evaluate([...s.seats[id].hole, ...s.board]),
    }));
    const bestScore = Math.max(...scored.map((x) => x.hand.score));
    const winners = scored.filter((x) => x.hand.score === bestScore);

    // Split pot
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;

    // Odd chips to seat closest left of dealer
    const ordered = orderByDealerProximity(
      winners.map((w) => w.id),
      s.dealer,
      s.seats.length,
    );

    for (const wid of ordered) {
      const amt = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      s.seats[wid].stack += amt;
      const desc = CATEGORY_NAMES[scored.find((x) => x.id === wid)!.hand.category];
      s.winners.push({ seatId: wid, amount: amt, description: desc });
      s.log.push(`${s.seats[wid].name} wins ${amt} with ${desc}`);
    }
  }

  s.pot = 0;
  return s;
}

// ── Side pot construction ────────────────────────────────────────────────────

interface Pot {
  amount: number;
  eligible: number[];
}

function buildSidePots(state: TableState): Pot[] {
  const startStacks: number[] = h(state)._startStacks;
  if (!startStacks) {
    const eligible = state.seats.filter((s) => !s.folded).map((s) => s.id);
    return [{ amount: state.pot, eligible }];
  }

  // Per-player total contribution this hand
  const contributions = state.seats.map((seat, i) => startStacks[i] - seat.stack);

  // Get unique contribution levels, sorted ascending
  const levels = [...new Set(contributions.filter((c) => c > 0))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prevLevel = 0;

  for (const level of levels) {
    const increment = level - prevLevel;
    // All players who contributed MORE than prevLevel contribute to this slice
    const contributors = state.seats.filter((_, i) => contributions[i] > prevLevel);
    const potAmount = increment * contributors.length;

    // Eligible to win: contributors who haven't folded
    const eligible = contributors.filter((s) => !s.folded).map((s) => s.id);

    if (potAmount > 0) {
      if (eligible.length > 0) {
        pots.push({ amount: potAmount, eligible });
      } else {
        // Dead money from folded players — add to previous pot
        if (pots.length > 0) {
          pots[pots.length - 1].amount += potAmount;
        }
      }
    }

    prevLevel = level;
  }

  return pots;
}

function orderByDealerProximity(ids: number[], dealer: number, n: number): number[] {
  return [...ids].sort((a, b) => {
    const distA = (a - dealer - 1 + n) % n;
    const distB = (b - dealer - 1 + n) % n;
    return distA - distB;
  });
}
