// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { DayKey } from '../../src/core/localDay.js';
import { FICTIONAL_LABEL, RAIL_TIERS } from '../../src/core/progression/rail.js';
import { seasonArchive, seasonBounds, seasonView } from '../../src/core/progression/season.js';
import type { RailState, SeasonsState } from '../../src/core/progression/types.js';
import { bannedPhrasingIn } from '../../src/core/progress.js';
import { renderRail } from '../../src/renderer/screens/rail.js';
import { comparisonLine, renderSeason, type SeasonPane } from '../../src/renderer/screens/season.js';

const start = seasonBounds(6).start;
const today = (start + 9) as DayKey;
const tally = (n: number, mean: number) => ({ n, sum: n * mean, sumSq: n * (mean * mean + 1) });

const rail: RailState = {
  tier: 'four',
  weeks: [
    { week: (start - 7) as DayKey, loss: tally(50, 2), reps: 900, grader: 1, mixed: false, outcome: 'up' },
    { week: start, loss: tally(10, 1), reps: 300, grader: 1, mixed: true, outcome: 'mixed' },
    { week: (start + 7) as DayKey, loss: tally(12, 1.5), reps: 200, grader: 1, mixed: false, outcome: null },
  ],
  promotions: [{ week: (start - 7) as DayKey, from: 'three', to: 'four' }],
};
const block = (at: number, mean: number) => ({ at, loss: tally(30, mean), grader: 1 });
const seasons: SeasonsState = {
  records: [
    { season: 5, reps: 5000, grader: 1, baseline: block(1, 3), finale: block(2, 1) },
    { season: 6, reps: 800, grader: 1, baseline: block(3, 2), finale: null },
  ],
};

function screens(): HTMLElement[] {
  const view = seasonView(seasons, today);
  const archive = seasonArchive(seasons, rail, [], today);
  const out: HTMLElement[] = [renderRail({ rail, today, onPlay: () => undefined })];
  for (const pane of ['track', 'finale', 'archive'] as SeasonPane[]) out.push(renderSeason({ view, archive, pane, onPane: () => undefined, onTakeBlock: () => undefined }));
  return out;
}

describe('the Ghost Rail and Season screens', () => {
  it('pass the content lint: no trait claims, no praise', () => {
    for (const root of screens()) expect(bannedPhrasingIn(root.textContent ?? '')).toBeNull();
    for (const kind of ['alone', 'graders', 'tie', 'apart'] as const) expect(bannedPhrasingIn(comparisonLine({ kind, change: -3 } as never))).toBeNull();
  });

  it('labels every bot on the board as fictional, and names no one but the learner otherwise', () => {
    const root = renderRail({ rail, today, onPlay: () => undefined });
    const bots = root.querySelectorAll('[data-testid="rail-row"][data-kind="bot"]');
    expect(bots).toHaveLength(3);
    for (const b of bots) expect(b.textContent).toContain(FICTIONAL_LABEL);
    for (const r of root.querySelectorAll('[data-testid="rail-row"]:not([data-kind="bot"]) .league-row-name')) expect(r.textContent).toMatch(/^You/);
    expect(root.querySelector('[data-testid="rail-ladder"]')?.children).toHaveLength(RAIL_TIERS.length);
    expect(root.querySelector('[data-testid="rail-past"]')?.textContent).toContain('two grader versions');
  });

  it('shows no chip, pot or money figure anywhere, and nothing for sale', () => {
    for (const root of screens()) {
      const text = (root.textContent ?? '').toLowerCase();
      expect(text).not.toMatch(/bankroll|\bpots?\b|\$|\b(buy|sale|purchase)\b/);
    }
  });

  it('the track week offers the opening block only while none is on file; the finale is not offered before its week', () => {
    const view = seasonView(seasons, today);
    const finale = renderSeason({ view, archive: [], pane: 'finale', onPane: () => undefined, onTakeBlock: () => undefined });
    // Season 6 already has its opening block, and the finale week has not come: nothing to take.
    expect(finale.querySelector('[data-testid="season-take"]')).toBeNull();
    expect(finale.querySelector('[data-testid="season-finale-when"]')?.textContent).toContain('Opens on');
    const empty = seasonView({ records: [] }, today);
    const open = renderSeason({ view: empty, archive: [], pane: 'finale', onPane: () => undefined, onTakeBlock: () => undefined });
    expect(open.querySelector('[data-testid="season-take"]')?.textContent).toBe('Take the opening block');
    const inFinale = seasonView({ records: [] }, (seasonBounds(6).finale + 1) as DayKey);
    const f = renderSeason({ view: inFinale, archive: [], pane: 'finale', onPane: () => undefined, onTakeBlock: () => undefined });
    expect(f.querySelector('[data-testid="season-take"]')?.textContent).toBe('Take the finale');
  });
});
