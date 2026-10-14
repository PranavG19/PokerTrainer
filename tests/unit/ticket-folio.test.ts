import { describe, expect, it } from 'vitest';
import type { DayKey } from '../../src/core/localDay.js';
import { MS_PER_DAY, type ConceptState } from '../../src/core/schedule.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import {
  buildTicket,
  DRILL_MINUTES,
  markDone,
  PERCEPTION_DRILLS,
  scenarioPrinciple,
  TICKET_MAX_MINUTES,
  TICKET_SPOTS,
  ticketFor,
  ticketMinutes,
} from '../../src/core/ticket.js';
import { folioCards, folioSheet, polish, wear } from '../../src/core/folio.js';
import { defaultProgression } from '../../src/core/progression/persist.js';
import type { LexiconAttempt } from '../../src/core/lexicon.js';
import { GREETING_LINES, GREETING_SLOTS, GREETING_WORD_BUDGET, greetingFor, salutation, toneText, type GreetingInput } from '../../src/core/progression/greeting.js';
import { renderLine, slotsOf } from '../../src/core/dee/engine.js';
import { variantProblems } from '../../src/core/dee/strict.js';
import { checkTutorOutput } from '../../src/main/tutor/guard.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { DEE_BANS, NUMBER_WORDS, request } from './deeLint.js';

const day = (n: number) => n as DayKey;
const T0 = 1_760_000_000_000;

/** A concept first seen `ageDays` ago with only its day-0 block done, so its day-1 (or later) wave is owed. */
function concept(id: string, ageDays: number, now: number): ConceptState {
  const firstSeen = now - ageDays * MS_PER_DAY;
  return { id, firstSeen, opportunities: Array.from({ length: 10 }, () => ({ at: firstSeen, correct: true })), probeMisses: 0 };
}

describe("Today's Ticket (D16): due + one drill + three leak spots, under 30 minutes", () => {
  const base = { day: day(20000), now: T0, concepts: [] as ConceptState[], leakPrinciple: null, scenarios: SCENARIOS, puzzleProgress: {} };

  it('on a fresh profile it is one perception drill and three spots', () => {
    const items = buildTicket(base);
    expect(items.map((i) => i.kind)).toEqual(['drill', 'spot', 'spot', 'spot']);
    expect(ticketMinutes(items)).toBeLessThan(30);
  });

  it('takes only what is due, plus exactly one drill and three spots, and stays under 30 minutes', () => {
    const concepts = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => concept(id, 1 + i * 7, T0));
    const items = buildTicket({ ...base, concepts });
    const reviews = items.filter((i) => i.kind === 'review');
    expect(reviews.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.kind === 'drill')).toHaveLength(1);
    expect(items.filter((i) => i.kind === 'spot')).toHaveLength(TICKET_SPOTS);
    expect(ticketMinutes(items)).toBeLessThanOrEqual(TICKET_MAX_MINUTES);
    // Every review is a concept that is due now: none invented.
    for (const r of reviews) expect(concepts.map((c) => c.id)).toContain(r.ref);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('a concept not yet due is not on it', () => {
    // Seen 3 days ago with day 0 and day 1 done: the next wave is day 7.
    const c = concept('fresh', 3, T0);
    const done: ConceptState = { ...c, opportunities: [...c.opportunities, { at: c.firstSeen + MS_PER_DAY, correct: true }] };
    expect(buildTicket({ ...base, concepts: [done] }).some((i) => i.kind === 'review')).toBe(false);
  });

  it('the spots come from the costliest leak first', () => {
    for (const principle of ['pot odds', 'value or bluff', 'ranges'] as const) {
      const spots = buildTicket({ ...base, leakPrinciple: principle }).filter((i) => i.kind === 'spot');
      for (const s of spots) expect(scenarioPrinciple(SCENARIOS.find((x) => x.id === s.ref)!)).toBe(principle);
    }
  });

  it('the drill alternates by day and is the warm-up length', () => {
    const a = buildTicket({ ...base, day: day(20000) }).find((i) => i.kind === 'drill')!;
    const b = buildTicket({ ...base, day: day(20001) }).find((i) => i.kind === 'drill')!;
    expect(new Set([a.ref, b.ref])).toEqual(new Set(PERCEPTION_DRILLS));
    expect(a.minutes).toBe(DRILL_MINUTES);
  });

  it('is frozen for the day: working it never reshuffles it; tomorrow it is rebuilt', () => {
    const empty = defaultProgression().ticket;
    const today = ticketFor(empty, base);
    expect(ticketFor(today, { ...base, leakPrinciple: 'ranges' })).toBe(today);
    const tomorrow = ticketFor(today, { ...base, day: day(20001) });
    expect(tomorrow.day).toBe(20001);
    expect(tomorrow.done).toEqual([]);
  });

  it('is finished when its last item is done, once; unknown ids and other days change nothing', () => {
    let t = ticketFor(defaultProgression().ticket, base);
    expect(markDone(t, 'nope', day(20000))).toBe(t);
    expect(markDone(t, t.items[0].id, day(20001))).toBe(t);
    for (const i of t.items.slice(0, -1)) t = markDone(t, i.id, day(20000));
    expect(t.finishedOn).toBeNull();
    t = markDone(t, t.items[t.items.length - 1].id, day(20000));
    expect(t.finishedOn).toBe(20000);
    expect(markDone(t, t.items[0].id, day(20000))).toBe(t);
  });
});

describe('Folio: tarnish follows the schedule waves, re-polish satisfies them', () => {
  const written = T0;

  it('is bright on the day it is written and tarnished from day 1 until polished', () => {
    expect(wear(written, [], written + 3_600_000)).toMatchObject({ tarnished: false, waveDay: 1, dueInDays: 1 });
    const d1 = wear(written, [], written + MS_PER_DAY);
    expect(d1).toMatchObject({ tarnished: true, waveDay: 1, dueInDays: 0 });
    expect(d1.tarnish).toBeGreaterThan(0);
  });

  it('a polish on day 1 satisfies it until day 7; a late polish still counts', () => {
    const p1 = written + MS_PER_DAY + 1000;
    expect(wear(written, [p1], written + 3 * MS_PER_DAY)).toMatchObject({ tarnished: false, waveDay: 7, dueInDays: 4 });
    expect(wear(written, [p1], written + 7 * MS_PER_DAY)).toMatchObject({ tarnished: true, waveDay: 7 });
    // Late: polished on day 10 for the day-7 wave.
    const late = written + 10 * MS_PER_DAY;
    expect(wear(written, [p1, late], written + 11 * MS_PER_DAY)).toMatchObject({ tarnished: false, waveDay: 21 });
  });

  it('two polishes on the same wave satisfy it once (the next wave still needs its own)', () => {
    const p = [written + MS_PER_DAY, written + MS_PER_DAY + 5];
    expect(wear(written, p, written + 7 * MS_PER_DAY)).toMatchObject({ tarnished: true, waveDay: 7 });
  });

  it('after the last wave it stays bright', () => {
    const ps = [1, 7, 21, 30].map((d) => written + d * MS_PER_DAY);
    expect(wear(written, ps, written + 90 * MS_PER_DAY)).toMatchObject({ tarnished: false, waveDay: null });
  });

  it('builds one card per concept from the lexicon and saved lesson rules, newest sentence on top', () => {
    const lexicon: LexiconAttempt[] = [
      { seq: 1, conceptId: 'river-bluff-catch', sentence: 'old words', at: written, flippingAxis: null, outcome: 'accepted', frame: 'range-asymmetry', decidedBy: 'keyword-check' },
      { seq: 2, conceptId: 'river-bluff-catch', sentence: 'new words', at: written + 10, flippingAxis: null, outcome: 'accepted', frame: 'range-asymmetry', decidedBy: 'keyword-check' },
      { seq: 3, conceptId: 'turn-probe', sentence: 'rejected', at: written, flippingAxis: null, outcome: 'rejected', reason: 'cached-cell', reasonText: 'x', pushback: true },
    ];
    const rules = [{ conceptId: 'pot-odds-as-a-price', text: 'the price is the call over the pot after I call', day: day(Math.floor(written / MS_PER_DAY)) }];
    const cards = folioCards({ lexicon, rules, folio: defaultProgression().folio, now: written + 3_600_000 });
    expect(cards.map((c) => c.conceptId).sort()).toEqual(['pot-odds-as-a-price', 'river-bluff-catch']);
    const river = cards.find((c) => c.conceptId === 'river-bluff-catch')!;
    expect(river.text).toBe('new words');
    expect(river.earlier).toEqual(['old words']);
    expect(folioSheet(cards, (id) => id)).toContain('river-bluff-catch: new words');
  });

  it('polish is bounded, idempotent at an instant, and refuses __proto__', () => {
    const f0 = defaultProgression().folio;
    const f1 = polish(f0, 'c', 5);
    expect(polish(f1, 'c', 5)).toBe(f1);
    expect(polish(f1, '__proto__', 6)).toBe(f1);
    expect(f1.polished.c).toEqual([5]);
  });

  it('a polish before the newest sentence was written does not count for it', () => {
    const lexicon: LexiconAttempt[] = [
      { seq: 1, conceptId: 'c', sentence: 's', at: written + 5 * MS_PER_DAY, flippingAxis: null, outcome: 'accepted', frame: 'range-asymmetry', decidedBy: 'keyword-check' },
    ];
    const folio = { polished: { c: [written + MS_PER_DAY] } };
    const [card] = folioCards({ lexicon, rules: [], folio, now: written + 6 * MS_PER_DAY });
    expect(card.lastPolished).toBe(written + 5 * MS_PER_DAY);
    expect(card.tarnished).toBe(true);
  });
});

describe("Dee's Home greeting: every line, every tone, passes Dee's lint", () => {
  const FIX = { review: '3 concepts', leak: 'calling bets above the price', rule: 'the price is the call over the pot after I call' };
  const words = (t: string) => t.trim().split(/\s+/).length;
  const rows = GREETING_LINES.flatMap((line) =>
    (['warm', 'dry', 'blunt'] as const).map((tone) => ({ line, tone, text: toneText(line, tone) })),
  );

  it('ids are unique', () => {
    expect(new Set(GREETING_LINES.map((l) => l.id)).size).toBe(GREETING_LINES.length);
  });

  it.each(rows.map((r) => [`${r.line.id} (${r.tone})`, r] as const))('%s', (_n, { line, text }) => {
    const problems: string[] = [];
    if (/\d/.test(text)) problems.push('literal numeral');
    if (NUMBER_WORDS.test(text)) problems.push(`number word ${NUMBER_WORDS.exec(text)?.[0]}`);
    for (const [name, re] of DEE_BANS) if (re.test(text)) problems.push(`dee-ban:${name}:${re.exec(text)?.[0]}`);
    const banned = bannedPhrasingIn(text);
    if (banned) problems.push(`banned:${banned}`);
    for (const slot of slotsOf(text)) if (!(GREETING_SLOTS as readonly string[]).includes(slot)) problems.push(`slot ${slot}`);
    if (text !== line.text) problems.push(...variantProblems(text, line.text));
    if (/held the price|price held/i.test(text)) problems.push('D6 wording');
    const filled = renderLine(text, FIX);
    if (filled === null) problems.push('does not render');
    else {
      if (words(filled) > GREETING_WORD_BUDGET) problems.push(`${words(filled)} words`);
      for (const v of checkTutorOutput({ text: filled, kind: 'correction' }, request(FIX)).violations) problems.push(`guard:${v.check}`);
    }
    expect(problems).toEqual([]);
  });

  const input: GreetingInput = {
    day: day(20000),
    hour: 20,
    name: 'Sam',
    tone: 'warm',
    handsPlayed: 40,
    dueCount: 0,
    leak: null,
    rule: null,
    ticketDoneToday: false,
    daysSinceLastSession: 0,
    lastGreeting: null,
  };

  it('picks the most specific moment that has facts', () => {
    expect(greetingFor({ ...input, handsPlayed: 0, dueCount: 3 }).moment).toBe('first');
    expect(greetingFor({ ...input, dueCount: 3, daysSinceLastSession: 4 }).moment).toBe('return');
    expect(greetingFor({ ...input, dueCount: 1 }).text).toMatch(/^1 concept ready for review/);
    expect(greetingFor({ ...input, leak: FIX.leak }).moment).toBe('leak');
    expect(greetingFor({ ...input, rule: 'price first.' }).text).toContain('“price first.”');
    expect(greetingFor(input).moment).toBe('quiet');
    expect(greetingFor({ ...input, ticketDoneToday: true, dueCount: 3 }).moment).toBe('done');
  });

  it("keeps today's line all day and avoids yesterday's when another fits", () => {
    const first = greetingFor({ ...input, dueCount: 3 });
    expect(greetingFor({ ...input, dueCount: 3, lastGreeting: { day: day(20000), lineId: first.lineId } }).lineId).toBe(first.lineId);
    const next = greetingFor({ ...input, day: day(20001), dueCount: 3, lastGreeting: { day: day(20000), lineId: first.lineId } });
    expect(next.lineId).not.toBe(first.lineId);
  });

  it('the salutation follows the local hour and carries the chosen name only', () => {
    expect(salutation(7, 'Sam')).toBe('Morning, Sam.');
    expect(salutation(13, null)).toBe('Afternoon.');
    expect(salutation(2, '  ')).toBe('Evening.');
  });
});
