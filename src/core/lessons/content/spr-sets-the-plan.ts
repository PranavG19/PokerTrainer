import type { Lesson } from '../types.js';

/**
 * Phase 2, node F5. SPR is taught as a count of the raises the money allows, which is what turns
 * stack depth into a readable cue instead of a mode: one pot-sized bet per unit of SPR, so SPR 1
 * commits on this street and SPR 6 leaves a street the pair cannot pay for. The strength needed to
 * put the last chip in is a consequence of that count, not of the hand's name.
 *
 * One variable moves — the effective stack behind, 200 then 600 then 1200 — while the flop, the
 * hand, the pot and the position hold still, so the boundary where one pair stops being worth a
 * stack is the learner's own finding (story 19). Prompts ask what the ratio implies, never the
 * action (G5).
 */
export const sprSetsThePlan: Lesson = {
  id: 'spr-sets-the-plan',
  phase: 2,
  title: 'SPR sets the plan',
  mechanism:
    'The stack-to-pot ratio counts the raises the money allows, which decides how much hand strength a full commitment requires.',
  prerequisites: ['pot-odds-as-a-price'],
  examples: [
    {
      id: 'spr-one-top-pair',
      hole: ['Ac', 'Qh'],
      board: ['Qs', '8c', '3d'],
      street: 'flop',
      pot: 200,
      heroStack: 200,
      villainStacks: [200],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The pot is 200 on this flop and 200 sits behind. What does that ratio say about how far the hand can go?',
      reasoning:
        'With 200 behind and 200 in the middle, one pot-sized bet ends the hand. Top pair beats most of a calling range over a single street, so the stack can go in here. Divide the effective stack by the pot before choosing a plan.',
    },
    {
      id: 'spr-three-top-pair',
      hole: ['Ac', 'Qh'],
      board: ['Qs', '8c', '3d'],
      street: 'flop',
      pot: 200,
      heroStack: 600,
      villainStacks: [600],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The pot is 200 and 600 sits behind. How many streets of betting does that stack depth leave, and for which hands?',
      reasoning:
        'At 600 behind into 200, three bets of growing size use the stack up. Top pair can pay two streets, but the third street needs a better hand than one pair. Plan the streets the stack allows, then pick the hands that fit.',
    },
    {
      id: 'spr-six-top-pair',
      hole: ['Ac', 'Qh'],
      board: ['Qs', '8c', '3d'],
      street: 'flop',
      pot: 200,
      heroStack: 1200,
      villainStacks: [1200],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'The pot is 200 and 1200 sits behind. What does that depth ask of a hand before the stacks go in?',
      reasoning:
        'With 1200 behind into 200, the stack survives four raises, so one pair cannot cover the last one. Deep money rewards hands that improve to two pair, a set or a straight. Name the SPR first, then ask which hands want the extra streets.',
    },
  ],
  acceptanceKeywords: [
    'stack-to-pot ratio',
    'streets of betting the stack allows',
    'commitment threshold',
    'effective stack depth',
    'implied odds',
    'equity realisation',
  ],
};
