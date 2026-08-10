import type { Lesson } from '../types.js';

/**
 * Phase 1 (Eyes), nut-advantage direction (TEACHING-METHOD P3). The board names the best possible
 * two-card holding; which side can hold it is a property of the two ranges, and range advantage
 * and nut advantage come apart constantly — that dissociation is the highest-value chunk in
 * postflop poker, so it is trained as perception rather than as a sizing rule.
 *
 * Hero is the preflop raiser on the button against one caller, checked to, with the two low board
 * cards, the pot and the stacks all fixed. One variable walks: the top card. The nut hand moves
 * from a set the raiser holds far more often, to a set both sides hold alike, to a straight the
 * caller holds far more often — so the nuts crosses the table without hero's cards changing.
 */
export const whoHoldsTheNuts: Lesson = {
  id: 'who-holds-the-nuts',
  phase: 1,
  title: 'Who holds the nuts',
  mechanism:
    'The board names the two cards the best possible hand needs, and nut advantage sits with whichever range holds those cards more often.',
  prerequisites: ['best-five-from-seven', 'board-texture-dimensions'],
  examples: [
    {
      id: 'ace-high-flop',
      hole: ['Ah', 'Qs'],
      board: ['Ad', '6c', '5h'],
      street: 'flop',
      pot: 100,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The flop is checked through to the raiser. Which two cards make the best possible hand here?',
      reasoning:
        'Ace-six-five makes a set of aces the best possible hand, and an opening range holds far more aces than a defending one. That asymmetry is what gives the betting lead its value on ace-high boards. Name the nut hand, then ask which range holds it.',
    },
    {
      id: 'ten-high-flop',
      hole: ['Ah', 'Qs'],
      board: ['Td', '6c', '5h'],
      street: 'flop',
      pot: 100,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'Only the top card has changed. What is the best possible hand on this flop?',
      reasoning:
        'Ten-six-five moves the nut hand to a set of tens, which both ranges hold in similar numbers. No two cards fill a straight on this shape, so the top of each range stays a set. Check whether a straight is even available before ceding the nuts.',
    },
    {
      id: 'connected-flop',
      hole: ['Ah', 'Qs'],
      board: ['7d', '6c', '5h'],
      street: 'flop',
      pot: 100,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The top card moved once more. Which two cards now make the best possible hand?',
      reasoning:
        'Seven-six-five puts nine-eight at the top, and a wide defending range holds far more nine-eight than an opening range does. One card moved and the nuts crossed the table, while the raiser keeps only the wider overall range. Ask which side can hold the straight, not which side raised.',
    },
  ],
  acceptanceKeywords: [
    'nut advantage',
    'range asymmetry',
    'which range holds the best hand',
    'the board names the nut hand',
    'range advantage and nut advantage differ',
  ],
};
