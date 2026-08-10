/**
 * EXPERIMENT 1 — headless match harness. No Electron, no DOM.
 *
 * Plays the real src/core/table.ts engine, the real src/core/ai.ts bots and (for the adherent
 * policies) the real src/core/coach.ts grader.
 *
 * DUPLICATE-HAND DESIGN. Hand n is the same hand for every policy:
 *  - the deal is keyed on (seed, handNumber) inside startHand, and every stack is restored to
 *    START_STACK before each hand, so the button rotation and therefore the hole cards and board
 *    are byte-identical across policies;
 *  - each villain decision draws from its own stream keyed on (seed, handNumber, seatId, k), so the
 *    k-th decision of seat 2 sees the same rolls no matter how the hero played. Villain *behaviour*
 *    still diverges, because the pot and board it faces do — that is the effect under measurement —
 *    but its luck does not.
 * This pairing is what makes the paired confidence interval in the report legitimate, and it is
 * dramatically tighter than an unpaired one at the same sample size.
 *
 * Stack resets also delete the bust/rebuy confound: always-fold would otherwise survive forever
 * while a shoving policy busts and stops sampling.
 */
import { mulberry32 } from '../../../src/core/rng.js';
import type { Rng } from '../../../src/core/rng.js';
import type { TableState } from '../../../src/core/table.js';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  settle,
  startHand,
} from '../../../src/core/table.js';
import { decideActionAs } from '../../../src/core/ai.js';
import type { Archetype } from '../../../src/core/ai.js';
import { POLICIES } from './policies.js';
import type { DecisionTrace, PolicyContext, PolicyName } from './policies.js';

// Table constants copied from src/renderer/screens/table.ts so the measurement matches shipped play.
export const SB = 25;
export const BB = 50;
export const START_STACK = 5000; // 100 bb

export interface MixSpec {
  name: string;
  /** Archetype for seats 1..3. Seat 0 is always the hero. */
  villains: [Archetype, Archetype, Archetype];
}

export const MIXES: readonly MixSpec[] = [
  // The shipped lineup: archetypeForSeat(1..3) === tag, station, nit.
  { name: 'shipped', villains: ['tag', 'station', 'nit'] },
  { name: 'all-station', villains: ['station', 'station', 'station'] },
  { name: 'all-nit', villains: ['nit', 'nit', 'nit'] },
  { name: 'all-tag', villains: ['tag', 'tag', 'tag'] },
];

export interface MatchResult {
  policy: PolicyName;
  mix: string;
  seed: number;
  hands: number;
  /** Hero net bb per hand, one entry per hand, in hand order. Paired across policies. */
  perHandBb: number[];
  heroDecisions: number;
  /** Decisions where every legal action graded < 0.5bb, i.e. the grader had no preference at all. */
  graderSilentDecisions: number;
  /** Decisions where more than one legal action sat at the graded minimum, so the tie-break chose. */
  graderTiedDecisions: number;
  /** Defensive counter: a live state that offers the actor no legal action. Must be 0. */
  stuckStates: number;
  showdownsReached: number;
  vpipHands: number;
}

/** 32-bit mix of the four coordinates that identify one decision stream. */
function streamSeed(seed: number, handNumber: number, seatId: number, k: number): number {
  let x = seed >>> 0;
  x = (Math.imul(x ^ handNumber, 0x9e3779b1) ^ Math.imul(seatId + 1, 0x85ebca6b)) >>> 0;
  x = (Math.imul(x ^ k, 0xc2b2ae35) ^ (x >>> 13)) >>> 0;
  return x >>> 0;
}

export function runMatch(opts: {
  policy: PolicyName;
  mix: MixSpec;
  seed: number;
  hands: number;
}): MatchResult {
  const { policy: policyName, mix, seed, hands } = opts;
  const policy = POLICIES[policyName];

  let table = createTable({
    seats: [
      { name: 'Hero', stack: START_STACK, isHero: true },
      { name: 'V1', stack: START_STACK },
      { name: 'V2', stack: START_STACK },
      { name: 'V3', stack: START_STACK },
    ],
    sb: SB,
    bb: BB,
    seed,
  });

  const perHandBb: number[] = [];
  let heroDecisions = 0;
  let graderSilentDecisions = 0;
  let graderTiedDecisions = 0;
  let stuckStates = 0;
  let showdownsReached = 0;
  let vpipHands = 0;

  for (let hand = 0; hand < hands; hand++) {
    // Restore every stack so each hand is an independent 100bb-deep sample.
    for (const seat of table.seats) seat.stack = START_STACK;

    let state: TableState = startHand(table);
    const handNumber = state.handNumber;
    const decisionCount = [0, 0, 0, 0];
    const trace: DecisionTrace[] = [];
    const heroRng: Rng = mulberry32(streamSeed(seed, handNumber, 0, 0));
    const ctx: PolicyContext = { rng: heroRng, graderSeed: seed + handNumber, trace };
    let voluntary = false;

    while (!isHandOver(state)) {
      const actor = state.toAct;
      if (legalActions(state).length === 0) {
        stuckStates++;
        break;
      }
      if (actor === 0) {
        const action = policy(state, ctx);
        heroDecisions++;
        if (action.kind !== 'fold' && action.kind !== 'check') voluntary = true;
        state = applyAction(state, action);
      } else {
        const rng = mulberry32(streamSeed(seed, handNumber, actor, decisionCount[actor]++));
        state = applyAction(state, decideActionAs(mix.villains[actor - 1], state, actor, rng));
      }
    }

    if (state.street === 'showdown' && state.seats.filter((s) => !s.folded).length > 1) {
      showdownsReached++;
    }
    state = settle(state);

    perHandBb.push((state.seats[0].stack - START_STACK) / BB);
    if (voluntary) vpipHands++;
    for (const t of trace) {
      if (t.allFree) graderSilentDecisions++;
      if (t.tiedAtMin > 1) graderTiedDecisions++;
    }

    table = state;
  }

  return {
    policy: policyName,
    mix: mix.name,
    seed,
    hands,
    perHandBb,
    heroDecisions,
    graderSilentDecisions,
    graderTiedDecisions,
    stuckStates,
    showdownsReached,
    vpipHands,
  };
}
