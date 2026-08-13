import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';

/**
 * R8 (Home) and R9 (Profile) — the two screens that turn a session into a diagnosis.
 *
 * The centre of gravity here is the leak list. R9's whole claim is that it tells the student what
 * to study NEXT, and that is a claim about ORDER: the ranking is by total bb cost, not frequency,
 * so one 20bb blunder must outrank five 0.6bb ones. Nothing in the e2e suite pinned that ordering
 * through the UI, and `leak-cost` had no coverage at all.
 *
 * Most tests here seed `offsuit-state.json` BEFORE launch instead of playing hands. That is
 * deliberate: these screens are pure functions of the persisted session, the ranking cases we care
 * about (a rare expensive leak vs a frequent cheap one, a legacy file with no costs, 0/1/4 hands)
 * cannot be produced on demand by playing, and the save file is a real, supported input — the
 * corrupt-save tests in persistence.spec.ts already treat it as one. Two tests still play real
 * hands, so the seeded fixtures are anchored to what the app itself writes.
 */

const STATE_FILE = 'offsuit-state.json';
const RECENT_LIMIT = 5;
const DEFAULT_BANKROLL = 10000;

const homeScreen = '[data-testid="home-screen"]';
const profileScreen = '[data-testid="profile-screen"]';
const handRow = '[data-testid="hand-row"]';
const recentEmpty = '[data-testid="recent-empty"]';
const sessionGraph = '[data-testid="session-graph"]';
const leakList = '[data-testid="leak-list"]';
const leakRow = '[data-testid="leak-row"]';
const leakCost = '[data-testid="leak-cost"]';
const graphCaption = '[data-testid="graph-caption"]';

interface FixtureHand {
  handNumber: number;
  hole: string[];
  board: string[];
  net: number;
  vpip: boolean;
  pfr: boolean;
  grades: { severity: string; principle: string; evLossBb: number }[];
}

/** Mirrors core/session.ts serialize() — what the app itself writes to disk. */
interface Fixture {
  bankroll: number;
  hands: FixtureHand[];
  stats: {
    handsPlayed: number;
    vpipHands: number;
    pfrHands: number;
    evLossBb: number;
    leaks: Record<string, number>;
    leakCostBb?: Record<string, number>;
  };
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-screens-'));
}

/** Write a save file into a fresh dir before launch. Boot only reads it, so it survives to render. */
function seedSave(fixture: Fixture): string {
  const userDataDir = freshUserDataDir();
  fs.writeFileSync(
    path.join(userDataDir, STATE_FILE),
    JSON.stringify(fixture, null, 2),
    'utf-8',
  );
  return userDataDir;
}

function readPersistedBankroll(userDataDir: string): number {
  const raw = fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8');
  return (JSON.parse(raw) as { bankroll: number }).bankroll;
}

/** Deterministic filler hands: only handNumber / hole / net are asserted on. */
function fixtureHands(count: number): FixtureHand[] {
  const holes = [
    ['As', 'Kd'],
    ['7h', '7c'],
    ['Qs', 'Jh'],
    ['2c', '9d'],
    ['Td', 'Ts'],
    ['4h', '5h'],
    ['Ac', 'Qc'],
  ];
  const nets = [250, -120, 75, -400, 1000, -50, 325];
  return Array.from({ length: count }, (_, i) => ({
    handNumber: i + 1,
    hole: holes[i % holes.length],
    board: ['2s', '5d', '9c', 'Jd', 'Kh'],
    net: nets[i % nets.length],
    vpip: i % 2 === 0,
    pfr: i % 4 === 0,
    grades: [],
  }));
}

async function readBankrollNumeral(page: Page): Promise<number> {
  const text = (await page.textContent(sel.bankroll)) ?? '';
  const value = Number(text.trim());
  expect(Number.isFinite(value), `bankroll numeral was "${text}"`).toBe(true);
  return value;
}

async function openProfile(page: Page): Promise<void> {
  await page.click(sel.tabProfile);
  await page.waitForSelector(profileScreen);
}

async function readGraphPoints(page: Page): Promise<string> {
  const points = await page.getAttribute(`${sessionGraph} polyline`, 'points');
  expect(points, 'session graph polyline has no points attribute').not.toBeNull();
  return (points ?? '').trim();
}

/** One pair per point: "12.0,34.5". A broken series shows up here as NaN or as a short list. */
function pointPairs(points: string): string[] {
  return points === '' ? [] : points.split(/\s+/);
}

async function readLeakRows(page: Page): Promise<{ principle: string; cost: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="leak-row"]')].map((row) => ({
      principle: row.dataset.principle ?? '',
      cost: row.querySelector<HTMLElement>('[data-testid="leak-cost"]')?.textContent ?? '',
    })),
  );
}

/** SPEC.md's documented window: "1100x760, non-resizable-min 900x640". */
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/**
 * Block until the profile screen's box stops changing, by polling the rect across animation frames.
 * A resize is asynchronous (window metrics change, then Blink relayouts, then paints) and a fixed
 * sleep would be either flaky or slow; two identical consecutive reads is the real signal.
 */
async function settleProfileLayout(page: Page): Promise<void> {
  const settled = await page.evaluate(async () => {
    const nextFrame = (): Promise<void> =>
      new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    const read = (): string => {
      const r = document.querySelector('[data-testid="profile-screen"]')?.getBoundingClientRect();
      return r === undefined ? 'absent' : `${r.width}x${r.height}@${r.top}`;
    };

    let previous = read();
    for (let i = 0; i < 180; i++) {
      await nextFrame();
      const current = read();
      if (current === previous && current !== 'absent') return true;
      previous = current;
    }
    return false;
  });
  expect(settled, 'profile layout never stopped changing').toBe(true);
}

/**
 * Resize the real BrowserWindow, then pin the render viewport to the same numbers — the technique
 * layout.spec.ts uses, and for the same reason: a tiling window manager on the host (this machine
 * runs AeroSpace) retiles the window moments after it is shown, which makes setSize() cosmetic.
 * Emulation.setDeviceMetricsOverride makes the geometry assertions describe the size SPEC.md
 * documents regardless of the host WM.
 */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    BrowserWindow.getAllWindows()[0].setSize(size.width, size.height);
  }, { width, height });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await page.waitForFunction(
    (want: { width: number; height: number }) =>
      window.innerWidth === want.width && window.innerHeight === want.height,
    { width, height },
  );
  await settleProfileLayout(page);
}

interface ProfileGeometry {
  innerHeight: number;
  scrollY: number;
  scrollHeight: number;
  /** Bottom edge of the Lifetime counter grid, viewport-relative. */
  countersBottom: number;
  counterRows: number;
  leakRows: number;
  leakListScrolls: boolean;
  leakRowsInDom: number;
}

/** One evaluate call, so the viewport and every rect describe the same frame. */
async function readProfileGeometry(page: Page): Promise<ProfileGeometry> {
  return page.evaluate(() => {
    const grid = document.querySelector('.counter-grid');
    if (grid === null) throw new Error('counter-grid missing');
    const list = document.querySelector('[data-testid="leak-list"]');
    if (list === null) throw new Error('leak-list missing');
    return {
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      countersBottom: grid.getBoundingClientRect().bottom,
      counterRows: grid.querySelectorAll('.counter').length,
      leakRows: list.querySelectorAll('[data-testid="leak-row"]').length,
      leakListScrolls: list.scrollHeight > list.clientHeight,
      leakRowsInDom: document.querySelectorAll('[data-testid="leak-row"]').length,
    };
  });
}

/** Every uncaught renderer exception. A screen that throws mid-render can still look fine. */
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  return errors;
}

test.describe('R8 home screen', () => {
  test('1. first launch shows a real empty state, not an empty list', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);

      await expect(page.locator(recentEmpty)).toBeVisible();
      await expect(page.locator(handRow)).toHaveCount(0);

      // "Not broken" means it explains itself. A blank div would pass a visibility check.
      const title = (await page.textContent(`${recentEmpty} .empty-state-title`)) ?? '';
      const body = (await page.textContent(`${recentEmpty} .empty-state-body`)) ?? '';
      expect(title.trim()).toBe('No hands yet');
      expect(body.trim().length, `empty-state body was "${body}"`).toBeGreaterThan(20);
      expect(body).toMatch(/session/i);

      const homeText = (await page.innerText(homeScreen)) ?? '';
      expect(homeText).not.toMatch(/NaN|undefined|null/);
      expect(await readBankrollNumeral(page)).toBe(DEFAULT_BANKROLL);
    } finally {
      await close();
    }
  });

  test('1b. the earned STANDING renders beside the bankroll and reads Calibrating on a fresh profile', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);

      // The standing is a real element, not a silent render: pin the testid so a broken wiring fails
      // here rather than shipping green (the render had no e2e coverage before this test).
      const standing = page.locator('[data-testid="home-standing"]');
      await expect(standing).toBeVisible();

      // A fresh profile has no eligible contested decisions, so the depth is 0 → "Calibrating".
      const label = (await page.textContent('[data-testid="home-standing-label"]')) ?? '';
      expect(label.trim()).toBe('Calibrating');

      // The Play-surface amendment allows a single-player STANDING but leaves BANNED_PHRASINGS intact:
      // the label must never leak a leaderboard word.
      const lower = label.toLowerCase();
      for (const banned of ['rank', 'percentile', 'level', 'elo', 'tier', 'leaderboard']) {
        expect(lower, `standing label "${label}" leaked a banned word`).not.toContain(banned);
      }

      // Zero net height is asserted structurally by session-plan.spec test 17; here we only confirm it
      // sits ON the headline row beside the bankroll, not stacked below it.
      const sameRow = await page.evaluate(() => {
        const bank = document.querySelector('[data-testid="bankroll"]');
        const stand = document.querySelector('[data-testid="home-standing"]');
        if (bank === null || stand === null) return false;
        const b = bank.getBoundingClientRect();
        const s = stand.getBoundingClientRect();
        // Their vertical extents overlap → they share the headline row rather than stacking.
        return b.bottom > s.top && s.bottom > b.top;
      });
      expect(sameRow, 'standing is not on the same row as the bankroll').toBe(true);
    } finally {
      await close();
    }
  });

  test('2. the recent list caps at the render limit, newest first, with cards and a net', async () => {
    const HANDS = RECENT_LIMIT + 2;
    const fixture: Fixture = {
      bankroll: 12345,
      hands: fixtureHands(HANDS),
      stats: {
        handsPlayed: HANDS,
        vpipHands: 4,
        pfrHands: 2,
        evLossBb: 6.5,
        leaks: {},
        leakCostBb: {},
      },
    };
    const userDataDir = seedSave(fixture);
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);

      await expect(page.locator(recentEmpty)).toHaveCount(0);
      await expect(page.locator(handRow)).toHaveCount(RECENT_LIMIT);

      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="hand-row"]')].map((row) => ({
          hand: Number(row.dataset.hand),
          cards: [...row.querySelectorAll<HTMLElement>('[data-testid="card"]')].map(
            (c) => c.dataset.card ?? '',
          ),
          net: row.querySelector<HTMLElement>('.hand-net')?.textContent ?? '',
        })),
      );

      // Newest first, and the two oldest hands are dropped rather than the two newest.
      expect(rows.map((r) => r.hand)).toEqual([7, 6, 5, 4, 3]);

      const byNumber = new Map(fixture.hands.map((h) => [h.handNumber, h]));
      for (const row of rows) {
        const source = byNumber.get(row.hand);
        expect(source, `no fixture hand #${row.hand}`).toBeDefined();
        expect(row.cards, `hole cards of hand #${row.hand}`).toEqual(source?.hole);
        expect(row.net, `net of hand #${row.hand}`).toMatch(/^[+-]\d+$/);
        expect(Number(row.net)).toBe(source?.net);
      }

      // Scenario 3: the numeral is the persisted number, not a coincidence.
      expect(await readBankrollNumeral(page)).toBe(readPersistedBankroll(userDataDir));
      expect(await readBankrollNumeral(page)).toBe(12345);
    } finally {
      await close();
    }
  });

  test('3. after a real hand the row shows the cards actually dealt and the persisted bankroll', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await waitForIdle(page);

      const dealt = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="hero-cards"] [data-testid="card"]',
          ),
        ].map((c) => c.dataset.card ?? ''),
      );
      expect(dealt).toHaveLength(2);

      await playToShowdown(page);

      // The save is an async IPC round-trip fired after 'handover' renders; poll, never race.
      await expect
        .poll(() => {
          try {
            const raw = fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8');
            return (JSON.parse(raw) as Fixture).stats.handsPlayed;
          } catch {
            return -1;
          }
        })
        .toBe(1);

      // Leaving and re-entering Play tears the settled table down, revealing Home.
      await openProfile(page);
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);

      await expect(page.locator(handRow)).toHaveCount(1);
      const rowCards = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="hand-row"] [data-testid="card"]',
          ),
        ].map((c) => c.dataset.card ?? ''),
      );
      expect(rowCards).toEqual(dealt);
      // "0" is a legal rendering now: a break-even hand carries no sign (see test 10).
      await expect(page.locator(`${handRow} .hand-net`)).toHaveText(/^(0|[+-]\d+)$/);

      expect(await readBankrollNumeral(page)).toBe(readPersistedBankroll(userDataDir));

      // Scenario 8, measured on real play rather than a fixture.
      await openProfile(page);
      const counters = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>('.counter')].map((cell) => [
            cell.querySelector<HTMLElement>('.stat-label')?.textContent ?? '',
            cell.querySelector<HTMLElement>('.stat-value')?.textContent ?? '',
          ]),
        ),
      );
      expect(Object.keys(counters).sort()).toEqual(['EV lost', 'Hands', 'PFR', 'VPIP']);
      expect(Number(counters.Hands)).toBe(1);
      const vpip = Number(counters.VPIP.replace('%', ''));
      const pfr = Number(counters.PFR.replace('%', ''));
      expect(vpip).toBeGreaterThanOrEqual(0);
      expect(vpip).toBeLessThanOrEqual(100);
      expect(pfr).toBeGreaterThanOrEqual(0);
      expect(pfr).toBeLessThanOrEqual(100);
      // A hand cannot be raised preflop without being played voluntarily.
      expect(vpip).toBeGreaterThanOrEqual(pfr);
      expect(counters['EV lost']).toMatch(/^-?\d+\.\d bb$/);

      expect((await page.innerText(profileScreen)) ?? '').not.toMatch(/NaN|undefined/);
    } finally {
      await close();
    }
  });
});

test.describe('R9 profile screen — leak ranking', () => {
  /**
   * THE test for R9. The fixture is built so frequency and cost disagree: "pot odds" happened 5x
   * for 3.0bb total, "value or bluff" once for 20.0bb. A list ranked by count puts "pot odds"
   * first and sends the student to study the wrong thing.
   */
  test('4. the most EXPENSIVE leak ranks first, not the most FREQUENT one', async () => {
    const userDataDir = seedSave({
      bankroll: 8200,
      hands: fixtureHands(3),
      stats: {
        handsPlayed: 6,
        vpipHands: 4,
        pfrHands: 1,
        evLossBb: 23,
        leaks: { 'pot odds': 5, 'value or bluff': 1 },
        leakCostBb: { 'pot odds': 3.0, 'value or bluff': 20.0 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);
      await expect(page.locator(leakList)).toBeVisible();

      const rows = await readLeakRows(page);
      expect(rows.map((r) => r.principle)).toEqual(['value or bluff', 'pot odds']);
      expect(rows[0].cost).toContain('20.0 bb');
      expect(rows[0].cost).toContain('1×');
      // The cheap-but-frequent leak is still listed, just demoted.
      expect(rows[1].cost).toContain('3.0 bb');
      expect(rows[1].cost).toContain('5×');
    } finally {
      await close();
    }
  });

  test('5. every leak-row states both a bb cost and a count', async () => {
    const userDataDir = seedSave({
      bankroll: 9000,
      hands: fixtureHands(2),
      stats: {
        handsPlayed: 9,
        vpipHands: 5,
        pfrHands: 2,
        evLossBb: 31.4,
        leaks: { 'pot odds': 5, 'value or bluff': 1, ranges: 3 },
        leakCostBb: { 'pot odds': 3.0, 'value or bluff': 20.0, ranges: 8.4 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);

      await expect(page.locator(leakRow)).toHaveCount(3);
      const rows = await readLeakRows(page);
      expect(rows.map((r) => r.principle)).toEqual(['value or bluff', 'ranges', 'pot odds']);

      const costs = await page.locator(leakCost).allInnerTexts();
      expect(costs).toHaveLength(3);
      for (const cost of costs) {
        expect(cost, 'leak-cost must name a bb figure').toMatch(/[\d.]+ bb/);
        expect(cost, 'leak-cost must name a count').toMatch(/\d+×|\d+x/);
      }

      // Costs descend, which is the ranking claim restated on the rendered numbers.
      const bb = costs.map((c) => Number(/([\d.]+) bb/.exec(c)?.[1] ?? 'NaN'));
      expect(bb.every(Number.isFinite)).toBe(true);
      expect([...bb].sort((a, b) => b - a)).toEqual(bb);
    } finally {
      await close();
    }
  });

  test('6. a legacy save with leaks but no leakCostBb still renders, with no NaN', async () => {
    // Written by a build that predated cost tracking: counts only.
    const userDataDir = seedSave({
      bankroll: 11750,
      hands: fixtureHands(3),
      stats: {
        handsPlayed: 3,
        vpipHands: 2,
        pfrHands: 1,
        evLossBb: 4.25,
        leaks: { 'pot odds': 2, ranges: 1 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);

      await expect(page.locator(leakRow)).toHaveCount(2);
      const rows = await readLeakRows(page);
      // Both cost 0, so the tiebreak (count desc, then principle asc) decides.
      expect(rows.map((r) => r.principle)).toEqual(['pot odds', 'ranges']);
      expect(rows[0].cost).toBe('0.0 bb · 2×');
      expect(rows[1].cost).toBe('0.0 bb · 1×');

      const screenText = await page.innerText(profileScreen);
      expect(screenText).not.toMatch(/NaN/);
      expect(screenText).not.toMatch(/undefined/);
      expect(screenText).toContain('pot odds');

      // The bar width is computed from cost; a 0/0 division would land here as an invalid style.
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.leak-bar')].map((bar) => bar.style.width),
      );
      expect(widths).toHaveLength(2);
      for (const width of widths) expect(width).toMatch(/^\d+(\.\d+)?%$/);

      expect(await readGraphPoints(page)).not.toContain('NaN');
    } finally {
      await close();
    }
  });

  /**
   * The bars must be comparable to each other, measured in PIXELS and not in the `width: %` the
   * style attribute claims. The bar is a percentage of its own `.leak-track`, so a track sized by
   * whatever room the cost text leaves over is a different ruler on every row: "25.0 bb · 137×" is
   * a wider string than "24.0 bb · 1×", so it left a narrower track and the MORE expensive leak
   * drew a 162px bar next to the cheaper one's 173px. The picture said the opposite of the ranking
   * it exists to illustrate, and every percentage-string assertion in this file passed while it did.
   */
  test('10. a more expensive leak draws a longer bar in pixels, whatever the cost text length', async () => {
    const userDataDir = seedSave({
      bankroll: 9000,
      hands: fixtureHands(1),
      stats: {
        handsPlayed: 20,
        vpipHands: 10,
        pfrHands: 4,
        evLossBb: 49,
        // Nearly tied costs; the dearer one deliberately carries the much longer count string.
        leaks: { 'pot odds': 137, ranges: 1 },
        leakCostBb: { 'pot odds': 25.0, ranges: 24.0 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);
      await expect(page.locator(leakRow)).toHaveCount(2);

      const bars = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="leak-row"]')].map((row) => ({
          principle: row.dataset.principle ?? '',
          costBb: Number(
            /([\d.]+) bb/.exec(
              row.querySelector<HTMLElement>('[data-testid="leak-cost"]')?.textContent ?? '',
            )?.[1] ?? 'NaN',
          ),
          barPx: row.querySelector<HTMLElement>('.leak-bar')?.getBoundingClientRect().width ?? NaN,
          trackPx:
            row.querySelector<HTMLElement>('.leak-track')?.getBoundingClientRect().width ?? NaN,
        })),
      );

      expect(bars.map((b) => b.principle)).toEqual(['pot odds', 'ranges']);
      for (const bar of bars) {
        expect(Number.isFinite(bar.barPx), `bar width of ${bar.principle}`).toBe(true);
        expect(bar.barPx, `${bar.principle} drew a zero-width bar`).toBeGreaterThan(0);
      }

      // One ruler for every row: an unequal track is the defect itself, not a symptom.
      expect(
        bars[1].trackPx,
        `tracks differ (${bars[0].trackPx}px vs ${bars[1].trackPx}px), so the bars measure different things`,
      ).toBeCloseTo(bars[0].trackPx, 1);

      // The picture must agree with the ranking: dearer leak, longer bar.
      expect(bars[0].costBb).toBeGreaterThan(bars[1].costBb);
      expect(
        bars[0].barPx,
        `"${bars[0].principle}" costs ${bars[0].costBb}bb but drew ${bars[0].barPx}px, while "${bars[1].principle}" costs ${bars[1].costBb}bb and drew ${bars[1].barPx}px`,
      ).toBeGreaterThan(bars[1].barPx);
    } finally {
      await close();
    }
  });
});

test.describe('R8 home screen — a break-even hand', () => {
  /**
   * A hero who folds the button preflop nets exactly 0 — the commonest result disciplined play
   * produces, and reachable in this app by pressing Fold on any hand where the hero posts no
   * blind. It used to render as a mint-green "+0": the win colour and the win sign, for a hand
   * where nothing was won. The list's whole job is telling a learner which hands cost them money.
   */
  test('11. nets exactly zero, so it is neither green nor signed', async () => {
    const userDataDir = seedSave({
      bankroll: 10000,
      hands: [
        { handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [] },
        { handNumber: 2, hole: ['7h', '7c'], board: [], net: -50, vpip: false, pfr: false, grades: [] },
        { handNumber: 3, hole: ['Qs', 'Jh'], board: [], net: 50, vpip: true, pfr: false, grades: [] },
      ],
      stats: {
        handsPlayed: 3,
        vpipHands: 1,
        pfrHands: 0,
        evLossBb: 0,
        leaks: {},
        leakCostBb: {},
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await expect(page.locator(handRow)).toHaveCount(3);

      const rows = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="hand-row"]')].map((row) => {
          const net = row.querySelector<HTMLElement>('.hand-net');
          return {
            hand: Number(row.dataset.hand),
            text: net?.textContent ?? '',
            colour: net === null ? '' : getComputedStyle(net).color,
          };
        }),
      );
      const byHand = new Map(rows.map((r) => [r.hand, r]));

      const win = byHand.get(3);
      const loss = byHand.get(2);
      const flat = byHand.get(1);
      expect(win?.text).toBe('+50');
      expect(loss?.text).toBe('-50');

      // No "+" on a hand that won nothing.
      expect(flat?.text, 'a break-even hand must not carry a plus sign').toBe('0');

      // And not the win colour. Comparing to the other two rows keeps this palette-agnostic.
      expect(
        flat?.colour,
        `break-even rendered in the winning colour ${String(flat?.colour)}`,
      ).not.toBe(win?.colour);
      expect(
        flat?.colour,
        `break-even rendered in the losing colour ${String(flat?.colour)}`,
      ).not.toBe(loss?.colour);
    } finally {
      await close();
    }
  });
});

test.describe('R9 profile screen — session graph and counters', () => {
  for (const hands of [0, 1, 4] as const) {
    test(`7. the session graph renders a finite polyline with ${hands} hand(s)`, async () => {
      const userDataDir = seedSave({
        bankroll: 10250,
        hands: fixtureHands(hands),
        stats: {
          handsPlayed: hands,
          vpipHands: 0,
          pfrHands: 0,
          evLossBb: 0,
          leaks: {},
          leakCostBb: {},
        },
      });
      const { page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        await page.waitForSelector(homeScreen);
        await openProfile(page);
        await expect(page.locator(sessionGraph)).toBeVisible();

        const points = await readGraphPoints(page);
        expect(points, 'graph points must never contain NaN').not.toContain('NaN');
        expect(points).not.toBe('');

        const pairs = pointPairs(points);
        for (const pair of pairs) {
          expect(pair, `malformed point "${pair}"`).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
        }

        // hands + 1 points (start + one per hand), floored at 2 so a single value is a flat line.
        expect(pairs.length).toBe(Math.max(2, hands + 1));
        if (hands >= 3) expect(pairs.length).toBeGreaterThanOrEqual(3);

        const caption = await page.innerText('.graph-caption');
        expect(caption).toBe(
          hands === 0 ? 'No hands played yet' : `${hands} hand${hands === 1 ? '' : 's'}`,
        );
      } finally {
        await close();
      }
    });
  }

  test('8. lifetime counters render the persisted totals in bounds', async () => {
    const userDataDir = seedSave({
      bankroll: 10800,
      hands: fixtureHands(4),
      stats: {
        handsPlayed: 4,
        vpipHands: 3,
        pfrHands: 1,
        evLossBb: 12.34,
        leaks: { 'pot odds': 1 },
        leakCostBb: { 'pot odds': 12.34 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);

      const counters = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>('.counter')].map((cell) => [
            cell.querySelector<HTMLElement>('.stat-label')?.textContent ?? '',
            cell.querySelector<HTMLElement>('.stat-value')?.textContent ?? '',
          ]),
        ),
      );

      expect(counters).toEqual({
        Hands: '4',
        VPIP: '75%',
        PFR: '25%',
        'EV lost': '12.3 bb',
      });

      const vpip = Number(counters.VPIP.replace('%', ''));
      const pfr = Number(counters.PFR.replace('%', ''));
      expect(vpip).toBeGreaterThanOrEqual(0);
      expect(vpip).toBeLessThanOrEqual(100);
      expect(pfr).toBeGreaterThanOrEqual(0);
      expect(pfr).toBeLessThanOrEqual(100);
      expect(vpip).toBeGreaterThanOrEqual(pfr);
    } finally {
      await close();
    }
  });
});

test.describe('R9 profile screen — it fits the documented window sizes', () => {
  /**
   * A session busy enough to have a real diagnosis: six graded concepts. That is what a student who
   * has played a few hundred hands sees, and it is the case that pushed the Lifetime grid off screen
   * — measured bottom 1013px in a 760px viewport at the DEFAULT size (253px below the fold) and
   * 1013px in a 640px viewport at the documented minimum. The player could not see their own
   * lifetime totals, and nothing on screen said there was more.
   */
  const busyLeaks = {
    bankroll: 7400,
    hands: fixtureHands(6),
    stats: {
      handsPlayed: 240,
      vpipHands: 62,
      pfrHands: 31,
      evLossBb: 61.2,
      leaks: { 'value or bluff': 3, 'pot odds': 9, ranges: 4, position: 6, 'bet sizing': 2, 'fold equity': 5 },
      leakCostBb: {
        'value or bluff': 20.0,
        'pot odds': 14.5,
        ranges: 9.4,
        position: 8.1,
        'bet sizing': 5.2,
        'fold equity': 4.0,
      },
    },
  } as const satisfies Fixture;

  for (const [width, height] of [
    [DEFAULT_WIDTH, DEFAULT_HEIGHT],
    [MIN_WIDTH, MIN_HEIGHT],
  ] as const) {
    test(`12. the lifetime counters are above the fold at ${width}x${height}`, async () => {
      const userDataDir = seedSave(structuredClone(busyLeaks) as Fixture);
      const { app, page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        await page.waitForSelector(homeScreen);
        await openProfile(page);
        await useViewport(app, page, width, height);

        const geo = await readProfileGeometry(page);
        expect(geo.innerHeight).toBe(height);
        // Rects are viewport-relative; a scrolled page would describe a view the player is not
        // looking at when the screen opens.
        expect(geo.scrollY, 'the profile screen was scrolled before measuring').toBe(0);

        expect(
          geo.countersBottom,
          `the Lifetime counters end at ${geo.countersBottom.toFixed(1)}px in a ${height}px viewport — ${(geo.countersBottom - height).toFixed(1)}px below the fold`,
        ).toBeLessThanOrEqual(height);
        expect(
          geo.scrollHeight,
          `the profile content is ${geo.scrollHeight}px tall in a ${height}px viewport, so the page itself scrolls`,
        ).toBeLessThanOrEqual(height + 1);

        // Fixed by making the leak list scroll, not by deleting rows: every concept is still there.
        expect(geo.leakRowsInDom, 'every leak row must still exist').toBe(6);
        expect(geo.counterRows).toBe(4);
        expect(geo.leakListScrolls, 'the leak list is what scrolls, not the page').toBe(true);
      } finally {
        await close();
      }
    });
  }

  /** The rows below the cap are reachable, not merely present in the DOM. */
  test('13. the leak list scrolls to its last row at 900x640', async () => {
    const userDataDir = seedSave(structuredClone(busyLeaks) as Fixture);
    const { app, page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);
      await useViewport(app, page, MIN_WIDTH, MIN_HEIGHT);

      const last = page.locator(leakRow).last();
      await last.scrollIntoViewIfNeeded();
      const reach = await page.evaluate(() => {
        const list = document.querySelector('[data-testid="leak-list"]')!;
        const row = [...document.querySelectorAll('[data-testid="leak-row"]')].at(-1)!;
        const listBox = list.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        return {
          pageScrollY: window.scrollY,
          rowTop: rowBox.top,
          rowBottom: rowBox.bottom,
          listTop: listBox.top,
          listBottom: listBox.bottom,
          principle: row instanceof HTMLElement ? (row.dataset.principle ?? '') : '',
        };
      });

      // Scrolling the list, not the document: the counters below it must not have moved.
      expect(reach.pageScrollY, 'reaching the last leak scrolled the whole page').toBe(0);
      expect(reach.principle).toBe('fold equity');
      expect(reach.rowTop).toBeGreaterThanOrEqual(reach.listTop - 1);
      expect(reach.rowBottom).toBeLessThanOrEqual(reach.listBottom + 1);
    } finally {
      await close();
    }
  });
});

test.describe('R9 profile screen — a capped hand log', () => {
  /**
   * session.ts caps the stored log at MAX_HAND_LOG (500) on purpose while `handsPlayed` keeps
   * climbing, so past 500 hands the screen shows two different hand counts. Measured on this
   * fixture: the graph caption said "500 hands" and the Lifetime counter said "612" — a difference
   * of 112 with nothing on screen saying one is a window over the other. A learner reads that as a
   * bug or as lost progress.
   */
  const HANDS_PLAYED = 612;
  const LOGGED = 500;

  test('14. the two hand counts are labelled, not left to be read as a bug', async () => {
    const userDataDir = seedSave({
      bankroll: 13400,
      hands: fixtureHands(LOGGED),
      stats: {
        handsPlayed: HANDS_PLAYED,
        vpipHands: 160,
        pfrHands: 80,
        evLossBb: 44.5,
        leaks: { 'pot odds': 12 },
        leakCostBb: { 'pot odds': 30.0 },
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);

      // The graph really is plotting only the logged window, which is why it needs saying.
      const pairs = pointPairs(await readGraphPoints(page));
      expect(pairs.length).toBe(LOGGED + 1);

      const lifetimeHands = await page
        .locator('.counter', { has: page.locator('.stat-label', { hasText: /^Hands$/ }) })
        .locator('.stat-value')
        .innerText();
      expect(Number(lifetimeHands), 'the Lifetime counter is the uncapped total').toBe(HANDS_PLAYED);

      const caption = (await page.innerText(graphCaption)).trim();
      // Both numbers named in one sentence: which hands the graph covers, and how many were played.
      expect(caption, `graph caption was "${caption}"`).toContain(String(LOGGED));
      expect(
        caption,
        `the caption says "${caption}" — it names ${LOGGED} without saying the player has played ${HANDS_PLAYED}`,
      ).toContain(String(HANDS_PLAYED));
      expect(caption).toMatch(/played/i);
      // "500 hands" full stop is the ambiguous rendering this test exists to forbid.
      expect(caption).not.toBe(`${LOGGED} hands`);

      expect(await page.innerText(profileScreen)).not.toMatch(/NaN|undefined/);
    } finally {
      await close();
    }
  });

  /** No cap reached, no divergence, so no extra words: the caption must not cry wolf. */
  test('15. an uncapped log still reads as a plain hand count', async () => {
    const userDataDir = seedSave({
      bankroll: 10250,
      hands: fixtureHands(4),
      stats: {
        handsPlayed: 4,
        vpipHands: 2,
        pfrHands: 1,
        evLossBb: 0,
        leaks: {},
        leakCostBb: {},
      },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openProfile(page);
      expect((await page.innerText(graphCaption)).trim()).toBe('4 hands');
    } finally {
      await close();
    }
  });
});

test.describe('R8 tab navigation', () => {
  test('9. Play -> Profile -> Play round-trips to a usable screen and never throws', async () => {
    const MAX_ROUND_TRIPS = 3;
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    const errors = watchPageErrors(page);
    try {
      await page.waitForSelector(homeScreen);

      // (a) round-trip from Home, with no table ever mounted.
      for (let i = 0; i < MAX_ROUND_TRIPS; i++) {
        await openProfile(page);
        await page.click(sel.tabPlay);
        await page.waitForSelector(homeScreen);
        expect(errors, `renderer errors after home round-trip ${i + 1}`).toEqual([]);
      }

      // (b) round-trip with a live table mid-hand: leaving Play tears the table down, so Play
      // must come back as Home rather than a half-destroyed table.
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      expect(await waitForIdle(page)).toBe('hero');
      await openProfile(page);
      await expect(page.locator(tableScreen)).toHaveCount(0);
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);

      // "Usable" means playable, not merely painted.
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await expect(page.locator(`${sel.heroCards} ${sel.card}`)).toHaveCount(2);
      await waitForIdle(page);
      await playToShowdown(page);

      // (c) round-trip from a settled table.
      await openProfile(page);
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);
      await expect(page.locator(sel.newHand)).toBeEnabled();

      expect(errors, 'uncaught renderer exceptions during tab navigation').toEqual([]);
    } finally {
      await close();
    }
  });
});

test.describe('the bankroll headline is colour-coded like the rows beneath it', () => {
  /**
   * Found by looking at a screenshot of a negative bankroll: the headline "-5000" rendered plain
   * white while every hand row under it was red. The most prominent number on the screen was the
   * only one not colour-coded. Negative is reachable in real play — three busts and rebuys off a
   * 10000 start leaves exactly -5000.
   */
  const cases: [string, number, string][] = [
    ['below the starting bankroll', -5000, 'net-down'],
    ['exactly the starting bankroll', 10000, 'net-flat'],
    ['above the starting bankroll', 15000, 'net-up'],
  ];

  for (const [label, bankroll, expected] of cases) {
    test(`bankroll ${label} reads ${expected}`, async () => {
      const userDataDir = seedSave({
        bankroll,
        hands: [],
        stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {} },
      });
      const { page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        const el = page.locator(sel.bankroll);
        await expect(el).toHaveAttribute('data-direction', expected);
        await expect(el).toHaveText(String(bankroll));
      } finally {
        await close();
      }
    });
  }

  test('a negative headline uses the same red as a losing hand row', async () => {
    const userDataDir = seedSave({
      bankroll: -5000,
      hands: [
        { handNumber: 1, hole: ['As', 'Kd'], board: [], net: -5000, vpip: true, pfr: false, grades: [] },
      ],
      stats: { handsPlayed: 1, vpipHands: 1, pfrHands: 0, evLossBb: 0, leaks: {} },
    });
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(sel.bankroll);
      const colours = await page.evaluate(() => ({
        headline: getComputedStyle(document.querySelector('[data-testid="bankroll"]')!).color,
        row: getComputedStyle(document.querySelector('.hand-net')!).color,
      }));
      expect(colours.headline, 'one loss colour, not two').toBe(colours.row);
    } finally {
      await close();
    }
  });
});
