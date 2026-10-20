/**
 * DEE'S LETTERS (VISION pillar 9, You › Letters): one short letter a week, written from that week's records.
 *
 * Scripted, never generated: the engine counts the week (hands dealt, decisions graded, river bets faced, the style
 * read, the assessment block, what went to the sheet, story sittings, trophies, the learner's own rules), picks one
 * template per moment from Dee's letter bank (dee/letterBank.ts) and fills its slots. The tutor writes nothing.
 *
 * A week is filed once it has ended (Monday 4 am local): its numbers, its line ids and its hand of the week are
 * stored (`progression.letters`), so the letter reads the same every time, after the hand log's 500-hand window has
 * moved on, and in any tone (the tone picks the words around the numbers at render time, never the numbers). A week
 * is filed only when the log still holds all of it; a week the cap has already cut into is never written at all,
 * rather than written from part of the week. The week in progress is shown as a draft and never stored.
 *
 * Pure: the caller passes the day function and today.
 */

import type { DayKey, DayKeyOf } from './localDay.js';
import type { AssessmentDecision, HandRecord } from './session.js';
import { MAX_ASSESSMENT_LOG, MAX_HAND_LOG } from './session.js';
import { MAX_LETTERS, type HandOfWeek, type LetterRecord, type LettersState } from './progression/types.js';
export type { HandOfWeek, LetterRecord, LettersState };
import { STYLES, STYLE_MIN_HANDS, styleAt, pct, type StyleId } from './style.js';
import { inWeek, weekOf } from './week.js';
import {
  LETTER_BANK,
  LETTER_EVENTS,
  LETTER_PARAGRAPH,
  type LetterEvent,
  type LetterFacts,
  type LetterLine,
  type LetterSlot,
} from './dee/letterBank.js';

export interface Sitting {
  readonly day: DayKey;
  readonly venue: string;
  readonly judged: number;
  readonly free: number;
}

export interface LetterInput {
  readonly hands: readonly HandRecord[];
  readonly assessments: readonly AssessmentDecision[];
  /** The learner's own rule sentences with the day each was written. */
  readonly rules: readonly { readonly text: string; readonly day: DayKey }[];
  readonly milestones: Readonly<Record<string, { readonly day: DayKey }>>;
  readonly sittings: readonly Sitting[];
  /**
   * The first day the story record is whole from: a regular whose sittings hit their cap has dropped older ones, so a
   * week before this day leaves the story line out rather than count part of it. Null when nothing was dropped.
   */
  readonly sittingsWholeFrom: DayKey | null;
  /** The career's costliest coach principle (what today's Ticket draws its spots from), or null. */
  readonly leakPrinciple: string | null;
  readonly dayOf: DayKeyOf;
}

/** What each coach principle is about, in Dee's words. */
export const PRINCIPLE_PHRASE: Readonly<Record<string, string>> = {
  'pot odds': 'calls and folds against the price',
  'value or bluff': 'what each bet is for',
  ranges: 'raises into stronger ranges',
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (day: number): Date => new Date(day * 86_400_000 + 43_200_000);

/** "3 Oct": fixed English month names, so a stored letter reads the same on any machine. */
export function dayLabel(day: DayKey): string {
  const d = dateOf(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "6–12 Oct", or "29 Sep – 5 Oct" across a month. */
export function weekLabel(week: DayKey): string {
  const a = dateOf(week);
  const b = dateOf(week + 6);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
    : `${dayLabel(week)} – ${dayLabel((week + 6) as DayKey)}`;
}

/** The week's numbers, counted from the records. Nothing here is a read until it clears its gate. */
export interface WeekCount {
  readonly week: DayKey;
  readonly hands: number;
  readonly vpip: number;
  readonly pfr: number;
  /** Table decisions with a verdict plus assessment decisions. */
  readonly graded: number;
  /** Table decisions with a verdict only: what the sheet is counted from. */
  readonly tableGraded: number;
  readonly sheet: number;
  /** Sheet cost per coach principle. */
  readonly cost: Readonly<Record<string, number>>;
  readonly riverBets: number;
  readonly riverFolds: number;
  /** River calls facing a bet that carry a verdict, and how many of those cost nothing. */
  readonly riverCalls: number;
  readonly riverRight: number;
  readonly assessN: number;
  readonly assessSum: number;
  readonly hand: HandOfWeek | null;
}

export function countWeek(input: Pick<LetterInput, 'hands' | 'assessments' | 'dayOf'>, week: DayKey): WeekCount {
  let hands = 0, vpip = 0, pfr = 0, graded = 0, sheet = 0, riverBets = 0, riverFolds = 0, riverCalls = 0, riverRight = 0;
  const cost: Record<string, number> = {};
  let best: { size: number; hand: HandOfWeek } | null = null;
  for (const h of input.hands) {
    if (typeof h.playedAt !== 'number' || !inWeek(input.dayOf(h.playedAt), week)) continue;
    hands++;
    if (h.vpip) vpip++;
    if (h.pfr) pfr++;
    for (const d of h.decisions ?? []) {
      const priced = d.toCall > 0;
      if (d.street === 'river' && priced) {
        riverBets++;
        if (d.action === 'fold') riverFolds++;
      }
      if (d.verdict === null) continue;
      graded++;
      const free = d.verdict.severity === 'free';
      if (!free) {
        sheet++;
        const p = d.verdict.principle ?? 'other';
        cost[p] = (cost[p] ?? 0) + Math.max(0, d.verdict.evLossBb);
      }
      if (d.street === 'river' && priced && d.action === 'call') {
        riverCalls++;
        if (free) riverRight++;
      }
      // The hand of the week: the biggest pot faced with a bet and answered right (ties go to the later hand).
      if (free && priced && (d.action === 'call' || d.action === 'fold') && (best === null || d.pot + d.toCall >= best.size)) {
        best = { size: d.pot + d.toCall, hand: { hole: [...h.hole], board: [...d.board], street: d.street, action: d.action, toCall: d.toCall, pot: d.pot } };
      }
    }
  }
  let assessN = 0, assessSum = 0;
  for (const a of input.assessments) {
    if (!Number.isFinite(a.evLossBb) || !inWeek(input.dayOf(a.at), week)) continue;
    assessN++;
    assessSum += Math.max(0, a.evLossBb);
  }
  return { week, hands, vpip, pfr, graded: graded + assessN, tableGraded: graded, sheet, cost, riverBets, riverFolds, riverCalls, riverRight, assessN, assessSum, hand: best?.hand ?? null };
}

function weekStyle(c: WeekCount): StyleId | null {
  return c.hands >= STYLE_MIN_HANDS && c.vpip >= STYLE_MIN_HANDS ? styleAt(c.vpip / c.hands, c.pfr / c.vpip) : null;
}

const bbPer100 = (sum: number, n: number): number => Math.round((sum / n) * 1000) / 10;

/** A small, stable hash so the same week always picks the same line. */
function pick<T>(items: readonly T[], week: number, salt: number): T {
  const h = Math.abs((week * 2654435761 + salt * 40503) | 0);
  return items[h % items.length];
}

/** Every slot of the line has a fact. */
function fits(line: LetterLine, facts: LetterFacts): boolean {
  return [...line.text.matchAll(/\{(\w+)\}/g)].every((m) => facts[m[1] as LetterSlot] !== undefined);
}

/**
 * Write the letter for `week`. `prev` is the week before's letter (filed, or written the same way), for "was";
 * `withNext` adds the line about where next week starts, which only the newest letters carry.
 */
export function writeLetter(input: LetterInput, week: DayKey, prev: LetterRecord | null, withNext: boolean, n: number): LetterRecord {
  const c = countWeek(input, week);
  const facts: LetterFacts = {};
  const figures: Record<string, number> = {
    hands: c.hands,
    graded: c.graded,
    sheet: c.sheet,
    riverBets: c.riverBets,
    riverFolds: c.riverFolds,
    riverCalls: c.riverCalls,
    riverRight: c.riverRight,
    assessN: c.assessN,
  };
  if (c.hands > 0) facts.hands = plural(c.hands, 'hand', 'hands');
  // "graded" in the prose is what the opening line counts: table decisions, or the block's on a week with no table.
  const opening = c.tableGraded > 0 ? c.tableGraded : c.hands === 0 ? c.assessN : 0;
  if (opening > 0) facts.graded = plural(opening, 'decision', 'decisions');
  if (c.riverCalls > 0) {
    facts.riverCalls = plural(c.riverCalls, 'call', 'calls');
    facts.riverRight = String(c.riverRight);
  }
  const style = weekStyle(c);
  if (style !== null) {
    facts.style = STYLES[style].name;
    facts.handsPct = `${pct(c.vpip / c.hands)}%`;
    facts.leadPct = `${pct(c.pfr / c.vpip)}%`;
    figures.handsPct = pct(c.vpip / c.hands);
    figures.leadPct = pct(c.pfr / c.vpip);
    const was = prev?.style;
    if (was && was !== style && was in STYLES) facts.styleWas = STYLES[was as StyleId].name;
  }
  if (c.riverBets >= STYLE_MIN_HANDS) {
    figures.foldRiverPct = pct(c.riverFolds / c.riverBets);
    facts.foldRiver = `${figures.foldRiverPct}%`;
    const was = prev?.figures.foldRiverPct;
    if (typeof was === 'number' && was !== figures.foldRiverPct) facts.foldRiverWas = `${was}%`;
  }
  if (c.assessN > 0) {
    figures.assessBb100 = bbPer100(c.assessSum, c.assessN);
    facts.assessLoss = `${figures.assessBb100} bb per 100 decisions`;
    const was = prev?.figures.assessBb100;
    if (typeof was === 'number' && (prev?.figures.assessN ?? 0) > 0) facts.assessWas = `${was}`;
  }
  let focus: string | null = null;
  for (const [p, v] of Object.entries(c.cost)) if (PRINCIPLE_PHRASE[p] && (focus === null || v > c.cost[focus])) focus = p;
  if (c.sheet > 0) facts.sheet = plural(c.sheet, 'decision', 'decisions');
  if (focus !== null) facts.focus = PRINCIPLE_PHRASE[focus];
  if (withNext && input.leakPrinciple && PRINCIPLE_PHRASE[input.leakPrinciple]) facts.leak = PRINCIPLE_PHRASE[input.leakPrinciple];

  const storyWhole = input.sittingsWholeFrom === null || week >= input.sittingsWholeFrom;
  const sittings = storyWhole ? input.sittings.filter((s) => inWeek(s.day, week)) : [];
  const venues = new Map<string, { judged: number; free: number }>();
  for (const s of sittings) {
    const v = venues.get(s.venue) ?? { judged: 0, free: 0 };
    v.judged += s.judged;
    v.free += s.free;
    venues.set(s.venue, v);
  }
  const top = [...venues.entries()].filter(([, v]) => v.judged > 0).sort((a, b) => b[1].judged - a[1].judged)[0];
  if (top) {
    facts.venue = top[0].replace(/^The /, 'the ');
    facts.judged = plural(top[1].judged, 'judged decision', 'judged decisions');
    facts.free = String(top[1].free);
  }
  const shelf = Object.entries(input.milestones)
    .filter(([, m]) => inWeek(m.day, week))
    .sort((a, b) => a[1].day - b[1].day)
    .map(([id]) => id);
  if (shelf.length > 0) facts.shelf = plural(shelf.length, 'trophy', 'trophies');

  const rules = [...input.rules].filter((r) => r.day <= week + 6).sort((a, b) => a.day - b.day);
  const newest = rules[rules.length - 1];
  const fresh = newest !== undefined && inWeek(newest.day, week);
  if (newest) {
    facts.rule = newest.text;
    facts.ruleDay = dayLabel(newest.day);
  }

  const want = new Set<LetterEvent>();
  if (c.tableGraded > 0) want.add('open');
  else if (c.hands === 0 && c.assessN > 0) want.add('open-assess');
  if (c.riverCalls > 0) want.add('river');
  if (facts.styleWas) want.add('style-change');
  else if (facts.style) want.add('style');
  if (facts.foldRiverWas) want.add('fold-move');
  if (facts.assessWas) want.add('assessment-change');
  else if (facts.assessLoss) want.add('assessment');
  if (c.sheet > 0 && facts.focus) want.add('sheet');
  else if (c.tableGraded > 0 && c.sheet === 0) want.add('clean');
  if (facts.leak) want.add('leak');
  if (facts.venue) want.add('story');
  if (facts.shelf) want.add('shelf');
  if (fresh) want.add('rule-new');
  else if (newest && c.graded > 0) want.add('ps');

  const lines: string[] = [];
  LETTER_EVENTS.forEach((event, i) => {
    if (!want.has(event)) return;
    const eligible = LETTER_BANK.filter((l) => l.event === event && fits(l, facts));
    if (eligible.length > 0) lines.push(pick(eligible, week, i).id);
  });
  // Only the slots a chosen line uses are kept: the record holds what the letter says, nothing more.
  const used = new Set(lines.flatMap((id) => [...(LETTER_BANK.find((l) => l.id === id)?.text ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1])));
  const slots: Record<string, string> = {};
  for (const [k, v] of Object.entries(facts)) if (used.has(k)) slots[k] = v as string;
  return { week, n, lines, slots, figures, style, hand: c.hand, shelf };
}

/** Weeks with any graded activity on record, oldest first. */
function activeWeeks(input: LetterInput): DayKey[] {
  const weeks = new Set<number>();
  for (const h of input.hands) if (typeof h.playedAt === 'number' && (h.decisions ?? []).some((d) => d.verdict !== null)) weeks.add(weekOf(input.dayOf(h.playedAt)));
  for (const a of input.assessments) weeks.add(weekOf(input.dayOf(a.at)));
  return [...weeks].sort((a, b) => a - b) as DayKey[];
}

/**
 * Both capped logs still hold the whole week: for each, either nothing has been cut yet, or the oldest entry kept is
 * from before the week.
 */
function covered(input: LetterInput, week: DayKey): boolean {
  if (input.hands.length >= MAX_HAND_LOG) {
    const oldest = input.hands.find((h) => typeof h.playedAt === 'number');
    if (oldest === undefined || input.dayOf(oldest.playedAt as number) >= week) return false;
  }
  if (input.assessments.length >= MAX_ASSESSMENT_LOG) {
    const oldest = input.assessments[0];
    if (input.dayOf(oldest.at) >= week) return false;
  }
  return true;
}

/** The letter number for `week`: counted from the first week on file or with activity. */
function numberOf(state: LettersState, input: LetterInput, week: DayKey): number {
  const first = Math.min(...state.filed.map((l) => l.week - (l.n - 1) * 7), ...activeWeeks(input), week);
  return Math.floor((week - first) / 7) + 1;
}

/** File every ended week with activity that is not on file yet. Returns the same object when nothing was filed. */
export function fileLetters(state: LettersState, input: LetterInput, today: DayKey): LettersState {
  const current = weekOf(today);
  const have = new Set(state.filed.map((l) => l.week));
  // Once the file is full, a week older than the oldest letter kept would only be filed to be dropped again.
  const floor = state.filed.length >= MAX_LETTERS ? state.filed[0].week : -Infinity;
  const due = activeWeeks(input).filter((w) => w < current && w > floor && !have.has(w) && covered(input, w));
  if (due.length === 0) return state;
  let filed = [...state.filed];
  for (const w of due) {
    const prev = filed.find((l) => l.week === w - 7) ?? null;
    const letter = writeLetter(input, w, prev, w === current - 7, numberOf({ filed }, input, w));
    filed = [...filed, letter].sort((a, b) => a.week - b.week);
  }
  return { filed: filed.slice(-MAX_LETTERS) };
}

/** This week's letter so far: written the same way, never stored. Null before anything this week was graded. */
export function draftLetter(state: LettersState, input: LetterInput, today: DayKey): LetterRecord | null {
  const week = weekOf(today);
  const c = countWeek(input, week);
  if (c.graded === 0) return null;
  const prev = state.filed.find((l) => l.week === week - 7) ?? null;
  return writeLetter(input, week, prev, true, numberOf(state, input, week));
}

export interface ReadParagraphs {
  readonly body: readonly string[][];
  readonly ps: string | null;
}

/** The letter as text in a tone: each line's tone variant, filled from the stored slots. Unknown ids are skipped. */
export function readLetter(letter: LetterRecord, tone: 'dry' | 'warm' | 'blunt'): ReadParagraphs {
  const body: string[][] = [[], [], []];
  let ps: string | null = null;
  for (const id of letter.lines) {
    const line = LETTER_BANK.find((l) => l.id === id);
    if (!line) continue;
    const template = (tone === 'dry' ? line.dry : tone === 'blunt' ? line.blunt : undefined) ?? line.text;
    const text = fillLetterLine(template, letter.slots);
    if (text === null) continue;
    const para = LETTER_PARAGRAPH[line.event];
    if (para === 'ps') ps = text;
    else body[para].push(text);
  }
  return { body: body.filter((p) => p.length > 0), ps };
}

const NUMERAL = /\d+(?:\.\d+)?/g;

/**
 * Fill a template from slots. Null when a slot is missing, or when the text carries a numeral no slot supplied: the
 * letter never says a number the engine did not count.
 */
export function fillLetterLine(template: string, slots: Readonly<Record<string, string>>): string | null {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = slots[name];
    if (v === undefined) missing = true;
    return v ?? '';
  });
  if (missing) return null;
  const allowed = new Set(Object.values(slots).flatMap((v) => v.match(NUMERAL) ?? []));
  for (const n of text.match(NUMERAL) ?? []) if (!allowed.has(n)) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The short title a letter is listed under. */
export function letterTitle(letter: LetterRecord, milestoneName: (id: string) => string | null): string {
  const named = letter.shelf.map(milestoneName).find((n): n is string => n !== null);
  if (named) return named;
  if (letter.hand) return `The ${letter.hand.street} ${letter.hand.action === 'call' ? 'call' : 'fold'}`;
  if (letter.style && letter.style in STYLES) return STYLES[letter.style as StyleId].name;
  return letter.figures.sheet === 0 ? 'A clean sheet' : 'The week in decisions';
}
