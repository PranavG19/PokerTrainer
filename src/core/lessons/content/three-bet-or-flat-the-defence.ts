import type { Lesson } from '../types.js';

/**
 * Phase 1. defend-the-big-blind teaches the price (defend or fold); this lesson splits the DEFEND half in
 * two: the big blind does not flat everything it continues with — it 3-bets its best hands for value and
 * flats the rest. It is the defender's mirror of facing-a-3bet (which sorts the OPENER's reply); here the
 * seat is the big blind facing a button open.
 *
 * The three examples move one hand across the app's own defence sort against a button open:
 * defenseAction('AA','bb-vs-btn') === 'threebet', ('A5s','bb-vs-btn') === 'call', ('72o','bb-vs-btn') ===
 * 'fold' — verified against preflop.ts. The lesson engine can only place a continue decision (toCall>0
 * offers `call`), so each prompt asks the learner to NAME the reply and the reasoning states the
 * rule-stated verdict. No solver frequency is used or implied.
 */
export const threeBetOrFlatTheDefence: Lesson = {
  id: 'three-bet-or-flat-the-defence',
  phase: 1,
  title: 'Defending: 3-bet the best, flat the rest',
  mechanism:
    'The big blind does not flat everything it defends: it 3-bets its strongest hands for value and flats the playable rest, folding only the trash.',
  prerequisites: ['defend-the-big-blind'],
  examples: [
    {
      id: 'aa-threebet',
      hole: ['As', 'Ad'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'A button open reaches the big blind holding pocket aces. Flatting hides the hand — which reply builds the pot with the best holding?',
      reasoning:
        'The strongest hand wants a bigger pot and a defined range, and flatting lets weak hands see a cheap flop. The 3-bet raises now for value. Re-raise and play a larger pot with the best of it.',
    },
    {
      id: 'a5s-flat',
      hole: ['As', '5s'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'Same button open with A-5 suited: strong enough to continue, not strong enough to raise for value. 3-bet, flat, or fold?',
      reasoning:
        'A-5 suited flops well and blocks big aces but is not ahead of a button open often enough to 3-bet for value. Flatting keeps it in at a low price. Call and see a flop with a hand that can improve.',
    },
    {
      id: '72o-fold',
      hole: ['7d', '2c'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'Same button open, now with 7-2 offsuit — below both the raise and the flat. Which reply is left?',
      reasoning:
        'A hand that flops almost nothing and is dominated when it pairs neither wants a raised pot nor a flat. The best price in the game still has a floor. Fold and keep the defence a range that can continue.',
    },
  ],
  acceptanceKeywords: [
    'the big blind does not flat everything',
    '3-bet the strongest hands for value',
    'flat the playable hands at a price',
    'flatting a premium hides its strength',
    'still fold the trash below the flat',
  ],
};
