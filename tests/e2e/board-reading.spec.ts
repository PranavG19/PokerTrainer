import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * BOARD-READING (SIGHT) DRILL — the 7-cards-to-best-5 fluency mode under the Train hub, reached by
 * opening Train then the Sight rung. Seven cards land (two hole + five board) and the learner names the
 * made-hand category under a 2s gate. The grade is evaluate() (the engine's own hand-ranker), so the
 * tests never hard-code a category: they drive the drill and assert its OWN exposed truth is consistent,
 * that the grader can produce both outcomes, and that the fluency gate really trips when slow.
 */

const drill = '[data-testid="board-reading-drill"]';
// HandCategory.Straight = 4; its number-key shortcut is 5 (index 4 + 1).
const STRAIGHT = '4';
const STRAIGHT_KEY = '5';

async function openSight(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="tab-train"]');
  await page.click('[data-testid="tab-board"]');
  await page.waitForSelector(drill);
}

test('the Sight rung mounts the drill with a prompt, seven cards and nine category choices', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);

    const situation = (await page.locator('[data-testid="board-reading-situation"]').textContent()) ?? '';
    expect(situation.toLowerCase()).toMatch(/best five-card hand/);
    expect(situation).toContain('2s'); // names the fluency gate, never the answer

    // Two hole cards and five board cards — the seven the learner must read.
    await expect(page.locator('[data-testid="board-reading-hole"] [data-testid="card"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="board-reading-board"] [data-testid="card"]')).toHaveCount(5);

    // All nine categories are offered, and nothing is graded before a commit.
    await expect(page.locator('[data-testid^="board-reading-cat-"]')).toHaveCount(9);
    await expect(page.locator(drill)).toHaveAttribute('data-verdict', '');
    await expect(page.locator('[data-testid="board-reading-feedback"]')).toHaveAttribute('data-verdict', 'none');
  } finally {
    await close();
  }
});

test('the grade is consistent with the exposed truth: verdict is right iff the pick matched the category', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);

    // Answer "Straight" (key 5). Whatever the board actually is, the verdict must agree with the truth
    // the drill then publishes on data-category — a rubber stamp or an inverted key would break this.
    await page.locator('[data-testid="board-reading-cat-4"]').click();
    const verdict = await page.locator(drill).getAttribute('data-verdict');
    const category = await page.locator(drill).getAttribute('data-category');
    expect(['right', 'wrong']).toContain(verdict);
    expect((verdict === 'right')).toBe(category === STRAIGHT);

    // The verdict line names the true category, and the timing tag reports against the gate.
    await expect(page.locator('[data-testid="board-reading-verdict"]')).toBeVisible();
    const timing = (await page.locator('[data-testid="board-reading-timing"]').textContent()) ?? '';
    expect(timing).toMatch(/\d+\.\d+s — (inside|over) the 2s gate/);
  } finally {
    await close();
  }
});

test('a real grader: always naming one category yields BOTH right and wrong over a run', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);

    const verdicts: string[] = [];
    for (let i = 0; i < 25; i++) {
      // Always answer "Pair" (key 2). Across a run of random boards that must be right on some and wrong
      // on others — never all-right (a stamp), never all-wrong (an inverted key).
      await page.locator('body').press('2');
      const v = await page.locator(drill).getAttribute('data-verdict');
      if (v) verdicts.push(v);
    }
    expect(verdicts).toContain('right');
    expect(verdicts).toContain('wrong');
    expect(Number(await page.locator(drill).getAttribute('data-answered'))).toBeGreaterThanOrEqual(25);
  } finally {
    await close();
  }
});

test('the fluency gate is real: a quick answer is fast, a slow one trips the gate', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);

    // A quick click is inside the 2s gate.
    await page.locator(`[data-testid="board-reading-cat-${STRAIGHT}"]`).click();
    await expect(page.locator(drill)).toHaveAttribute('data-fast', 'true');

    // Wait out the gate before answering the next board — the drill must report it as slow.
    await page.waitForTimeout(2100);
    await page.locator(`[data-testid="board-reading-cat-${STRAIGHT}"]`).click();
    await expect(page.locator(drill)).toHaveAttribute('data-fast', 'false');
    await expect(page.locator('[data-testid="board-reading-timing"]')).toContainText('over the 2s gate');
  } finally {
    await close();
  }
});

test('number keys commit, and an out-of-range key is inert', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);

    const before = Number(await page.locator(drill).getAttribute('data-answered'));
    await page.locator('body').press(STRAIGHT_KEY); // 5 = Straight
    await expect(page.locator(drill)).toHaveAttribute('data-answered', String(before + 1));

    // 0 is below the 1–9 range and must not commit; the count holds.
    await page.locator('body').press('0');
    await page.locator('body').press('x');
    await expect(page.locator(drill)).toHaveAttribute('data-answered', String(before + 1));
  } finally {
    await close();
  }
});

test('the verdict reaches screen readers via a polite live region', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openSight(page);
    const region = page.locator('[data-testid="board-reading-announcer"]');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveText(''); // nothing before the first commit

    await page.locator('body').press(STRAIGHT_KEY);
    await expect(region).toContainText(/inside|over/); // the spoken line reports the gate result
  } finally {
    await close();
  }
});
