import { describe, it, expect } from 'vitest';
import type { TableState } from '../../src/core/table.js';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  settle,
  startHand,
} from '../../src/core/table.js';

/**
 * SAT-OUT SEATS AND THE BLINDS — a chipless seat can neither post a blind nor hold the button.
 *
 * A seat whose stack reaches 0 sits out (startHand sets folded = stack === 0, so it is dealt no
 * cards and never acts). But the blinds and the dealer button used to advance by pure rotation with
 * no chip check, so posting a blind ran Math.min(blind, 0) and put in nothing while currentBet was
 * still set to one big blind. Measured on a 4-seat table with two busted villains, all four button
 * positions were wrong and three were visibly broken:
 *
 *   dealer -> 0: "Ada posts SB 0 | Bo posts BB 0"   pot 0,  currentBet 50
 *   dealer -> 3: "You posts SB 25 | Ada posts BB 0" pot 25, currentBet 50
 *   dealer -> 1: "Bo posts SB 0 | Cy posts BB 50"   pot 50, currentBet 50
 *
 * In the pot-0 case the hand dealt with an empty pot and the surviving player was handed it with
 * "You wins 0 (Last player standing)" in the winner colour. Chip conservation held throughout,
 * which is exactly why every existing invariant check passed over it.
 *
 * These tests assert the blinds are real money from funded seats, at every button position.
 */

const SB = 25;
const BB = 50;
const START_STACK = 5000;
const SEAT_NAMES = ['You', 'Ada', 'Bo', 'Cy'];

function freshTable(seed = 42): TableState {
  return createTable({
    seats: SEAT_NAMES.map((name, i) => ({
      name,
      stack: START_STACK,
      isHero: i === 0,
      avatar: name[0],
    })),
    sb: SB,
    bb: BB,
    seed,
  });
}

/**
 * Deal a hand with `bustedIds` chipless and the button at `dealer`.
 *
 * The stacks are set on a state that has already been through startHand once, then startHand is
 * called again — the same path the renderer takes when a villain busts, since bust is discovered at
 * settle and acted on at the next deal. Setting up via the public API rather than hand-building a
 * TableState keeps the hidden state (seed, per-street trackers) consistent.
 */
function dealWithBusted(dealer: number, bustedIds: number[], seed = 42): TableState {
  const base = startHand(freshTable(seed));
  const staged = {
    ...base,
    dealer,
    seats: base.seats.map((seat) => ({
      ...seat,
      stack: bustedIds.includes(seat.id) ? 0 : START_STACK,
      committed: 0,
      folded: false,
      allIn: false,
      hole: [],
    })),
  } as TableState;
  return startHand(staged);
}

const fundedSeats = (state: TableState): number[] =>
  state.seats.filter((s) => s.stack > 0 || s.committed > 0).map((s) => s.id);

describe('blinds skip sat-out seats', () => {
  // Every button position, because the original defect was position-dependent: one rotation in four
  // produced a pot of 0, another a pot of 25, another 50. Testing one dealer index would have
  // reported a pass three times out of four.
  for (const dealer of [0, 1, 2, 3]) {
    it(`posts a full ${SB}+${BB} pot with two seats busted and the button at ${dealer}`, () => {
      const state = dealWithBusted(dealer, [1, 2]);

      expect(state.pot, `blinds posted from chipless seats: ${state.log.join(' | ')}`).toBe(SB + BB);
      expect(state.currentBet).toBe(BB);

      // currentBet must be backed by chips someone actually put in, not asserted into existence.
      const committed = state.seats.reduce((sum, s) => sum + s.committed, 0);
      expect(committed, 'committed chips must equal the pot').toBe(state.pot);
      expect(Math.max(...state.seats.map((s) => s.committed))).toBe(BB);

      // Neither blind may come from a seat that is sitting out.
      for (const seat of state.seats) {
        if (seat.committed > 0) {
          expect(seat.folded, `${seat.name} posted ${seat.committed} while sitting out`).toBe(false);
        }
      }

      // The button itself must be on a live seat: it decides blind order and odd-chip awards.
      expect(fundedSeats(state), `button on busted seat ${state.dealer}`).toContain(state.dealer);
    });
  }

  it('never posts a zero blind, whichever single seat is busted', () => {
    for (const busted of [1, 2, 3]) {
      for (const dealer of [0, 1, 2, 3]) {
        const state = dealWithBusted(dealer, [busted]);
        expect(
          state.log.some((line) => / posts (SB|BB) 0$/.test(line)),
          `dealer ${dealer}, busted ${busted}: ${state.log.join(' | ')}`,
        ).toBe(false);
        expect(state.pot).toBe(SB + BB);
      }
    }
  });

  it('gives the hero a real decision instead of an empty pot handed to nobody', () => {
    // The pot-0 case: the hand used to deal, skip every turn and settle for 0.
    const state = dealWithBusted(3, [1, 2]);
    expect(isHandOver(state)).toBe(false);
    expect(state.pot).toBeGreaterThan(0);
    // Someone who can act is on turn, and they have cards to act with.
    expect(state.seats[state.toAct].folded).toBe(false);
    expect(state.seats[state.toAct].hole).toHaveLength(2);
    expect(legalActions(state).length).toBeGreaterThan(0);
  });

  it('treats a 4-seat table with two busted seats as heads-up for blind order', () => {
    // Heads-up posts the small blind ON the button. With the seat count driving that decision, a
    // two-live-seat table used the 3+-handed branch and posted SB left of the button instead.
    const state = dealWithBusted(0, [1, 2]);
    expect(state.seats[state.dealer].committed).toBe(SB);
  });

  it('conserves chips across a settled hand with seats sitting out', () => {
    let state = dealWithBusted(0, [1, 2]);
    const total = state.seats.reduce((sum, s) => sum + s.stack + s.committed, 0);

    for (let i = 0; i < 40 && !isHandOver(state); i++) {
      const legal = legalActions(state);
      const kind = legal.includes('check') ? 'check' : legal.includes('call') ? 'call' : 'fold';
      state = applyAction(state, { kind });
    }
    expect(isHandOver(state), 'hand never settled').toBe(true);

    state = settle(state);
    expect(state.seats.reduce((sum, s) => sum + s.stack + s.committed, 0)).toBe(total);
    // A sat-out seat must not be paid: it put nothing in.
    expect(state.winners).not.toBeNull();
    expect(state.winners?.map((w) => w.seatId)).not.toContain(1);
    expect(state.winners?.map((w) => w.seatId)).not.toContain(2);
  });
});
