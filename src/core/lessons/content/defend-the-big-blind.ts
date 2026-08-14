import type { Lesson } from '../types.js';

/**
 * Phase 1. The big blind gets the best price in poker — it already has one blind in and closes the action
 * — so against a button open it DEFENDS an enormous range and folds only the true trash. This is the
 * companion to position-sets-your-range: that lesson opens first-in by seat; this one continues from the
 * seat that never opens.
 *
 * One variable moves — the hand — across the call/fold boundary the app's own rule draws:
 * defenseAction('KQo','bb-vs-btn') === 'call' and defenseAction('72o','bb-vs-btn') === 'fold', verified
 * against preflop.ts. The reasoning restates the BB rule from POSITION_RULES ("defend wide versus a button
 * open, the price is excellent"). Each prompt asks about the price and the range, never the action, so the
 * learner commits before the reveal (G5).
 */
export const defendTheBigBlind: Lesson = {
  id: 'defend-the-big-blind',
  phase: 1,
  title: 'Defend the big blind on the price',
  mechanism:
    'The big blind already has a blind in and acts last preflop, so against a button open it defends a very wide range and folds only the true trash.',
  prerequisites: ['position-sets-your-range'],
  examples: [
    {
      id: 'kqo-defend',
      hole: ['Kd', 'Qc'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'The button opens and folds to the big blind with KQ offsuit. What price does the big blind get, and how wide should it defend?',
      reasoning:
        'Closing the action with a blind already in lays a low price, so the big blind defends very wide against a button open. KQ offsuit sits comfortably inside that range. Call and see a flop with a hand that can improve.',
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
        'Same button open, same low price, now with 7-2 offsuit. Does the wide big-blind defence stretch this far?',
      reasoning:
        'Even at the best price in the game the defence has a floor: a hand that flops almost nothing and is dominated when it pairs is below it. 7-2 offsuit is the trash the wide range still folds. Let it go and defend a hand that can actually continue.',
    },
  ],
  acceptanceKeywords: [
    'the big blind gets the best price',
    'closing the action defends wide',
    'a blind already in lowers the price',
    'even a wide range folds the trash',
    'position to improve is worth the call',
  ],
};
