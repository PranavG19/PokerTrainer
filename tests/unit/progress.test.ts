import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../../src/core/rng.js';
import type {
  DecisionRecord,
  ErrorTag,
  HandOutcome,
  KcEvidence,
  ProgressInput,
} from '../../src/core/progress.js';
import {
  BANNED_PHRASINGS,
  ERROR_TAGS,
  METRIC_KEYS,
  RESULTS_GRAPH_MIN_HANDS,
  WEEKLY_DECISION_TARGET,
  WEEK_MS,
  WIN_RATE_MIN_HANDS,
  bannedPhrasingIn,
  computeMetrics,
  decisionRecordsFromHands,
  formatTagAggregate,
  kcBar,
  kcBars,
  resultsGraph,
  tagAggregates,
  winRateMetric,
} from '../../src/core/progress.js';
import type { LoggedHand } from '../../src/core/progress.js';

/**
 * PROGRESS DISPLAY — mostly negative tests, because this module's job is refusal.
 *
 * The load-bearing assertions are the ones that fail when someone ADDS something: a sixth metric, a
 * placeholder win rate below the gate, a short results graph, a hidden frozen KC, or a sentence that
 * describes the player instead of the decision.
 */

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const DAY = 86_400_000;

function decision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    at: NOW - DAY,
    mode: 'practice',
    evLossBb: 0,
    tag: null,
    sure: false,
    correct: true,
    ...overrides,
  };
}

function hand(overrides: Partial<HandOutcome> = {}): HandOutcome {
  return { at: NOW - DAY, netBb: 0, evBb: 0, botConfigId: 'bots-v1', ...overrides };
}

function input(overrides: Partial<ProgressInput> = {}): ProgressInput {
  return { decisions: [], hands: [], fluency: [], botConfigId: 'bots-v1', ...overrides };
}

/** Seeded so the "thousands of hands" fixtures are reproducible without hand-writing them. */
function seededHands(count: number, seed: number, botConfigId = 'bots-v1'): HandOutcome[] {
  const rng = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const netBb = (rng() - 0.45) * 20;
    return { at: NOW - (count - i) * 1000, netBb, evBb: netBb + (rng() - 0.5) * 4, botConfigId };
  });
}

describe('P1 — exactly five metrics', () => {
  it('names five keys and only five', () => {
    expect(METRIC_KEYS).toHaveLength(5);
    expect(new Set(METRIC_KEYS).size).toBe(5);
  });

  it('emits no key outside METRIC_KEYS, above or below the win-rate gate', () => {
    const below = computeMetrics(input(), NOW);
    const above = computeMetrics(input({ hands: seededHands(WIN_RATE_MIN_HANDS, 7) }), NOW);

    // A sixth metric would show up here as an unexpected key rather than passing silently.
    expect(Object.keys(below).sort()).toEqual(
      METRIC_KEYS.filter((k) => k !== 'winRateVsBots')
        .slice()
        .sort(),
    );
    expect(Object.keys(above).sort()).toEqual(METRIC_KEYS.slice().sort());
    expect(Object.keys(above).length).toBeLessThanOrEqual(5);
  });

  it('gives a target only to the effort metric', () => {
    const metrics = computeMetrics(input({ hands: seededHands(WIN_RATE_MIN_HANDS, 9) }), NOW);
    expect(metrics.gradedDecisionsThisWeek.target).toBe(WEEKLY_DECISION_TARGET);
    expect(metrics.assessmentEvLossBb100.target).toBeNull();
    expect(metrics.fluentCategories.target).toBeNull();
    expect(metrics.sureWrongThisWeek.target).toBeNull();
    expect(metrics.winRateVsBots?.target).toBeNull();
  });
});

describe('P1 — the weekly window', () => {
  it('counts only decisions inside the trailing week', () => {
    const decisions = [
      decision({ at: NOW }),
      decision({ at: NOW - WEEK_MS + 1 }),
      decision({ at: NOW - WEEK_MS }), // exactly on the far edge: outside
      decision({ at: NOW - 30 * DAY }),
      decision({ at: NOW + DAY }), // future-dated: not "this week"
    ];
    expect(computeMetrics(input({ decisions }), NOW).gradedDecisionsThisWeek.value).toBe(2);
  });

  it('counts SURE-wrong only when both sure and wrong, and only this week', () => {
    const decisions = [
      decision({ sure: true, correct: false }),
      decision({ sure: true, correct: false }),
      decision({ sure: true, correct: true }),
      decision({ sure: false, correct: false }),
      decision({ sure: true, correct: false, at: NOW - 20 * DAY }),
    ];
    expect(computeMetrics(input({ decisions }), NOW).sureWrongThisWeek.value).toBe(2);
  });

  it('reports zero with a zero sample on an empty log rather than dividing by nothing', () => {
    const metrics = computeMetrics(input(), NOW);
    expect(metrics.assessmentEvLossBb100.value).toBe(0);
    expect(metrics.assessmentEvLossBb100.sample).toBe(0);
    expect(Number.isNaN(metrics.assessmentEvLossBb100.value)).toBe(false);
  });
});

describe('P1 — assessment-mode EV loss', () => {
  it('averages assessment decisions only, ignoring practice', () => {
    const decisions = [
      decision({ mode: 'assessment', evLossBb: 0.02 }),
      decision({ mode: 'assessment', evLossBb: 0.04 }),
      decision({ mode: 'practice', evLossBb: 5 }),
    ];
    const metrics = computeMetrics(input({ decisions }), NOW);
    expect(metrics.assessmentEvLossBb100.value).toBeCloseTo(3, 10); // (0.06/2)*100
    expect(metrics.assessmentEvLossBb100.sample).toBe(2);
  });

  it('is lifetime, not weekly — an assessment runs every week and one week is 30 spots', () => {
    const decisions = [decision({ mode: 'assessment', evLossBb: 1, at: NOW - 60 * DAY })];
    expect(computeMetrics(input({ decisions }), NOW).assessmentEvLossBb100.sample).toBe(1);
  });
});

describe('P1 — fluent categories', () => {
  it('counts passing categories against the total as its sample', () => {
    const fluency = [
      { category: 'pairedness', passing: true },
      { category: 'connectivity', passing: true },
      { category: 'suitedness', passing: false },
    ];
    const metrics = computeMetrics(input({ fluency }), NOW);
    expect(metrics.fluentCategories.value).toBe(2);
    expect(metrics.fluentCategories.sample).toBe(3);
  });
});

describe('P1 — win rate is gated at 2,000 hands', () => {
  it('is absent at 1,999 hands: no key, not zero, not a placeholder', () => {
    const metrics = computeMetrics(input({ hands: seededHands(WIN_RATE_MIN_HANDS - 1, 3) }), NOW);
    expect('winRateVsBots' in metrics).toBe(false);
    expect(metrics.winRateVsBots).toBeUndefined();
    expect(Object.keys(metrics)).toHaveLength(4);
    expect(winRateMetric(input({ hands: seededHands(WIN_RATE_MIN_HANDS - 1, 3) }))).toBeNull();
  });

  it('is present at exactly 2,000 hands with a confidence band', () => {
    const hands = seededHands(WIN_RATE_MIN_HANDS, 3);
    const metrics = computeMetrics(input({ hands }), NOW);
    const winRate = metrics.winRateVsBots;
    expect(winRate).toBeDefined();
    expect(winRate!.sample).toBe(WIN_RATE_MIN_HANDS);
    expect(winRate!.ciLowerBb100).toBeLessThan(winRate!.value);
    expect(winRate!.ciUpperBb100).toBeGreaterThan(winRate!.value);
    expect(winRate!.unit).toBe('bb/100');
  });

  it('is absent with zero hands — the degenerate case takes the same path as 1,999', () => {
    expect(computeMetrics(input(), NOW).winRateVsBots).toBeUndefined();
  });

  it('counts only the fixed bot config, so a config change re-closes the gate', () => {
    const mixed = [
      ...seededHands(WIN_RATE_MIN_HANDS - 1, 11, 'bots-v1'),
      ...seededHands(500, 12, 'bots-v2'),
    ];
    expect(winRateMetric(input({ hands: mixed }))).toBeNull();

    const v2 = winRateMetric(input({ hands: [...mixed, ...seededHands(1500, 13, 'bots-v2')], botConfigId: 'bots-v2' }));
    expect(v2!.sample).toBe(2000);
    expect(v2!.botConfigId).toBe('bots-v2');
  });

  it('computes the rate as bb per 100 hands from the per-hand nets', () => {
    const hands = Array.from({ length: WIN_RATE_MIN_HANDS }, (_, i) =>
      hand({ netBb: i % 2 === 0 ? 2 : -1, at: NOW - i * 1000 }),
    );
    // Mean 0.5 bb/hand → 50 bb/100.
    expect(winRateMetric(input({ hands }))!.value).toBeCloseTo(50, 8);
  });

  it('never presents itself as a trend or a target', () => {
    const winRate = winRateMetric(input({ hands: seededHands(WIN_RATE_MIN_HANDS, 5) }))!;
    expect(winRate.target).toBeNull();
    expect(bannedPhrasingIn(winRate.note)).toBeNull();
    expect(bannedPhrasingIn(winRate.label)).toBeNull();
    expect(Object.keys(winRate)).not.toContain('series');
    expect(Object.keys(winRate)).not.toContain('trend');
  });
});

describe('P3 — the results graph is refused under 10,000 hands', () => {
  it('refuses at 9,999 with the variance module as the alternative', () => {
    const graph = resultsGraph(seededHands(RESULTS_GRAPH_MIN_HANDS - 1, 21));
    expect(graph.kind).toBe('refused');
    if (graph.kind !== 'refused') throw new Error('unreachable');
    expect(graph.alternative).toBe('variance-module');
    expect(graph.handsShort).toBe(1);
    expect(graph.reason).toContain('variance module');
    expect(graph).not.toHaveProperty('chipBb');
    expect(graph).not.toHaveProperty('evBb');
  });

  it('refuses on an empty log and reports the full shortfall', () => {
    const graph = resultsGraph([]);
    expect(graph.kind).toBe('refused');
    if (graph.kind !== 'refused') throw new Error('unreachable');
    expect(graph.handsShort).toBe(RESULTS_GRAPH_MIN_HANDS);
  });

  it('returns both series at exactly 10,000 hands', () => {
    const graph = resultsGraph(seededHands(RESULTS_GRAPH_MIN_HANDS, 21));
    expect(graph.kind).toBe('series');
    if (graph.kind !== 'series') throw new Error('unreachable');
    expect(graph.chipBb).toHaveLength(RESULTS_GRAPH_MIN_HANDS);
    expect(graph.evBb).toHaveLength(RESULTS_GRAPH_MIN_HANDS);
    expect(graph.hands).toBe(RESULTS_GRAPH_MIN_HANDS);
  });

  it('cumulates chronologically regardless of input order', () => {
    const unsorted = [
      hand({ at: NOW - 3000, netBb: 5, evBb: 1 }),
      hand({ at: NOW - 5000, netBb: -2, evBb: 3 }),
      ...seededHands(RESULTS_GRAPH_MIN_HANDS - 2, 22).map((h) => ({ ...h, at: NOW - 10_000_000 + h.at % 1000 })),
    ];
    const graph = resultsGraph(unsorted);
    if (graph.kind !== 'series') throw new Error('unreachable');
    // The two hand-written hands are the newest, so they close out both cumulative series.
    const chipDelta = graph.chipBb[graph.chipBb.length - 1] - graph.chipBb[graph.chipBb.length - 2];
    const evDelta = graph.evBb[graph.evBb.length - 1] - graph.evBb[graph.evBb.length - 2];
    expect(chipDelta).toBeCloseTo(5, 10);
    expect(evDelta).toBeCloseTo(1, 10);
  });

  it('returns the chip and EV series together — neither alone', () => {
    const hands = [
      ...Array.from({ length: RESULTS_GRAPH_MIN_HANDS }, (_, i) =>
        hand({ at: NOW - (RESULTS_GRAPH_MIN_HANDS - i) * 1000, netBb: 1, evBb: -1 }),
      ),
    ];
    const graph = resultsGraph(hands);
    if (graph.kind !== 'series') throw new Error('unreachable');
    expect(graph.chipBb[graph.chipBb.length - 1]).toBeCloseTo(RESULTS_GRAPH_MIN_HANDS, 6);
    expect(graph.evBb[graph.evBb.length - 1]).toBeCloseTo(-RESULTS_GRAPH_MIN_HANDS, 6);
    expect(graph.lesson).toContain('variance');
  });
});

describe('P2 — KC bars', () => {
  function kc(overrides: Partial<KcEvidence> = {}): KcEvidence {
    return {
      id: 'kc-1',
      label: 'folds too much to big bets',
      status: 'learning',
      posteriorMean: 0.6,
      ciLower: 0.45,
      ciUpper: 0.75,
      opportunities: 8,
      errorSignature: null,
      ...overrides,
    };
  }

  it('keeps a frozen KC visible with its error signature', () => {
    const frozen = kc({ id: 'kc-frozen', status: 'frozen', opportunities: 25, errorSignature: 'SIZING' });
    const bars = kcBars([kc(), frozen, kc({ id: 'kc-3', status: 'mastered', posteriorMean: 0.93 })]);

    expect(bars).toHaveLength(3);
    const frozenBar = bars.find((b) => b.id === 'kc-frozen')!;
    expect(frozenBar.status).toBe('frozen');
    expect(frozenBar.errorSignature).toBe('SIZING');
    expect(frozenBar.caption).toContain('SIZING');
    expect(frozenBar.caption).toContain('worked example');
  });

  it('names a frozen KC without a signature as unattributed rather than dropping the caption', () => {
    const bar = kcBar(kc({ status: 'frozen', opportunities: 25, errorSignature: null }));
    expect(bar.caption).toContain('unattributed');
  });

  it('carries the posterior and clamps the bar fill to [0, 1]', () => {
    expect(kcBar(kc({ posteriorMean: 0.72 })).fill).toBeCloseTo(0.72, 10);
    expect(kcBar(kc({ posteriorMean: -0.3 })).fill).toBe(0);
    expect(kcBar(kc({ posteriorMean: 1.4 })).fill).toBe(1);
  });

  it('renders a zero-opportunity KC rather than throwing', () => {
    const bar = kcBar(kc({ opportunities: 0, posteriorMean: 0.5 }));
    expect(bar.opportunities).toBe(0);
    expect(bar.caption).toContain('0 opportunities');
  });

  it('returns an empty list for no KCs', () => {
    expect(kcBars([])).toEqual([]);
  });

  it('does not import schedule.ts — the two compose through a plain input type', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/core/progress.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain("from './schedule");
  });
});

describe('G7 — aggregate by error tag, never by trait', () => {
  const tagged = (tag: ErrorTag | null, evLossBb: number) => decision({ tag, evLossBb });

  it('matches hand-computed bb/100 against the full decision scope', () => {
    const decisions = [
      tagged('SIZING', 2),
      tagged('SIZING', 4),
      tagged('RANGE', 1),
      tagged(null, 0),
      tagged(null, 0),
    ];
    const aggregates = tagAggregates(decisions);

    // SIZING: 6 bb over 5 decisions → 120 bb/100. RANGE: 1 bb over 5 → 20 bb/100.
    expect(aggregates.map((a) => a.tag)).toEqual(['SIZING', 'RANGE']);
    expect(aggregates[0].evLossBb100).toBeCloseTo(120, 10);
    expect(aggregates[0].occurrences).toBe(2);
    expect(aggregates[0].decisions).toBe(5);
    expect(aggregates[1].evLossBb100).toBeCloseTo(20, 10);
  });

  it('omits tags with no occurrences instead of listing them at zero', () => {
    const aggregates = tagAggregates([tagged('PURITY', 0.5)]);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].tag).toBe('PURITY');
  });

  it('returns nothing for an empty log', () => {
    expect(tagAggregates([])).toEqual([]);
  });

  it('breaks equal-loss ties on the G7 precedence order', () => {
    const aggregates = tagAggregates([tagged('PURITY', 1), tagged('RANGE', 1), tagged('PRICE', 1)]);
    expect(aggregates.map((a) => a.tag)).toEqual(['RANGE', 'PRICE', 'PURITY']);
  });

  it('formats exactly as the spec quotes it', () => {
    const formatted = formatTagAggregate({
      tag: 'SIZING',
      evLossBb100: 1.9,
      decisions: 340,
      occurrences: 40,
    });
    expect(formatted).toBe('SIZING: 1.9 bb/100 across 340 decisions');
  });

  it('formats every tag without ever naming a trait', () => {
    for (const tag of ERROR_TAGS) {
      const formatted = formatTagAggregate({ tag, evLossBb100: 1.9, decisions: 340, occurrences: 40 });
      expect(bannedPhrasingIn(formatted)).toBeNull();
      expect(formatted).toContain(tag);
    }
  });
});

describe('the ban list', () => {
  it('still catches TRAIT and praise phrasing (the G7 pedagogy rule, unchanged)', () => {
    expect(bannedPhrasingIn("you're too loose")).not.toBeNull();
    expect(bannedPhrasingIn('you are a nit')).not.toBeNull();
    expect(bannedPhrasingIn('great job, well done')).not.toBeNull();
    expect(bannedPhrasingIn('what a maniac')).not.toBeNull();
  });

  it('no longer bans gamification vocabulary (removed 2026-08-14 by product decision)', () => {
    // Streaks, XP, ranks, badges, leaderboards, personal bests are now allowed — the app is adding
    // honest progress features built on real logged data.
    expect(bannedPhrasingIn('4 correct in a row')).toBeNull();
    expect(bannedPhrasingIn('a 7-day streak')).toBeNull();
    expect(bannedPhrasingIn('top 1% of players')).toBeNull();
    expect(bannedPhrasingIn('your EV trend is up')).toBeNull();
    expect(bannedPhrasingIn('you earned 120 XP')).toBeNull();
    expect(bannedPhrasingIn('a new personal best')).toBeNull();
    expect(bannedPhrasingIn('milestone badge unlocked')).toBeNull();
  });

  it('matches on word boundaries so honest words are not flagged', () => {
    expect(bannedPhrasingIn('unit of measurement, by definition')).toBeNull();
    expect(bannedPhrasingIn('the ranking of nodes is infinite')).toBeNull();
    expect(bannedPhrasingIn('')).toBeNull();
  });

  it('rejects nothing the module actually emits', () => {
    const decisions: DecisionRecord[] = [
      decision({ mode: 'assessment', evLossBb: 0.3, tag: 'RANGE', sure: true, correct: false }),
      decision({ evLossBb: 1.2, tag: 'SIZING' }),
      decision({ evLossBb: 0, tag: null }),
    ];
    const metrics = computeMetrics(
      input({
        decisions,
        hands: seededHands(WIN_RATE_MIN_HANDS, 31),
        fluency: [{ category: 'pairedness', passing: true }],
      }),
      NOW,
    );
    const graph = resultsGraph(seededHands(RESULTS_GRAPH_MIN_HANDS, 32));
    const shortGraph = resultsGraph(seededHands(10, 33));
    const bars = kcBars([
      {
        id: 'kc-1',
        label: 'overfolds to a big turn bet',
        status: 'frozen',
        posteriorMean: 0.55,
        ciLower: 0.4,
        ciUpper: 0.7,
        opportunities: 25,
        errorSignature: 'PRICE',
      },
      {
        id: 'kc-2',
        label: 'raise size on a dynamic flop',
        status: 'mastered',
        posteriorMean: 0.94,
        ciLower: 0.87,
        ciUpper: 0.99,
        opportunities: 14,
        errorSignature: null,
      },
      {
        id: 'kc-3',
        label: 'blocker-aware bluff selection',
        status: 'learning',
        posteriorMean: 0.5,
        ciLower: 0.3,
        ciUpper: 0.7,
        opportunities: 4,
        errorSignature: null,
      },
    ]);

    const emitted = [
      ...Object.values(metrics).map((m) => m.label),
      metrics.winRateVsBots!.note,
      ...bars.map((b) => b.caption),
      ...tagAggregates(decisions).map(formatTagAggregate),
      ...(graph.kind === 'series' ? [graph.lesson] : []),
      ...(shortGraph.kind === 'refused' ? [shortGraph.reason, shortGraph.alternative] : []),
    ];

    expect(emitted.length).toBeGreaterThan(10);
    for (const text of emitted) {
      expect(bannedPhrasingIn(text), `banned phrasing in: ${text}`).toBeNull();
    }
  });

  it('bans no phrase twice and none empty', () => {
    expect(new Set(BANNED_PHRASINGS).size).toBe(BANNED_PHRASINGS.length);
    expect(BANNED_PHRASINGS.every((p) => p.length > 0)).toBe(true);
  });
});

describe('purity', () => {
  it('is stable across repeated calls with the same now', () => {
    const fixture = input({
      decisions: [decision({ tag: 'SIZING', evLossBb: 1 })],
      hands: seededHands(WIN_RATE_MIN_HANDS, 41),
    });
    expect(computeMetrics(fixture, NOW)).toEqual(computeMetrics(fixture, NOW));
    expect(resultsGraph(fixture.hands)).toEqual(resultsGraph(fixture.hands));
  });

  it('moves the weekly window when now moves, without touching the log', () => {
    const decisions = [decision({ at: NOW - 3 * DAY })];
    expect(computeMetrics(input({ decisions }), NOW).gradedDecisionsThisWeek.value).toBe(1);
    expect(computeMetrics(input({ decisions }), NOW + 10 * DAY).gradedDecisionsThisWeek.value).toBe(0);
    expect(decisions).toHaveLength(1);
  });

  it('does not mutate the input hand array when sorting for the graph', () => {
    const hands = seededHands(RESULTS_GRAPH_MIN_HANDS, 42).reverse();
    const before = hands.map((h) => h.at);
    resultsGraph(hands);
    expect(hands.map((h) => h.at)).toEqual(before);
  });
});

describe('decisionRecordsFromHands — the session-log adapter that feeds the effort metric', () => {
  const gradedDecision = (severity: 'free' | 'notable' | 'serious', evLossBb: number) => ({
    verdict: { severity, evLossBb },
  });

  it('flattens every graded decision across hands into practice records at the hand timestamp', () => {
    const hands: LoggedHand[] = [
      { playedAt: NOW - DAY, decisions: [gradedDecision('free', 0), gradedDecision('serious', 3.2)] },
      { playedAt: NOW - 2 * DAY, decisions: [gradedDecision('notable', 1.1)] },
    ];
    const records = decisionRecordsFromHands(hands);
    expect(records).toHaveLength(3);
    // Every record is practice-mode, inherits its hand's timestamp, and never fabricates a tag or certainty.
    for (const r of records) {
      expect(r.mode).toBe('practice');
      expect(r.tag).toBeNull();
      expect(r.sure).toBe(false);
    }
    expect(records[0]).toMatchObject({ at: NOW - DAY, correct: true, evLossBb: 0 });
    expect(records[1]).toMatchObject({ at: NOW - DAY, correct: false, evLossBb: 3.2 });
    expect(records[2]).toMatchObject({ at: NOW - 2 * DAY, correct: false, evLossBb: 1.1 });
  });

  it("treats the coach's silence (severity 'free') as the only 'correct' decision", () => {
    const hands: LoggedHand[] = [
      { playedAt: NOW, decisions: [gradedDecision('free', 0), gradedDecision('notable', 0.4), gradedDecision('serious', 5)] },
    ];
    const records = decisionRecordsFromHands(hands);
    expect(records.map((r) => r.correct)).toEqual([true, false, false]);
  });

  it('skips a hand with no playedAt — an undated decision cannot be placed in a week', () => {
    const hands: LoggedHand[] = [
      { decisions: [gradedDecision('free', 0)] }, // legacy hand, no timestamp
      { playedAt: NOW, decisions: [gradedDecision('free', 0)] },
    ];
    expect(decisionRecordsFromHands(hands)).toHaveLength(1);
  });

  it('skips a decision with no verdict rather than inventing one', () => {
    const hands: LoggedHand[] = [
      { playedAt: NOW, decisions: [{ verdict: null }, gradedDecision('serious', 2)] },
    ];
    const records = decisionRecordsFromHands(hands);
    expect(records).toHaveLength(1);
    expect(records[0].evLossBb).toBe(2);
  });

  it('a hand with no decisions array contributes nothing, and an empty log is empty', () => {
    expect(decisionRecordsFromHands([{ playedAt: NOW }])).toEqual([]);
    expect(decisionRecordsFromHands([])).toEqual([]);
  });

  it('feeds the effort metric so the week window counts real decisions', () => {
    // Two hands this week, one last week: only the two recent decisions are "this week".
    const hands: LoggedHand[] = [
      { playedAt: NOW - DAY, decisions: [gradedDecision('free', 0)] },
      { playedAt: NOW - 2 * DAY, decisions: [gradedDecision('serious', 4)] },
      { playedAt: NOW - WEEK_MS - DAY, decisions: [gradedDecision('free', 0)] },
    ];
    const metrics = computeMetrics(input({ decisions: decisionRecordsFromHands(hands) }), NOW);
    expect(metrics.gradedDecisionsThisWeek.value).toBe(2);
    // None are assessment spots, so that metric stays empty — the honesty boundary the wiring keeps.
    expect(metrics.assessmentEvLossBb100.sample).toBe(0);
  });
})
