import type { Lesson } from '../types.js';

/**
 * Phase 3. The idea installed here is that the *shape of the range* chooses the bet size, not the
 * strength of the single hand: a range holding only nuts and air wants one large size, because that
 * size collects the most from the calls and applies the most pressure with the bluffs, while a
 * merged range holding medium hands has no such size available to it.
 *
 * All three examples are the same river spot — same board, pot, stacks, position, and a check to
 * hero — so the only variable is where hero's hand sits in the range. Two of them share one size
 * from opposite ends of the range, which is the boundary the third one falls outside (story 19).
 * No flush or straight is possible on A-K-7-8-2, so nothing but the range shape moves between
 * the examples.
 */
export const polarityPicksTheSize: Lesson = {
  id: 'polarity-picks-the-size',
  phase: 3,
  title: 'Polarity picks the size',
  mechanism:
    'A range split into nuts and air wants a large size: the big bet maximises what the value hands are paid and what the bluffs fold out.',
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'nut-end-checked-to',
      hole: ['Ac', 'Kh'],
      board: ['Ah', 'Kd', '7s', '8c', '2h'],
      street: 'river',
      pot: 300,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'Checked to on the river in a pot of 300. Where does this hand sit in the range, and how would you play it?',
      reasoning:
        'Top two pair beats every pair called down here and loses only to three of a kind. A large bet charges that whole calling range full price, and the same size hides the bluffs. Pick the size from the range shape, then check which hands can share it.',
    },
    {
      id: 'air-end-checked-to',
      hole: ['Qc', 'Jd'],
      board: ['Ah', 'Kd', '7s', '8c', '2h'],
      street: 'river',
      pot: 300,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'Checked to on the river in a pot of 300. Which end of the range holds this hand, and how would you play it?',
      reasoning:
        'Queen-high makes no pair, so the chips only come back if a large bet folds out the pairs ahead of it. Sharing one size with the top of the range is what makes that fold credible. Choose bluffs that can share the value size, then commit to that size.',
    },
    {
      id: 'middle-checked-to',
      hole: ['Kh', 'Ts'],
      board: ['Ah', 'Kd', '7s', '8c', '2h'],
      street: 'river',
      pot: 300,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'Checked to on the river, pot 300. Does this hand sit at either end of the range, and how would you play it?',
      reasoning:
        'Second pair beats the missed hands and loses to every ace, so a large bet folds out the hands it beats. A small bet, or a check, keeps the pot the size this hand can win. Sort the hand into polarised or merged first, then size to that.',
    },
  ],
  acceptanceKeywords: [
    'polarity',
    'polarised range',
    'nuts and air',
    'range shape picks the size',
    'fold equity from a big bet',
    'merged range wants a small size',
    'value hands and bluffs share one size',
  ],
};
