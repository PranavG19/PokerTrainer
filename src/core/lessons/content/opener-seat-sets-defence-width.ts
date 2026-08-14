import type { Lesson } from '../types.js';

/**
 * Phase 1. defend-the-big-blind teaches the price against ONE opener (the button). This lesson holds the
 * seat fixed at the big blind and moves the other variable a beginner ignores: WHO opened. An early raise
 * carries a tight, strong range, so the defence stays narrow; a button raise is wide, so the defence widens.
 *
 * The hand is held fixed across the two contrasting opens to isolate the variable: defenseAction('KTo',
 * 'bb-vs-utg') === 'fold' but defenseAction('KTo','bb-vs-btn') === 'call' — the same holding crosses the
 * boundary purely because the opener changed. The control example uses defenseAction('KQo','bb-vs-utg') ===
 * 'call' — a hand strong enough to defend even the tightest open. All three verified against preflop.ts.
 * The opener seat is narrative; the hero always faces a big-blind continue decision (board=[], toCall>0),
 * and each prompt asks about the range, never the action, so the learner commits before the reveal (G5).
 */
export const openerSeatSetsDefenceWidth: Lesson = {
  id: 'opener-seat-sets-defence-width',
  phase: 1,
  title: 'Who opened sets how wide you defend',
  mechanism:
    'The earlier a raise comes the tighter its range, so the big blind defends narrow against an early open and wide against a late one.',
  prerequisites: ['defend-the-big-blind'],
  examples: [
    {
      id: 'kto-vs-utg-fold',
      hole: ['Kd', 'Tc'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'An early-position raise reaches the big blind holding K-10 offsuit. How wide is the defence against the tightest opening range?',
      reasoning:
        'An early raise shows a tight, strong range, so the big blind defends only hands that hold up against it. K-10 offsuit is dominated by much of that range and folds here. Save the chips for a stronger holding.',
    },
    {
      id: 'kto-vs-btn-call',
      hole: ['Kd', 'Tc'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'The button opens and the action folds to the big blind with the same K-10 offsuit. Does the wider range now include it?',
      reasoning:
        'A button open covers many weak hands, so the big blind defends far wider and this holding clears the bar. K-10 offsuit flops pairs and straights against that broad range. Call and play a flop with position to improve.',
    },
    {
      id: 'kqo-vs-utg-call',
      hole: ['Kd', 'Qc'],
      board: [],
      street: 'preflop',
      pot: 80,
      heroStack: 980,
      villainStacks: [960],
      bb: 20,
      position: 'BB',
      toCall: 30,
      prompt:
        'The same early-position raise, now holding K-Q offsuit. Does a hand this strong defend even against the tightest open?',
      reasoning:
        'K-Q offsuit dominates much of an early range and makes strong top pairs, so it defends against even the tightest open. The narrow defence still keeps its best hands. Call and continue with a holding that flops well.',
    },
  ],
  acceptanceKeywords: [
    'an earlier raise carries a tighter range',
    'defend narrow against an early open',
    'defend wide against a late open',
    'the opener seat sets the defence width',
    'strong hands defend against even the tightest open',
  ],
};
