import type { Lesson } from '../types.js';

/**
 * Phase 3. Raw equity is what a hand wins at showdown; realised equity is what it actually
 * collects once the rest of the hand has to be played. The gap between them is the variable that
 * pays for a weak kicker and for wide blind defence (TEACHING-METHOD R3).
 *
 * The two examples hold the hand, the board, the price and the stacks fixed and move one variable:
 * hero's seat, and with it whether hero closes the action or acts first. Same raw equity, different
 * realised equity — which is the whole point, and the learner has to name it before `reasoning`
 * appears (G5).
 */
export const equityRealisation: Lesson = {
  id: 'equity-realisation',
  phase: 3,
  title: 'Equity realisation',
  mechanism:
    "Equity realisation is the share of a hand's raw equity that reaches showdown; position and the chance to end the hand cheaply set that share.",
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'in-position',
      hole: ['Ad', '5d'],
      board: ['Qh', '8s', '3c'],
      street: 'flop',
      pot: 150,
      heroStack: 1950,
      villainStacks: [1900],
      bb: 20,
      position: 'BTN',
      toCall: 50,
      prompt:
        'A bet of 50 makes the pot 150. How much of this hand’s equity gets to showdown from this seat?',
      reasoning:
        'Ace high with a backdoor wheel draw holds equity that only matures on later cards. Closing the action every street lets the hand see the turn and river at a price of its own choosing, so most of that equity arrives at showdown. Count the cheap cards available before paying.',
    },
    {
      id: 'out-of-position',
      hole: ['Ad', '5d'],
      board: ['Qh', '8s', '3c'],
      street: 'flop',
      pot: 150,
      heroStack: 1950,
      villainStacks: [1900],
      bb: 20,
      position: 'BB',
      toCall: 50,
      prompt:
        'A bet of 50 makes the pot 150. How much of this hand’s equity gets to showdown from this seat?',
      reasoning:
        'The same ace high keeps the same raw equity and loses the choice of when the hand ends. Acting first every street invites a turn bet the hand cannot price, so a chunk of that equity never reaches showdown. Discount marginal hands by one seat before defending.',
    },
  ],
  acceptanceKeywords: [
    'equity realisation',
    'realised equity',
    'raw equity versus what reaches showdown',
    'positional discount',
    'position lets the hand see cards cheaply',
    'hands that need later cards realise less',
  ],
};
