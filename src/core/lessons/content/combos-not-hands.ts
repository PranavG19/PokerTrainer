import type { Lesson } from '../types.js';

/**
 * Phase 2, node F4. Combination counting is taught as the arithmetic underneath range reading: a
 * pair is six combinations, an unpaired holding sixteen, and every card the hand or the board can
 * see subtracts from that count. Naming a holding a villain "could have" is worthless until the
 * count is done, which is also the whole mechanism behind blockers.
 *
 * One variable moves — how many kings the hand holds, none then one then two — while the board,
 * the street, the pot and the price hold still, so the collapse from three combinations to one to
 * none is something the learner watches happen (story 19). Prompts ask for the count, never the
 * action (G5).
 */
export const combosNotHands: Lesson = {
  id: 'combos-not-hands',
  phase: 2,
  title: 'Combos, not hands',
  mechanism:
    'Holdings exist as combination counts — six per pair, sixteen per unpaired hand — and every seen card removes some, so range reading is counting.',
  prerequisites: [],
  examples: [
    {
      id: 'no-king-in-hand',
      hole: ['Ah', 'Qh'],
      board: ['Kh', '9c', '4d'],
      street: 'flop',
      pot: 180,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt: 'No king sits in this hand and one is on the flop. How many combinations of pocket kings can a villain hold?',
      reasoning:
        'Three kings remain unseen, so pocket kings makes 3 combinations out of six. Pairs start at 6 combinations and every visible card cuts the count fast. Count the unseen cards before crediting a range with the holding.',
    },
    {
      id: 'one-king-in-hand',
      hole: ['Ks', 'Qh'],
      board: ['Kh', '9c', '4d'],
      street: 'flop',
      pot: 180,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt: 'One king sits in this hand and one on the flop. How many combinations of pocket kings are left for a villain?',
      reasoning:
        'Two kings remain unseen, so pocket kings shrinks to a single combination. One card in the hand removed two thirds of that holding without changing anything else. Ask how many kings the hand and board already show.',
    },
    {
      id: 'two-kings-in-hand',
      hole: ['Ks', 'Kc'],
      board: ['Kh', '9c', '4d'],
      street: 'flop',
      pot: 180,
      heroStack: 900,
      villainStacks: [900],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt: 'Two kings sit in this hand and one on the flop. How many combinations of pocket kings remain in a villain range?',
      reasoning:
        'One king remains unseen, so pocket kings holds 0 combinations and cannot appear at all. Blockers work by arithmetic rather than by feel, and the combinations either exist or they do not. Convert a read into a combination count before acting on it.',
    },
  ],
  acceptanceKeywords: [
    'combination count',
    'card removal',
    'blockers',
    'six combinations per pair',
    'sixteen combinations unpaired',
    'a range is counted, not named',
  ],
};
