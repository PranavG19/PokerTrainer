import { describe, expect, it } from 'vitest';
import { emptySession, type HandRecord, type SessionState } from '../../src/core/session.js';
import { fixedOffsetDayKeyOf, type DayKey } from '../../src/core/localDay.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';
import { applyProgress, type ApplyContext } from '../../src/core/progression/apply.js';
import { defaultProgression, parseProgression, RAIL_TIER_IDS, RAIL_WEEK_CAP, serializeProgression } from '../../src/core/progression/persist.js';
import {
  countForRail,
  effectiveRailTier,
  FICTIONAL_LABEL,
  GHOST_WEEKS,
  RAIL_DAILY_REPS,
  RAIL_WEEK_DECISIONS,
  RAIL_TIERS,
  railBoard,
  recordRail,
  settleRail,
  tierOn,
  weekOf,
  weekOutcome,
} from '../../src/core/progression/rail.js';
import { RIVALS } from '../../src/core/story/cast.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { chips } from '../../src/core/units.js';
import { GRADER_VERSION } from '../../src/core/online/ranked.js';
import { REPS_PER_DECISION } from '../../src/core/progression/reps.js';
import type { RailState } from '../../src/core/progression/types.js';

const MS_PER_DAY = 86_400_000;
const dayOf = fixedOffsetDayKeyOf(0);
/** Monday 12 Oct 2026, 8 pm UTC (the test clock's instant: OFFSUIT_NOW=2026-10-12T20:00:00Z). */
const MON = Date.parse('2026-10-12T20:00:00Z');
const ctxAt = (now: number): ApplyContext => ({ now, dayOf, scenarios: SCENARIOS, leakPrinciple: null });

/** A hand of `graded` contested decisions, each losing `loss` bb (0 = free), with a big chip result to prove it is ignored. */
function hand(at: number, graded: number, loss: number, net = 0): HandRecord {
  const decisions = Array.from({ length: graded }, () => ({
    street: 'flop' as const,
    board: [],
    pot: 100,
    toCall: 50,
    action: 'call' as const,
    amount: null,
    verdict:
      loss === 0
        ? { severity: 'free' as const, evLossBb: 0, message: null, principle: null }
        : { severity: 'serious' as const, evLossBb: loss, message: 'm', principle: 'pot odds' },
  }));
  return { handNumber: 1, hole: ['As', 'Kd'], board: [], net, vpip: false, pfr: false, grades: [], playedAt: at, decisions };
}

/** A save, as the host makes it: prev → next, the result is the new base. */
function save(prev: SessionState, next: SessionState, now: number): SessionState {
  return { ...next, progression: applyProgress(prev, next, {}, ctxAt(now)).progression };
}

/** Play `hands` (each `graded` decisions losing `loss`) at `at`, one second apart, in one save. */
/** A judged week: RAIL_WEEK_DECISIONS decisions losing `loss`, over two days (the 400-Rep line allows 4 hands a day). */
function fullWeek(s: SessionState, at: number, loss: number): SessionState {
  return play(play(s, at, 4, 10, loss), at + MS_PER_DAY, (RAIL_WEEK_DECISIONS - 40) / 10, 10, loss);
}

function play(s: SessionState, at: number, hands: number, graded: number, loss: number, net = 0): SessionState {
  const fresh = Array.from({ length: hands }, (_, i) => hand(at + i * 1000, graded, loss, net));
  return save(s, { ...s, hands: [...s.hands, ...fresh] }, at + hands * 1000);
}

describe('the Ghost Rail: who is on it', () => {
  it('runs Deuce to Ace, thirteen tiers, each with a labelled fictional pace-setter', () => {
    expect(RAIL_TIERS.map((t) => t.name)).toEqual(['Deuce', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace']);
    for (const t of RAIL_TIERS) expect(t.bot.label).toBe(FICTIONAL_LABEL);
    expect(FICTIONAL_LABEL).toMatch(/^Fictional/);
  });

  it('bots are not the story rivals and their names are unique', () => {
    const names = RAIL_TIERS.map((t) => t.bot.name);
    expect(new Set(names).size).toBe(names.length);
    const rivalWords = Object.values(RIVALS).flatMap((r) => r.name.split(/\s+/));
    for (const n of names) expect(rivalWords).not.toContain(n);
  });

  it('paces tighten strictly up the ladder: a tier is never easier than the one below', () => {
    for (let i = 1; i < RAIL_TIERS.length; i++) expect(RAIL_TIERS[i].bot.pace).toBeLessThan(RAIL_TIERS[i - 1].bot.pace);
  });

  it('every name and label passes the content lint', () => {
    for (const t of RAIL_TIERS) for (const s of [t.name, t.bot.name, t.bot.label]) expect(bannedPhrasingIn(s)).toBeNull();
  });

  it('the board holds only the learner’s own weeks and labelled bots: no other person', () => {
    let s = emptySession();
    for (let w = 0; w < GHOST_WEEKS + 2; w++) s = play(s, MON + w * 7 * MS_PER_DAY, 5, 10, 0);
    const board = railBoard(s.progression.rail, dayOf(MON + (GHOST_WEEKS + 1) * 7 * MS_PER_DAY));
    expect(new Set(board.rows.map((r) => r.kind))).toEqual(new Set(['you', 'ghost', 'bot']));
    expect(board.rows.filter((r) => r.kind === 'ghost')).toHaveLength(GHOST_WEEKS);
    for (const r of board.rows.filter((x) => x.kind === 'bot')) expect(r.tier?.bot.label).toBe(FICTIONAL_LABEL);
    for (const r of board.rows.filter((x) => x.kind !== 'bot')) expect(r.name.startsWith('You')).toBe(true);
  });
});

describe('the Ghost Rail: scored on decision quality, never chips', () => {
  it('weeks start on Monday at the learner’s 4 am turn', () => {
    const monday = dayOf(MON);
    expect(weekOf(monday)).toBe(monday);
    expect(weekOf((monday + 6) as DayKey)).toBe(monday);
    expect(weekOf((monday + 7) as DayKey)).toBe(monday + 7);
    // 3 am on the next Monday is still Sunday's day, so still this week.
    expect(weekOf(dayOf(Date.parse('2026-10-19T03:00:00Z')))).toBe(monday);
  });

  it('a week’s number reads the coach’s bb loss; the same decisions with any chip result score the same', () => {
    const a = play(emptySession(), MON, 4, 10, 0.5, +90_000);
    const b = play(emptySession(), MON, 4, 10, 0.5, -90_000);
    expect(a.progression.rail).toEqual(b.progression.rail);
    expect(a.progression.rail.weeks[0].loss).toEqual({ n: 40, sum: 20, sumSq: 10 });
  });

  it('a bankroll change alone files nothing', () => {
    const s0 = emptySession();
    const s1 = save(s0, { ...s0, bankroll: chips(s0.bankroll + 5000) }, MON);
    expect(s1.progression.rail).toEqual(defaultProgression().rail);
  });

  it('uncontested decisions (nothing to call) and non-sound-math charges do not count, as for Depth', () => {
    const free = { ...hand(MON, 1, 0), decisions: hand(MON, 1, 0).decisions!.map((d) => ({ ...d, toCall: 0 })) };
    const bluff = { ...hand(MON + 1, 1, 3), decisions: hand(MON + 1, 1, 3).decisions!.map((d) => ({ ...d, verdict: { ...d.verdict!, principle: 'value or bluff' } })) };
    const s = save(emptySession(), { ...emptySession(), hands: [free, bluff] }, MON + 2);
    expect(s.progression.rail.weeks[0].loss.n).toBe(0);
    // Their Reps still count: the effort was real.
    expect(s.progression.rail.weeks[0].reps).toBe(2 * REPS_PER_DECISION);
  });

  it('counts through the ledger: a stale or replayed save files nothing twice', () => {
    const s0 = emptySession();
    const s1 = play(s0, MON, 3, 10, 0);
    const replay = save(s0, { ...s1 }, MON + 10_000);
    expect(replay.progression.rail).toEqual(s1.progression.rail);
    expect(save(s1, s1, MON + 20_000).progression.rail).toEqual(s1.progression.rail);
  });

  it(`above ${RAIL_DAILY_REPS} Reps a day, Reps count 0 for the Rail; the week still takes its fixed count of decisions`, () => {
    // Each hand pays 10 decisions × 10 Reps = 100; the fifth starts past the line.
    const s = play(emptySession(), MON, 6, 10, 0);
    const w = s.progression.rail.weeks[0];
    expect(w.reps).toBe(RAIL_DAILY_REPS);
    expect(w.loss.n).toBe(40);
    expect(s.progression.reps.total).toBe(600);
    // The next day the line resets.
    const next = play(s, MON + MS_PER_DAY, 1, 10, 0);
    expect(next.progression.rail.weeks[0].reps).toBe(RAIL_DAILY_REPS + 100);
  });

  it('the daily rule splits an award that crosses the line', () => {
    const counted = countForRail(
      [
        { day: 1 as DayKey, reps: 350, losses: [0] },
        { day: 1 as DayKey, reps: 100, losses: [1] },
        { day: 1 as DayKey, reps: 30, losses: [2] },
      ],
      () => 0,
    );
    expect(counted.map((c) => c.reps)).toEqual([350, 50, 0]);
    // The line is on Reps only (round 2): every decision still reaches the week's fixed count.
    expect(counted.map((c) => c.losses)).toEqual([[0], [1], [2]]);
  });
});

describe('the Ghost Rail: weeks settle when they end, and nobody moves down (time travel)', () => {
  const nextWeek = (weeks: number) => MON + weeks * 7 * MS_PER_DAY;

  it('a rated week at or under the pace moves up one tier, filed the first save after the week ends', () => {
    let s = fullWeek(emptySession(), MON, 0);
    expect(s.progression.rail.tier).toBe('deuce');
    // Mid-week nothing settles, and the week is its first RAIL_WEEK_DECISIONS decisions (R1).
    expect(s.progression.rail.weeks[0].outcome).toBeNull();
    s = save(s, s, nextWeek(1));
    expect(s.progression.rail.tier).toBe('three');
    expect(s.progression.rail.weeks[0].outcome).toBe('up');
    expect(s.progression.rail.promotions).toEqual([{ week: dayOf(MON), from: 'deuce', to: 'three' }]);
  });

  it('NO DEMOTION: a terrible week after a move up keeps the tier', () => {
    let s = fullWeek(emptySession(), MON, 0);
    s = save(s, s, nextWeek(1));
    s = fullWeek(s, nextWeek(1), 20);
    s = save(s, s, nextWeek(2));
    expect(s.progression.rail.weeks[1].outcome).toBe('held');
    expect(s.progression.rail.tier).toBe('three');
    // And many bad weeks later, still.
    for (let w = 2; w < 8; w++) {
      s = fullWeek(s, nextWeek(w), 20);
      s = save(s, s, nextWeek(w + 1));
    }
    expect(s.progression.rail.tier).toBe('three');
    expect(s.progression.rail.promotions).toHaveLength(1);
  });

  it('settle never lowers a tier, whatever the weeks hold', () => {
    const state: RailState = {
      tier: 'king',
      weeks: [{ week: 0 as DayKey, loss: { n: 100, sum: 5000, sumSq: 300_000 }, reps: 0, grader: GRADER_VERSION, mixed: false, outcome: null }],
      promotions: [],
    };
    expect(settleRail(state, 7 as DayKey).tier).toBe('king');
  });

  it(`a week under ${RAIL_WEEK_DECISIONS} scored decisions is unrated and moves nothing`, () => {
    let s = play(emptySession(), MON, 3, 10, 0);
    s = save(s, s, nextWeek(1));
    expect(s.progression.rail.weeks[0].outcome).toBe('unrated');
    expect(s.progression.rail.tier).toBe('deuce');
  });

  it('a long absence settles each missed week in order, at most one tier per week', () => {
    let s = emptySession();
    for (let w = 0; w < 3; w++) s = fullWeek(s, nextWeek(w), 0);
    // The second and third weeks are filed while earlier ones are still open only if no save fell between: force it.
    const raw = s.progression.rail;
    const reopened: RailState = { ...raw, tier: 'deuce', promotions: [], weeks: raw.weeks.map((w) => ({ ...w, outcome: null })) };
    const settled = settleRail(reopened, dayOf(nextWeek(10)));
    expect(settled.tier).toBe('five');
    expect(settled.promotions.map((p) => p.to)).toEqual(['three', 'four', 'five']);
  });

  it('a week graded by two grader versions is shown but never settles up', () => {
    let r = recordRail(defaultProgression().rail, [{ day: 0 as DayKey, reps: 100, losses: Array(30).fill(0) }], 1);
    r = recordRail(r, [{ day: 1 as DayKey, reps: 100, losses: Array(30).fill(0) }], 2);
    expect(r.weeks[0].mixed).toBe(true);
    expect(weekOutcome(r.weeks[0], 0)).toBe('mixed');
    expect(settleRail(r, 30 as DayKey).tier).toBe('deuce');
  });

  it('a settled week is closed: a late event under it does not reopen its number', () => {
    let s = fullWeek(emptySession(), MON, 0);
    s = save(s, s, nextWeek(1));
    const closed = s.progression.rail.weeks[0];
    const late = recordRail(s.progression.rail, [{ day: dayOf(MON + 1000), reps: 50, losses: [9] }]);
    expect(late.weeks[0]).toEqual(closed);
  });

  it('at Ace there is nowhere further up: a good week holds', () => {
    const at = RAIL_TIERS.length - 1;
    const w = { week: 0 as DayKey, loss: { n: RAIL_WEEK_DECISIONS, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome: null };
    expect(weekOutcome(w, at)).toBe('held');
    expect(railBoard({ tier: 'ace', weeks: [], promotions: [] }, 3 as DayKey).toBeat).toBeNull();
  });

  it('a newer build’s tier is kept, shown as the lowest, and never moved by this build', () => {
    const p = parseProgression({ rail: { tier: 'joker', weeks: [], promotions: [] } });
    expect(p.rail.tier).toBe('joker');
    expect(effectiveRailTier(p.rail).id).toBe('deuce');
    const week = { week: 0 as DayKey, loss: { n: RAIL_WEEK_DECISIONS, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome: null };
    expect(settleRail({ ...p.rail, weeks: [week] }, 7 as DayKey).tier).toBe('joker');
  });

  it('the tier held on a day reads from the promotions on file', () => {
    const r: RailState = { tier: 'four', weeks: [], promotions: [{ week: 7 as DayKey, from: 'deuce', to: 'three' }, { week: 14 as DayKey, from: 'three', to: 'four' }] };
    expect(tierOn(r, 13 as DayKey).id).toBe('deuce');
    expect(tierOn(r, 14 as DayKey).id).toBe('three');
    expect(tierOn(r, 30 as DayKey).id).toBe('four');
  });
});

describe('the Ghost Rail persists tolerantly', () => {
  it('round-trips, and corrupt weeks and promotions are dropped, never invented', () => {
    let s = fullWeek(emptySession(), MON, 1);
    s = save(s, s, MON + 7 * MS_PER_DAY);
    const p = s.progression;
    expect(parseProgression(JSON.parse(JSON.stringify(serializeProgression(p)))).rail).toEqual(p.rail);
    const bad = parseProgression({
      rail: {
        tier: 7,
        weeks: [
          { week: 1, loss: { n: 1, sum: 1, sumSq: 1 } }, // not a Monday
          { week: -3, loss: { n: 2, sum: 10, sumSq: 1 }, reps: -5 }, // impossible tally, negative Reps
        ],
        promotions: [{ week: 4, from: 'deuce', to: 'deuce' }, 'x'],
      },
    }).rail;
    expect(bad.tier).toBe('deuce');
    expect(bad.weeks).toEqual([{ week: -3, loss: { n: 0, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome: null }]);
    expect(bad.promotions).toEqual([]);
  });
});

describe('review fixes (red first)', () => {
  const MON0 = 0 as DayKey;
  const free = (n: number) => Array(n).fill(0);

  it('R1: a week is judged on a fixed count, so stopping early on a lucky run is unrated, and later decisions do not move it', () => {
    // Free decisions short of the count, then stop: rated before the fix, which let stopping-when-ahead buy a move.
    const stopped = recordRail(defaultProgression().rail, [{ day: MON0, reps: 100, losses: free(RAIL_WEEK_DECISIONS - 10) }]);
    expect(weekOutcome(stopped.weeks[0], 0)).toBe('unrated');
    // The first RAIL_WEEK_DECISIONS are the week; decisions after them do not change its number.
    const full = recordRail(defaultProgression().rail, [{ day: MON0, reps: 100, losses: free(RAIL_WEEK_DECISIONS) }]);
    const more = recordRail(full, [{ day: (MON0 + 1) as DayKey, reps: 100, losses: Array(30).fill(50) }]);
    expect(more.weeks[0].loss).toEqual(full.weeks[0].loss);
    expect(more.weeks[0].reps).toBe(200);
    expect(weekOutcome(more.weeks[0], 0)).toBe('up');
  });

  it('R3: an older build leaves a newer tier’s weeks open for the newer build to settle', () => {
    const week = { week: 0 as DayKey, loss: { n: RAIL_WEEK_DECISIONS, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome: null };
    const out = settleRail({ tier: 'joker', weeks: [week], promotions: [] }, 7 as DayKey);
    expect(out.weeks[0].outcome).toBeNull();
  });

  it('R4: corrupt promotions cannot invent moves, and the tier is never below the last move on file', () => {
    const p = parseProgression({
      rail: {
        tier: 'nonsense-but-valid-id',
        promotions: [
          { week: 7, from: 'ace', to: 'deuce' },
          { week: 14, from: 'deuce', to: 'four' },
          { week: 21, from: 'deuce', to: 'three' },
          { week: 21, from: 'three', to: 'four' },
          { week: 28, from: 'three', to: 'four' },
          { week: 35, from: 'joker', to: 'wild' },
        ],
      },
    }).rail;
    expect(p.promotions).toEqual([
      { week: 21, from: 'deuce', to: 'three' },
      { week: 28, from: 'three', to: 'four' },
      { week: 35, from: 'joker', to: 'wild' },
    ]);
    // A corrupt tier never reads below the moves on file.
    expect(parseProgression({ rail: { tier: 7, promotions: [{ week: 7, from: 'deuce', to: 'three' }] } }).rail.tier).toBe('three');
  });

  it('R6: a move earned in a season’s last week is held from the next Monday, not before', () => {
    const r: RailState = { tier: 'three', weeks: [], promotions: [{ week: 14 as DayKey, from: 'deuce', to: 'three' }] };
    expect(tierOn(r, 20 as DayKey).id).toBe('deuce');
    expect(tierOn(r, 21 as DayKey).id).toBe('three');
  });

  it('R7: a non-finite grade is skipped, not counted as a free decision', () => {
    const r = recordRail(defaultProgression().rail, [{ day: MON0, reps: 10, losses: [Number.NaN, 2, Number.POSITIVE_INFINITY] }]);
    expect(r.weeks[0].loss).toEqual({ n: 1, sum: 2, sumSq: 4 });
  });
});

describe('the review’s missing invariants', () => {
  it('persist spells the tier ids and the week count exactly as rail.ts does', () => {
    expect(RAIL_TIER_IDS).toEqual(RAIL_TIERS.map((t) => t.id));
    expect(RAIL_WEEK_CAP).toBe(RAIL_WEEK_DECISIONS);
  });

  it('a newer build’s week outcome survives parsing and is never re-settled', () => {
    const week = { week: -3, loss: { n: 60, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome: 'promoted-twice' };
    const p = parseProgression({ rail: { tier: 'deuce', weeks: [week], promotions: [] } }).rail;
    expect(p.weeks[0].outcome).toBe('promoted-twice');
    expect(settleRail(p, 30 as DayKey)).toBe(p);
  });

  it('the daily line holds when one day’s awards come over several saves', () => {
    let s = emptySession();
    for (let i = 0; i < 6; i++) s = play(s, MON + i * 60_000, 1, 10, 0);
    expect(s.progression.rail.weeks[0].reps).toBe(RAIL_DAILY_REPS);
  });

  it('with the award log full, a new hand still reaches the Rail once', () => {
    let s = emptySession();
    const filler = Array.from({ length: 500 }, (_, i) => ({ key: `speed:${i + 1}`, reps: 2 as never, day: (dayOf(MON) - 30) as DayKey }));
    s = { ...s, progression: { ...s.progression, reps: { total: 1000 as never, awards: filler } } };
    const s1 = play(s, MON, 1, 10, 0);
    expect(s1.progression.rail.weeks[0]).toMatchObject({ reps: 100, loss: { n: 10 } });
    expect(save(s1, s1, MON + 99_000).progression.rail).toEqual(s1.progression.rail);
  });
});

describe('review round 2 (red first)', () => {
  it('F1: the daily line applies to Reps only; the decisions of a hand past it still count toward the week', () => {
    const counted = countForRail([{ day: 1 as DayKey, reps: 500, losses: [0] }, { day: 1 as DayKey, reps: 20, losses: [1, 2] }], () => 0);
    expect(counted.map((c) => c.reps)).toEqual([400, 0]);
    expect(counted[1].losses).toEqual([1, 2]);
  });

  it('F2: a week already at its count is not marked mixed by a later grader’s hand', () => {
    const full = recordRail(defaultProgression().rail, [{ day: 0 as DayKey, reps: 10, losses: Array(RAIL_WEEK_DECISIONS).fill(0) }], 1);
    const later = recordRail(full, [{ day: 1 as DayKey, reps: 10, losses: [3] }], 2);
    expect(later.weeks[0].mixed).toBe(false);
  });

  it('F4: a move settled for an older week than the newest on file survives a reload', () => {
    const w = (n: number, outcome: string | null) => ({ week: n as DayKey, loss: { n: RAIL_WEEK_DECISIONS, sum: 0, sumSq: 0 }, reps: 0, grader: 1, mixed: false, outcome });
    const state: RailState = { tier: 'three', weeks: [w(-3, null), w(11, 'up')], promotions: [{ week: 11 as DayKey, from: 'deuce', to: 'three' }] };
    const settled = settleRail(state, 30 as DayKey);
    expect(settled.promotions).toHaveLength(2);
    const reread = parseProgression({ rail: JSON.parse(JSON.stringify(settled)) }).rail;
    expect(reread.promotions).toEqual(settled.promotions);
    // R3-1: the tier held reads the highest move, not the last in week order.
    expect(settled.tier).toBe('four');
    expect(tierOn(settled, 30 as DayKey).id).toBe('four');
  });

  it('F5: a stored week beyond the count is read at the count, its mean kept', () => {
    const p = parseProgression({ rail: { weeks: [{ week: -3, loss: { n: 90, sum: 9, sumSq: 9 } }] } }).rail;
    expect(p.weeks[0].loss.n).toBe(RAIL_WEEK_DECISIONS);
  });
});
