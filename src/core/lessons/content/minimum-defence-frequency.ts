import type { Lesson } from '../types.js';

/**
 * Phase 2. The mirror of pot odds: pot odds price one hand's call, while minimum defence
 * frequency prices the whole range against a bluff that risks the bet to win the pot. It is the
 * arithmetic that makes "a big bet does not have to be called often" a number instead of a
 * feeling, and it is a prerequisite for every later folding-frequency rule.
 *
 * Board, hand, position and the old pot of 200 hold steady; only the bet size moves — half pot,
 * pot, then a double-pot overbet — so the shrinking defence share (2 in 3, 1 in 2, 1 in 3) is a
 * boundary the learner traces rather than a table to memorise (story 19).
 */
export const minimumDefenceFrequency: Lesson = {
  id: 'minimum-defence-frequency',
  phase: 2,
  title: 'Minimum defence frequency',
  mechanism:
    'A bet size sets the share of a defending range that must continue, the old pot against the pot plus the bet, or the bet profits uncontested.',
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'half-pot-river',
      hole: ['Ac', 'Jc'],
      board: ['Kd', '9c', '5h', '2s', '7d'],
      street: 'river',
      pot: 300,
      heroStack: 900,
      villainStacks: [820],
      bb: 20,
      position: 'BB',
      toCall: 100,
      prompt: 'A river bet of 100 makes the pot 300. What share of the defending range has to continue?',
      reasoning:
        'Half pot risks 100 to win the 200 already there, so folding more than 1 hand in 3 pays for the bluff outright. Defending about 2 hands in 3 removes that automatic profit. Read the size first, then pick which hands fill the quota.',
    },
    {
      id: 'pot-sized-river',
      hole: ['Ac', 'Jc'],
      board: ['Kd', '9c', '5h', '2s', '7d'],
      street: 'river',
      pot: 400,
      heroStack: 900,
      villainStacks: [820],
      bb: 20,
      position: 'BB',
      toCall: 200,
      prompt: 'A pot-sized river bet of 200 makes the pot 400. What share of the range must keep going?',
      reasoning:
        'A pot-sized bet risks 200 to win 200, so one fold in two already pays for a bluff. Defending about 1 hand in 2 removes that profit, a narrower share than the half-pot bet demanded. Convert the size into a defence share before choosing which hands stay.',
    },
    {
      id: 'overbet-river',
      hole: ['Ac', 'Jc'],
      board: ['Kd', '9c', '5h', '2s', '7d'],
      street: 'river',
      pot: 600,
      heroStack: 900,
      villainStacks: [820],
      bb: 20,
      position: 'BB',
      toCall: 400,
      prompt: 'An overbet of 400 into a pot of 200 makes the pot 600. What share of the range must continue?',
      reasoning:
        'An overbet of 400 risks 400 to win 200, so 2 folds in 3 already pay for it. Defending about 1 hand in 3 is enough, which is why big sizes face narrow calling ranges. Size the defence to the price, not to the strength of the board.',
    },
  ],
  acceptanceKeywords: [
    'minimum defence frequency',
    'bet size sets the defence share',
    'alpha',
    'automatic profit for a bluff',
    'bluff break-even frequency',
    'the pot against pot plus bet',
  ],
};
