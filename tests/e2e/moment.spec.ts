import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { playToShowdown, tableScreen } from './flow.js';
import { systemDayKeyOf } from '../../src/core/localDay.js';

/**
 * THE CELEBRATION MOMENT (1.10): the equipped celebration plays once when a session ends.
 *  - session end only: the day's twelfth hand ends a session; the eleventh does not;
 *  - never over a verdict: with one on screen it waits, and plays once it closes;
 *  - at most 1600 ms, then gone; reduced motion shows it still;
 *  - the clack only behind the sound switch.
 * A MutationObserver records every moment as it is added, so a 1.6 s overlay is never missed by a slow poll.
 */

const STATE = 'offsuit-state.json';
const NOW = new Date(2026, 9, 20, 20, 0, 0).getTime();

/** A profile with `n` hands already played today and the Light sweep celebration worn. */
function profileWithHandsToday(n: number, extra: Record<string, unknown> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-moment-'));
  const hands = Array.from({ length: n }, (_, i) => ({
    handNumber: i + 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [], playedAt: NOW - 3_600_000 + i * 60_000,
  }));
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({
      schemaVersion: 2,
      hands,
      ...extra,
      progression: {
        milestones: { achieved: { 'price-held-first': { day: systemDayKeyOf()(NOW) - 3 } } },
        cosmetics: { owned: ['cele-light-sweep'], equipped: { celebration: 'cele-light-sweep' } },
      },
    }),
  );
  return dir;
}

async function recordMoments(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __moments: { at: number; gone?: number; celebration: string | null; anim: string; text: string }[] };
    w.__moments = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n instanceof HTMLElement && n.dataset.testid === 'moment') {
            const mark = n.querySelector('.moment-mark') as HTMLElement;
            const entry = { at: performance.now(), celebration: document.documentElement.getAttribute('data-celebration'), anim: getComputedStyle(mark).animationName, text: n.textContent ?? '' };
            w.__moments.push(entry);
          }
        }
        for (const n of r.removedNodes) {
          if (n instanceof HTMLElement && n.dataset.testid === 'moment') {
            const last = w.__moments[w.__moments.length - 1];
            if (last && last.gone === undefined) last.gone = performance.now();
          }
        }
      }
    }).observe(document.body, { childList: true });
  });
}

const moments = (page: Page) =>
  page.evaluate(() => (window as unknown as { __moments: { at: number; gone?: number; celebration: string | null; anim: string; text: string }[] }).__moments);

/** A costly verdict left in the coach panel at hand end holds the moment (by design); the next hand clears it. */
const verdictUp = (page: Page) =>
  page.evaluate(() => {
    if (document.querySelector('[data-sheet="verdict"]:not(#fake-verdict)')) return true;
    const c = document.querySelector<HTMLElement>('.table-screen .coach[data-severity="notable"], .table-screen .coach[data-severity="serious"]');
    return c !== null && !c.hidden && c.offsetParent !== null;
  });

async function playOneHand(page: Page): Promise<void> {
  await page.click(sel.newHand);
  await page.waitForSelector(tableScreen);
  await playToShowdown(page);
}

/** Play the session's last hand, then move past any verdict it left, as a learner would. */
async function endSession(page: Page): Promise<boolean> {
  await playOneHand(page);
  const held = await verdictUp(page);
  if (held) {
    expect(await moments(page), 'no moment while the verdict is up').toHaveLength(0);
    await page.click('[data-testid="next-hand"]');
  }
  return held;
}

test('the twelfth hand of the day ends a session: the worn celebration plays once, for at most 1600 ms', async () => {
  const app = await launchApp({ userDataDir: profileWithHandsToday(11), env: { OFFSUIT_NOW: String(NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-celebration'))).toBe('light-sweep');
    await recordMoments(page);
    await endSession(page);
    await expect.poll(async () => (await moments(page)).length).toBe(1);
    await expect.poll(async () => (await moments(page))[0].gone !== undefined, { timeout: 5000 }).toBe(true);
    const [m] = await moments(page);
    expect(m.celebration).toBe('light-sweep');
    expect(m.anim).toBe('moment-sweep');
    expect(m.text).toContain('Session done');
    expect(m.text).toContain('Twelve hands today');
    expect((m.gone as number) - m.at).toBeLessThanOrEqual(1600 + 250);
    // Another hand is not a new session: no second moment.
    if (!(await page.locator('[data-testid="table-screen"][data-awaiting="hero"], [data-testid="table-screen"][data-awaiting="ai"]').count())) {
      await page.click('[data-testid="next-hand"]');
    }
    await playToShowdown(page);
    await page.waitForTimeout(800);
    expect(await moments(page)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('the eleventh hand is not a session end: no moment', async () => {
  const app = await launchApp({ userDataDir: profileWithHandsToday(10), env: { OFFSUIT_NOW: String(NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await recordMoments(page);
    await playOneHand(page);
    await page.waitForTimeout(1000);
    expect(await moments(page)).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test('never over a verdict: with one on screen the moment waits, and plays once it closes', async () => {
  const app = await launchApp({ userDataDir: profileWithHandsToday(11), env: { OFFSUIT_NOW: String(NOW) } });
  try {
    const { page } = app;
    await page.waitForSelector('[data-testid="home-screen"]');
    await recordMoments(page);
    // Stand in for an open verdict sheet (the table marks it with data-sheet="verdict").
    await page.evaluate(() => {
      const v = document.createElement('div');
      v.id = 'fake-verdict';
      v.dataset.sheet = 'verdict';
      document.body.appendChild(v);
    });
    await playOneHand(page);
    if (await verdictUp(page)) await page.click('[data-testid="next-hand"]');
    await page.waitForTimeout(1200);
    expect(await moments(page)).toHaveLength(0);
    await page.evaluate(() => document.getElementById('fake-verdict')?.remove());
    await expect.poll(async () => (await moments(page)).length).toBe(1);
  } finally {
    await app.close();
  }
});

test('reduced motion: the words show, still', async () => {
  const app = await launchApp({ userDataDir: profileWithHandsToday(11), env: { OFFSUIT_NOW: String(NOW) } });
  try {
    const { page } = app;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForSelector('[data-testid="home-screen"]');
    await recordMoments(page);
    await endSession(page);
    await expect.poll(async () => (await moments(page)).length).toBe(1);
    expect((await moments(page))[0].anim).toBe('none');
  } finally {
    await app.close();
  }
});

/** A counting AudioContext (sound.spec's idiom): every oscillator start is counted, nothing is heard. */
async function installAudioSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __oscStarts: number; __clacks: number; AudioContext: unknown; webkitAudioContext: unknown };
    w.__oscStarts = 0;
    w.__clacks = 0;
    class FakeCtx {
      currentTime = 0;
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() {
        // The clack is the one 880 Hz tone (sound.ts CLACK); the mistake cue's tones are 392 and 311 Hz.
        const o = { type: 'sine', frequency: { value: 0 }, connect() {}, start() { w.__oscStarts += 1; if (o.frequency.value === 880) w.__clacks += 1; }, stop() {} };
        return o;
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    }
    w.AudioContext = FakeCtx as unknown;
    w.webkitAudioContext = FakeCtx as unknown;
  });
}

for (const soundCues of [false, true]) {
  test(`the clack plays only behind the sound switch (sound ${soundCues ? 'on' : 'off'})`, async () => {
    const app = await launchApp({ userDataDir: profileWithHandsToday(11, { soundCues }), env: { OFFSUIT_NOW: String(NOW) } });
    try {
      const { page } = app;
      await page.waitForSelector('[data-testid="home-screen"]');
      await installAudioSpy(page);
      await recordMoments(page);
      await endSession(page);
      await expect.poll(async () => (await moments(page)).length).toBe(1);
      const { starts, clacks } = await page.evaluate(() => {
        const w = window as unknown as { __oscStarts: number; __clacks: number };
        return { starts: w.__oscStarts, clacks: w.__clacks };
      });
      if (soundCues) expect(clacks).toBe(1);
      else {
        expect(starts).toBe(0);
        expect(clacks).toBe(0);
      }
    } finally {
      await app.close();
    }
  });
}
