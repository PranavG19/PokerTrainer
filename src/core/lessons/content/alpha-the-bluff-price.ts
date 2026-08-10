import type { Lesson } from '../types.js';

/**
 * Phase 2, node F3. Alpha is taught as the *bet's own* price, the mirror of pot odds: the chips
 * risked against the chips already there give the frequency the bet must be folded to, and the
 * same ratio caps how many bluffs the value bets can carry. Stated as a frequency rather than a
 * percentage because the two numbers are on screen and the division is re-derivable at the table.
 *
 * One variable moves across the three examples — the size under consideration, half pot then
 * three-quarters then pot — while board, hand, position and stacks hold still, so the learner
 * finds the boundary between size and required fold frequency themselves (story 19). Each prompt
 * asks only for the frequency, never for the action, so commitment precedes the answer (G5).
 */
export const alphaTheBluffPrice: Lesson = {
  id: 'alpha-the-bluff-price',
  phase: 2,
  title: 'Alpha, the price of a bluff',
  mechanism:
    "A bet's size sets its own break-even fold frequency, and the same ratio fixes how many bluffs the value bets can carry.",
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'half-pot-river-bluff',
      hole: ['Jh', 'Th'],
      board: ['Ah', '9c', '4d', '2s', '7c'],
      street: 'river',
      pot: 240,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'A half-pot bet of 120 into 240 is available on this river. How often must it take the pot immediately?',
      reasoning:
        'A 120 bet into 240 risks 120 to win 240, so folding must happen about 1 time in 3. Jack-high wins almost nothing at showdown, so the fold frequency is the whole return. Size the bluff first, then ask whether folds arrive that often.',
    },
    {
      id: 'three-quarter-river-bluff',
      hole: ['Jh', 'Th'],
      board: ['Ah', '9c', '4d', '2s', '7c'],
      street: 'river',
      pot: 240,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'A three-quarter bet of 180 into 240 is available here. How often must that bet take the pot immediately?',
      reasoning:
        'A 180 bet into 240 risks 180 to win 240, so the fold has to come about 3 times in 7. The larger size buys more folds but demands them more often. Pair every larger size with the higher frequency it needs.',
    },
    {
      id: 'pot-sized-river-bluff',
      hole: ['Jh', 'Th'],
      board: ['Ah', '9c', '4d', '2s', '7c'],
      street: 'river',
      pot: 240,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'A pot-sized bet of 240 into 240 is available here. How often must that bet take the pot immediately?',
      reasoning:
        'A 240 bet into 240 risks 240 to win 240, so the fold must arrive 1 time in 2. The same size sets the value pairing: 1 bluff for every 2 value bets keeps a caller indifferent. Read a size as two numbers at once, folds needed and bluffs allowed.',
    },
  ],
  acceptanceKeywords: [
    'break-even fold frequency',
    'risk against reward',
    'fold equity',
    'the size sets the price',
    'bluff-to-value ratio',
    'indifference',
  ],
};
