import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';
import { tableScreen } from './flow.js';

/**
 * STORY EXTRAS — the Kitchen Table (chapter 0), a boss hand, the keepsake shelf and the Masquerade epilogue, end to
 * end and hidden. Every room opens at any time (N1); a boss hand is judged on its decisions; the Masquerade names a
 * seat only once the Folio has inked a read at reads.ts's 20.
 */

const STATE = 'offsuit-state.json';
const DAY = 20380;

function freshDir(seed?: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-story-extras-'));
  if (seed) fs.writeFileSync(path.join(dir, STATE), JSON.stringify({ schemaVersion: 2, progression: seed }), 'utf-8');
  return dir;
}

async function withApp(dir: string, body: (page: Page, app: Awaited<ReturnType<typeof launchApp>>) => Promise<void>): Promise<void> {
  const launched = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await launched.page.waitForSelector('[data-testid="home-screen"]');
    await body(launched.page, launched);
  } finally {
    await launched.close();
  }
}

async function openStory(page: Page): Promise<void> {
  await page.click('[data-testid="tab-story"]');
  await page.waitForSelector('[data-testid="story-map"]');
}

async function fits(page: Page, app: Awaited<ReturnType<typeof launchApp>>): Promise<void> {
  for (const [w, h] of [
    [900, 640],
    [1100, 760],
  ]) {
    await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
    await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
    const geo = await page.evaluate(() => ({
      sh: document.documentElement.scrollHeight,
      ch: document.documentElement.clientHeight,
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(geo.sh, `${w}x${h} height`).toBeLessThanOrEqual(geo.ch);
    expect(geo.sw, `${w}x${h} width`).toBeLessThanOrEqual(geo.cw);
  }
}

async function answer(page: Page, kind: string): Promise<void> {
  await page.click(`[data-testid="boss-option"][data-kind="${kind}"]`);
  await page.click('[data-testid="boss-commit"]');
}

/** Every element matching `selector` sits inside the window (nothing clipped by an overflow-hidden column). */
async function allInView(page: Page, selector: string): Promise<void> {
  const out = await page.locator(selector).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return r.bottom <= window.innerHeight && r.right <= window.innerWidth && r.height > 0;
    }),
  );
  expect(out.length).toBeGreaterThan(0);
  expect(out.every(Boolean), selector).toBe(true);
}

test.describe('Story extras', () => {
  test('the Kitchen Table: welcome, the price, the first hand judged on decisions, and the lamp on the shelf', async () => {
    const dir = freshDir();
    await withApp(dir, async (page, app) => {
      await openStory(page);
      await page.click('[data-testid="story-kitchen-open"]');
      const kitchen = page.locator('[data-testid="story-kitchen"]');
      await expect(kitchen).toHaveAttribute('data-stage', 'intro');
      await expect(page.locator('[data-testid="story-intro-line"]').first()).toHaveAttribute('data-line-id', /^story\.kitchen\./);
      await page.click('[data-testid="story-primary"]');
      await expect(kitchen).toHaveAttribute('data-stage', 'lesson');
      // A wrong answer gets a question back, then the script walks.
      await page.click('[data-testid="dialogue-option"][data-option-id="with-bet"]');
      await page.click('[data-testid="dialogue-commit"]');
      await expect(page.locator('[data-testid="dee-turn"]').last()).toContainText('?');
      for (const id of ['after', 'price', 'price-first']) {
        await page.click(`[data-testid="dialogue-option"][data-option-id="${id}"]`);
        await page.click('[data-testid="dialogue-commit"]');
      }
      await page.click('[data-testid="kitchen-to-hand"]');
      await expect(kitchen).toHaveAttribute('data-stage', 'boss');

      // The first hand: a wrong first answer is a question back, the hand waits, and the play is not clean.
      await page.click('[data-testid="boss-deal"]');
      const beat = page.locator('[data-testid="boss-beat"]');
      await expect(beat).toHaveAttribute('data-phase', 'ask');
      await expect(page.locator('[data-testid="boss-ask"]')).toContainText(/1 in 4/);
      await expect(page.locator('[data-testid="boss-rival-cards"]')).toHaveAttribute('data-shown', 'false');
      await answer(page, 'fold');
      await expect(page.locator('[data-testid="boss-back"]')).toContainText('?');
      await expect(page.locator('[data-testid="boss-option"][data-kind="fold"]')).toBeDisabled();
      await answer(page, 'call');
      await expect(beat).toHaveAttribute('data-phase', 'done');
      await expect(page.locator('[data-testid="boss-result"]')).toHaveAttribute('data-clean', 'false');
      await expect(page.locator('[data-testid="boss-keepsake"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="boss-rival-cards"]')).toHaveAttribute('data-shown', 'true');
      // Chips never enter the judgement.
      await expect(page.locator('[data-testid="boss-result"]')).not.toContainText(/won|lost|chips/i);

      // Again, clean: the lamp is kept.
      await page.click('[data-testid="boss-again"]');
      await answer(page, 'call');
      await expect(page.locator('[data-testid="boss-result"]')).toHaveAttribute('data-clean', 'true');
      await expect(page.locator('[data-testid="boss-keepsake"]')).toContainText('The kitchen lamp');
      await fits(page, app);
    });

    await withApp(dir, async (page, app) => {
      const state = JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8'));
      expect(state.progression.story.bosses['boss-kitchen'].attempts).toBe(2);
      expect(state.progression.story.bosses['boss-kitchen'].cleanOn).toEqual(expect.any(Number));
      expect(state.progression.dee.keepsakes).toEqual(['kitchen-lamp']);
      await page.click('[data-testid="tab-you"]');
      await page.waitForSelector('[data-testid="you-profile"]');
      const shelf = page.locator('[data-testid="keepsake-shelf"]');
      await expect(shelf.locator('[data-testid="keepsake"]')).toHaveCount(8);
      await expect(shelf.locator('[data-testid="keepsake"][data-kept="true"]')).toHaveCount(1);
      await expect(shelf.locator('[data-testid="keepsake"][data-id="kitchen-lamp"]')).toHaveAttribute('data-kept', 'true');
      await fits(page, app);
      await allInView(page, '[data-testid="keepsake"]');
      // A keepsake opens the hand that earned it.
      await shelf.locator('[data-testid="keepsake"][data-id="kitchen-lamp"]').click();
      await expect(page.locator('[data-testid="story-kitchen"]')).toHaveAttribute('data-stage', 'boss');
      // The Locker files the first-keepsake item on a receipt.
      await page.click('[data-testid="tab-you"]');
      await page.click('[data-testid="tab-locker"]');
      await page.click('[data-testid="locker-slot-deeRim"]');
      await expect(page.locator('[data-testid="locker-item"][data-id="rim-lamplit"]')).toHaveAttribute('data-owned', 'true');
    });
  });

  test('a boss hand: the rival’s exploit is the right line, and a clean one keeps the room’s keepsake', async () => {
    const dir = freshDir();
    await withApp(dir, async (page, app) => {
      await openStory(page);
      await page.click('[data-testid="story-venue"][data-venue="lighthouse"]');
      await page.click('[data-testid="story-beat"][data-beat="boss"]');
      await expect(page.locator('[data-testid="story-chapter"]')).toHaveAttribute('data-stage', 'boss');
      await page.click('[data-testid="boss-deal"]');
      // The hand so far carries the engine's numbers; the ask is the river.
      await expect(page.locator('[data-testid="boss-history"]')).toContainText('raises to 150');
      await expect(page.locator('[data-testid="boss-board"] .card')).toHaveCount(5);
      await answer(page, 'fold');
      await expect(page.locator('[data-testid="boss-result"]')).toHaveAttribute('data-clean', 'true');
      await expect(page.locator('[data-testid="boss-keepsake"]')).toContainText('The wick');
      // A folded hand shows no cards; the beat row ticks at once.
      await expect(page.locator('[data-testid="boss-rival-cards"]')).toHaveAttribute('data-shown', 'false');
      await expect(page.locator('[data-testid="story-beat"][data-beat="boss"]')).toHaveAttribute('data-done', 'true');
      // A later play that misses still shows the keepsake as on the shelf (review: stale kept flag).
      await page.click('[data-testid="boss-again"]');
      await answer(page, 'call');
      await answer(page, 'fold');
      await expect(page.locator('[data-testid="boss-result"]')).toHaveAttribute('data-clean', 'false');
      await expect(page.locator('[data-testid="boss-keepsake"]')).toContainText('On the shelf');
      // The keepsake never names a rival still masked.
      await expect(page.locator('[data-testid="boss-beat"]')).not.toContainText('Wren');
      await fits(page, app);
    });
  });

  test('the Masquerade: masked seats in pencil until 20 hands; an inked seat is named from its reads', async () => {
    const fresh = freshDir();
    await withApp(fresh, async (page, app) => {
      await openStory(page);
      await page.click('[data-testid="story-masquerade-open"]');
      const masq = page.locator('[data-testid="story-masquerade"]');
      await expect(masq).toHaveAttribute('data-run', '1');
      await expect(page.locator('[data-testid="masq-seat"]')).toHaveCount(3);
      await expect(page.locator('[data-testid="masq-seat"][data-unmasked="false"]')).toHaveCount(3);
      await expect(page.locator('[data-testid="masq-seat"]').first()).toContainText('20 more hands');
      await expect(page.locator('[data-testid="masq-read"][data-inked="true"]')).toHaveCount(0);
      // Nothing to name until a read is inked.
      await expect(page.locator('[data-testid="masq-name"]')).toHaveCount(0);
      await fits(page, app);
      // The table: three masked seats, a round of ten, no style label shown.
      await page.click('[data-testid="masq-sit"]');
      await page.waitForSelector(`${tableScreen}[data-hand-limit="10"]`);
      await expect(page.locator('[data-testid="seat"]')).toHaveCount(4);
      await expect(page.locator('[data-testid="seat"]').nth(1)).toContainText('Fox');
    });

    // Seat 0 inked at 21 hands: it plays almost every hand, folds to almost nothing.
    const dir = freshDir({
      story: {
        masquerade: {
          run: 1,
          completed: 0,
          completedOn: null,
          seats: [
            { rival: 'juniper', acted: 21, played: 20, faced: 21, folded: 0, chances: 21, bets: 19, missed: [], unmaskedOn: null },
            { rival: 'wren', acted: 19, played: 1, faced: 6, folded: 5, chances: 1, bets: 0, missed: [], unmaskedOn: null },
            { rival: 'ines', acted: 19, played: 6, faced: 8, folded: 4, chances: 5, bets: 2, missed: [], unmaskedOn: null },
          ],
        },
      },
    });
    await withApp(dir, async (page, app) => {
      await openStory(page);
      await page.click('[data-testid="story-masquerade-open"]');
      await expect(page.locator('[data-testid="masq-seat"][data-seat="0"]')).toHaveAttribute('data-inked', 'true');
      await expect(page.locator('[data-testid="masq-seat"][data-seat="1"]')).toContainText('1 more hand');
      await expect(page.locator('[data-testid="masq-read"][data-read="plays"]')).toHaveAttribute('data-lean', 'more');
      // A name the reads do not fit gets a question back, and that name is spent.
      await page.click('[data-testid="masq-style"][data-rival="wren"]');
      await page.click('[data-testid="masq-commit"]');
      await expect(page.locator('[data-testid="masq-said"]')).toHaveAttribute('data-line-id', 'story.masq.not-fit.a');
      await expect(page.locator('[data-testid="masq-style"][data-rival="wren"]')).toBeDisabled();
      // A name the inked reads fit takes the mask off; the orbit still masks the rival's name.
      await page.click('[data-testid="masq-style"][data-rival="vesper"]');
      await page.click('[data-testid="masq-commit"]');
      await expect(page.locator('[data-testid="masq-unmask"]')).toContainText('The Fireworks Pier’s regular');
      // The style is the orbit's to reveal (D17): not shown while the Pier is still masked.
      await expect(page.locator('[data-testid="masq-unmask"]')).not.toContainText('Bets and raises nearly everything');
      await expect(page.locator('[data-testid="masq-seat"][data-seat="0"]')).toHaveAttribute('data-unmasked', 'true');
      await fits(page, app);
      // A seat still in pencil cannot be named.
      await page.click('[data-testid="masq-seat"][data-seat="1"]');
      await expect(page.locator('[data-testid="masq-name"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="masq-said"]')).toHaveAttribute('data-line-id', 'story.masq.pencil.a');
    });
  });

  test('a Masquerade opened from the keepsake shelf keeps its hands (review blocker)', async () => {
    const dir = freshDir();
    await withApp(dir, async (page) => {
      await page.click('[data-testid="tab-you"]');
      await page.waitForSelector('[data-testid="you-profile"]');
      await page.click('[data-testid="keepsake"][data-id="masquerade-mask"]');
      await page.waitForSelector('[data-testid="story-masquerade"]');
      await page.click('[data-testid="masq-sit"]');
      await page.waitForSelector(`${tableScreen}[data-hand-limit="10"]`);
      await page.click('[data-testid="btn-fold"]');
      await expect
        .poll(() => {
          const file = path.join(dir, STATE);
          if (!fs.existsSync(file)) return 'no save yet';
          const seats = JSON.parse(fs.readFileSync(file, 'utf-8')).progression?.story?.masquerade?.seats ?? [];
          return seats.length === 3 && seats.some((x: { acted: number }) => x.acted > 0) ? 'counted' : `seats on file: ${seats.length}`;
        }, { timeout: 30_000 })
        .toBe('counted');
    });
  });
});
