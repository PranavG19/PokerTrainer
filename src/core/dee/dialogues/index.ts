import type { DialogueScript } from '../dialogue.js';
import { minimumDefenceFrequencyDialogue } from './minimum-defence-frequency.js';

/**
 * Lessons that run as a dialogue, by lesson id. Converting another lesson is one script file plus one line
 * here; the lesson screen and the engine need no change. A lesson with no script keeps its commit box.
 * tests/unit/dee-dialogue.test.ts checks every script runs on every example of its lesson and lints its
 * lines like the bank.
 */
export const DIALOGUES: Readonly<Record<string, DialogueScript>> = {
  [minimumDefenceFrequencyDialogue.lessonId]: minimumDefenceFrequencyDialogue,
};

export function dialogueFor(lessonId: string): DialogueScript | undefined {
  return Object.hasOwn(DIALOGUES, lessonId) ? DIALOGUES[lessonId] : undefined;
}
