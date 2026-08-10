import type { Lesson } from '../types.js';

/**
 * Phase 3. Domination is the reason two hands that look alike are not: sharing a top card with a
 * worse second card means the pairs the hand makes are the same pairs a caller beats, so the
 * equity is dead exactly when the pot gets big (TEACHING-METHOD R8, the K7s boundary family).
 *
 * The three examples move one variable — the kicker beside the king — across the boundary from
 * dominating to dominated, with board, price, seat and stacks identical, so the learner locates the
 * crossover instead of being handed it (story 19). The prompt asks which better hands the pair runs
 * into and never names an action (G5).
 */
export const dominationAndDeadHands: Lesson = {
  id: 'domination-and-dead-hands',
  phase: 3,
  title: 'Domination and dead hands',
  mechanism:
    'Domination is sharing a top card with a worse second card: the hand keeps making pairs a calling range already beats, so its equity is dead.',
  prerequisites: [],
  examples: [
    {
      id: 'top-kicker',
      hole: ['Kd', 'Qc'],
      board: ['Kh', '8s', '3c'],
      street: 'flop',
      pot: 180,
      heroStack: 1940,
      villainStacks: [1880],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt:
        'A bet of 60 makes the pot 180 on this king-high flop. Which better hands does top pair here run into?',
      reasoning:
        'Top pair with a queen loses to ace-king and beats every other king a caller can hold. The kicker turns a second king on later streets into value rather than trouble. Name the better kickers before deciding how many streets this pair pays.',
    },
    {
      id: 'middle-kicker',
      hole: ['Kd', '9c'],
      board: ['Kh', '8s', '3c'],
      street: 'flop',
      pot: 180,
      heroStack: 1940,
      villainStacks: [1880],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt:
        'A bet of 60 makes the pot 180 on this king-high flop. Which better hands does top pair here run into?',
      reasoning:
        'Top pair with a nine beats the small kings and loses to ace-king, king-queen, king-jack and king-ten. Roughly half the kings that keep betting hold the better second card, so the pair wins less than a made hand suggests. Count the better kickers, then plan one street.',
    },
    {
      id: 'weak-kicker',
      hole: ['Kd', '4c'],
      board: ['Kh', '8s', '3c'],
      street: 'flop',
      pot: 180,
      heroStack: 1940,
      villainStacks: [1880],
      bb: 20,
      position: 'BB',
      toCall: 60,
      prompt:
        'A bet of 60 makes the pot 180 on this king-high flop. Which better hands does top pair here run into?',
      reasoning:
        'Top pair with a four sits behind every other king and ahead only of missed hands and small pairs. Growing the pot invites the dominating kings and leaves the equity dead against them. Treat a weak kicker as a hand that wants a small pot.',
    },
  ],
  acceptanceKeywords: [
    'domination risk',
    'dominated kicker',
    'dead equity when called',
    'the same top card with a worse second card',
    'hitting a pair that a better hand already beats',
    'card removal',
  ],
};
