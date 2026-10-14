// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderProHands } from '../../src/renderer/screens/proHands.js';
import { renderProIcm } from '../../src/renderer/screens/proIcm.js';
import { leakReport } from '../../src/core/pro/leaks.js';
import { parseHandHistories } from '../../src/core/pro/parse.js';
import { answerShove, parseShoveRequest } from '../../src/core/pro/analysis.js';

/**
 * The two Pro screens over a fake bridge that runs core in-process: the wiring the screens add (what is
 * drawn from main's answer, what a locked or malformed answer draws, what a click asks main for).
 * Layout and the gate are pro-tools.spec's.
 */

const FIXTURES = path.resolve(import.meta.dirname, '..', 'fixtures', 'hh');
const hands = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.txt')).flatMap((f) => parseHandHistories(fs.readFileSync(path.join(FIXTURES, f), 'utf8')).hands);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Pro · Hands', () => {
  it('draws the report main sends: 14 spots, the summary, nothing read as a leak under 20 hands', async () => {
    const root = renderProHands({
      bridge: { proHandsReport: async () => ({ report: leakReport(hands), meta: { at: '2026-10-14T05:00:00Z', files: 9, sites: ['pokerstars', 'acr'] } }) },
      onPractise: () => undefined,
    });
    await flush();
    expect(root.querySelectorAll('[data-testid="pro-spot"]')).toHaveLength(14);
    expect(root.querySelector('[data-testid="pro-stat-hands"]')!.textContent).toContain(String(hands.length));
    expect(root.querySelector('[data-testid="pro-last-import"]')!.textContent).toContain('PokerStars, ACR');
    expect(root.querySelectorAll('[data-reading="leak"]')).toHaveLength(0);
    expect((root.querySelector('[data-testid="pro-empty"]') as HTMLElement).hidden).toBe(true);
  });

  it('a locked or malformed answer draws the empty state, not a crash', async () => {
    for (const answer of [{ locked: 'leak-finder' }, null, { report: { spots: 'x' } }]) {
      const root = renderProHands({ bridge: { proHandsReport: async () => answer }, onPractise: () => undefined });
      await flush();
      expect((root.querySelector('[data-testid="pro-empty"]') as HTMLElement).hidden).toBe(false);
      expect(root.querySelectorAll('[data-testid="pro-spot"]')).toHaveLength(0);
    }
  });

  it('import asks main (no path crosses), reports counts in words; delete needs a second click', async () => {
    let imports = 0;
    let cleared = 0;
    const root = renderProHands({
      bridge: {
        proHandsReport: async () => ({ report: leakReport(cleared ? [] : hands), meta: null }),
        proImportHands: async (...args: unknown[]) => {
          imports++;
          expect(args).toEqual([]);
          return { canceled: false, files: 2, added: 5, duplicates: 1, overCap: 0, handsSkipped: { partial: 1 }, filesSkipped: { link: 1 } };
        },
        proClearHands: async () => ((cleared++), { cleared: true, total: 0 }),
      },
      onPractise: () => undefined,
    });
    await flush();
    (root.querySelector('[data-testid="pro-import"]') as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(imports).toBe(1);
    expect(root.querySelector('[data-testid="pro-import-notice"]')!.textContent).toBe(
      'Added 5 hands from 2 files. 1 already imported. Skipped: 1 cut off mid-hand, 1 a link.',
    );
    const clear = root.querySelector('[data-testid="pro-clear"]') as HTMLButtonElement;
    clear.click();
    await flush();
    expect(cleared).toBe(0);
    clear.click();
    await flush();
    await flush();
    expect(cleared).toBe(1);
  });
});

describe('Pro · ICM', () => {
  it('sends the spot and the named callers, and draws the chart main answers', async () => {
    const sent: unknown[] = [];
    const root = renderProIcm({
      bridge: {
        proShove: async (req) => {
          sent.push(req);
          const r = parseShoveRequest(req);
          return r === null ? { invalid: true } : { answer: answerShove(r) };
        },
      },
    });
    document.body.appendChild(root);
    for (let i = 0; i < 50 && root.dataset.solving !== 'false'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(sent[0]).toMatchObject({ stacks: [27, 13, 6, 14], payouts: [0.5, 0.3, 0.2], callers: { kind: 'equilibrium' } });
    expect(root.querySelectorAll('[data-testid="pro-cell"]')).toHaveLength(169);
    expect(root.querySelector('[data-combo="AA"]')!.getAttribute('data-kind')).toBe('push');
    expect(root.querySelectorAll('[data-testid="pro-seat"]')).toHaveLength(4);
    expect(root.querySelector('[data-testid="pro-icm-note"]')!.textContent).toMatch(/equilibrium.*bubble factor/);
    (root.querySelector('[data-testid="pro-callers-top25"]') as HTMLButtonElement).click();
    await flush();
    expect(sent[1]).toMatchObject({ callers: { kind: 'top', share: 0.25 } });
    root.remove();
  });

  it('an invalid spot says so instead of drawing stale numbers as new', async () => {
    const root = renderProIcm({ bridge: { proShove: async () => ({ invalid: true }) } });
    await flush();
    await flush();
    expect(root.querySelector('[data-testid="pro-solving"]')!.textContent).toContain('cannot happen');
  });
});
