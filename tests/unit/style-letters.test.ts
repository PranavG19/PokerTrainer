import { describe, expect, it } from 'vitest';
import { fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { weekOf } from '../../src/core/week.js';
import { HANDS_LINE, LEAD_LINE, STYLE_MIN_HANDS, styleAt, styleRead } from '../../src/core/style.js';
import { draftLetter, fileLetters, letterTitle, readLetter, weekLabel, writeLetter, type LetterInput, type LettersState } from '../../src/core/letters.js';
import { MAX_ASSESSMENT_LOG, MAX_HAND_LOG, type DecisionRecord, type HandRecord } from '../../src/core/session.js';
import { MAX_LETTERS } from '../../src/core/progression/types.js';
import { parseProgression } from '../../src/core/progression/persist.js';

const UTC = fixedOffsetDayKeyOf(0);
const DAY = 86_400_000;
/** Noon UTC on a DayKey (the 4 am line never moves it to another day). */
const at = (day: number): number => day * DAY + 12 * 3_600_000;
/** Monday 6 October 2025 as a DayKey. */
const MON = Math.floor(Date.UTC(2025, 9, 6) / DAY) as DayKey;

function dec(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return { street: 'river', board: ['4s', '4d', 'Kd', '9c', 'Js'], pot: 900, toCall: 450, action: 'call', amount: null, verdict: { severity: 'free', evLossBb: 0, message: null, principle: null }, ...over };
}

function hand(day: number, over: Partial<HandRecord> = {}): HandRecord {
  return { handNumber: 1, hole: ['Kh', '2d'], board: [], net: 0, vpip: false, pfr: false, grades: [], playedAt: at(day), decisions: [], ...over };
}

/** n hands on `day`: `vpip` of them played, `pfr` of those raised first. */
function hands(day: number, n: number, vpip: number, pfr: number, decisions: DecisionRecord[] = []): HandRecord[] {
  return Array.from({ length: n }, (_, i) => hand(day, { vpip: i < vpip, pfr: i < pfr, decisions: i === 0 ? decisions : [] }));
}

describe('the week', () => {
  it('runs Monday to Sunday', () => {
    expect(weekOf(MON)).toBe(MON);
    expect(weekOf((MON + 6) as DayKey)).toBe(MON);
    expect(weekOf((MON + 7) as DayKey)).toBe(MON + 7);
    expect(weekOf((MON - 1) as DayKey)).toBe(MON - 7);
    expect(weekLabel(MON)).toBe('6–12 Oct');
    expect(weekLabel((MON - 7) as DayKey)).toBe('29 Sep – 5 Oct');
  });
});

describe('the style read', () => {
  it('names nothing under the gate and says how many hands are needed', () => {
    const r = styleRead(hands(MON, STYLE_MIN_HANDS - 1, 5, 4), UTC);
    expect(r.style).toBeNull();
    expect(r.vpip.share).toBeNull();
    expect(r.vpip.needed).toBe(1);
  });

  it('a lead read from one played hand is noise: the style waits for as many hands played as the gate', () => {
    const one = styleRead(hands(MON, 40, 1, 1), UTC);
    expect(one.style).toBeNull();
    expect(one.lead.needed).toBe(STYLE_MIN_HANDS - 1);
    expect(one.trail).toEqual([]);
    expect(styleRead(hands(MON, 80, STYLE_MIN_HANDS, 15), UTC).style).toBe('closer');
  });

  it('the four styles sit on the two lines', () => {
    expect(styleAt(HANDS_LINE, LEAD_LINE)).toBe('closer');
    expect(styleAt(HANDS_LINE + 0.01, LEAD_LINE)).toBe('pressure');
    expect(styleAt(HANDS_LINE, LEAD_LINE - 0.01)).toBe('anchor');
    expect(styleAt(HANDS_LINE + 0.01, LEAD_LINE - 0.01)).toBe('explorer');
  });

  it('reads the style, the trail by week and the closeness to a line from the hand log', () => {
    // Week 1: 60 hands, 21 played (35%), 5 raised first (24%): The Explorer. Week 2: 120 hands, 22 played, 18 raised.
    const log = [...hands(MON - 7, 60, 21, 5), ...hands(MON, 120, 22, 18)];
    const r = styleRead(log, UTC);
    expect(r.hands).toBe(180);
    expect(r.since).toBe(MON - 7);
    expect(r.vpip.k).toBe(43);
    expect(r.lead.share).toBeCloseTo(23 / 43);
    expect(r.style).toBe('closer');
    expect(r.trail.map((t) => [t.week, t.style])).toEqual([[MON - 7, 'explorer'], [MON, 'closer']]);
    // 23 of 43 raised first is 53%: the 90% band runs well under 50%, so the side is not settled.
    expect(r.nearLeadLine).toBe(true);
  });

  it('aggression, folds to river bets and the grader rows each wait for their own observations', () => {
    const bets = Array.from({ length: 12 }, () => dec({ street: 'flop', action: 'bet', toCall: 0 }));
    const calls = Array.from({ length: 6 }, () => dec({ street: 'turn', action: 'call' }));
    const riverFolds = Array.from({ length: 5 }, () => dec({ action: 'fold', verdict: { severity: 'notable', evLossBb: 1, message: null, principle: 'pot odds' } }));
    const few = styleRead(hands(MON, 30, 8, 6, [...bets, ...calls]), UTC);
    expect(few.aggression.factor).toBeNull();
    expect(few.aggression.needed).toBe(2);
    const more = styleRead(hands(MON, 30, 8, 6, [...bets, ...calls, ...calls, ...riverFolds]), UTC);
    expect(more.aggression.factor).toBe(1);
    expect(more.foldToRiverBet.n).toBe(5);
    expect(more.foldToRiverBet.share).toBeNull();
    expect(more.grader.find((g) => g.kind === 'fold')).toEqual({ kind: 'fold', graded: 5, right: 0 });
    expect(more.grader.find((g) => g.kind === 'lead')).toEqual({ kind: 'lead', graded: 12, right: 12 });
  });
});

function input(log: HandRecord[], over: Partial<LetterInput> = {}): LetterInput {
  return { hands: log, assessments: [], rules: [], milestones: {}, sittings: [], sittingsWholeFrom: null, leakPrinciple: null, dayOf: UTC, ...over };
}

const NONE: LettersState = { filed: [] };

describe('Dee’s letters', () => {
  const sheetCall = dec({ verdict: { severity: 'serious', evLossBb: 3, message: null, principle: 'pot odds' } });

  it('files each ended week once, never the week in progress, and writes only numbers the records hold', () => {
    const log = [...hands(MON - 7, 30, 20, 15, [dec(), dec(), sheetCall]), ...hands(MON, 5, 1, 1, [dec()])];
    const today = (MON + 2) as DayKey;
    const filed = fileLetters(NONE, input(log), today);
    expect(filed.filed.map((l) => l.week)).toEqual([MON - 7]);
    const l = filed.filed[0];
    expect(l.n).toBe(1);
    expect(l.figures).toMatchObject({ hands: 30, graded: 3, sheet: 1, riverCalls: 3, riverRight: 2 });
    expect(l.style).toBe('pressure');
    expect(l.hand).toMatchObject({ street: 'river', action: 'call', toCall: 450, pot: 900 });
    const text = readLetter(l, 'warm').body.flat().join(' ');
    const allowed = new Set(Object.values(l.slots).flatMap((v) => v.match(/\d+(?:\.\d+)?/g) ?? []));
    for (const n of text.match(/\d+(?:\.\d+)?/g) ?? []) expect([...allowed]).toContain(n);
    expect(text).toContain('30 hands');
    // Idempotent: nothing new to file returns the same state.
    expect(fileLetters(filed, input(log), today)).toBe(filed);
    // The week in progress is a draft, numbered after the filed one.
    const draft = draftLetter(filed, input(log), today);
    expect(draft?.week).toBe(MON);
    expect(draft?.n).toBe(2);
  });

  it('a week the 500-hand cap has cut into is never written from part of it', () => {
    const log = hands(MON - 7, MAX_HAND_LOG, 100, 80, [dec()]);
    expect(fileLetters(NONE, input(log), (MON + 1) as DayKey).filed).toEqual([]);
    const withOlder = [hand(MON - 14), ...log.slice(0, -1)];
    expect(fileLetters(NONE, input(withOlder), (MON + 1) as DayKey).filed.map((l) => l.week)).toEqual([MON - 7]);
  });

  it('“was” comes from the letter before; the tone changes the words, never the numbers', () => {
    const assess = (day: number, loss: number) => Array.from({ length: 10 }, () => ({ at: at(day), evLossBb: loss, correct: loss === 0 }));
    const inp = input([], { assessments: [...assess(MON - 7, 0.06), ...assess(MON, 0.03)], rules: [{ text: 'price first', day: (MON - 9) as DayKey }] });
    const state = fileLetters(NONE, inp, (MON + 8) as DayKey);
    expect(state.filed).toHaveLength(2);
    const [, second] = state.filed;
    expect(second.slots.assessLoss).toBe('3 bb per 100 decisions');
    expect(second.slots.assessWas).toBe('6');
    const numbers = (tone: 'dry' | 'warm' | 'blunt') => readLetter(second, tone).body.flat().join(' ').match(/\d+(?:\.\d+)?/g);
    expect(numbers('dry')).toEqual(numbers('warm'));
    expect(numbers('blunt')).toEqual(numbers('warm'));
    expect(readLetter(second, 'warm').ps).toContain('“price first”');
  });

  it('a week the 500-spot assessment cap has cut into is not written either', () => {
    const spot = (day: number) => ({ at: at(day), evLossBb: 0.05, correct: false });
    const full = Array.from({ length: MAX_ASSESSMENT_LOG }, () => spot(MON - 7));
    expect(fileLetters(NONE, input([], { assessments: full }), (MON + 1) as DayKey).filed).toEqual([]);
    // One older spot kept: that week is the one cut into now, and the week after it is whole.
    const older = [spot(MON - 14), ...full.slice(1)];
    expect(fileLetters(NONE, input([], { assessments: older }), (MON + 1) as DayKey).filed.map((l) => l.week)).toEqual([MON - 7]);
  });

  it('a clean sheet is said only of table decisions, never of a week that was all assessment', () => {
    const assess = Array.from({ length: 10 }, () => ({ at: at(MON - 7), evLossBb: 0.06, correct: false }));
    const l = writeLetter(input(hands(MON - 7, 3, 1, 1, []), { assessments: assess }), (MON - 7) as DayKey, null, false, 1);
    expect(l.lines.some((id) => id.startsWith('lt-clean'))).toBe(false);
    expect(l.lines.some((id) => id.startsWith('lt-open'))).toBe(false);
    expect(l.lines.some((id) => id.startsWith('lt-assess'))).toBe(true);
  });

  it('once the file is full, a week older than the oldest kept is never re-filed (no save on every open)', () => {
    const filed = Array.from({ length: MAX_LETTERS }, (_, i) => writeLetter(input([]), (MON - 7 * (MAX_LETTERS - i)) as DayKey, null, false, i + 1));
    const state: LettersState = { filed };
    const log = hands(MON - 7 * (MAX_LETTERS + 3), 3, 1, 1, [dec()]);
    expect(fileLetters(state, input(log), MON)).toBe(state);
  });

  it('a stored letter whose week is not a Monday is dropped, so it cannot shadow the real one', () => {
    const p = parseProgression({ letters: { filed: [{ week: MON + 2, n: 1, lines: [] }, { week: MON, n: 1, lines: [] }] } });
    expect(p.letters.filed.map((l) => l.week)).toEqual([MON]);
  });

  it('an assessment-only week is never titled a clean sheet', () => {
    const assess = Array.from({ length: 10 }, () => ({ at: at(MON - 7), evLossBb: 0.06, correct: false }));
    const l = writeLetter(input([], { assessments: assess }), (MON - 7) as DayKey, null, false, 1);
    expect(letterTitle(l, () => null)).toBe('The week in decisions');
    const clean = writeLetter(input(hands(MON - 7, 3, 1, 1, [dec()])), (MON - 7) as DayKey, null, false, 1);
    expect(clean.hand).not.toBeNull();
    expect(letterTitle({ ...clean, hand: null }, () => null)).toBe('A clean sheet');
  });

  it('this week’s draft is not written from part of the week either', () => {
    const log = hands(MON, MAX_HAND_LOG, 100, 80, [dec()]);
    expect(draftLetter(NONE, input(log), (MON + 2) as DayKey)).toBeNull();
  });

  it('a record raised first but not played cannot push the lead past 100%', () => {
    const bad = Array.from({ length: 40 }, (_, i) => hand(MON - 7, { vpip: i < 20, pfr: true, decisions: i === 0 ? [dec()] : [] }));
    const l = writeLetter(input(bad), (MON - 7) as DayKey, null, false, 1);
    expect(l.figures.leadPct).toBe(100);
    expect(styleRead(bad, UTC).trail[0].lead).toBe(1);
  });

  it('a line id this build does not know is skipped, not shown', () => {
    const l = writeLetter(input(hands(MON, 3, 1, 1, [dec()])), MON, null, false, 1);
    const read = readLetter({ ...l, lines: ['lt-from-the-future', ...l.lines] }, 'warm');
    expect(read.body.flat().length).toBe(readLetter(l, 'warm').body.flat().length);
  });

  it('the next-week line names the career’s costliest spot only on the newest letters', () => {
    const inp = input(hands(MON - 7, 3, 1, 1, [sheetCall]), { leakPrinciple: 'pot odds' });
    expect(writeLetter(inp, (MON - 7) as DayKey, null, true, 1).lines.some((id) => id.startsWith('lt-leak'))).toBe(true);
    expect(writeLetter(inp, (MON - 7) as DayKey, null, false, 1).lines.some((id) => id.startsWith('lt-leak'))).toBe(false);
  });
});
