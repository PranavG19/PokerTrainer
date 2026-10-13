/**
 * Lessons as dialogue: Dee asks, the learner commits, and a wrong answer gets a question back, never a
 * grade. Generic over lessons: a script (dialogues/*.ts) is a list of steps whose numbers are SLOTS filled
 * from the lesson example's own fields (`exampleFacts`), so a script authors no number, and the same
 * script runs over every example of its lesson.
 *
 * Commit before feedback (G5): the reply to an answer is computed only by `commitAnswer`, after the
 * learner has committed it. `pendingStep` exposes the question and the options and nothing else, so a
 * renderer that draws only it cannot show a reply early.
 *
 * Pure: a state value in, a new state value out.
 */

import type { LessonExample } from '../lessons/types.js';
import { DEE_BANK } from './bank.js';
import { renderLine, selectLine } from './engine.js';
import type { DeePose, Facts, Line, Tone } from './types.js';

/** Facts a lesson example supplies. Every value is arithmetic on the example's own fields. */
export const LESSON_SLOTS = [
  'pot',
  'toCall',
  'oldPot',
  'potAfterCall',
  'callPrice',
  'betFoldShare',
  'defendShare',
] as const;
export type LessonSlot = (typeof LESSON_SLOTS)[number];
export type LessonFacts = Partial<Record<LessonSlot, string>>;

/**
 * A share as a natural frequency ("2 in 3"), the form the lessons teach (pot-odds-as-a-price), when it
 * reduces to a small denominator; otherwise a whole percentage.
 */
export function naturalFrequency(part: number, whole: number): string {
  if (!(whole > 0) || part < 0) return '';
  const g = gcd(Math.round(part), Math.round(whole));
  const n = Math.round(part) / g;
  const d = Math.round(whole) / g;
  if (Number.isInteger(n) && Number.isInteger(d) && d <= 12) return `${n} in ${d}`;
  return `${Math.round((part / whole) * 100)}%`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.max(1, a) : gcd(b, a % b);
}

/**
 * The example's numbers. `pot` includes the bet faced and `toCall` is hero's call (lessons/types.ts), so the
 * pot before the bet is pot − toCall, and after a call it is pot + toCall.
 */
export function exampleFacts(example: Pick<LessonExample, 'pot' | 'toCall'>): LessonFacts {
  const { pot, toCall } = example;
  const facts: LessonFacts = { pot: String(pot), toCall: String(toCall) };
  if (toCall > 0 && pot > toCall) {
    const oldPot = pot - toCall;
    facts.oldPot = String(oldPot);
    facts.potAfterCall = String(pot + toCall);
    facts.callPrice = naturalFrequency(toCall, pot + toCall);
    facts.betFoldShare = naturalFrequency(toCall, pot);
    facts.defendShare = naturalFrequency(oldPot, pot);
  }
  return facts;
}

export interface DialogueOption {
  readonly id: string;
  /** Template: the answer as the learner commits it, usually one slot. */
  readonly label: string;
  readonly correct: boolean;
  /** For a wrong option: Dee's question back. Must end in a question mark. */
  readonly back?: string;
}

export interface DialogueStep {
  readonly id: string;
  /** Dee's question. Ends in a question mark; ≤ 20 words. */
  readonly ask: string;
  readonly options: readonly DialogueOption[];
  /** Dee's line after the right answer, usually restating it with the next fact. */
  readonly right: string;
}

export interface DialogueScript {
  readonly lessonId: string;
  readonly steps: readonly DialogueStep[];
}

export type Turn =
  | { readonly who: 'dee'; readonly text: string; readonly pose: DeePose; readonly lineId: string }
  | { readonly who: 'you'; readonly text: string; readonly optionId: string; readonly right: boolean };

export interface DialogueState {
  readonly lessonId: string;
  readonly stepIndex: number;
  /** Wrong options already tried on the current step (each is shown as tried, and cannot be re-picked). */
  readonly tried: readonly string[];
  readonly thread: readonly Turn[];
  readonly done: boolean;
}

/** One option, filled. Options whose label equals the correct answer's are dropped (they could not be wrong). */
export interface ShownOption {
  readonly id: string;
  readonly label: string;
  readonly tried: boolean;
}

function fill(template: string, facts: LessonFacts): string | null {
  return renderLine(template, facts as Facts);
}

/** The options a step shows for these facts, or null if a slot is missing (the step cannot run). */
export function optionsFor(step: DialogueStep, facts: LessonFacts, tried: readonly string[] = []): ShownOption[] | null {
  const right = step.options.find((o) => o.correct);
  if (!right) return null;
  const rightLabel = fill(right.label, facts);
  if (rightLabel === null) return null;
  const out: ShownOption[] = [];
  const seen = new Set<string>();
  for (const o of step.options) {
    const label = fill(o.label, facts);
    if (label === null) return null;
    if (!o.correct && label === rightLabel) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ id: o.id, label, tried: tried.includes(o.id) });
  }
  return out;
}

/** True when every step of the script can be filled for this example. */
export function scriptRuns(script: DialogueScript, facts: LessonFacts): boolean {
  return script.steps.every((s) => fill(s.ask, facts) !== null && fill(s.right, facts) !== null && optionsFor(s, facts) !== null);
}

function dee(text: string, pose: DeePose, lineId: string): Turn {
  return { who: 'dee', text, pose, lineId };
}

/** A generic bank line for a lesson moment, seeded by step so a replay reads the same. */
function bankLine(
  kind: 'lesson-open' | 'lesson-retry' | 'lesson-done',
  tone: Tone,
  seed: number,
  bank: readonly Line[],
  character = true,
): Turn | null {
  // Character off: Dee's own voice goes; the script's questions, which are the lesson, stay.
  if (!character) return null;
  const line = selectLine({ kind, facts: {} }, { tone, quietness: 1, character: true }, { handsWatched: 0, said: [] }, seed, bank);
  return line ? dee(line.text, line.pose, line.lineId) : null;
}

export function startDialogue(
  script: DialogueScript,
  facts: LessonFacts,
  opts: { tone: Tone; seed: number; bank?: readonly Line[]; character?: boolean },
): DialogueState {
  const thread: Turn[] = [];
  const open = bankLine('lesson-open', opts.tone, opts.seed, opts.bank ?? DEE_BANK, opts.character);
  if (open) thread.push(open);
  const first = script.steps[0];
  const ask = first ? fill(first.ask, facts) : null;
  if (first && ask !== null) thread.push(dee(ask, 'listening', `${script.lessonId}:${first.id}:ask`));
  return { lessonId: script.lessonId, stepIndex: 0, tried: [], thread, done: script.steps.length === 0 };
}

/** The question waiting for a commit: what to draw, and nothing that answers it. */
export function pendingStep(
  script: DialogueScript,
  state: DialogueState,
  facts: LessonFacts,
): { stepId: string; options: ShownOption[] } | null {
  if (state.done) return null;
  const step = script.steps[state.stepIndex];
  if (!step) return null;
  const options = optionsFor(step, facts, state.tried);
  return options ? { stepId: step.id, options } : null;
}

/**
 * Commit one answer. A right answer gets Dee's `right` line and moves on (or finishes); a wrong one gets
 * the option's question back and the step stays open with that option marked tried. Committing an option
 * already tried, or after the end, changes nothing.
 */
export function commitAnswer(
  script: DialogueScript,
  state: DialogueState,
  facts: LessonFacts,
  optionId: string,
  opts: { tone: Tone; seed: number; bank?: readonly Line[]; character?: boolean },
): DialogueState {
  if (state.done) return state;
  const step = script.steps[state.stepIndex];
  const shown = step ? optionsFor(step, facts, state.tried) : null;
  const picked = shown?.find((o) => o.id === optionId);
  const option = step?.options.find((o) => o.id === optionId);
  if (!step || !shown || !picked || picked.tried || !option) return state;

  const thread: Turn[] = [...state.thread, { who: 'you', text: picked.label, optionId, right: option.correct }];
  if (!option.correct) {
    const back = option.back ? fill(option.back, facts) : null;
    const reply = back !== null ? dee(back, 'thinking', `${script.lessonId}:${step.id}:${option.id}:back`) : bankLine('lesson-retry', opts.tone, opts.seed + state.thread.length, opts.bank ?? DEE_BANK, opts.character);
    if (reply) thread.push(reply);
    return { ...state, tried: [...state.tried, optionId], thread };
  }

  const right = fill(step.right, facts);
  if (right !== null) thread.push(dee(right, 'rest', `${script.lessonId}:${step.id}:right`));
  const nextIndex = state.stepIndex + 1;
  const next = script.steps[nextIndex];
  if (!next) {
    const done = bankLine('lesson-done', opts.tone, opts.seed + nextIndex, opts.bank ?? DEE_BANK, opts.character);
    if (done) thread.push(done);
    return { ...state, stepIndex: nextIndex, tried: [], thread, done: true };
  }
  const ask = fill(next.ask, facts);
  if (ask !== null) thread.push(dee(ask, 'listening', `${script.lessonId}:${next.id}:ask`));
  return { ...state, stepIndex: nextIndex, tried: [], thread };
}
