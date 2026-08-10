import type { Lesson } from '../types.js';

/**
 * Phase 1 (Eyes), texture dimensions (TEACHING-METHOD P1a–e). Texture is taught as separate
 * dimensions — pairedness, connectivity, suitedness, high-card class — rather than one gut
 * impression, because a single blurred label cannot be corrected later and the dimensions are
 * what actually move the decision.
 *
 * The three flops hold pairedness (unpaired), suitedness (rainbow), gap shape (1 then 2) and the
 * whole betting picture fixed, and walk one variable: the high card. Overpair availability is the
 * dimension beginners never see, so hero keeps the same pocket jacks while the flop's top card
 * moves them from clear of the board, to the exact boundary, to underneath it.
 */
export const boardTextureDimensions: Lesson = {
  id: 'board-texture-dimensions',
  phase: 1,
  title: 'Board texture dimensions',
  mechanism:
    'A flop reads dimension by dimension — pairedness, connectivity, suitedness, high-card class — and the high card sets how many pocket pairs are overpairs.',
  prerequisites: ['best-five-from-seven'],
  examples: [
    {
      id: 'seven-high-rainbow',
      hole: ['Jd', 'Jc'],
      board: ['7d', '6c', '4h'],
      street: 'flop',
      pot: 90,
      heroStack: 970,
      villainStacks: [940],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt: 'Read this flop one dimension at a time. How many pocket pairs sit above it?',
      reasoning:
        'Seven-high, unpaired and rainbow puts every pocket pair from eights upward above the board, so the jacks are far clear of it. No flush draw and no two-card straight exists on this shape. Say the high card first, then count the pairs above it.',
    },
    {
      id: 'ten-high-rainbow',
      hole: ['Jd', 'Jc'],
      board: ['Td', '9c', '7h'],
      street: 'flop',
      pot: 90,
      heroStack: 970,
      villainStacks: [940],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt: 'The gaps and the suits are unchanged. Where do the jacks sit against this flop?',
      reasoning:
        'Ten-high with the same gaps and the same rainbow lifts the overpair floor to jacks exactly. Four pocket pairs now beat the board instead of seven, and the jacks sit one card from being outclassed. Read the top card as the line that sorts pocket pairs.',
    },
    {
      id: 'king-high-rainbow',
      hole: ['Jd', 'Jc'],
      board: ['Kd', 'Qc', 'Th'],
      street: 'flop',
      pot: 90,
      heroStack: 970,
      villainStacks: [940],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt: 'Same shape again, higher cards. Which pocket pairs are still above this board?',
      reasoning:
        'King-high leaves aces as the only overpair, and the jacks now sit under two board cards. One dimension moved while pairedness, suitedness and the gaps held, so the holding changed meaning on its own. Check the high-card class before treating any pocket pair as strong.',
    },
  ],
  acceptanceKeywords: [
    'texture dimensions',
    'high-card class',
    'overpair availability',
    'pairedness',
    'connectivity',
    'suitedness',
    'which hands the board already beats',
  ],
};
