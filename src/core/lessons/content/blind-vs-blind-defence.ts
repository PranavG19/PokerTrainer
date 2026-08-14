import type { Lesson } from '../types.js';

/**
 * Phase 1. The widest defending range in the game. defend-the-big-blind teaches the price against a
 * BUTTON open; this pushes the same idea to its extreme: when the SMALL BLIND opens, it is raising the
 * widest range at the table (it has position on no one and is trying to steal), and the big blind closes
 * the action heads-up getting an excellent price — so it defends almost everything, folding only the true
 * bottom. A beginner who has learned to fold trash overfolds badly here; the lesson is that the opener's
 * seat (SB, the widest) plus the heads-up price stretch the defence further than anywhere else.
 *
 * The examples hold the BB seat facing an SB open and move the hand across the app's own rule boundary:
 * defenseAction('K2o','bb-vs-sb') === 'call', ('J7o','bb-vs-sb') === 'call', ('72o','bb-vs-sb') === 'fold'
 * — verified against preflop.ts. Each spot is a big-blind continue decision (toCall>0 offers `call`); the
 * prompt asks about the price and the range, never the action, so the learner commits before the reveal
 * (G5). No solver frequency is used or implied.
 */
export const blindVsBlindDefence: Lesson = {
  id: 'blind-vs-blind-defence',
  phase: 1,
  title: 'Blind vs blind: the widest defence',
  mechanism:
    'The small blind opens the widest range at the table and the big blind closes heads-up on a low price, so it defends almost everything and folds only the bottom.',
  prerequisites: ['defend-the-big-blind'],
  examples: [
    {
      id: 'k2o-defend',
      hole: ['Kd', '2c'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'The small blind opens and the big blind holds K-2 offsuit, heads-up. How wide is the defence against the widest opening range in poker?',
      reasoning:
        'The small blind opens its widest range and the big blind gets a low heads-up price, so the defence is enormous. A king dominates much of that range and clears the bar easily. Call and take a flop with the better high card.',
    },
    {
      id: 'j7o-defend',
      hole: ['Jd', '7c'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'Same blind-vs-blind spot with J-7 offsuit — a hand that folds almost everywhere else. Does the widest defence in the game still include it?',
      reasoning:
        'Against the small blind’s steal-wide range this hand is not behind often enough to fold at the price the big blind is getting. The seat and the price, not the two cards, keep it in. Call and play a flop heads-up in position to improve.',
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
        'Same spot, now the worst hand in poker: 7-2 offsuit. Does even the widest defence in the game stretch this far?',
      reasoning:
        'Even the widest range has a floor, and a hand that flops almost nothing and is dominated when it pairs sits below it. The low price does not rescue the very bottom. Fold it and defend the rest of the enormous range.',
    },
  ],
  acceptanceKeywords: [
    'the small blind opens the widest range',
    'the big blind closes heads-up on a low price',
    'blind versus blind defends almost everything',
    'the seat and the price keep weak hands in',
    'even the widest range folds the true bottom',
  ],
};
