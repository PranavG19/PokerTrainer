import { describe, it, expect } from 'vitest';
import {
  CHART_BANK,
  DEFAULT_CHART_ID,
  EMPTY_PROGRESS,
  actionComboCount,
  chartById,
  chartCells,
  chartWidth,
  correctAction,
  deserializeProgress,
  gradeChartAnswer,
  recordAnswer,
  serializeProgress,
  type ChartBankProgress,
  type PreflopChart,
} from '../../src/core/chartBank.js';
import { ALL_COMBOS, isCombo, isInRfiRange, defenseAction } from '../../src/core/preflop.js';

/**
 * The chart bank is a thin catalog over the ALREADY-VERIFIED preflop.ts ranges (preflop.test.ts and
 * defense.test.ts pin the range values combo-by-combo). So these tests own three things the catalog
 * layer itself is responsible for: (1) data integrity — every chart covers all 169 valid combos with
 * legal actions and a sane width; (2) that the bank never diverges from preflop.ts's answers; and
 * (3) drill scoring + persistence round-trip.
 */

describe('chart bank — data integrity', () => {
  it('ships the five RFI charts and the six vs-RFI defense charts, all with unique ids', () => {
    expect(CHART_BANK).toHaveLength(11);
    expect(CHART_BANK.filter((c) => c.category === 'rfi')).toHaveLength(5);
    expect(CHART_BANK.filter((c) => c.category === 'defense')).toHaveLength(6);
    const ids = CHART_BANK.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_CHART_ID).toBe(ids[0]);
  });

  it('every chart resolves all 169 canonical combos to one of its own legal actions', () => {
    for (const chart of CHART_BANK) {
      const cells = chartCells(chart);
      expect(cells).toHaveLength(169);
      const combos = cells.map((c) => c.combo);
      // Exactly the 169 canonical combos, each valid, no duplicates.
      expect(new Set(combos).size).toBe(169);
      for (const cell of cells) {
        expect(isCombo(cell.combo), `${cell.combo} not a canonical combo`).toBe(true);
        expect(chart.actions).toContain(cell.action);
      }
    }
  });

  it('every chart width sits strictly inside (0, 1) — never empty, never everything', () => {
    for (const chart of CHART_BANK) {
      const width = chartWidth(chart);
      expect(width, `${chart.id} width`).toBeGreaterThan(0);
      expect(width, `${chart.id} width`).toBeLessThan(1);
    }
  });

  it('RFI widths are in the sane published band (tightest UTG >= 10%, widest BTN <= 55%)', () => {
    const utg = chartWidth(chartById('rfi-UTG')!);
    const btn = chartWidth(chartById('rfi-BTN')!);
    expect(utg).toBeGreaterThanOrEqual(0.1);
    expect(btn).toBeLessThanOrEqual(0.55);
    expect(utg).toBeLessThan(btn);
  });

  it('the width equals the weighted-combo count of every non-fold action over 1326', () => {
    for (const chart of CHART_BANK) {
      const nonFold = chart.actions
        .filter((a) => a !== 'fold')
        .reduce((sum, action) => sum + actionComboCount(chart, action), 0);
      expect(chartWidth(chart)).toBeCloseTo(nonFold / 1326, 10);
    }
  });
});

describe('chart bank — agrees with preflop.ts (no independent poker maths)', () => {
  it('RFI charts mirror isInRfiRange for all 169 combos', () => {
    const co = chartById('rfi-CO')!;
    for (const combo of ALL_COMBOS) {
      const expected = isInRfiRange(combo, 'CO') ? 'open' : 'fold';
      expect(correctAction(co, combo), combo).toBe(expected);
    }
  });

  it('defense charts mirror defenseAction for all 169 combos', () => {
    const chart = chartById('def-bb-vs-btn')!;
    for (const combo of ALL_COMBOS) {
      expect(correctAction(chart, combo), combo).toBe(defenseAction(combo, 'bb-vs-btn'));
    }
  });

  it('rejects a combo outside the 169-cell domain', () => {
    expect(() => correctAction(CHART_BANK[0], 'ZZ')).toThrow();
  });
});

describe('chart bank — drill scoring', () => {
  const rfi = chartById('rfi-UTG')!;

  it('grades a correct open on a premium and a correct fold on trash', () => {
    expect(gradeChartAnswer(rfi, 'AA', 'open').right).toBe(true);
    expect(gradeChartAnswer(rfi, '72o', 'fold').right).toBe(true);
  });

  it('grades a wrong answer as wrong and reports the correct action', () => {
    const g = gradeChartAnswer(rfi, 'AA', 'fold');
    expect(g.right).toBe(false);
    expect(g.correct).toBe('open');
    expect(g.chose).toBe('fold');
  });

  it('scores a three-bet on a defense chart', () => {
    const def = chartById('def-bb-vs-utg')!;
    // AA is a three-bet in every BB spot (see defense.test.ts).
    expect(gradeChartAnswer(def, 'AA', 'threebet').right).toBe(true);
    expect(gradeChartAnswer(def, 'AA', 'call').right).toBe(false);
  });

  it('refuses to grade an action the chart does not offer', () => {
    // 'threebet' is meaningless on an open-or-fold RFI chart.
    expect(() => gradeChartAnswer(rfi, 'AA', 'threebet')).toThrow();
    // 'open' is meaningless on a facing-a-raise chart.
    expect(() => gradeChartAnswer(chartById('def-bb-vs-utg')!, 'AA', 'open')).toThrow();
  });

  it('recordAnswer accumulates attempts and correct without mutating the input', () => {
    let progress: ChartBankProgress = EMPTY_PROGRESS;
    progress = recordAnswer(progress, gradeChartAnswer(rfi, 'AA', 'open')); // right
    progress = recordAnswer(progress, gradeChartAnswer(rfi, 'AA', 'fold')); // wrong
    expect(progress.tallies['rfi-UTG']).toEqual({ attempts: 2, correct: 1 });
    // EMPTY_PROGRESS is untouched.
    expect(EMPTY_PROGRESS.tallies).toEqual({});
  });
});

describe('chart bank — persistence round-trip', () => {
  it('round-trips a valid progress exactly', () => {
    const progress: ChartBankProgress = {
      selectedId: 'def-bb-vs-co',
      tallies: { 'rfi-UTG': { attempts: 10, correct: 7 }, 'def-bb-vs-co': { attempts: 3, correct: 3 } },
    };
    expect(deserializeProgress(serializeProgress(progress))).toEqual(progress);
  });

  it('falls back to the default chart and empty tallies on junk', () => {
    expect(deserializeProgress('not json')).toEqual(EMPTY_PROGRESS);
    expect(deserializeProgress('')).toEqual(EMPTY_PROGRESS);
    expect(deserializeProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(deserializeProgress('{}')).toEqual(EMPTY_PROGRESS);
  });

  it('drops tallies for unknown chart ids and falls back on an unknown selection', () => {
    const stored = JSON.stringify({
      selectedId: 'rfi-XYZ',
      tallies: { 'ghost-chart': { attempts: 5, correct: 2 }, 'rfi-CO': { attempts: 4, correct: 1 } },
    });
    const result = deserializeProgress(stored);
    expect(result.selectedId).toBe(DEFAULT_CHART_ID);
    expect(result.tallies).toEqual({ 'rfi-CO': { attempts: 4, correct: 1 } });
  });

  it('clamps an impossible tally (correct > attempts, negatives, fractions)', () => {
    const stored = JSON.stringify({
      selectedId: 'rfi-CO',
      tallies: { 'rfi-CO': { attempts: -3, correct: 9 }, 'rfi-BTN': { attempts: 8.9, correct: 12.4 } },
    });
    const result = deserializeProgress(stored);
    expect(result.tallies['rfi-CO']).toEqual({ attempts: 0, correct: 0 });
    // attempts floors to 8, correct clamps down to attempts.
    expect(result.tallies['rfi-BTN']).toEqual({ attempts: 8, correct: 8 });
  });
});
