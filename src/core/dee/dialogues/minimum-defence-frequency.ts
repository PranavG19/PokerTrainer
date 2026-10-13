import type { DialogueScript } from '../dialogue.js';

/**
 * Minimum defence frequency, as a conversation. Three questions walk the arithmetic the lesson's own
 * reasoning states: the pot before the bet, the fold share the bet needs, and the share of the range that
 * must continue. Every number is a slot filled from the example (dialogue.ts exampleFacts), so the same
 * script runs on all three examples (half pot, pot, overbet) and each wrong answer is a REAL number from the
 * spot, aimed at a different question, with a question back that points at the right one.
 */
export const minimumDefenceFrequencyDialogue: DialogueScript = {
  lessonId: 'minimum-defence-frequency',
  steps: [
    {
      id: 'old-pot',
      ask: 'Start before the bet landed. What was in the pot then?',
      options: [
        { id: 'old', label: '{oldPot}', correct: true },
        { id: 'with-bet', label: '{pot}', correct: false, back: 'That pot already holds the bet of {toCall}. What sat there before it?' },
        { id: 'after-call', label: '{potAfterCall}', correct: false, back: 'That counts a call nobody has made. What was there before the bet?' },
      ],
      right: '{oldPot}. So the bet risks {toCall} to win the {oldPot} already there.',
    },
    {
      id: 'fold-share',
      ask: 'Risking {toCall} to win {oldPot}: how often must a bluff get a fold to break even?',
      options: [
        { id: 'alpha', label: '{betFoldShare}', correct: true },
        { id: 'defend', label: '{defendShare}', correct: false, back: 'That is the other side of the bet. What does it risk, out of the pot after it lands?' },
        { id: 'price', label: '{callPrice}', correct: false, back: 'That prices a call. Which number does the bettor risk, and against what?' },
      ],
      right: '{betFoldShare}. Fold more often than that and the bluff profits on the spot.',
    },
    {
      id: 'defend-share',
      ask: 'So what share of the defending range has to keep going?',
      options: [
        { id: 'mdf', label: '{defendShare}', correct: true },
        { id: 'alpha', label: '{betFoldShare}', correct: false, back: 'That is the fold the bluff needs. What is left of the range after those hands fold?' },
        { id: 'price', label: '{callPrice}', correct: false, back: 'That is the price of one call. Is this question about one hand, or the whole range?' },
      ],
      right: '{defendShare} of the range continues, and the bluff stops paying for itself.',
    },
  ],
};
