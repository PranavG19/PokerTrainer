import type { Lesson } from '../types.js';

/**
 * Phase 1. After opening, the raiser sometimes faces a 3-bet, and the reply is a THREE-way sort, not a
 * fold reflex: 4-bet the hands that want a bigger pot, flat the dominated-but-playable hands that still
 * have a price, fold the rest. Teaching the sort is the point — a beginner treats a 3-bet as a fold button.
 *
 * The three examples hold the seat fixed (a cutoff opener) and move the hand across the app's own rule
 * boundaries: threeBetResponseAction('AA','CO') === 'threebet' (4-bet), ('AJs','CO') === 'call' (flat),
 * ('A5s','CO') === 'fold' — verified against preflop.ts. Because the lesson engine can only place a
 * continue decision (toCall>0 offers `call`), each prompt asks the learner to NAME the reply and reason;
 * the reasoning states the rule-stated verdict. No solver frequency is used or implied.
 */
export const facingA3Bet: Lesson = {
  id: 'facing-a-3bet',
  phase: 1,
  title: 'Facing a 3-bet: 4-bet, flat, or fold',
  mechanism:
    'A 3-bet is a three-way sort, not a fold: 4-bet the hands that want a bigger pot, flat the dominated-but-playable hands with a price, fold the rest.',
  prerequisites: ['position-sets-your-range'],
  examples: [
    {
      id: 'aa-4bet',
      hole: ['As', 'Ad'],
      board: [],
      street: 'preflop',
      pot: 260,
      heroStack: 900,
      villainStacks: [880],
      bb: 20,
      position: 'CO',
      toCall: 120,
      prompt:
        'The cutoff open is met by a 3-bet, holding pocket aces. Which of the three replies fits the strongest hand in the deck?',
      reasoning:
        'The best hand wants the biggest pot it can build, and flatting caps the range and invites a flop that could cool the action. The 4-bet is the reply that grows the pot now. Re-raise for value and set up a stack-off.',
    },
    {
      id: 'ajs-flat',
      hole: ['As', 'Js'],
      board: [],
      street: 'preflop',
      pot: 260,
      heroStack: 900,
      villainStacks: [880],
      bb: 20,
      position: 'CO',
      toCall: 120,
      prompt:
        'Same cutoff open and 3-bet, now with A-J suited: a 4-bet only folds worse hands and is called by better. 4-bet, flat, or fold?',
      reasoning:
        'A-J suited plays well but is dominated by the value a 4-bet keeps in, so raising it turns a playable hand into a bluff. Flatting keeps it alive at a price with position and suitedness. Call and continue on a flop that helps the hand.',
    },
    {
      id: 'a5s-fold',
      hole: ['As', '5s'],
      board: [],
      street: 'preflop',
      pot: 260,
      heroStack: 900,
      villainStacks: [880],
      bb: 20,
      position: 'CO',
      toCall: 120,
      prompt:
        'Same spot with A-5 suited — a hand that neither wants a bigger pot nor flops well enough to defend. Which reply is left?',
      reasoning:
        'A-5 suited is behind the 4-bet value and too thin to flat and realise out of the pot, so neither aggressive reply pays. The blocker alone does not rescue it here. Fold and keep the flatting range one that can actually continue.',
    },
  ],
  acceptanceKeywords: [
    'a 3-bet is a sort not a fold',
    '4-bet the hands that want a bigger pot',
    'flat the dominated-but-playable hands',
    'raising a dominated hand turns it into a bluff',
    'fold what neither wants a pot nor flops well',
  ],
};
