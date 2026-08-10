import type { Lesson } from '../types.js';

/**
 * Phase 0. Betting order is taught as the source of position's edge rather than as a seating
 * diagram: the seat that acts last sees an action before paying for it, and the order restarts left
 * of the button once the board arrives, which is why the blinds act late before the flop and first
 * after it.
 *
 * The three examples hold the board, pot, stacks and price fixed and walk one variable — hero's
 * seat — across the button (acts last), the cutoff (acts before the button), and the small blind
 * (acts late preflop, first afterwards). Each `prompt` asks about the order and never about the
 * action, so the learner commits before `reasoning` is visible (G5, story 12).
 */
export const bettingOrderAndPosition: Lesson = {
  id: 'betting-order-and-position',
  phase: 0,
  title: 'Betting order and position',
  mechanism:
    'Betting order restarts left of the button each street, so the last seat to act buys free information the early seats must pay for.',
  prerequisites: [],
  examples: [
    {
      id: 'button-acts-last',
      hole: ['Ks', 'Qd'],
      board: ['Jc', '7h', '2s'],
      street: 'flop',
      pot: 100,
      heroStack: 480,
      villainStacks: [480],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The opponent has checked this flop to the button. Which seat acts last here, and what does that buy?',
      reasoning:
        'The button acts last on every postflop street, so the check arrives before this decision does. Free information is what the seat buys: one action seen, none given away. Note which seats still act behind the hand before choosing a size.',
    },
    {
      id: 'cutoff-acts-first',
      hole: ['Ks', 'Qd'],
      board: ['Jc', '7h', '2s'],
      street: 'flop',
      pot: 100,
      heroStack: 480,
      villainStacks: [480],
      bb: 20,
      position: 'CO',
      toCall: 0,
      prompt: 'Same flop, acting from the cutoff with the button still in the hand. Who acts after this seat?',
      reasoning:
        'The cutoff acts before the button on every street, so this decision is made blind to the last seat. Chips go in without seeing the reply, which is the cost of acting early. Check who is still behind before committing chips from the cutoff.',
    },
    {
      id: 'small-blind-order-flips',
      hole: ['Ks', 'Qd'],
      board: ['Jc', '7h', '2s'],
      street: 'flop',
      pot: 100,
      heroStack: 480,
      villainStacks: [480],
      bb: 20,
      position: 'SB',
      toCall: 0,
      prompt: 'Same flop from the small blind. Which seat opens the betting now, and which opened it before the flop?',
      reasoning:
        'The small blind acted third before the flop and opens the betting on every street after it. Order restarts left of the button once the board arrives, so the blinds lose the late seat they held. Re-read the acting order at the start of each street.',
    },
  ],
  acceptanceKeywords: [
    'acting last is free information',
    'order restarts left of the button',
    'the early seat pays for information',
    'position decides who commits blind',
    'seats still behind the hand',
  ],
};
