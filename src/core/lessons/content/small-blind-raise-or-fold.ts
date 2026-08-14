import type { Lesson } from '../types.js';

/**
 * Phase 1. The small blind is the one seat that already has chips in and can complete for half a bet,
 * which tempts a beginner to limp "cheaply". The rule is the opposite: raise or fold, never limp. Out of
 * position for the whole hand with the big blind closing behind, a limp surrenders initiative and invites
 * a raise the completer must fold to — so the range splits cleanly into opens and folds, with no calling
 * band first-in. This is distinct from position-sets-your-range (which teaches open WIDTH by seat): here
 * the seat is fixed and the lesson is the raise-or-fold discipline itself.
 *
 * The examples hold the SB seat and move the hand across the app's own RFI boundary: isInRfiRange('K9o',
 * 'SB') === true (raise), ('Q9o','SB') === false and ('85o','SB') === false (fold) — verified against
 * preflop.ts, whose SB rule reads "Raise or fold only; never limp the small blind." Each spot is a
 * first-in decision folded to the SB (a live raise/fold the engine offers), and the prompt asks about
 * the plan, never the action, so the learner commits before the reveal (G5). No solver frequency is
 * used or implied.
 */
export const smallBlindRaiseOrFold: Lesson = {
  id: 'small-blind-raise-or-fold',
  phase: 1,
  title: 'The small blind: raise or fold, never limp',
  mechanism:
    'The small blind acts out of position all hand with the big blind behind, so a completed limp surrenders initiative — the range is raise-or-fold, never a call.',
  prerequisites: ['position-sets-your-range'],
  examples: [
    {
      id: 'k9o-open',
      hole: ['Kd', '9c'],
      board: [],
      street: 'preflop',
      pot: 30,
      heroStack: 1000,
      villainStacks: [1000],
      bb: 20,
      position: 'SB',
      toCall: 20,
      prompt:
        'Folded to the small blind with K-9 offsuit. Completing looks cheap — what is the plan with a hand worth playing here?',
      reasoning:
        'K-9 offsuit is inside the small-blind opening range, and limping it lets the big blind realise equity for free and take the initiative. Raising takes the pot down often and plays the flop as the aggressor. Open it, do not limp.',
    },
    {
      id: 'q9o-fold',
      hole: ['Qd', '9c'],
      board: [],
      street: 'preflop',
      pot: 30,
      heroStack: 1000,
      villainStacks: [1000],
      bb: 20,
      position: 'SB',
      toCall: 20,
      prompt:
        'Same spot with Q-9 offsuit, one rank weaker. The cheap completion still tempts — does this hand raise or fold?',
      reasoning:
        'Q-9 offsuit falls below the small-blind opening range, and completing only invites a raise it must fold to or a flop played out of position. The half-bet already in is not a reason to chase. Fold and give up the small blind cleanly.',
    },
    {
      id: '85o-fold',
      hole: ['8d', '5c'],
      board: [],
      street: 'preflop',
      pot: 30,
      heroStack: 1000,
      villainStacks: [1000],
      bb: 20,
      position: 'SB',
      toCall: 20,
      prompt:
        'Same spot with 8-5 offsuit — a hand that looks connected enough to "just see a flop". Which of the two plans fits it?',
      reasoning:
        'An offsuit eight-five flops weak pairs and dominated draws and is well below the small-blind opening range, so neither a raise nor a limp pays. Looking connected is not the same as being playable out of position. Fold and wait for a hand that can open.',
    },
  ],
  acceptanceKeywords: [
    'the small blind raises or folds, never limps',
    'a limp surrenders initiative out of position',
    'the big blind realises equity for free against a limp',
    'the half-bet in is not a reason to complete',
    'raise the hands worth playing and fold the rest',
  ],
};
