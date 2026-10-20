import { describe, expect, it } from 'vitest';
import { checkTutorOutput } from '../../src/main/tutor/guard.js';
import { slotsOf } from '../../src/core/dee/engine.js';
import { variantProblems } from '../../src/core/dee/strict.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { ARCHETYPE_NAMES } from '../../src/core/archetypes.js';
import { VENUES } from '../../src/core/story/cast.js';
import { STYLES } from '../../src/core/style.js';
import { PRINCIPLE_PHRASE, fillLetterLine } from '../../src/core/letters.js';
import { LETTER_BANK, LETTER_EVENTS, LETTER_SLOTS, LETTER_WORD_BUDGET, type LetterFacts } from '../../src/core/dee/letterBank.js';
import type { Facts } from '../../src/core/dee/types.js';
import { DEE_BANS, NUMBER_WORDS, request } from './deeLint.js';

/**
 * THE LETTER LINT: the line bank's checks (dee-bank.test.ts) over every sentence a letter can hold, in every tone, filled
 * with every value the engine can put in its named slots (each style name, each principle phrase, each venue).
 */

const BASE: Required<LetterFacts> = {
  hands: '24 hands',
  graded: '31 decisions',
  sheet: '4 decisions',
  focus: PRINCIPLE_PHRASE['pot odds'],
  riverCalls: '9 calls',
  riverRight: '6',
  foldRiver: '38%',
  foldRiverWas: '61%',
  assessLoss: '4.2 bb per 100 decisions',
  assessWas: '6.1',
  style: STYLES.closer.name,
  styleWas: STYLES.explorer.name,
  handsPct: '24%',
  leadPct: '71%',
  leak: PRINCIPLE_PHRASE['value or bluff'],
  venue: 'the Lighthouse',
  judged: '5 judged decisions',
  free: '4',
  shelf: '2 trophies',
  rule: 'the price is the call over the pot after I call',
  ruleDay: '3 Oct',
};

/** Every value a named slot can take, each tried in turn. */
const VARIANTS: Partial<Record<keyof LetterFacts, readonly string[]>> = {
  style: Object.values(STYLES).map((s) => s.name),
  styleWas: Object.values(STYLES).map((s) => s.name),
  focus: Object.values(PRINCIPLE_PHRASE),
  leak: Object.values(PRINCIPLE_PHRASE),
  venue: VENUES.map((v) => v.name.replace(/^The /, 'the ')),
  hands: ['1 hand'],
  graded: ['1 decision'],
  sheet: ['1 decision'],
  riverCalls: ['1 call'],
  shelf: ['1 trophy'],
  judged: ['1 judged decision'],
};

const wordCount = (t: string): number => t.trim().split(/\s+/).length;

function lint(text: string, facts: LetterFacts): string[] {
  const problems: string[] = [];
  if (/\d/.test(text)) problems.push('literal numeral in the template');
  if (NUMBER_WORDS.test(text)) problems.push(`number word: ${NUMBER_WORDS.exec(text)?.[0]}`);
  for (const [name, re] of DEE_BANS) if (re.test(text)) problems.push(`dee-ban:${name}: ${re.exec(text)?.[0]}`);
  const banned = bannedPhrasingIn(text);
  if (banned) problems.push(`banned:${banned}`);
  for (const id of ARCHETYPE_NAMES) if (new RegExp(`\\b${id}\\b`, 'i').test(text)) problems.push(`archetype id: ${id}`);
  for (const slot of slotsOf(text)) if (!(LETTER_SLOTS as readonly string[]).includes(slot)) problems.push(`unknown slot {${slot}}`);
  const filled = fillLetterLine(text, facts as Record<string, string>);
  if (filled === null) problems.push('does not render from its facts');
  else {
    if (wordCount(filled) > LETTER_WORD_BUDGET) problems.push(`${wordCount(filled)} words > ${LETTER_WORD_BUDGET}`);
    for (const [name, re] of DEE_BANS) if (re.test(filled)) problems.push(`filled dee-ban:${name}: ${re.exec(filled)?.[0]}`);
    const guard = checkTutorOutput({ text: filled, kind: 'correction' }, request(facts as Facts));
    for (const v of guard.violations) problems.push(`guard:${v.check}:${v.detail}`);
  }
  return problems;
}

describe('Dee letter bank: every line, every tone, every slot value', () => {
  const rows = LETTER_BANK.flatMap((line) =>
    [
      { tone: 'warm', text: line.text },
      ...(line.dry ? [{ tone: 'dry', text: line.dry }] : []),
      ...(line.blunt ? [{ tone: 'blunt', text: line.blunt }] : []),
    ].map((v) => ({ line, ...v })),
  );

  it('ids are unique and every event has a line', () => {
    const ids = LETTER_BANK.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of LETTER_EVENTS) expect(LETTER_BANK.some((l) => l.event === e), e).toBe(true);
  });

  it.each(rows.map((r) => [`${r.line.id} (${r.tone})`, r] as const))('%s passes the lint', (_n, { line, text }) => {
    const problems = lint(text, BASE);
    for (const slot of slotsOf(text)) {
      for (const value of VARIANTS[slot as keyof LetterFacts] ?? []) {
        for (const p of lint(text, { ...BASE, [slot]: value })) problems.push(`${slot}=${value}: ${p}`);
      }
    }
    if (text !== line.text) problems.push(...variantProblems(text, line.text).map((p) => `strict:${p}`));
    expect(problems).toEqual([]);
  });

  it('the letter filler never says a number no slot supplied', () => {
    expect(fillLetterLine('{hands}, not 40.', { hands: '24 hands' })).toBeNull();
    expect(fillLetterLine('{hands} this week.', {})).toBeNull();
    expect(fillLetterLine('{venue}, then.', { venue: 'the Lighthouse' })).toBe('The Lighthouse, then.');
  });
});

describe('style names and their copy stay neutral (G7)', () => {
  it('no style name or line makes a trait claim or trips a ban', () => {
    for (const s of Object.values(STYLES)) {
      for (const text of [s.name, s.how]) {
        expect(bannedPhrasingIn(text), text).toBeNull();
        for (const [name, re] of DEE_BANS) if (name !== 'you-subject') expect(re.test(text), `${name}: ${text}`).toBe(false);
      }
    }
  });
});
