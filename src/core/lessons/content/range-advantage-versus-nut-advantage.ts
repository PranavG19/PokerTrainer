import type { Lesson } from '../types.js';

/**
 * Phase 3. The two advantages dissociate constantly, and that dissociation is the highest-value
 * chunk in postflop play (TEACHING-METHOD R2/P3): a raiser can hold the better range on average
 * while the defender holds most of the best hands, and only the second one decides sizing.
 *
 * The three examples walk one variable — flop texture, from king-high and disconnected down to
 * low and connected — holding hero's cards, seat, price and stacks fixed, so the learner finds the
 * crossover themselves (story 19). All three flops are rainbow so suit density is not a second
 * variable. The prompt is identical in all three and asks for the read, never the action (G5).
 */
export const rangeAdvantageVersusNutAdvantage: Lesson = {
  id: 'range-advantage-versus-nut-advantage',
  phase: 3,
  title: 'Range advantage versus nut advantage',
  mechanism:
    'Range advantage is holding more strong hands on average; nut advantage is holding more of the very best. Boards separate the two.',
  prerequisites: [],
  examples: [
    {
      id: 'king-high-disconnected',
      hole: ['Ad', 'Qd'],
      board: ['Kh', '7s', '2c'],
      street: 'flop',
      pot: 110,
      heroStack: 1950,
      villainStacks: [1950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt:
        'The big blind checks this flop. Which range holds more strong hands, and which holds more of the best ones?',
      reasoning:
        'A raising range holds every strong king and most aces, while a defending range rarely contains K7 or 72. Range advantage and nut advantage point the same direction on this flop. Count top-pair combos and nutted combos separately before choosing a size.',
    },
    {
      id: 'middling-connected',
      hole: ['Ad', 'Qd'],
      board: ['Th', '9s', '8c'],
      street: 'flop',
      pot: 110,
      heroStack: 1950,
      villainStacks: [1950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt:
        'The big blind checks this flop. Which range holds more strong hands, and which holds more of the best ones?',
      reasoning:
        'Both ranges connect with T98, yet suited connectors and small pairs sit mostly in the defending range and make the straights and sets. Range advantage stays close to even while nut advantage crosses over. Ask which range makes the straight before betting big.',
    },
    {
      id: 'low-connected',
      hole: ['Ad', 'Qd'],
      board: ['7h', '6s', '5c'],
      street: 'flop',
      pot: 110,
      heroStack: 1950,
      villainStacks: [1950],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt:
        'The big blind checks this flop. Which range holds more strong hands, and which holds more of the best ones?',
      reasoning:
        'Low connected cards live in a defending range, so two pair and made straights concentrate there. High cards still leave the raiser a thin edge on average, and the nut advantage has flipped entirely. Separate the two questions on every low board.',
    },
  ],
  acceptanceKeywords: [
    'range asymmetry',
    'range advantage',
    'nut advantage',
    'board texture decides which range is stronger',
    'nutted combos',
    'which range holds the strongest hands',
  ],
};
