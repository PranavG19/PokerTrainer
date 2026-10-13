import { describe, expect, it } from 'vitest';
import {
  commitAnswer,
  exampleFacts,
  naturalFrequency,
  pendingStep,
  startDialogue,
  type DialogueScript,
} from '../../src/core/dee/dialogue.js';
import { DIALOGUES, dialogueFor } from '../../src/core/dee/dialogues/index.js';
import { lessonById } from '../../src/core/lessons/index.js';

const OPTS = { tone: 'warm' as const, seed: 4 };
const script = dialogueFor('minimum-defence-frequency') as DialogueScript;
const lesson = lessonById('minimum-defence-frequency')!;

describe('lesson facts', () => {
  it('natural frequencies reduce, and fall back to a percentage', () => {
    expect(naturalFrequency(200, 300)).toBe('2 in 3');
    expect(naturalFrequency(100, 400)).toBe('1 in 4');
    expect(naturalFrequency(37, 100)).toBe('37%');
  });

  it('every number is arithmetic on the example’s own fields', () => {
    const f = exampleFacts(lesson.examples[0]);
    expect(f).toEqual({ pot: '300', toCall: '100', oldPot: '200', potAfterCall: '400', callPrice: '1 in 4', betFoldShare: '1 in 3', defendShare: '2 in 3' });
    // The lesson's own reasoning states the same two shares.
    expect(lesson.examples[0].reasoning).toContain('1 hand in 3');
    expect(lesson.examples[0].reasoning).toContain('2 hands in 3');
  });
});

describe('Dee asks, you commit, a wrong answer gets a question back', () => {
  const facts = exampleFacts(lesson.examples[0]);

  it('opens with a question, and nothing that answers it', () => {
    const s = startDialogue(script, facts, OPTS);
    const last = s.thread[s.thread.length - 1];
    expect(last.who).toBe('dee');
    expect(last.text.endsWith('?')).toBe(true);
    const pending = pendingStep(script, s, facts);
    expect(pending?.options.map((o) => o.label).sort()).toEqual(['200', '300', '400']);
    // Commit before feedback: no reply line exists until an answer is committed.
    expect(s.thread.some((t) => t.who === 'dee' && t.lineId.endsWith(':right'))).toBe(false);
  });

  it('a wrong answer gets a question back, no grade, and the step stays open', () => {
    let s = startDialogue(script, facts, OPTS);
    s = commitAnswer(script, s, facts, 'with-bet', OPTS);
    const reply = s.thread[s.thread.length - 1];
    expect(reply.who).toBe('dee');
    expect(reply.text.endsWith('?')).toBe(true);
    expect(reply.text.toLowerCase()).not.toMatch(/\b(wrong|incorrect|right|correct|good|nice)\b/);
    expect(s.stepIndex).toBe(0);
    expect(pendingStep(script, s, facts)?.options.find((o) => o.id === 'with-bet')?.tried).toBe(true);
    // Re-committing a tried option changes nothing.
    expect(commitAnswer(script, s, facts, 'with-bet', OPTS)).toBe(s);
  });

  it('right answers walk the steps and finish with Dee’s closing line', () => {
    let s = startDialogue(script, facts, OPTS);
    for (const id of ['old', 'alpha', 'mdf']) s = commitAnswer(script, s, facts, id, OPTS);
    expect(s.done).toBe(true);
    const text = s.thread.map((t) => t.text).join(' ');
    expect(text).toContain('2 in 3');
    expect(text).toContain('1 in 3');
    expect(pendingStep(script, s, facts)).toBeNull();
  });

  it('a distractor that equals the right answer is dropped (the pot-sized example)', () => {
    const f = exampleFacts(lesson.examples[1]);
    let s = startDialogue(script, f, OPTS);
    s = commitAnswer(script, s, f, 'old', OPTS);
    expect(pendingStep(script, s, f)?.options.map((o) => o.label)).toEqual(['1 in 2', '1 in 3']);
  });

  it('every registered script names a registered lesson', () => {
    for (const id of Object.keys(DIALOGUES)) expect(lessonById(id)).toBeDefined();
    expect(dialogueFor('pot-odds-as-a-price')).toBeUndefined();
    expect(dialogueFor('__proto__')).toBeUndefined();
  });
});
