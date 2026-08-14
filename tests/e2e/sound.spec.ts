import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * Optional sound cue on a costly verdict.
 *
 * Nothing here asserts audible sound — that is not testable and not the risk. The risks mirror the
 * voice feature's:
 *   1. THE load-bearing test — an off switch that still fires. With sound off, NO AudioContext may be
 *      constructed and no tone rendered, even though a real (mistake) verdict occurred.
 *   2. On means a tone actually renders — with sound on, the same verdict builds oscillators.
 *   3. The toggle persists across a restart.
 *   4. Sound is never load-bearing — a correct/'free' decision is silent, matching the panel.
 *
 * The renderer's Web Audio is stubbed with a COUNTING AudioContext installed before any verdict, so
 * the suite is silent and the code under test is the shipped path: preference gate in narrate() ->
 * createSoundPlayer().play() -> AudioContext oscillators. jsdom-free: this runs in the real renderer.
 */

const homeScreen = '[data-testid="home-screen"]';
const settingsScreen = '[data-testid="settings-screen"]';
const tabSettings = '[data-testid="tab-settings"]';
const soundToggle = '[data-testid="sound-cues-toggle"]';
const coachPanel = '.coach';
const nextHand = '[data-testid="next-hand"]';

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-sound-'));
}

function readSaved(userDataDir: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function withApp(
  opts: { seed?: number; userDataDir?: string },
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const launched = await launchApp({
    seed: opts.seed ?? 8,
    userDataDir: opts.userDataDir ?? freshUserDataDir(),
  });
  try {
    await launched.page.waitForSelector(homeScreen);
    await body({ app: launched.app, page: launched.page });
  } finally {
    await launched.close();
  }
}

/**
 * Replace window.AudioContext with a counter that records every oscillator start(), then never makes a
 * sound. Installed AFTER load but BEFORE any verdict — the sound player constructs its context lazily on
 * the first mistake, so a spy set now is the one the player will use. Returns nothing; read the count
 * back with oscillatorCount().
 */
async function installAudioSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __oscStarts: number; AudioContext: unknown; webkitAudioContext: unknown };
    w.__oscStarts = 0;
    class FakeCtx {
      currentTime = 0;
      state = 'running';
      destination = {};
      resume() { return Promise.resolve(); }
      createOscillator() {
        return {
          type: 'sine',
          frequency: { value: 0 },
          connect() {},
          start() { w.__oscStarts += 1; },
          stop() {},
        };
      }
      createGain() {
        return {
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
        };
      }
    }
    w.AudioContext = FakeCtx as unknown;
    w.webkitAudioContext = FakeCtx as unknown;
  });
}

async function oscillatorCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __oscStarts?: number }).__oscStarts ?? 0);
}

async function setSound(page: Page, on: boolean): Promise<void> {
  await page.click(tabSettings);
  await page.waitForSelector(settingsScreen);
  const toggle = page.locator(soundToggle);
  if ((await toggle.getAttribute('data-on')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('data-on', String(on));
  await page.click(sel.tabPlay);
  await page.waitForSelector(homeScreen);
}

async function openTable(page: Page): Promise<void> {
  await page.click(sel.newHand);
  await page.waitForSelector(tableScreen);
}

/**
 * Seed 8, hand 1 (pinned by coach.spec / voice.spec): hero holds QsQh on 8c9h8s. Calling 50 preflop is
 * free (silent); folding for 99 into a 348 pot throws away ~3.9bb and grades SERIOUS — exactly one
 * mistake verdict out of two decisions, so a tone count of 1 is a real count, not a coincidence.
 */
async function playToOneVerdict(page: Page): Promise<string> {
  expect(await waitForIdle(page)).toBe('hero');
  await page.locator(sel.btnCall).click();
  expect(await waitForIdle(page)).toBe('hero');
  await page.locator(sel.btnFold).click();
  await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'serious');
  const verdict = (await page.locator(sel.coach).textContent()) ?? '';
  expect(verdict.length, 'the pinned seed must produce a real verdict').toBeGreaterThan(20);
  return verdict;
}

test.describe('the sound off switch', () => {
  test('1. sound OFF is the default, and a graded verdict renders NO tone', async () => {
    await withApp({ seed: 8 }, async ({ page }) => {
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      await expect(page.locator(soundToggle)).toHaveAttribute('data-on', 'false');
      await expect(page.locator(soundToggle)).toHaveText('Off');
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);

      await installAudioSpy(page);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      expect(verdict).not.toBe(''); // non-vacuous: there WAS a verdict to chime

      expect(await oscillatorCount(page), 'sound is off, yet a tone was rendered').toBe(0);
    });
  });

  test('2. sound ON: the same graded verdict renders a tone', async () => {
    await withApp({ seed: 8 }, async ({ page }) => {
      await setSound(page, true);
      await installAudioSpy(page);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      expect(verdict).not.toBe('');

      expect(await oscillatorCount(page), 'sound is on, yet no tone rendered').toBeGreaterThan(0);
    });
  });

  test('3. the toggle persists to disk and comes back on after a restart', async () => {
    const userDataDir = freshUserDataDir();
    await withApp({ seed: 8, userDataDir }, async ({ page }) => {
      await setSound(page, true);
    });
    // The saved state carries the preference...
    expect(readSaved(userDataDir).soundCues).toBe(true);
    // ...and a relaunch reads it back as On without touching the toggle.
    await withApp({ seed: 8, userDataDir }, async ({ page }) => {
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      await expect(page.locator(soundToggle)).toHaveAttribute('data-on', 'true');
      await expect(page.locator(soundToggle)).toHaveText('On');
    });
  });

  test('4. a correct/free decision is silent even with sound on', async () => {
    await withApp({ seed: 8 }, async ({ page }) => {
      await setSound(page, true);
      await installAudioSpy(page);
      await openTable(page);
      // The first decision (calling 50 preflop) is free — no verdict, so no tone.
      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      // Give the coach panel a beat; a free decision shows no serious verdict.
      await expect(page.locator(coachPanel)).not.toHaveAttribute('data-severity', 'serious');
      expect(await oscillatorCount(page), 'a free decision rendered a tone').toBe(0);
    });
  });
});
