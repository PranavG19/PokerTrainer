import type { Lesson } from '../types.js';

/**
 * Phase 2 reference lesson. Copy this file's shape when adding a lesson (see AUTHORING.md).
 *
 * Pot odds are taught as a *price* in natural frequencies — "about 2 times in 7" — because the
 * percentage form is what learners memorise instead of computing: a remembered 29% transfers to
 * nothing, while "the bet is asking me to be right 2 times in 7" is re-derivable at the table
 * from two numbers already on screen.
 *
 * The three examples walk one variable — bet size as a fraction of the pot — across the three
 * sizings that produce clean frequencies: two-thirds (2 in 7), half (1 in 4), quarter (1 in 6).
 * Each example's `prompt` asks for the price and never for the action, so the learner commits
 * before `reasoning` is visible (G5, story 12).
 */
export const potOddsAsAPrice: Lesson = {
  id: 'pot-odds-as-a-price',
  phase: 2,
  title: 'Pot odds as a price',
  mechanism:
    'Pot odds are a price: the chips a call costs against the chips it can win, read as a natural frequency like 2 times in 7.',
  prerequisites: [],
  examples: [
    {
      id: 'two-thirds-flop',
      hole: ['9h', '8h'],
      board: ['Th', '6d', '2h'],
      street: 'flop',
      pot: 180,
      heroStack: 1950,
      villainStacks: [1880],
      bb: 20,
      position: 'BB',
      toCall: 70,
      prompt: 'A bet of 70 makes the pot 180. What price is on offer, and how often must the hand win to break even?',
      reasoning:
        'The bet asks 70 to win 250, a price of about 2 times in 7. Four hearts and a gutshot arrive more often than that across two cards. Read the price off the pot before reading the cards next time.',
    },
    {
      id: 'half-pot-turn',
      hole: ['Ac', '4c'],
      board: ['Qc', '9d', '3c', '8s'],
      street: 'turn',
      pot: 300,
      heroStack: 1500,
      villainStacks: [1500],
      bb: 20,
      position: 'BTN',
      toCall: 100,
      prompt: 'A half-pot bet makes the pot 300 on the turn. What frequency does calling have to beat?',
      reasoning:
        'Half pot asks 100 to win 400, which is 1 time in 4. Nine clubs land on one card closer to 1 time in 5, so the draw alone is short of the price. Count the river card only, not both streets.',
    },
    {
      id: 'quarter-pot-river',
      hole: ['Jd', 'Js'],
      board: ['Ah', 'Qc', '7d', '4s', '2h'],
      street: 'river',
      pot: 125,
      heroStack: 900,
      villainStacks: [780],
      bb: 20,
      position: 'BB',
      toCall: 25,
      prompt: 'A quarter-pot bet makes the pot 125 on the river. What price does that offer a bluff-catcher?',
      reasoning:
        'A quarter-pot bet asks 25 to win 150, so calling needs to be right 1 time in 6. Small prices demand a low frequency, which is why cheap bets get called with weak holdings. State the frequency first, then pick the hands that clear it.',
    },
  ],
  acceptanceKeywords: [
    'price',
    'pot odds',
    'break-even frequency',
    'natural frequency',
    'cost against reward',
    'equity needed to continue',
  ],
};
