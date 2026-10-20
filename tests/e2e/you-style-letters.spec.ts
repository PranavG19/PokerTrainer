import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';
import { systemDayKeyOf, DAY_BOUNDARY_HOUR } from '../../src/core/localDay.js';
import { weekOf } from '../../src/core/week.js';

/**
 * YOU › STYLE and YOU › LETTERS (VISION pillar 9).
 *
 * - Fresh: both pages are open (nothing locked), say what they need, and fit both window sizes.
 * - Seeded (three weeks of coached hands): Style names the style from the log with its numbers and trail, places the
 *   unmasked regular on the map, and saves the card through the native dialog only; Letters files the two ended weeks
 *   into the profile, shows this week as a draft, quotes the learner's rule, and every number in the prose is one the
 *   stored record holds.
 */

const STATE = 'offsuit-state.json';
const SHOTS = process.env.YSL_SHOTS ?? path.join('tests', 'tmp', 'you-style-letters');
const freshDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-ysl-'));
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8')) as Record<string, any>;

const DAY = 86_400_000;
const dayOf = systemDayKeyOf(DAY_BOUNDARY_HOUR);
const thisWeek = weekOf(dayOf(Date.now()));
/** Mid-afternoon local time on a DayKey: well clear of the 4 am line. */
function msOn(day: number): number {
  const guess = day * DAY + 14 * 3_600_000;
  return guess + new Date(guess).getTimezoneOffset() * 60_000;
}

function decision(over: Record<string, unknown>) {
  return { street: 'river', board: ['4s', '4d', 'Kd', '9c', 'Js'], pot: 900, toCall: 450, action: 'call', amount: null, verdict: { severity: 'free', evLossBb: 0, message: null, principle: null }, ...over };
}

/** n hands on `day`: `vpip` played, `pfr` raised first; the first carries the decisions. */
function hands(day: number, n: number, vpip: number, pfr: number, decisions: unknown[]) {
  return Array.from({ length: n }, (_, i) => ({
    handNumber: i + 1,
    hole: ['Kh', '2d'],
    board: [],
    net: 0,
    vpip: i < vpip,
    pfr: i < pfr,
    grades: [],
    playedAt: msOn(day) + i * 1000,
    decisions: i === 0 ? decisions : [],
  }));
}

function seeded(): Record<string, unknown> {
  const w2 = thisWeek - 14;
  const w1 = thisWeek - 7;
  const sheet = decision({ action: 'call', verdict: { severity: 'serious', evLossBb: 3.2, message: null, principle: 'pot odds' } });
  const log = [
    ...hands(w2 + 2, 80, 32, 8, [decision({}), sheet, decision({ street: 'flop', action: 'bet', toCall: 0 })]),
    ...hands(w1 + 1, 100, 22, 18, [decision({}), decision({}), decision({ action: 'fold', pot: 1200, toCall: 600 }), sheet]),
    ...hands(thisWeek, 30, 6, 5, [decision({})]),
  ];
  const assess = (day: number, loss: number) => Array.from({ length: 30 }, (_, i) => ({ at: msOn(day) + i * 1000, evLossBb: loss, correct: loss === 0, principle: 'pot odds', toCall: 10, street: 'river' }));
  return {
    schemaVersion: 2,
    hands: log,
    stats: { handsPlayed: log.length, vpipHands: 60, pfrHands: 31, evLossBb: 6.4, leaks: { 'pot odds': 2 }, leakCostBb: { 'pot odds': 6.4 } },
    assessments: [...assess(w2 + 3, 0.06), ...assess(w1 + 3, 0.03)],
    progression: {
      personalization: { displayName: 'Sam', goals: ['understand-losses'] },
      dee: { ruleSentences: [{ conceptId: 'pot-odds', text: 'the price is the call over the pot after I call', day: w1 + 2 }] },
      milestones: { achieved: { 'first-assessment': { day: w2 + 3 } } },
      story: {
        chapters: { lighthouse: { introSeen: true, lessonDone: true, tables: 1, lastResult: 'met', beatenOn: w1 + 4 } },
        rivals: { wren: { hands: 6, sittings: [{ day: w1 + 4, chapter: 'lighthouse', judged: 5, free: 4, serious: 0 }], showdowns: [] } },
      },
    },
  };
}

async function open(page: Page, leaf: 'style' | 'letters'): Promise<void> {
  await page.locator('[data-testid="tab-you"]').click();
  await page.locator(`[data-testid="tab-${leaf}"]`).click();
  await expect(page.locator(`[data-testid="you-${leaf}"]`)).toBeVisible();
}

async function size(app: Awaited<ReturnType<typeof launchApp>>, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

/** Both sizes: no page scroll, nothing on the page clipped out of its own box sideways, and a screenshot of each. */
async function fitsAndShoot(app: Awaited<ReturnType<typeof launchApp>>, leaf: string, profile: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await size(app, w, h);
    const [sh, ih, sw, iw] = await app.page.evaluate(() => [document.documentElement.scrollHeight, innerHeight, document.documentElement.scrollWidth, innerWidth]);
    expect(sh, `${leaf} ${w}x${h} scrolls`).toBeLessThanOrEqual(ih);
    expect(sw, `${leaf} ${w}x${h} scrolls sideways`).toBeLessThanOrEqual(iw);
    // The screen's own content stays inside it: no child box past the screen's bottom edge.
    const overflow = await app.page.evaluate((testid) => {
      const root = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement;
      const bottom = root.getBoundingClientRect().bottom + 1;
      return [...root.querySelectorAll('button, .style-tile, .letter-fig, .style-pass')].filter((e) => e.getBoundingClientRect().bottom > bottom).length;
    }, `you-${leaf}`);
    expect(overflow, `${leaf} ${w}x${h}: controls below the screen`).toBe(0);
    await app.page.screenshot({ path: path.join(SHOTS, `${leaf}-${profile}-${w}x${h}.png`) });
  }
}

test('fresh profile: Style and Letters are open, say what they need, and fit both sizes', async () => {
  const app = await launchApp({ userDataDir: freshDir() });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await open(page, 'style');
    await expect(page.locator('[data-testid="style-name"]')).toHaveText('Not read yet');
    await expect(page.locator('[data-testid="style-sub"]')).toContainText('20 more hands');
    await expect(page.locator('[data-testid="style-tile"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="style-save"]')).toBeDisabled();
    await expect(page.locator('[data-testid="style-me"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="you-style"]')).not.toContainText(/Not built/);
    await fitsAndShoot(app, 'style', 'fresh');

    await open(page, 'letters');
    await expect(page.locator('[data-testid="letter-empty"]')).toContainText('No letter yet');
    await expect(page.locator('[data-testid="letters-row"]')).toHaveCount(0);
    await fitsAndShoot(app, 'letters', 'fresh');
  } finally {
    await app.close();
  }
});

test('seeded profile: the style read, the trail, the regular on the map and the card saved through the dialog', async () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify(seeded()));
  const out = path.join(dir, 'card.png');
  const app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await open(page, 'style');
    // 210 hands, 60 played (29%), 31 raised first (15%; 52% of those played): more hands, taking the lead, near the line.
    await expect(page.locator('[data-testid="style-name"]')).toHaveText('The Pressure');
    await expect(page.locator('[data-testid="style-numbers"]')).toContainText('29%');
    await expect(page.locator('[data-testid="style-numbers"]')).toContainText('15%');
    await expect(page.locator('[data-testid="style-card"]')).toContainText('Sam');
    await expect(page.locator('[data-testid="style-card"]')).toContainText('210 hands');
    await expect(page.locator('[data-testid="style-sub"]')).toContainText('Close to a line');
    // Two weeks clear the gate (80 and 100 hands, 32 and 22 played); this week's 6 played do not.
    await expect(page.locator('[data-testid="style-trail-point"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="style-tile"][data-on="true"]')).toHaveAttribute('data-id', 'pressure');
    // Wren (unmasked) plays as a nit: few hands, and leads them.
    await expect(page.locator('[data-testid="style-tile"][data-id="closer"]')).toContainText('Wren Holloway');
    await expect(page.locator('[data-testid="style-tile"][data-id="explorer"]')).toContainText('Where you started');
    // Calls facing a bet: 6 graded, 4 cost nothing (2 went to the sheet).
    await expect(page.locator('[data-testid="style-coach"]')).toContainText('4 of 6 right');
    await fitsAndShoot(app, 'style', 'seeded');

    // Cancel writes nothing; a picked path gets the PNG.
    await app.app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = (async () => ({ canceled: true, filePath: '' })) as unknown as typeof dialog.showSaveDialog;
    });
    await page.locator('[data-testid="style-save"]').click();
    await expect(page.locator('[data-testid="style-save-note"]')).toHaveAttribute('data-result', 'cancelled');
    await app.app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as unknown as typeof dialog.showSaveDialog;
    }, out);
    await page.locator('[data-testid="style-save"]').click();
    await expect(page.locator('[data-testid="style-save-note"]')).toHaveAttribute('data-result', 'saved');
    const png = fs.readFileSync(out);
    expect(png.subarray(1, 4).toString()).toBe('PNG');

    await page.locator('[data-testid="style-leak-finder"]').click();
    await expect(page.locator('[data-testid="tab-pro"]')).toHaveAttribute('data-active', 'true');
  } finally {
    await app.close();
  }
});

test('seeded profile: ended weeks are filed into the profile, this week is a draft, every number is on record', async () => {
  const dir = freshDir();
  fs.writeFileSync(path.join(dir, STATE), JSON.stringify(seeded()));
  const app = await launchApp({ userDataDir: dir });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await open(page, 'letters');
    await expect.poll(() => (readState(dir).progression?.letters?.filed ?? []).length).toBe(2);
    const filed = readState(dir).progression.letters.filed as { week: number; n: number; slots: Record<string, string>; lines: string[] }[];
    expect(filed.map((l) => l.week)).toEqual([thisWeek - 14, thisWeek - 7]);
    expect(filed.map((l) => l.n)).toEqual([1, 2]);

    // The draft (this week) is shown first and never stored.
    await expect(page.locator('[data-testid="letter-week"]')).toContainText('Week 3');
    await expect(page.locator('[data-testid="letters-row"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="letter-body"]')).toContainText('Sam,');

    // Last week's letter: the rule written that week, the regular's venue, the assessment against the week before.
    await page.locator(`[data-testid="letters-row"][data-week="${thisWeek - 7}"]`).click();
    const body = page.locator('[data-testid="letter-body"]');
    await expect(body).toContainText('the price is the call over the pot after I call');
    await expect(body).toContainText('Lighthouse');
    await expect(body).toContainText('3 bb per 100 decisions');
    await expect(page.locator('[data-testid="letter-hand"]')).toContainText('into 1200');
    const text = await body.innerText();
    // Whole numbers only, against the stored record's own slots.
    const allowed = new Set(Object.values(filed[1].slots).flatMap((v) => v.match(/\d+(?:\.\d+)?/g) ?? []));
    const said = text.match(/\d+(?:\.\d+)?/g) ?? [];
    expect(said.length).toBeGreaterThan(3);
    for (const n of said) expect([...allowed], `number ${n} in the letter`).toContain(n);
    expect(text).not.toMatch(/\b(won|lost|luck|you are|bankroll)\b/i);
    await fitsAndShoot(app, 'letters', 'seeded');

    // Reopening files nothing new.
    await open(page, 'style');
    await open(page, 'letters');
    expect(readState(dir).progression.letters.filed).toHaveLength(2);
  } finally {
    await app.close();
  }
});
