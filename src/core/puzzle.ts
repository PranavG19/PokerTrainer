/**
 * PUZZLE MODE — deterministic, pre-dealt scenarios that teach one spot and exactly how to play it.
 *
 * A puzzle fixes everything a normal hand randomises: the hero's hole cards, every villain's hole
 * cards, the board that will come, and the villains' scripted actions. The learner plays the hero's
 * decisions and is graded step-by-step against a TARGET LINE with an explanation. Because nothing is
 * random, the same puzzle always plays out the same way — which is the whole point: a learner can be
 * shown "UTG opens, you're on the button with AKs, here is exactly what to do and why".
 *
 * WHY THIS TOUCHES NOTHING IN table.ts. The engine deals holes and the board by popping from
 * `state.deck` (a burn then the street's cards). So a scenario is realised by STACKING THE DECK: we
 * let the real engine post blinds via startHand, then overwrite the holes with the scenario's and
 * rewrite the deck's tail so the engine's own burns-and-pops produce the scripted board. The engine
 * is unmodified — the determinism lives here, in what we hand it. A unit test runs a scenario all the
 * way through the real engine and asserts the holes and board come out exactly as written, so a drift
 * in the engine's deal order fails a test rather than silently mis-dealing a lesson.
 *
 * The target line is graded by the learner's ACTION KIND per street-decision, not by chips: a puzzle
 * teaches "raise here, then barrel the turn", and whether the raise was 2.2x or 2.5x is a sizing
 * lesson a later mode owns. A step is correct when its action kind matches the target for that step.
 */

import type { Card } from './cards.js';
import type { ActionKind, TableState } from './table.js';
import { createTable, startHand } from './table.js';

/** One villain action in the script, applied in engine order whenever that seat is to act. */
export interface ScriptedAction {
  readonly kind: ActionKind;
  /** For a bet/raise: the total the seat is raising TO, in chips. Ignored for fold/check/call. */
  readonly to?: number;
}

/** One step the hero is expected to take, with the reason shown after they act on it. */
export interface TargetStep {
  readonly action: ActionKind;
  /** Shown once the learner has answered this step — the "why", in one line. */
  readonly explanation: string;
}

/**
 * A fully-specified teaching hand. Seat 0 is always the hero. Every seat's hole is fixed, the board
 * is fixed, and villain actions are scripted, so the only free variable is the hero's play.
 */
export interface Scenario {
  readonly id: string;
  readonly title: string;
  /** One-line framing shown before the learner acts: the setup, not the answer. */
  readonly setup: string;
  /** Seat count (2–6). Seat 0 is the hero. */
  readonly seatCount: number;
  /** Seat index that holds the dealer button. */
  readonly button: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly startStack: number;
  /** Hole cards per seat, indexed by seat id. Every seat gets exactly two. */
  readonly holes: readonly (readonly [Card, Card])[];
  /** The five community cards that WILL come, in order. Streets not reached are simply never dealt. */
  readonly board: readonly [Card, Card, Card, Card, Card];
  /** Villain actions, applied in the order the engine asks each villain seat to act. */
  readonly villainScript: readonly ScriptedAction[];
  /** The hero's correct line, one step per hero decision, in order. */
  readonly target: readonly TargetStep[];
}

const HOLE = 2;
const BOARD = 5;

function assertScenario(s: Scenario): void {
  if (s.seatCount < 2 || s.seatCount > 6) {
    throw new RangeError(`puzzle ${s.id}: seatCount ${s.seatCount} out of 2..6`);
  }
  if (s.holes.length !== s.seatCount) {
    throw new Error(`puzzle ${s.id}: ${s.holes.length} holes for ${s.seatCount} seats`);
  }
  for (const [i, hole] of s.holes.entries()) {
    if (hole.length !== HOLE) throw new Error(`puzzle ${s.id}: seat ${i} hole is not ${HOLE} cards`);
  }
  if (s.board.length !== BOARD) throw new Error(`puzzle ${s.id}: board is not ${BOARD} cards`);
  // A card cannot be in two places: a duplicate would make equity and the runout nonsense.
  const all = [...s.holes.flat(), ...s.board];
  const seen = new Set<Card>();
  for (const card of all) {
    if (seen.has(card)) throw new Error(`puzzle ${s.id}: card ${card} appears twice`);
    seen.add(card);
  }
  if (s.target.length === 0) throw new Error(`puzzle ${s.id}: target line is empty`);
  if (s.button < 0 || s.button >= s.seatCount) {
    throw new RangeError(`puzzle ${s.id}: button ${s.button} not a seat`);
  }
}

/**
 * Build the deck the engine must be handed AFTER startHand has already dealt (and consumed) the
 * holes, so its street-by-street dealing produces this scenario's board.
 *
 * buildScenarioTable runs the real startHand — which pops the holes — and then overwrites the holes
 * with the scenario's and hands the engine THIS deck. So the holes are NOT in it: the only thing the
 * engine still pops from here is the board, one burn before each street. The engine pops from the END
 * of the array, so the pop sequence — burn, flop×3, burn, turn, burn, river — sits at the tail in
 * reverse. Burns are cards the scenario never shows, so a burn can never be a scripted card.
 */
export function stackedDeck(scenario: Scenario): Card[] {
  const used = new Set<Card>([...scenario.holes.flat(), ...scenario.board]);
  const rest: Card[] = [];
  for (const rank of '23456789TJQKA') {
    for (const suit of 'shdc') {
      const card = `${rank}${suit}`;
      if (!used.has(card)) rest.push(card);
    }
  }
  let burnAt = 0;
  const burn = (): Card => {
    const card = rest[burnAt];
    burnAt += 1;
    if (card === undefined) throw new Error(`puzzle ${scenario.id}: ran out of burn cards`);
    return card;
  };

  // The board deal, in the order the engine pops it. Burns are drawn off the front of `rest`.
  const boardRun: Card[] = [
    burn(), scenario.board[0], scenario.board[1], scenario.board[2], // flop: burn + 3
    burn(), scenario.board[3], // turn: burn + 1
    burn(), scenario.board[4], // river: burn + 1
  ];

  // The unused remainder fills the head (never reached); the board run sits at the tail in pop order.
  const head = rest.slice(burnAt);
  return [...head, ...boardRun.reverse()];
}

/**
 * A table sitting at the hero's first decision for this scenario, with holes and board fixed.
 *
 * Reuses the engine's blind posting and first-to-act logic (via startHand) rather than restating it,
 * then swaps in the scenario's holes and the stacked deck so the board comes exactly as written. The
 * dealer is placed on the scenario's button; startHand advances it by one on the first hand, so we
 * seat it one BEFORE the button and let startHand rotate onto it.
 */
export function buildScenarioTable(scenario: Scenario): TableState {
  assertScenario(scenario);
  const table = createTable({
    seats: Array.from({ length: scenario.seatCount }, (_unused, i) => ({
      name: i === 0 ? 'You' : `V${i}`,
      stack: scenario.startStack,
      isHero: i === 0,
      avatar: i === 0 ? 'Y' : `${i}`,
    })),
    sb: scenario.smallBlind,
    bb: scenario.bigBlind,
    seed: 0,
  });
  // startHand rotates the dealer forward by one from its current value, so pre-seat it one behind the
  // scenario's button. dealer starts at -1 meaning "seat 0 on the first hand"; set it explicitly.
  table.dealer = (scenario.button - 1 + scenario.seatCount) % scenario.seatCount;

  const dealt = startHand(table);

  // Override the random deal with the scenario's fixed cards, and hand the engine a deck whose tail
  // is the scripted board run (holes are already dealt, so they are not in it).
  for (let seat = 0; seat < scenario.seatCount; seat++) {
    dealt.seats[seat].hole = [...scenario.holes[seat]];
  }
  dealt.board = [];
  dealt.deck = stackedDeck(scenario);
  return dealt;
}

/** A single step's verdict: did the hero's action match the target for this step. */
export interface StepVerdict {
  readonly stepIndex: number;
  readonly expected: ActionKind;
  readonly played: ActionKind;
  readonly correct: boolean;
  /** The target's explanation — always shown, right or wrong, so the reason is taught either way. */
  readonly explanation: string;
}

/** Grade one hero decision against the target line. Out-of-range steps are a caller bug, not a miss. */
export function gradeStep(scenario: Scenario, stepIndex: number, played: ActionKind): StepVerdict {
  const step = scenario.target[stepIndex];
  if (step === undefined) throw new RangeError(`puzzle ${scenario.id}: no target step ${stepIndex}`);
  return {
    stepIndex,
    expected: step.action,
    played,
    correct: played === step.action,
    explanation: step.explanation,
  };
}

/** True once every hero decision in the target line has been graded. */
export function isComplete(scenario: Scenario, stepsTaken: number): boolean {
  return stepsTaken >= scenario.target.length;
}
