import type { Lesson } from '../types.js';

/**
 * Phase 2. Outs are taught as a frequency over the *next card only*, because the four-and-two
 * shortcut quietly prices two cards against a bet that will be charged again on the river, and
 * the resulting number is unfalsifiable at the table. Comparing outs to the 46 unseen cards is
 * re-derivable from what is already on screen.
 *
 * The board, the pot and the price are identical in all three examples; only the out count moves
 * — 4, then 9, then 15 — so the boundary against a fixed 1-in-4 price is the learner's to find
 * (story 19). The 9-out draw sitting just short of the price is the point of the middle example.
 */
export const countingOutsAsAFrequency: Lesson = {
  id: 'counting-outs-as-a-frequency',
  phase: 2,
  title: 'Counting outs as a frequency',
  mechanism:
    'An out count becomes a frequency by comparing outs against unseen cards, one card at a time: nine outs on the turn arrives about 1 time in 5.',
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'gutshot-four-outs',
      hole: ['Jd', '8d'],
      board: ['Qh', '7h', '2c', '9s'],
      street: 'turn',
      pot: 240,
      heroStack: 1200,
      villainStacks: [1120],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'A turn bet of 80 makes the pot 240. How often does the river complete this hand?',
      reasoning:
        'Only a ten completes this straight, four cards out of forty-six, about 1 time in 12. The bet asks 80 to win 320, a price of 1 time in 4. Compare the out frequency with the price before the cards feel close.',
    },
    {
      id: 'flush-draw-nine-outs',
      hole: ['Ah', '5h'],
      board: ['Qh', '7h', '2c', '9s'],
      street: 'turn',
      pot: 240,
      heroStack: 1200,
      villainStacks: [1120],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'A turn bet of 80 makes the pot 240. How often does the flush arrive on one card?',
      reasoning:
        'Nine hearts remain among forty-six unseen cards, so the flush arrives about 1 time in 5. The price asks 1 time in 4, so the draw alone falls just short. Count outs against one card, then look for the chips behind.',
    },
    {
      id: 'combo-draw-fifteen-outs',
      hole: ['Jh', 'Th'],
      board: ['Qh', '7h', '2c', '9s'],
      street: 'turn',
      pot: 240,
      heroStack: 1200,
      villainStacks: [1120],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'A turn bet of 80 makes the pot 240. How often does this hand improve by the river?',
      reasoning:
        'Nine hearts plus six more straight cards make fifteen outs, about 1 time in 3 on the river. That frequency beats the 1-in-4 price the bet is asking. Count the flush and the straight cards separately, then subtract the overlap.',
    },
  ],
  acceptanceKeywords: [
    'outs against unseen cards',
    'one card at a time',
    'natural frequency',
    'improvement frequency',
    'draw frequency against the price',
  ],
};
