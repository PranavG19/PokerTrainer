import { describe, expect, it } from 'vitest';
import { fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { chips, reps } from '../../src/core/units.js';
import { countSession, currentStreakOn, defaultProgression, MAX_REP_AWARDS } from '../../src/core/progression/persist.js';
import {
  award,
  awarded,
  keys,
  repsForDrillRep,
  repsForHand,
  repsForRule,
  repsForSpot,
  repsOn,
  REPS_PER_DECISION,
  REPS_PER_REASON,
} from '../../src/core/progression/reps.js';
import { countFinished, handsMakeASession, handsOn, hourLabel, SESSION_HANDS, streakNote } from '../../src/core/progression/streak.js';
import { todaysRing } from '../../src/core/progression/ring.js';
import { sealViews, syncSeals } from '../../src/core/progression/seals.js';
import { earned, MILESTONES, milestoneViews, nextUp, syncMilestones, type MilestoneFacts } from '../../src/core/progression/milestones.js';
import { parseTestNow, REAL, testHooksFrom } from '../../src/core/testHooks.js';

const day = (n: number) => n as DayKey;

describe('the Reps ledger: keyed per award, idempotent', () => {
  const empty = defaultProgression().reps;

  it('pays an award once, however often it is delivered', () => {
    let s = award(empty, 'hand:1', 23, day(100));
    s = award(s, 'hand:1', 23, day(100));
    s = award(s, 'hand:1', 99, day(101));
    expect(s.total).toBe(23);
    expect(s.awards).toHaveLength(1);
    expect(awarded(s, 'hand:1')).toBe(true);
  });

  it('records nothing for zero, negative or non-finite amounts, or a key past 64 characters', () => {
    expect(award(empty, 'a', 0, day(1))).toBe(empty);
    expect(award(empty, 'a', -5, day(1))).toBe(empty);
    expect(award(empty, 'a', Number.NaN, day(1))).toBe(empty);
    expect(award(empty, 'x'.repeat(65), 10, day(1))).toBe(empty);
    expect(award(empty, '', 10, day(1))).toBe(empty);
  });

  it('keeps the lifetime total when the bounded log forgets old awards', () => {
    let s = empty;
    for (let i = 0; i < MAX_REP_AWARDS + 20; i++) s = award(s, `k:${i}`, 10, day(i));
    expect(s.awards).toHaveLength(MAX_REP_AWARDS);
    expect(s.total).toBe((MAX_REP_AWARDS + 20) * 10);
  });

  it('counts the Reps of one day', () => {
    let s = award(empty, 'a', 10, day(5));
    s = award(s, 'b', 13, day(5));
    s = award(s, 'c', 7, day(6));
    expect(repsOn(s, day(5))).toBe(23);
    expect(repsOn(s, day(7))).toBe(0);
  });

  it('a hand pays for graded decisions and reasons written, never for chips', () => {
    expect(repsForHand([])).toBe(0);
    expect(repsForHand([{ graded: false }])).toBe(0);
    expect(repsForHand([{ graded: true }, { graded: true, gateAttempts: 1 }, { graded: true, gateAttempts: 0 }])).toBe(
      3 * REPS_PER_DECISION + REPS_PER_REASON,
    );
    // Chips are not a parameter of any rule: the branded bankroll does not fit the effort shape.
    // @ts-expect-error a Chips value is not a decision
    repsForHand([chips(5000)]);
  });

  it('a mastered concept that is not due pays 0; a rule attempt pays less than an accepted one', () => {
    expect(repsForDrillRep(true)).toBe(0);
    expect(repsForDrillRep(false)).toBeGreaterThan(0);
    expect(repsForRule(true)).toBeGreaterThan(repsForRule(false));
    expect(repsForRule(false)).toBeGreaterThan(0);
    expect(repsForSpot(-2)).toBe(0);
  });

  it('keys stay within the 64 characters the profile keeps', () => {
    const long = 'c'.repeat(80);
    for (const k of [keys.drill(long, 1_700_000_000_000), keys.spot(long, day(20000)), keys.rule(long, 1_700_000_000_000)]) {
      expect(k.length).toBeLessThanOrEqual(64);
    }
  });

  it('the units stay apart: Reps are not Chips', () => {
    const r = reps(10);
    // @ts-expect-error Reps do not convert to Chips
    const c: ReturnType<typeof chips> = r;
    void c;
  });
});

describe('the streak, by the test clock (time travel across local days)', () => {
  // UTC−5 with the 4 am turn. 2026-10-12 is a Monday.
  const dayOf = fixedOffsetDayKeyOf(-300);
  const at = (iso: string) => Date.parse(iso);
  const start = defaultProgression().streak;

  it('a finished session counts the local day; a second one that day changes nothing', () => {
    const d = dayOf(at('2026-10-12T23:00:00-05:00'));
    let s = countFinished(start, 'ticket', d);
    s = countFinished(s, 'table-hands', d);
    expect(s.current).toBe(1);
    expect(currentStreakOn(s, d)).toBe(1);
  });

  it('a session at 2 am belongs to the evening before (the day turns at 4 am)', () => {
    const evening = dayOf(at('2026-10-12T21:00:00-05:00'));
    const lateNight = dayOf(at('2026-10-13T02:30:00-05:00'));
    const morning = dayOf(at('2026-10-13T04:30:00-05:00'));
    expect(lateNight).toBe(evening);
    expect(morning).toBe(evening + 1);
  });

  it('consecutive days build the run; a missed day resets it; the best is kept; nothing freezes it', () => {
    const mon = dayOf(at('2026-10-12T20:00:00-05:00'));
    let s = start;
    for (let i = 0; i < 5; i++) s = countSession(s, day(mon + i));
    expect(s.current).toBe(5);
    // Saturday skipped: Sunday reads 0 before a session, and a session starts a new run at 1.
    const sunday = day(mon + 6);
    expect(currentStreakOn(s, sunday)).toBe(0);
    s = countSession(s, sunday);
    expect(s.current).toBe(1);
    expect(s.best).toBe(5);
  });

  it('twelve hands on a day make a session, eleven do not; hands from another day never count', () => {
    expect(SESSION_HANDS).toBe(12);
    expect(handsMakeASession(11)).toBe(false);
    expect(handsMakeASession(12)).toBe(true);
    const d = dayOf(at('2026-10-12T20:00:00-05:00'));
    const hands = [
      { playedAt: at('2026-10-12T20:00:00-05:00') },
      { playedAt: at('2026-10-13T03:59:00-05:00') },
      { playedAt: at('2026-10-13T04:01:00-05:00') },
      {},
    ];
    expect(handsOn(hands, d, dayOf)).toBe(2);
  });

  it('the note under the streak is never loss-framed', () => {
    const notes = [streakNote(0, false, 4), streakNote(23, false, 4), streakNote(23, true, 4)];
    expect(notes[1]).toBe('Finish one session and your streak goes to 24.');
    for (const n of notes) expect(n).not.toMatch(/lose|lost|break|miss|don't|do not/i);
    expect(hourLabel(4)).toBe('4 am');
    expect(hourLabel(0)).toBe('midnight');
    expect(hourLabel(17)).toBe('5 pm');
  });
});

describe("today's ring", () => {
  const base = { today: day(50), dueNow: 0, repsToday: 0, suggestionTakenOn: null, suggestionOffered: true, ruleDays: [] };

  it('opens empty on a day with no work, even with nothing due', () => {
    const r = todaysRing(base);
    expect(r.closed).toBe(0);
    expect(r.goals.map((g) => g.id)).toEqual(['due', 'suggestion', 'rule']);
  });

  it('closes each goal only from something done today', () => {
    expect(todaysRing({ ...base, repsToday: 10 }).goals[0].done).toBe(true);
    expect(todaysRing({ ...base, repsToday: 10, dueNow: 2 }).goals[0].done).toBe(false);
    expect(todaysRing({ ...base, suggestionTakenOn: day(50) }).goals[1].done).toBe(true);
    expect(todaysRing({ ...base, suggestionTakenOn: day(49) }).goals[1].done).toBe(false);
    expect(todaysRing({ ...base, ruleDays: [day(48), day(50)] }).goals[2].done).toBe(true);
    expect(todaysRing({ ...base, repsToday: 1, suggestionTakenOn: day(50), ruleDays: [day(50)] }).closed).toBe(3);
  });
});

describe('Seals: derived from the gate, receipts are a ratchet', () => {
  it('adds a receipt the first time a concept is mastered and keeps it after it decays', () => {
    const empty = defaultProgression().seals;
    const s1 = syncSeals(empty, ['pot-odds'], day(10));
    expect(s1.earned['pot-odds']).toEqual({ day: day(10) });
    expect(syncSeals(s1, ['pot-odds'], day(11))).toBe(s1);
    // Decayed out of mastery: the receipt stays, but the Seal is not live.
    const views = sealViews(s1, []);
    expect(views).toEqual([{ conceptId: 'pot-odds', live: false, earnedOn: day(10) }]);
    expect(sealViews(s1, ['pot-odds'])[0].live).toBe(true);
  });

  it('never writes a __proto__ receipt', () => {
    const s = syncSeals(defaultProgression().seals, ['__proto__'], day(1));
    expect(Object.keys(s.earned)).toEqual([]);
  });
});

describe('milestones: fixed, fact-labelled, ratcheted, never from results', () => {
  const zero: MilestoneFacts = {
    depthFloor: 0,
    conceptsMastered: 0,
    puzzlesSolvedClean: 0,
    assessmentsTaken: 0,
    rulesInYourWords: 0,
    bestStreak: 0,
    priceHeld: 0,
    ticketsFinished: 0,
    sureTotal: 0,
    sureRight: 0,
  };

  it('ids are unique and include career.ts ids', () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['first-clean-solve', 'concepts-12', 'depth-75']) expect(ids).toContain(id);
  });

  it('facts carry no chips, pots, results or wins', () => {
    expect(Object.keys(zero).join(' ')).not.toMatch(/chip|pot\b|net|won|win|bankroll|result|bb\b/i);
  });

  it('writes a receipt the day a milestone is met and never takes it back', () => {
    const empty = defaultProgression().milestones;
    const s1 = syncMilestones(empty, { ...zero, bestStreak: 7, priceHeld: 1 }, day(30));
    expect(Object.keys(s1.achieved).sort()).toEqual(['price-held-first', 'streak-7']);
    expect(syncMilestones(s1, zero, day(31))).toBe(s1);
    const views = milestoneViews(s1, zero);
    expect(earned(views).map((v) => v.def.id).sort()).toEqual(['price-held-first', 'streak-7']);
  });

  it('Sure Means Sure needs 100 Sure calls before a percentage counts', () => {
    expect(Object.keys(syncMilestones(defaultProgression().milestones, { ...zero, sureTotal: 99, sureRight: 99 }, day(1)).achieved)).not.toContain('sure-means-sure');
    expect(Object.keys(syncMilestones(defaultProgression().milestones, { ...zero, sureTotal: 100, sureRight: 85 }, day(1)).achieved)).toContain('sure-means-sure');
  });

  it('the next four are the closest unearned, in a stable order', () => {
    const facts = { ...zero, bestStreak: 6, rulesInYourWords: 11, ticketsFinished: 0 };
    const next = nextUp(milestoneViews(defaultProgression().milestones, facts), 4).map((v) => v.def.id);
    expect(next.slice(0, 2)).toEqual(['rules-12', 'streak-7']);
    expect(next).toHaveLength(4);
  });
});

describe('the test clock gate', () => {
  it('is honoured only under e2e and never in a packaged build', () => {
    expect(testHooksFrom({ OFFSUIT_NOW: '1700000000000' }, false)).toEqual(REAL);
    expect(testHooksFrom({ OFFSUIT_E2E: '1', OFFSUIT_NOW: '1700000000000' }, true)).toEqual(REAL);
    expect(testHooksFrom({ OFFSUIT_E2E: '1', OFFSUIT_NOW: '1700000000000' }, false)).toEqual({ now: 1_700_000_000_000, onboarding: false });
    expect(testHooksFrom({ OFFSUIT_E2E: '1', OFFSUIT_E2E_ONBOARDING: '1' }, false)).toEqual({ now: null, onboarding: true });
  });

  it('parses epoch ms and ISO, and refuses anything else', () => {
    expect(parseTestNow('2026-10-12T20:00:00-05:00')).toBe(Date.parse('2026-10-12T20:00:00-05:00'));
    expect(parseTestNow('nonsense')).toBeNull();
    expect(parseTestNow('-5')).toBeNull();
    expect(parseTestNow('')).toBeNull();
    expect(parseTestNow(undefined)).toBeNull();
  });
});
