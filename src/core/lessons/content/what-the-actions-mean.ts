import type { Lesson } from '../types.js';

/**
 * Phase 0. The five actions are taught as *what each one buys*, not as a list of buttons, because
 * a beginner who has memorised the list still cannot say why folding a free card is a mistake or
 * why an oversized bet deletes two of the buttons.
 *
 * The three examples walk one variable — the chips in front of hero — across the three values that
 * change the menu itself: nothing (check or bet), a bet inside the stack (fold, call, raise), and a
 * bet larger than the stack (fold or all-in). Pot moves only as a consequence of that one dial: the
 * pot before the bet is 120 in all three. Each `prompt` asks which actions exist, never which one
 * to take, so the learner commits before `reasoning` is visible (G5, story 12).
 */
export const whatTheActionsMean: Lesson = {
  id: 'what-the-actions-mean',
  phase: 0,
  title: 'What the actions mean',
  mechanism:
    'Fold, check, call, bet and raise differ in what each buys: nothing risked, a free look, a price paid, or chips that can win the pot uncontested.',
  prerequisites: [],
  examples: [
    {
      id: 'nothing-in-front',
      hole: ['Ah', 'Qs'],
      board: ['Kd', '9c', '4h'],
      street: 'flop',
      pot: 120,
      heroStack: 200,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 0,
      prompt: 'Nothing is in front of this hand on the flop: which actions exist, and what does each one cost?',
      reasoning:
        'Checking passes the action along and costs nothing, keeping every chip and the current pot intact. Betting puts chips in that a fold can win uncontested, and folding here throws away a free card. Name the price in front of the hand before choosing an action.',
    },
    {
      id: 'bet-inside-the-stack',
      hole: ['Ah', 'Qs'],
      board: ['Kd', '9c', '4h'],
      street: 'flop',
      pot: 180,
      heroStack: 200,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 60,
      prompt: 'A bet of 60 makes the pot 180. Which actions are on the menu now, and what does each cost?',
      reasoning:
        'The 60 buys the next card and a claim on 240, which is what folding gives up for nothing. Raising adds chips beyond 60 and asks the bettor to pay again or surrender the pot. Read the number in front of the hand first, then pick from fold, call, raise.',
    },
    {
      id: 'bet-over-the-stack',
      hole: ['Ah', 'Qs'],
      board: ['Kd', '9c', '4h'],
      street: 'flop',
      pot: 360,
      heroStack: 200,
      villainStacks: [900],
      bb: 20,
      position: 'BTN',
      toCall: 240,
      prompt: 'The bet is 240 and this stack holds 200. Which actions remain, and where do the extra 40 chips go?',
      reasoning:
        'A bet larger than the stack removes calling and raising from the menu: 200 goes in or nothing does. All-in commits every chip, and the extra 40 stays with the bettor rather than the pot. Compare the bet against the stack before hunting for a raise size.',
    },
  ],
  acceptanceKeywords: [
    'what each action buys',
    'the price in front of the hand',
    'chips committed',
    'winning the pot uncontested',
    'the bet size sets the menu',
    'a free look at the next card',
  ],
};
