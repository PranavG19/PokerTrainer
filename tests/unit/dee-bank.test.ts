import { describe, expect, it } from 'vitest';
import { checkTutorOutput } from '../../src/main/tutor/guard.js';
import type { StrategyRequest, TutorOutputKind } from '../../src/main/tutor/types.js';
import { DEE_BANK } from '../../src/core/dee/bank.js';
import { EVENT_KINDS, selectLine, slotsOf, renderLine } from '../../src/core/dee/engine.js';
import { variantProblems } from '../../src/core/dee/strict.js';
import { DIALOGUES } from '../../src/core/dee/dialogues/index.js';
import { exampleFacts, LESSON_SLOTS, scriptRuns } from '../../src/core/dee/dialogue.js';
import { lessonById } from '../../src/core/lessons/index.js';
import {
  SLOTS,
  TONES,
  WORD_BUDGET,
  type DeeAction,
  type DeeEvent,
  type Facts,
  type Line,
  type Principle,
  type Slot,
  type Tone,
} from '../../src/core/dee/types.js';

/**
 * THE BANK LINT. Every line Dee can say, in every tone, on every CI run. A line fails if:
 *  - the tutor guard rejects it once filled (word count, ban list, number provenance, leading pronoun);
 *  - it trips Dee's own ban list (the personality bible's "never says");
 *  - it writes a numeral or a spelled-out number itself (Dee phrases; the engine owns every number);
 *  - it uses a slot its event cannot supply, or a slot not in the vocabulary;
 *  - it is over its surface's word budget;
 *  - a tone variant flips polarity, reorders or drops a slot, adds an action, or drops a question (STRICT).
 * And the bank must cover every grade the coach can produce, in every tone.
 */

/** Values that look like engine output, so the guard's provenance check has real numerals to test. */
const FIXTURE: Required<Facts> = {
  reqPct: '25%',
  sharePct: '74%',
  evLossBb: '2.9',
  toCall: '75',
  pot: '225',
  repeat: '3',
  hands: '24',
  mistakes: '4',
  priceHeld: '2',
  rule: 'the price is the call over the pot after I call',
};

function request(facts: Facts): StrategyRequest {
  return {
    kind: 'strategy',
    prompt: JSON.stringify(facts),
    table: { positions: [], stacksBb: [], potBb: 0, board: [], heroCards: [], toAct: '', street: 'river' },
  } as unknown as StrategyRequest;
}

/** The personality bible's "never says", beyond what the guard already bans. */
const DEE_BANS: readonly [string, RegExp][] = [
  ['luck', /\b(?:luck|lucky|unlucky|fortunate|variance gods|run (?:good|bad|hot|cold)|hot run|cold run|due)\b/i],
  // "to win" is price arithmetic ("risks 100 to win 200"); every other win/lose word is an outcome.
  ['outcome', /\b(?:won|winning|lost|lose|loses|losing|scoop(?:ed)?|ship it)\b|(?<!\bto )\bwins?\b/i],
  ['one-more', /\bone more hand\b/i],
  ['comparison', /\b(?:other players|most players|everyone|percentile|than most|better than you|ranked)\b/i],
  ['absence-guilt', /\b(?:miss(?:ed)? you|where were you|been a while|come back|sorry|streak|days?)\b/i],
  ['trait', /\b(?:natural|talent(?:ed)?|gifted|genius|smart|clever|stupid|idiot|bad at|good at|a (?:tight|loose|passive|aggressive) player)\b/i],
  ['praise', /\b(?:brilliant|amazing|fantastic|superb|lovely|nicely|bravo|wonderful|proud|terrific|outstanding)\b/i],
  ['you-subject', /\byou(?:'ll|’ll| will| should| need| must| did| made)\b/i],
  ['gambling', /\b(?:jackpot|cash|money|dollars?|\$|bankroll|casino)\b/i],
];

const NUMBER_WORDS = /\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|thirty|forty|fifty|hundred|thousand|once|twice|half a dozen|dozen)\b/i;

/** Slots each event can supply (engine.ts handEndEvent / sessionEndEvent). */
const EVENT_SLOTS: Record<Line['event'], readonly Slot[]> = {
  verdict: ['reqPct', 'sharePct', 'evLossBb', 'toCall', 'pot', 'repeat', 'rule'],
  'right-action-wrong-reason': ['reqPct', 'sharePct', 'toCall', 'pot'],
  'price-held': ['reqPct', 'sharePct', 'toCall', 'pot', 'rule'],
  'session-end': ['hands', 'mistakes', 'priceHeld'],
  'lesson-open': [],
  'lesson-retry': [],
  'lesson-done': [],
};

/** A priced-only slot needs a line that only fires on a priced spot. */
const PRICED_SLOTS: readonly Slot[] = ['reqPct', 'sharePct', 'toCall', 'pot'];
function onlyPriced(line: Line): boolean {
  if (line.event === 'price-held') return true;
  if (line.when?.priced === true) return true;
  return line.event === 'verdict' && line.when?.action !== undefined && line.when.action.every((a) => a === 'call');
}

function variantsOf(line: Line): { tone: Tone; text: string }[] {
  const out: { tone: Tone; text: string }[] = [{ tone: 'warm', text: line.text }];
  if (line.dry !== undefined) out.push({ tone: 'dry', text: line.dry });
  if (line.blunt !== undefined) out.push({ tone: 'blunt', text: line.blunt });
  return out;
}

const kindOf = (text: string): TutorOutputKind => (text.trim().endsWith('?') ? 'question' : 'correction');
const wordCount = (t: string): number => t.trim().split(/\s+/).length;

describe('Dee line bank: size and identity', () => {
  it('holds 150 to 250 authored lines with unique ids', () => {
    expect(DEE_BANK.length).toBeGreaterThanOrEqual(150);
    expect(DEE_BANK.length).toBeLessThanOrEqual(250);
    const ids = DEE_BANK.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every event kind has lines', () => {
    for (const kind of EVENT_KINDS) expect(DEE_BANK.some((l) => l.event === kind), kind).toBe(true);
  });
});

describe('Dee line bank: every line, every tone', () => {
  const rows = DEE_BANK.flatMap((line) => variantsOf(line).map((v) => ({ line, ...v })));

  it.each(rows.map((r) => [`${r.line.id} (${r.tone})`, r] as const))('%s passes the lint', (_name, { line, text }) => {
    const problems: string[] = [];
    if (/\d/.test(text)) problems.push('literal numeral in the template');
    if (NUMBER_WORDS.test(text)) problems.push(`number word: ${NUMBER_WORDS.exec(text)?.[0]}`);
    for (const [name, re] of DEE_BANS) if (re.test(text)) problems.push(`dee-ban:${name}: ${re.exec(text)?.[0]}`);
    for (const slot of slotsOf(text)) {
      if (!(SLOTS as readonly string[]).includes(slot)) problems.push(`unknown slot {${slot}}`);
      else if (!EVENT_SLOTS[line.event].includes(slot as Slot)) problems.push(`slot {${slot}} not supplied by ${line.event}`);
      if ((PRICED_SLOTS as readonly string[]).includes(slot) && !onlyPriced(line)) problems.push(`priced slot {${slot}} on a line that can fire unpriced`);
      if (slot === 'repeat' && line.when?.repeat !== 'repeat') problems.push('{repeat} on a line that can fire first time');
      if (slot === 'evLossBb' && line.event !== 'verdict') problems.push('{evLossBb} outside a verdict');
    }
    if (line.event === 'lesson-retry' && !text.trim().endsWith('?')) problems.push('a retry is a question back');

    const filled = renderLine(text, FIXTURE);
    if (filled === null) problems.push('does not render from engine facts');
    else {
      if (wordCount(filled) > WORD_BUDGET[line.event]) problems.push(`${wordCount(filled)} words > ${WORD_BUDGET[line.event]}`);
      const guard = checkTutorOutput({ text: filled, kind: kindOf(filled) }, request(FIXTURE));
      for (const v of guard.violations) problems.push(`guard:${v.check}:${v.detail}`);
    }
    if (text !== line.text) problems.push(...variantProblems(text, line.text).map((p) => `strict:${p}`));
    expect(problems).toEqual([]);
  });

  it('a numeral no fact supplied never renders (the provenance guard inside the engine)', () => {
    expect(renderLine('Needed {reqPct}, not 40%.', { reqPct: '25%' })).toBeNull();
    expect(renderLine('Needed {reqPct}.', {})).toBeNull();
    expect(renderLine('Needed {reqPct}.', { reqPct: '25%' })).toBe('Needed 25%.');
  });
});

describe('Dee line bank: coverage of every grade the coach can produce', () => {
  const combos: { principle: Principle; action: DeeAction; priced: boolean; late?: boolean }[] = [
    { principle: 'pot odds', action: 'call', priced: true },
    { principle: 'pot odds', action: 'fold', priced: true },
    { principle: 'value or bluff', action: 'fold', priced: false },
    { principle: 'value or bluff', action: 'check', priced: false, late: true },
    { principle: 'value or bluff', action: 'bet', priced: false },
    { principle: 'value or bluff', action: 'raise', priced: false },
    { principle: 'value or bluff', action: 'allin', priced: false },
    { principle: 'ranges', action: 'raise', priced: true },
    { principle: 'ranges', action: 'bet', priced: true },
    { principle: 'ranges', action: 'allin', priced: true },
    { principle: 'other', action: 'call', priced: true },
    { principle: 'other', action: 'check', priced: false },
  ];
  const facts = (priced: boolean, repeat: number): Facts => {
    const f: Facts = { evLossBb: '2.9' };
    if (priced) Object.assign(f, { reqPct: '25%', sharePct: '18%', toCall: '75', pot: '225' });
    if (repeat > 0) f.repeat = String(repeat + 1);
    return f;
  };
  const empty = { handsWatched: 0, said: [] };

  for (const c of combos) {
    for (const severity of ['notable', 'serious'] as const) {
      for (const repeat of [0, 1]) {
        it(`${c.principle} ${c.action} ${severity}${repeat ? ' (repeat)' : ''} has a line in every tone`, () => {
          for (const tone of TONES) {
            const event: DeeEvent = { kind: 'verdict', severity, repeat, ...c, facts: facts(c.priced, repeat) };
            const line = selectLine(event, { tone, quietness: 1, character: true }, empty, 7);
            expect(line, tone).not.toBeNull();
          }
        });
      }
    }
  }

  it('right-for-the-wrong-reason, price held and the session summary all speak in every tone', () => {
    const cases: DeeEvent[] = [
      { kind: 'right-action-wrong-reason', reason: 'hand-strength', priced: true, facts: facts(true, 0) },
      { kind: 'right-action-wrong-reason', reason: 'none', priced: false, facts: {} },
      { kind: 'price-held', action: 'call', priced: true, facts: facts(true, 0) },
      { kind: 'price-held', action: 'fold', priced: true, late: true, facts: facts(true, 0) },
      { kind: 'session-end', clean: true, facts: { hands: '12', mistakes: '0' } },
      { kind: 'session-end', clean: false, principle: 'pot odds', facts: { hands: '12', mistakes: '3' } },
    ];
    for (const event of cases) {
      for (const tone of TONES) expect(selectLine(event, { tone, quietness: 1, character: true }, empty, 3), `${event.kind} ${tone}`).not.toBeNull();
    }
  });
});

describe('Dialogue scripts: lint and run on every example', () => {
  for (const script of Object.values(DIALOGUES)) {
    it(`${script.lessonId}: every step runs on every example and every line passes the lint`, () => {
      const lesson = lessonById(script.lessonId);
      expect(lesson, 'the script names a registered lesson').toBeDefined();
      const templates: { where: string; text: string; question: boolean }[] = [];
      for (const step of script.steps) {
        templates.push({ where: `${step.id}.ask`, text: step.ask, question: true });
        templates.push({ where: `${step.id}.right`, text: step.right, question: false });
        expect(step.options.filter((o) => o.correct)).toHaveLength(1);
        for (const o of step.options) {
          expect(o.label, `${step.id}.${o.id} label is slots only`).toMatch(/^(\{[a-zA-Z]+\}\s*)+$/);
          if (!o.correct) {
            expect(o.back, `${step.id}.${o.id} has a question back`).toBeDefined();
            templates.push({ where: `${step.id}.${o.id}.back`, text: o.back ?? '', question: true });
          }
        }
      }
      for (const example of lesson?.examples ?? []) {
        const f = exampleFacts(example);
        expect(scriptRuns(script, f), `${example.id} runs`).toBe(true);
        for (const t of templates) {
          const problems: string[] = [];
          if (/\d/.test(t.text)) problems.push('literal numeral');
          for (const slot of slotsOf(t.text)) if (!(LESSON_SLOTS as readonly string[]).includes(slot)) problems.push(`slot {${slot}}`);
          for (const [name, re] of DEE_BANS) if (re.test(t.text)) problems.push(`dee-ban:${name}`);
          if (t.question && !t.text.trim().endsWith('?')) problems.push('not a question');
          const filled = renderLine(t.text, f as Facts);
          if (filled === null) problems.push('does not render');
          else {
            if (wordCount(filled) > 20) problems.push(`${wordCount(filled)} words`);
            const guard = checkTutorOutput({ text: filled, kind: t.question ? 'question' : 'correction' }, request(f as Facts));
            for (const v of guard.violations) problems.push(`guard:${v.check}:${v.detail}`);
          }
          expect(problems, `${example.id} ${t.where}`).toEqual([]);
        }
      }
    });
  }
});
