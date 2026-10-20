import { describe, expect, it } from 'vitest';
import { checkTutorOutput } from '../../src/main/tutor/guard.js';
import { renderLine, slotsOf } from '../../src/core/dee/engine.js';
import { variantProblems } from '../../src/core/dee/strict.js';
import { exampleFacts, LESSON_SLOTS, optionsFor, scriptRuns } from '../../src/core/dee/dialogue.js';
import type { Facts } from '../../src/core/dee/types.js';
import { lessonById } from '../../src/core/lessons/index.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { ARCHETYPE_NAMES } from '../../src/core/archetypes.js';
import { KITCHEN, LEAK_LABELS, MASQUERADE, RIVALS, VENUES } from '../../src/core/story/cast.js';
import { CHAPTER_SCRIPTS, KITCHEN_SCRIPT, STORY_LINES, STORY_SLOTS, STORY_WORD_BUDGET, WORD_ANSWERS, type StoryEvent, type StoryFacts } from '../../src/core/story/scripts.js';
import { BOSS_HANDS, answerBoss, pendingAsk, startBoss } from '../../src/core/story/boss.js';
import { KEEPSAKES } from '../../src/core/story/keepsakes.js';
import { MASKS, READ_LABELS } from '../../src/core/story/masquerade.js';
import type { DialogueScript } from '../../src/core/dee/dialogue.js';
import { DEE_BANS, NUMBER_WORDS, request } from './deeLint.js';

/**
 * THE STORY LINT: the same checks as Dee's bank (dee-bank.test.ts) over every word the Long Orbit says.
 * Story lines in every tone, the chapter dialogue beats on their lesson examples, the rivals' own lines and
 * the venue copy.
 */

const FIXTURE: Required<StoryFacts> = {
  rival: 'Percival',
  focus: LEAK_LABELS['over-fold'],
  judged: '5',
  free: '4',
  bigBets: '6',
  bluffs: '3',
  calls: '4',
  thin: '3',
  bets: '7',
  strong: '2',
  keepsake: 'The wick',
  needs: '7',
  mask: 'Fox',
};

const wordCount = (t: string): number => t.trim().split(/\s+/).length;

function lint(text: string, facts: Facts, budget: number, question: boolean): string[] {
  const problems: string[] = [];
  if (/\d/.test(text)) problems.push('literal numeral in the template');
  if (NUMBER_WORDS.test(text)) problems.push(`number word: ${NUMBER_WORDS.exec(text)?.[0]}`);
  for (const [name, re] of DEE_BANS) if (re.test(text)) problems.push(`dee-ban:${name}: ${re.exec(text)?.[0]}`);
  const banned = bannedPhrasingIn(text);
  if (banned) problems.push(`banned:${banned}`);
  for (const id of ARCHETYPE_NAMES) if (new RegExp(`\\b${id}\\b`, 'i').test(text)) problems.push(`archetype id: ${id}`);
  const filled = renderLine(text, facts);
  if (filled === null) problems.push('does not render from its facts');
  else {
    if (wordCount(filled) > budget) problems.push(`${wordCount(filled)} words > ${budget}`);
    const guard = checkTutorOutput({ text: filled, kind: question ? 'question' : 'correction' }, request(facts));
    for (const v of guard.violations) problems.push(`guard:${v.check}:${v.detail}`);
  }
  return problems;
}

describe('story lines: every line, every tone', () => {
  const rows = STORY_LINES.flatMap((line) =>
    [
      { tone: 'warm', text: line.text },
      ...(line.dry ? [{ tone: 'dry', text: line.dry }] : []),
      ...(line.blunt ? [{ tone: 'blunt', text: line.blunt }] : []),
    ].map((v) => ({ line, ...v })),
  );

  it('ids are unique', () => {
    const ids = STORY_LINES.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(rows.map((r) => [`${r.line.id} (${r.tone})`, r] as const))('%s passes the lint', (_n, { line, text }) => {
    const problems = lint(text, FIXTURE as Facts, STORY_WORD_BUDGET[line.event], text.trim().endsWith('?'));
    for (const slot of slotsOf(text)) if (!(STORY_SLOTS as readonly string[]).includes(slot)) problems.push(`unknown slot {${slot}}`);
    if (text !== line.text) problems.push(...variantProblems(text, line.text).map((p) => `strict:${p}`));
    // D6: "Price held" (its words and its pose) belongs to a close spot played right, never a count of free decisions.
    if (/held the price|price held/i.test(text)) problems.push('D6: price-held wording outside the price-held beat');
    if (line.pose === 'price-held') problems.push('D6: the price-held pose outside the price-held beat');
    expect(problems).toEqual([]);
  });

  it('every venue has an intro, and every shared moment has a line', () => {
    for (const v of VENUES) expect(STORY_LINES.some((l) => l.event === 'intro' && l.venue === v.id), v.id).toBe(true);
    const shared: StoryEvent[] = [
      'intro-personal', 'debrief-met', 'debrief-met-again', 'debrief-short', 'debrief-unjudged',
      'take-bluffs-high', 'take-bluffs-low', 'take-thin-high', 'take-thin-low', 'take-strong-high',
      'take-strong-low', 'take-baseline', 'take-none', 'kitchen-intro', 'boss-clean', 'boss-again', 'masq-intro',
      'masq-pencil', 'masq-fit', 'masq-not-fit', 'masq-done',
    ];
    for (const e of shared) expect(STORY_LINES.some((l) => l.event === e), e).toBe(true);
  });
});

describe('chapter dialogue beats: lint, and every one runs on its lesson example', () => {
  const beats: { id: string; script: DialogueScript; beat: { lessonId: string; exampleIndex: number } }[] = [
    { id: KITCHEN.id, script: KITCHEN_SCRIPT, beat: KITCHEN.beat },
    ...VENUES.map((v) => ({ id: v.id, script: CHAPTER_SCRIPTS[v.id], beat: v.beat })),
  ];
  for (const venue of beats) {
    const script = venue.script;
    it(`${venue.id}: runs on ${venue.beat.lessonId} example ${venue.beat.exampleIndex}, and every line passes`, () => {
      expect(script.lessonId).toBe(venue.beat.lessonId);
      const example = lessonById(venue.beat.lessonId)?.examples[venue.beat.exampleIndex];
      expect(example, 'the beat names a real lesson example').toBeDefined();
      const facts = exampleFacts(example!);
      expect(scriptRuns(script, facts)).toBe(true);
      for (const step of script.steps) {
        expect(step.options.filter((o) => o.correct)).toHaveLength(1);
        // At least two answers survive the dedupe, or the step is not a question.
        expect(optionsFor(step, facts)!.length, `${step.id} options`).toBeGreaterThanOrEqual(2);
        const templates: { where: string; text: string; question: boolean }[] = [
          { where: 'ask', text: step.ask, question: true },
          { where: 'right', text: step.right, question: false },
        ];
        for (const o of step.options) {
          const slotOnly = /^(\{[a-zA-Z]+\}\s*)+$/.test(o.label);
          expect(slotOnly || (WORD_ANSWERS as readonly string[]).includes(o.label), `${step.id}.${o.id} label`).toBe(true);
          if (!o.correct) {
            expect(o.back, `${step.id}.${o.id} has a question back`).toBeDefined();
            templates.push({ where: `${o.id}.back`, text: o.back ?? '', question: true });
          }
        }
        for (const t of templates) {
          const problems = lint(t.text, facts as Facts, 20, t.question);
          for (const slot of slotsOf(t.text)) if (!(LESSON_SLOTS as readonly string[]).includes(slot)) problems.push(`slot {${slot}}`);
          if (t.question && !t.text.trim().endsWith('?')) problems.push('not a question');
          expect(problems, `${step.id}.${t.where}`).toEqual([]);
        }
      }
    });
  }
});

describe('boss hands: every ask, answer and question back, filled from the engine at its decision', () => {
  for (const boss of BOSS_HANDS) {
    it(`${boss.id}: passes the lint`, () => {
      // The setup and Dee's reveal carry no slot at all.
      for (const [where, text] of [['setup', boss.setup], ['reveal', boss.reveal]] as const) {
        expect(lint(text, {}, 24, false), `${boss.id}.${where}`).toEqual([]);
      }
      let run = startBoss(boss);
      for (let guard = 0; guard < 20 && !run.done; guard++) {
        const p = pendingAsk(run);
        if (!p) break;
        const templates = [
          { where: 'ask', text: p.ask.ask, question: true },
          { where: 'right', text: p.ask.right, question: false },
          ...Object.entries(p.ask.back).map(([k, text]) => ({ where: `back.${k}`, text: text ?? '', question: true })),
        ];
        for (const t of templates) {
          const problems = lint(t.text, p.facts as Facts, 24, t.question);
          for (const slot of slotsOf(t.text)) if (!(LESSON_SLOTS as readonly string[]).includes(slot)) problems.push(`slot {${slot}}`);
          if (t.question && !t.text.trim().endsWith('?')) problems.push('not a question');
          expect(problems, `${p.ask.id}.${t.where}`).toEqual([]);
        }
        run = answerBoss(run, p.ask.correct);
      }
    });
  }
});

describe('the rest of the orbit’s words', () => {
  it('rival lines and venue copy carry no number, no ban-list phrase and no archetype id', () => {
    const copy = [
      ...Object.values(RIVALS).flatMap((r) => [r.name, r.title, r.style, r.unmaskLine]),
      ...VENUES.flatMap((v) => [v.name, v.cluster, v.place, v.lesson]),
      ...Object.values(LEAK_LABELS),
      KITCHEN.name, KITCHEN.cluster, KITCHEN.place, KITCHEN.lesson,
      MASQUERADE.name, MASQUERADE.place, MASQUERADE.lesson,
      ...BOSS_HANDS.flatMap((b) => [b.title, b.setup, b.reveal]),
      ...KEEPSAKES.flatMap((k) => [k.name, k.short, k.fact]),
      ...MASKS,
      ...Object.values(READ_LABELS).flatMap((r) => [r.label, r.unit, r.counted]),
    ];
    for (const text of copy) {
      const problems: string[] = [];
      if (/\d/.test(text)) problems.push('numeral');
      const banned = bannedPhrasingIn(text);
      if (banned) problems.push(`banned:${banned}`);
      for (const id of ARCHETYPE_NAMES) if (new RegExp(`\\b${id}\\b`, 'i').test(text)) problems.push(`archetype id: ${id}`);
      for (const [name, re] of DEE_BANS) if (name !== 'you-subject' && re.test(text)) problems.push(`dee-ban:${name}`);
      expect(problems, text).toEqual([]);
    }
  });
});
