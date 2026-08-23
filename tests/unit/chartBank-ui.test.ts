// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderChartBank } from '../../src/renderer/screens/chartBank.js';
import { CHART_BANK, correctAction, chartById, type ChartBankProgress } from '../../src/core/chartBank.js';

/**
 * The screen is a surface over the (separately tested) core/chartBank.ts. These tests own the wiring the
 * screen adds: the catalog renders every chart, selecting one swaps the detail + its action set, a real
 * unmodified keypress grades against the SELECTED chart and reports progress, and a modifier-held or
 * off-chart key does not.
 */

function press(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

describe('chart bank screen', () => {
  let root: HTMLElement;
  let saved: ChartBankProgress[];

  beforeEach(() => {
    document.body.replaceChildren();
    saved = [];
    root = renderChartBank({ onProgress: (p) => saved.push(p) });
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
    press('x'); // let the self-removing keydown listener unregister on its next fire
  });

  it('lists every chart in the bank as a catalog item', () => {
    const items = root.querySelectorAll('[data-testid="catalog-item"]');
    expect(items).toHaveLength(CHART_BANK.length);
    // Defaults to the first chart.
    expect(root.dataset.chart).toBe(CHART_BANK[0].id);
  });

  it('renders all 169 cells for the selected chart, actioned', () => {
    const cells = root.querySelectorAll('[data-testid="chart-cell"]');
    expect(cells).toHaveLength(169);
    // The AA cell opens on the default RFI-UTG chart.
    const aa = root.querySelector<HTMLElement>('[data-testid="chart-cell"][data-combo="AA"]');
    expect(aa?.dataset.action).toBe('open');
  });

  it('selecting a defense chart swaps the detail and exposes 3-bet/call/fold', () => {
    const target = root.querySelector<HTMLElement>('[data-testid="catalog-item"][data-chart="def-bb-vs-btn"]');
    target!.click();
    expect(root.dataset.chart).toBe('def-bb-vs-btn');
    expect(root.querySelector('[data-testid="drill-threebet"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="drill-call"]')).not.toBeNull();
    // RFI's open key is gone on a defense chart.
    expect(root.querySelector('[data-testid="drill-open"]')).toBeNull();
  });

  it('grades a real keypress against the selected chart and reports progress', () => {
    const spot = root.dataset.spot!;
    const chart = chartById(CHART_BANK[0].id)!;
    const want = correctAction(chart, spot); // 'open' or 'fold' for the default RFI chart
    // Answer correctly by pressing the matching key.
    press(want === 'open' ? 'o' : 'f');
    expect(root.dataset.answered).toBe('1');
    expect(saved).toHaveLength(1);
    expect(saved[0].tallies[chart.id]).toEqual({ attempts: 1, correct: 1 });
    expect(root.dataset.verdict).toBe('right');
  });

  it('ignores a modifier-held keypress and an off-chart key', () => {
    press('o', { metaKey: true });
    press('t'); // 3-bet is not offered on the default RFI chart
    expect(root.dataset.answered).toBe('0');
    expect(saved).toHaveLength(0);
  });

  it('clicking a drill button grades the same as its key', () => {
    root.querySelector<HTMLElement>('[data-testid="drill-fold"]')!.click();
    expect(root.dataset.answered).toBe('1');
    expect(saved).toHaveLength(1);
  });
});
