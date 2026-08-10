import type { Lesson } from '../types.js';

/**
 * Phase 1 (Eyes), the card floor: seven cards to the best five. It is phase 1 rather than phase 0
 * because the skill is perceptual — reading the hand off the whole seven under time pressure —
 * and every later timing target is gated on it (TEACHING-METHOD P0).
 *
 * The three examples hold hero's pocket kings and the first four board cards fixed and walk one
 * variable: the river card. It moves how many of hero's two cards can play — two, then one, then
 * none — which is the boundary beginners miss when they read "my hand plus the board" instead of
 * the best five of seven. The last two differ only in the suit of the same river nine.
 */
export const bestFiveFromSeven: Lesson = {
  id: 'best-five-from-seven',
  phase: 1,
  title: 'Best five from seven',
  mechanism:
    'A hand is the best five cards out of seven, chosen freely across hole and board, so the other two contribute nothing at showdown.',
  prerequisites: [],
  examples: [
    {
      id: 'river-two',
      hole: ['Kd', 'Kc'],
      board: ['Qh', 'Jh', 'Th', '5h', '2c'],
      street: 'river',
      pot: 260,
      heroStack: 700,
      villainStacks: [620],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'Seven cards are now visible. Which five of them make the strongest hand available here?',
      reasoning:
        'The best five is a pair of kings with queen, jack and ten alongside, so both hole cards play. Four hearts sit on the board, but a flush needs a fifth heart held in hand. Name the best five before naming an action.',
    },
    {
      id: 'river-nine-club',
      hole: ['Kd', 'Kc'],
      board: ['Qh', 'Jh', 'Th', '5h', '9c'],
      street: 'river',
      pot: 260,
      heroStack: 700,
      villainStacks: [620],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'One river card has changed. Which five cards make the strongest hand out of these seven?',
      reasoning:
        'The nine fills king-queen-jack-ten-nine, so exactly one king plays and the second king becomes dead weight. A pair of kings is the weaker reading of the same seven cards. Scan the board for a straight before counting pairs.',
    },
    {
      id: 'river-nine-heart',
      hole: ['Kd', 'Kc'],
      board: ['Qh', 'Jh', 'Th', '5h', '9h'],
      street: 'river',
      pot: 260,
      heroStack: 700,
      villainStacks: [620],
      bb: 20,
      position: 'BB',
      toCall: 80,
      prompt: 'Only the suit of the river nine has moved. Which five cards make the hand now?',
      reasoning:
        'The fifth heart puts a queen-high flush on the board itself, and both kings sit outside it. The seven cards hold nothing better than the five already showing. Check whether the board alone makes the hand before committing chips.',
    },
  ],
  acceptanceKeywords: [
    'best five of seven',
    'cards that play',
    'a card can be dead weight',
    'the board can make the hand',
    'hole and board combine freely',
  ],
};
