/**
 * GRADE A SPOT FROM THE TABLE STATE — the one adapter between the engine and the grader.
 *
 * gradeDecision takes plain numbers; something has to read a TableState and decide which opponent model
 * and which chart apply. That used to be inlined at each call site (the live table, the assessment block,
 * the Experiment 1 harness), and the copies drifted: the harness graded with no villain model while the
 * table passed one. Every caller now goes through `gradeSpot`, so the experiment measures the grader the
 * learner meets.
 *
 * It decides three things:
 *  1. PREFLOP CHART SPOT (chartGrade.ts), from the preflop betting in the log: first in, facing one open,
 *     or facing a 3-bet after opening. Seats are mapped onto the 6-max charts by their distance from the
 *     button, so on the 4-max table the first seat to act opens the cutoff range, as contrast.ts maps it.
 *  2. THE AGGRESSOR'S RANGE (villainRanges.ts), when hero faces a bet: the last aggressor's archetype, the
 *     board, whether it bet or raised, and its size. A seat with no known model falls back to the fixed
 *     VILLAIN_BETTING_RANGE, the previous behaviour.
 *  3. Everything else gradeDecision needs (price, opponents, seed), exactly as the call sites computed it.
 */
import { gradeDecision, type Grade } from './coach.js';
import type { ChartSpot } from './chartGrade.js';
import { VILLAIN_BETTING_RANGE, type RfiPosition, type ThreeBetResponsePosition } from './preflop.js';
import type { ActionKind, TableState } from './table.js';
import { seatPositions } from './seatPositions.js';
import { villainRange, type VillainModel } from './villainRanges.js';

export interface GradeSpotOptions {
  readonly seed: number;
  readonly betSize?: number;
  /** The opponent model for a seat, or null when the caller has none (the fixed range is used). */
  readonly modelFor: (seatId: number) => VillainModel | null;
}

type ChartSeat = RfiPosition | 'BB';

/** Each funded seat's chart position: BTN, SB and BB as dealt; the rest by distance from the button. */
export function chartSeats(state: TableState): (ChartSeat | null)[] {
  const funded = state.seats.map((s) => s.hole.length === 2);
  const labels = seatPositions(state.dealer, funded);
  const out: (ChartSeat | null)[] = labels.map(() => null);
  const n = state.seats.length;
  for (let i = 0; i < n; i++) {
    const label = labels[i];
    if (label === null) continue;
    if (label === 'BTN' || label === 'SB' || label === 'BB') {
      out[i] = label;
      continue;
    }
    // Funded seats strictly between this one and the button, in seat order.
    let between = 0;
    for (let j = (i + 1) % n; j !== state.dealer; j = (j + 1) % n) if (funded[j]) between++;
    out[i] = between === 0 ? 'CO' : between === 1 ? 'HJ' : 'UTG';
  }
  return out;
}

interface PreflopAction {
  seat: number;
  kind: 'fold' | 'check' | 'call' | 'raise';
}

/** The voluntary preflop actions so far, in order, read from the log (the blinds are posts, not actions). */
function preflopActions(state: TableState): PreflopAction[] | null {
  const bySeat = new Map<string, number>();
  for (const seat of state.seats) {
    if (bySeat.has(seat.name)) return null; // two seats share a name: the log cannot be attributed
    bySeat.set(seat.name, seat.id);
  }
  const out: PreflopAction[] = [];
  let toMatch = state.bb;
  for (const line of state.log) {
    if (line.includes(' posts ')) continue;
    const m = /^(.*) (folds|checks|calls \d+|bets \d+|raises to \d+|all-in \d+)$/.exec(line);
    if (!m) continue;
    const seat = bySeat.get(m[1]);
    if (seat === undefined) return null;
    const verb = m[2];
    if (verb === 'folds') out.push({ seat, kind: 'fold' });
    else if (verb === 'checks') out.push({ seat, kind: 'check' });
    else if (verb.startsWith('calls')) out.push({ seat, kind: 'call' });
    else {
      const amount = Number(verb.slice(verb.lastIndexOf(' ') + 1));
      // An all-in that does not lift the bet is a call for less.
      if (verb.startsWith('all-in') && amount <= toMatch) out.push({ seat, kind: 'call' });
      else {
        toMatch = Math.max(toMatch, amount);
        out.push({ seat, kind: 'raise' });
      }
    }
  }
  return out;
}

/** The chart spot hero is in preflop, or null when the betting is not one the charts cover. */
export function chartSpotFor(state: TableState): ChartSpot | null {
  if (state.street !== 'preflop') return null;
  const heroId = state.toAct;
  if (state.seats.filter((s) => s.hole.length === 2).length < 3) return null; // heads-up: no chart
  const seats = chartSeats(state);
  const hero = seats[heroId];
  const actions = preflopActions(state);
  if (hero === null || actions === null) return null;
  const raises = actions.filter((a) => a.kind === 'raise');
  const calls = actions.filter((a) => a.kind === 'call');

  if (raises.length === 0 && calls.length === 0) {
    return hero === 'BB' ? null : { kind: 'rfi', position: hero };
  }
  if (raises.length === 1 && calls.length === 0 && raises[0].seat !== heroId) {
    const opener = seats[raises[0].seat];
    if (hero === 'BB' && opener !== null && opener !== 'BB') {
      const spot = opener === 'UTG' ? 'bb-vs-utg' : opener === 'HJ' ? 'bb-vs-hj' : opener === 'CO' ? 'bb-vs-co' : opener === 'BTN' ? 'bb-vs-btn' : 'bb-vs-sb';
      return { kind: 'defend', spot };
    }
    if (hero === 'SB' && opener === 'BTN') return { kind: 'defend', spot: 'sb-vs-btn' };
    return null;
  }
  if (raises.length === 2 && calls.length === 0 && raises[0].seat === heroId && raises[1].seat !== heroId) {
    if (hero === 'UTG' || hero === 'HJ' || hero === 'CO' || hero === 'BTN') {
      return { kind: '3bet', opener: hero as ThreeBetResponsePosition };
    }
  }
  return null;
}

export function gradeSpot(state: TableState, chosen: ActionKind, opts: GradeSpotOptions): Grade {
  const hero = state.seats[state.toAct];
  const toCall = Math.max(0, state.currentBet - hero.committed);
  const opponents = state.seats.filter((s) => !s.folded && s.id !== hero.id).length;
  const base = {
    hole: hero.hole,
    board: state.board,
    street: state.street,
    pot: state.pot,
    toCall,
    stack: hero.stack,
    bb: state.bb,
    chosen,
    betSize: opts.betSize,
    opponents: Math.max(1, opponents),
    seed: opts.seed,
  };

  const chart = chartSpotFor(state);
  if (chart) return gradeDecision({ ...base, chart });
  if (toCall === 0) return gradeDecision(base);

  const aggressor = state.lastAggressor;
  const model = aggressor !== null && aggressor !== hero.id ? opts.modelFor(aggressor) : null;
  if (model === null) return gradeDecision({ ...base, villainRange: VILLAIN_BETTING_RANGE });

  // A raise over a bet when hero had already put chips in this street; otherwise a bet into hero.
  const facing = state.street === 'preflop' || hero.committed > 0 ? 'raise' : 'bet';
  const potBefore = state.pot - toCall;
  return gradeDecision({
    ...base,
    villainHands: villainRange({
      model,
      board: state.board,
      facing,
      // Preflop raise sizes are not pot fractions in the archetypes' sense, so only postflop reads size.
      potFraction: state.street !== 'preflop' && potBefore > 0 ? toCall / potBefore : undefined,
      livePlayers: opponents + 1,
    }),
  });
}
