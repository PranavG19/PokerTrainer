import type { Lesson } from '../types.js';

/**
 * Phase 0. The order of made hands is taught as *rarity*, not as a list to recite: a beginner who
 * has memorised the list still counts seven cards as a hand, and the mistake that costs chips is
 * failing to pick the best five out of the seven available.
 *
 * The three examples hold hero's hole cards and the first four board cards fixed and walk one
 * variable — the river card — across three values that move the same two cards up the order: a pair,
 * a straight, a flush. Each `prompt` asks which five cards make the hand and never what to do with
 * it, so the learner commits before `reasoning` is visible (G5, story 12).
 */
export const handRankingsInOrder: Lesson = {
  id: 'hand-rankings-in-order',
  phase: 0,
  title: 'Hand rankings in order',
  mechanism:
    'The order of made hands follows rarity: the harder combination to be dealt wins, and only the best five of the seven available cards count.',
  prerequisites: [],
  examples: [
    {
      id: 'river-pairs-the-eight',
      hole: ['9h', '8h'],
      board: ['Th', '7h', '3d', '2s', '8d'],
      street: 'river',
      pot: 160,
      heroStack: 800,
      villainStacks: [800],
      bb: 20,
      position: 'BTN',
      toCall: 40,
      prompt: 'Seven cards are available on this river. Which five make the hand, and how rare is that holding?',
      reasoning:
        'The best five here are the two eights plus the three highest kickers, a single pair. One pair is the commonest made hand on a river, so it sits near the bottom of the order. Pick the best five cards before naming the hand.',
    },
    {
      id: 'river-completes-the-straight',
      hole: ['9h', '8h'],
      board: ['Th', '7h', '3d', '2s', '6c'],
      street: 'river',
      pot: 160,
      heroStack: 800,
      villainStacks: [800],
      bb: 20,
      position: 'BTN',
      toCall: 40,
      prompt: 'The same two cards now sit on this river board. Which five make the hand?',
      reasoning:
        'Ten, nine, eight, seven and six make a straight, so the two low kickers drop out of the hand. Five specific running cards are far scarcer than a pair, which is why a straight sits above two pair and trips. Say which five cards play, and which two do not.',
    },
    {
      id: 'river-brings-the-flush',
      hole: ['9h', '8h'],
      board: ['Th', '7h', '3d', '2s', 'Ah'],
      street: 'river',
      pot: 160,
      heroStack: 800,
      villainStacks: [800],
      bb: 20,
      position: 'BTN',
      toCall: 40,
      prompt: 'One river card changed the suits on this board. Which five cards make the hand now?',
      reasoning:
        'Five hearts make an ace-high flush, and the ace on the board plays as the top card of it. Five cards of one suit are rarer than five running cards, so a flush sits above a straight in the order. Count suits on the board before counting connections.',
    },
  ],
  acceptanceKeywords: [
    'rarity orders the hands',
    'best five of seven cards',
    'the harder combination wins',
    'which cards play and which drop out',
    'scarcer holdings sit higher',
  ],
};
