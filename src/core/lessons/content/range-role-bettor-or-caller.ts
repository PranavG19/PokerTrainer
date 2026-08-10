import type { Lesson } from '../types.js';

/**
 * Phase 1 (Eyes): the perceptual read that has to land before any c-bet rule can, because a
 * sizing rule applied with the roles reversed is worse than no rule. Role is a property of the
 * two *ranges* against the board, not of hero's two cards, so hero holds the same hand in all
 * three examples and only the board's top card moves.
 *
 * The walk is one variable — the highest flop card — across the three points where the answer
 * changes: ace-high (the opener holds the strong hands the caller folded preflop), jack-high
 * (range advantage one way, nut advantage drifting the other), nine-high connected (the caller's
 * range is denser in sets and two pair). The learner finds the boundary between them (story 19).
 */
export const rangeRoleBettorOrCaller: Lesson = {
  id: 'range-role-bettor-or-caller',
  phase: 1,
  title: 'Range role: bettor or caller',
  mechanism:
    'Range asymmetry assigns roles: the side whose range holds strong hands the other cannot have does the betting, and the capped side defends.',
  prerequisites: [],
  examples: [
    {
      id: 'ace-high-flop',
      hole: ['Kd', 'Qd'],
      board: ['Ac', '9d', '4s'],
      street: 'flop',
      pot: 110,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'CO',
      toCall: 0,
      prompt:
        'The cutoff opened and the big blind called. On this ace-high flop, which range holds more of the strong hands?',
      reasoning:
        'A cutoff opening range holds AA, AK and AQ; a big-blind calling range holds almost none of them. That gap makes the aggressor the bettor here, and a small bet works across the whole range. Name the role before choosing a size.',
    },
    {
      id: 'jack-high-flop',
      hole: ['Kd', 'Qd'],
      board: ['Jc', '9d', '4s'],
      street: 'flop',
      pot: 110,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'CO',
      toCall: 0,
      prompt:
        'The cutoff opened and the big blind called. On this jack-high flop, which side holds more of the nutted combos?',
      reasoning:
        'A jack-high flop leaves the cutoff range ahead in equity while the calling range keeps more sets and two pair. Split roles like this favour a smaller size and a wider checking range. Ask which side holds the nutted combos, not just the better average.',
    },
    {
      id: 'nine-high-connected-flop',
      hole: ['Kd', 'Qd'],
      board: ['8c', '9d', '4s'],
      street: 'flop',
      pot: 110,
      heroStack: 950,
      villainStacks: [950],
      bb: 20,
      position: 'CO',
      toCall: 0,
      prompt:
        'The cutoff opened and the big blind called. On this nine-high connected flop, which range does the board favour?',
      reasoning:
        'A nine-high connected flop sits inside the big-blind calling range, which keeps 98, 76 and 65 that a cutoff open rarely holds. The nut advantage moves to the caller, so the betting lead does not follow the preflop raise here. Check the board against the calling range before taking the lead.',
    },
  ],
  acceptanceKeywords: [
    'range asymmetry',
    'nut advantage',
    'range advantage',
    'which range holds the strong hands',
    'betting lead',
    'capped range',
  ],
};
