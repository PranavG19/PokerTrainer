import type { Lesson } from '../types.js';

/**
 * Phase 1. The master preflop variable: the SEAT decides how wide you open, so the same hand is a fold
 * from an early seat and an open from a late one. This is the "memorise preflop" foundation — the app
 * drills it in Charts, but no lesson had ever taught the idea behind it.
 *
 * The examples hold ONE hand fixed — Q9o — and move only the seat, which is the whole lesson: Q9o is a
 * FOLD in the cutoff and an OPEN on the button. That flip is a rule-stated fact, verified against the
 * app's own RFI rule (isInRfiRange(Q9o,'CO') === false, isInRfiRange(Q9o,'BTN') === true) — no solver
 * data, no fabrication. Each spot is a first-in decision facing the big blind (toCall = bb), so the
 * engine offers a real continue/raise decision; the `prompt` asks about the seat, never the action, so
 * the learner commits before `reasoning` is visible (G5, story 12).
 *
 * The reasoning lines are drawn from POSITION_RULES in preflop.ts (CO: "fold below those"; BTN: "K8o,
 * Q9o, J9o, T9o, 98o" open), so the lesson and the chart teach the identical frontier.
 */
export const positionSetsYourRange: Lesson = {
  id: 'position-sets-your-range',
  phase: 1,
  title: 'Position sets your opening range',
  mechanism:
    'The later your seat, the fewer players act behind you, so the same hand folds early and opens on the button — the seat sets how wide you open.',
  prerequisites: ['betting-order-and-position'],
  examples: [
    {
      id: 'q9o-cutoff-fold',
      hole: ['Qs', '9d'],
      board: [],
      street: 'preflop',
      pot: 30,
      heroStack: 1000,
      villainStacks: [1000],
      bb: 20,
      position: 'CO',
      toCall: 20,
      prompt:
        'Folded to you in the cutoff with Q9 offsuit. How many seats act behind you, and which way does that push the range?',
      reasoning:
        'Two seats still act behind the cutoff, so the opening range stays disciplined: offsuit needs A9o, KTo, QTo or JTo, and Q9o falls below that line. The seat, not the hand, is what removes it. From the cutoff, fold Q9o first in.',
    },
    {
      id: 'q9o-button-open',
      hole: ['Qs', '9d'],
      board: [],
      street: 'preflop',
      pot: 30,
      heroStack: 1000,
      villainStacks: [1000],
      bb: 20,
      position: 'BTN',
      toCall: 20,
      prompt:
        'Same Q9 offsuit, now folded to you on the button. How many seats act behind you now, and which way does that push the range?',
      reasoning:
        'Only the two blinds act behind the button, so the opening range widens: the offsuit frontier reaches K8o, Q9o, J9o, T9o and 98o. The identical hand that folded in the cutoff now opens. On the button, open Q9o first in.',
    },
  ],
  acceptanceKeywords: [
    'the seat sets how wide you open',
    'fewer players act behind a later seat',
    'the same hand folds early and opens late',
    'position not the hand decides the open',
    'the button opens the widest range',
  ],
};
