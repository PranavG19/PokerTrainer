import { describe, expect, it } from 'vitest';
import { emptySession, type HandRecord, type SessionState } from '../../src/core/session.js';
import { fixedOffsetDayKeyOf } from '../../src/core/localDay.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { applyProgress, DRILL_ANSWERS, type ApplyContext } from '../../src/core/progression/apply.js';
import { REPS_ASSESSMENT, REPS_PER_DECISION, REPS_PER_PERCEPTION, REPS_PER_REASON } from '../../src/core/progression/reps.js';
import { SESSION_HANDS } from '../../src/core/progression/streak.js';
import { MS_PER_DAY } from '../../src/core/schedule.js';
import { chips } from '../../src/core/units.js';

const dayOf = fixedOffsetDayKeyOf(0);
const NOW = Date.parse('2026-10-12T20:00:00Z');
const ctx: ApplyContext = { now: NOW, dayOf, scenarios: SCENARIOS, leakPrinciple: null };

function hand(at: number, graded = 1, reasoned = 0): HandRecord {
  const decisions = Array.from({ length: graded }, (_, i) => ({
    street: 'flop' as const,
    board: [],
    pot: 100,
    toCall: 50,
    action: 'call' as const,
    amount: null,
    verdict: { severity: 'free' as const, evLossBb: 0, message: null, principle: null },
    ...(i < reasoned ? { gateAttempts: 1 as const } : {}),
  }));
  return { handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [], playedAt: at, decisions };
}

/** Apply prev → next, then hand the result back as the new saved state, as the host does. */
function save(prev: SessionState, next: SessionState, extras = {}, c = ctx): SessionState {
  return { ...next, progression: applyProgress(prev, next, extras, c).progression };
}

describe('the progression host: one diff → award → save', () => {
  const s0 = emptySession();

  it('pays for what changed, once: saving the same state again pays nothing', () => {
    const s1 = save(s0, { ...s0, hands: [hand(NOW - 1000, 2, 1)] });
    expect(s1.progression.reps.total).toBe(2 * REPS_PER_DECISION + REPS_PER_REASON);
    const s2 = save(s1, s1);
    expect(s2.progression.reps.total).toBe(s1.progression.reps.total);
    // The same hand delivered again (a replayed save from a stale base) is still paid once: the key holds.
    const s3 = save(s0, { ...s1 });
    expect(s3.progression.reps.total).toBe(s1.progression.reps.total);
  });

  it('a change in the bankroll alone pays nothing', () => {
    const s1 = save(s0, { ...s0, bankroll: chips(s0.bankroll + 5000) });
    expect(s1.progression.reps.total).toBe(0);
  });

  it(`${SESSION_HANDS} hands on one day count the streak day; ${SESSION_HANDS - 1} do not`, () => {
    const eleven = Array.from({ length: SESSION_HANDS - 1 }, (_, i) => hand(NOW - 10_000 + i));
    const s1 = save(s0, { ...s0, hands: eleven });
    expect(s1.progression.streak.current).toBe(0);
    const s2 = save(s1, { ...s1, hands: [...eleven, hand(NOW - 1)] });
    expect(s2.progression.streak.current).toBe(1);
    expect(s2.progression.streak.lastCountedDay).toBe(dayOf(NOW));
  });

  it('an assessment block pays once and counts the day', () => {
    const at = NOW - 5000;
    const block = Array.from({ length: 3 }, () => ({ at, evLossBb: 0, correct: true }));
    const s1 = save(s0, { ...s0, assessments: block });
    expect(s1.progression.reps.total).toBe(REPS_ASSESSMENT);
    expect(s1.progression.streak.current).toBe(1);
  });

  it('a story table played to its end counts the day', () => {
    expect(save(s0, s0, { storyTableEnded: true }).progression.streak.current).toBe(1);
  });

  it('a Price held beat is tallied and files its milestone', () => {
    const s1 = save(s0, s0, { priceHeld: 1 });
    expect(s1.progression.tallies.priceHeld).toBe(1);
    expect(s1.progression.milestones.achieved['price-held-first']).toEqual({ day: dayOf(NOW) });
  });

  it('Speed answers pay once each even when the save base is stale (a failed or overlapping save)', () => {
    const tally = (n: number): SessionState => ({ ...s0, anomalyTally: { ...s0.anomalyTally, attempts: n } });
    // The first save fails, so the base stays s0; the next save carries both answers.
    const s1 = save(s0, tally(1));
    const s2 = save(s0, { ...tally(2), progression: s1.progression });
    expect(s2.progression.reps.total).toBe(2 * REPS_PER_PERCEPTION);
    // Five answers, every save failing: still five answers' worth.
    let st = s0;
    for (let n = 1; n <= 5; n++) st = save(s0, { ...tally(n), progression: st.progression });
    expect(st.progression.reps.total).toBe(5 * REPS_PER_PERCEPTION);
  });

  it('Speed answers count across a relaunch: six, then four more after a restart, finish the drill item', () => {
    let s = save(s0, s0);
    const drill = s.progression.ticket.items.find((i) => i.kind === 'drill')!;
    expect(drill.ref).toBe('anomaly'); // NOW's day draws Speed; Sight's answers are per visit by design.
    s = save(s, { ...s, anomalyTally: { ...s.anomalyTally, attempts: 6 } });
    // A relaunch: a fresh host with no in-memory counts, the same saved profile.
    s = save(s, { ...s, anomalyTally: { ...s.anomalyTally, attempts: 10 } });
    expect(s.progression.ticket.done).toContain(drill.id);
  });

  it("works today's Ticket item by item and counts the day when the last one is done", () => {
    let s = save(s0, s0);
    const t = s.progression.ticket;
    expect(t.day).toBe(dayOf(NOW));
    const spots = t.items.filter((i) => i.kind === 'spot');
    const drill = t.items.find((i) => i.kind === 'drill')!;
    for (const spot of spots) s = save(s, s, { spot: { id: spot.ref, correct: 1 } });
    expect(s.progression.streak.current).toBe(0);
    // Speed answers arrive as the persisted tally; Sight answers (not persisted) as this visit's count.
    const answer = (st: SessionState, n: number): SessionState =>
      drill.ref === 'anomaly'
        ? save(st, { ...st, anomalyTally: { ...st.anomalyTally, attempts: st.anomalyTally.attempts + n } })
        : save(st, st, { perception: { mode: drill.ref, answered: n } });
    s = answer(s, DRILL_ANSWERS - 1);
    expect(s.progression.ticket.done).not.toContain(drill.id);
    s = drill.ref === 'anomaly' ? answer(s, 1) : answer(s, DRILL_ANSWERS);
    expect(s.progression.ticket.finishedOn).toBe(dayOf(NOW));
    expect(s.progression.tallies.ticketsFinished).toBe(1);
    expect(s.progression.streak.current).toBe(1);
    // Saving again does not count the Ticket twice.
    expect(save(s, s).progression.tallies.ticketsFinished).toBe(1);
  });

  it('the first save of the day can be the work on an item: a spot solved before any other save is ticked, not reshuffled', () => {
    // What Home showed: the Ticket built from the state before the work (nothing saved yet today).
    const shown = applyProgress(s0, s0, {}, ctx).progression.ticket;
    const spot = shown.items.find((i) => i.kind === 'spot')!;
    const steps = SCENARIOS.find((x) => x.id === spot.ref)!.target.length;
    const next = { ...s0, puzzleProgress: { [spot.ref]: { attempts: 1, bestCorrect: steps } } };
    const t = save(s0, next, { spot: { id: spot.ref, correct: steps } }).progression.ticket;
    expect(t.items.map((i) => i.id)).toEqual(shown.items.map((i) => i.id));
    expect(t.done).toContain(spot.id);
  });

  it('the first save of the day can be a review rep: the review item stays on the Ticket and is ticked', () => {
    const first = NOW - 2 * MS_PER_DAY;
    const block = Array.from({ length: 10 }, (_, i) => ({ kind: 'graded' as const, conceptId: 'pot-odds', at: first + i, correct: true }));
    // Saved yesterday (day-0 block and the day-1 wave not yet worked), so today's first save is the review.
    let s = save(s0, { ...s0, fadingLog: block }, {}, { ...ctx, now: first + 1000 });
    const shown = applyProgress(s, s, {}, ctx).progression.ticket;
    const review = shown.items.find((i) => i.kind === 'review');
    expect(review?.ref).toBe('pot-odds');
    const wave = Array.from({ length: 4 }, (_, i) => ({ kind: 'graded' as const, conceptId: 'pot-odds', at: NOW - 1000 + i, correct: true }));
    s = save(s, { ...s, fadingLog: [...block, ...wave] });
    expect(s.progression.ticket.items.map((i) => i.id)).toEqual(shown.items.map((i) => i.id));
    expect(s.progression.ticket.done).toContain(review!.id);
  });

  it('the first save of the day freezes the Ticket Home showed, even when that save moves the costliest leak', () => {
    const shown = applyProgress(s0, s0, {}, ctx).progression.ticket;
    const moved = save(s0, s0, { shownTicket: shown }, { ...ctx, leakPrinciple: 'ranges' }).progression.ticket;
    expect(moved.items.map((i) => i.id)).toEqual(shown.items.map((i) => i.id));
    // A shown Ticket from another day is never adopted.
    const stale = { ...shown, day: (shown.day! - 1) as typeof shown.day };
    const fresh = save(s0, s0, { shownTicket: stale }, { ...ctx, leakPrinciple: 'ranges' }).progression.ticket;
    expect(fresh.day).toBe(dayOf(NOW));
  });

  it("yesterday's greeting, still on screen after 4 am, is not stamped as today's", () => {
    const today = dayOf(NOW);
    const s1 = save(s0, s0, { greeting: { lineId: 'greet.due.1', day: (today - 1) as typeof today } });
    expect(s1.progression.dee.lastGreeting).toBeNull();
    const s2 = save(s0, s0, { greeting: { lineId: 'greet.due.1', day: today } });
    expect(s2.progression.dee.lastGreeting).toEqual({ day: today, lineId: 'greet.due.1' });
  });

  it('the suggestion taken and a Folio polish are recorded for today', () => {
    const s1 = save(s0, s0, { suggestionTaken: true, polished: ['pot-odds-as-a-price'] });
    expect(s1.progression.tallies.suggestionTakenOn).toBe(dayOf(NOW));
    expect(s1.progression.folio.polished['pot-odds-as-a-price']).toEqual([NOW]);
  });

  it('time travel: the next day builds a new Ticket and the streak carries on from yesterday', () => {
    const s1 = save(s0, s0, { storyTableEnded: true });
    const tomorrow = { ...ctx, now: NOW + MS_PER_DAY };
    const s2 = save(s1, s1, { storyTableEnded: true }, tomorrow);
    expect(s2.progression.streak.current).toBe(2);
    expect(s2.progression.ticket.day).toBe(dayOf(NOW) + 1);
    // A day skipped: the run starts again at 1, the best is kept.
    const s3 = save(s2, s2, { storyTableEnded: true }, { ...ctx, now: NOW + 3 * MS_PER_DAY });
    expect(s3.progression.streak.current).toBe(1);
    expect(s3.progression.streak.best).toBe(2);
  });
});
