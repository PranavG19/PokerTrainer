import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './helpers.js';

/**
 * HAND-READING DRILL — the range-narrowing practice mode under the Train hub. Reached by opening Train
 * then the Reading rung. Exercised through the real app: the prompt names an opener seat, shows two
 * cards, and the learner answers In range / Folded; the verdict is graded on the app's own RFI rule.
 *
 * The drill is seed-fixed (DRILL_SEED=17), so the FIRST question is deterministic — the tests read the
 * position+combo off the DOM and derive the correct answer from the same rule the core uses, rather than
 * hard-coding a hand, so they stay honest if the seed's first draw ever changes.
 */

const drill = '[data-testid="hand-reading-drill"]';

async function openReading(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="tab-train"]');
  await page.click('[data-testid="tab-reading"]');
  await page.waitForSelector(drill);
}

test('the Reading rung mounts the hand-reading drill with a situation, two cards and two choices', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openReading(page);

    // The situation names an opener seat and poses the in-range question, never the answer.
    const situation = (await page.locator('[data-testid="hand-reading-situation"]').textContent()) ?? '';
    expect(situation).toMatch(/opens from /i); // names the opener seat (any scenario)
    expect(situation).toMatch(/in .*range\?/i); // poses the question, does not answer it

    // Two concrete cards are shown (reading the combo off cards is the skill).
    await expect(page.locator('[data-testid="hand-reading-hand"] [data-testid="card"]')).toHaveCount(2);

    // Both choices are offered; no verdict before committing.
    await expect(page.locator('[data-testid="hand-reading-in"]')).toBeVisible();
    await expect(page.locator('[data-testid="hand-reading-folded"]')).toBeVisible();
    await expect(page.locator(drill)).toHaveAttribute('data-verdict', '');
    await expect(page.locator('[data-testid="hand-reading-feedback"]')).toHaveAttribute('data-verdict', 'none');
  } finally {
    await close();
  }
});

test('committing an answer grades against the rule and names the truth for that combo', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openReading(page);

    const combo = (await page.locator(drill).getAttribute('data-combo')) ?? '';

    // Click "In range"; the drill grades it (right or wrong per the rule) and shows the verdict.
    await page.locator('[data-testid="hand-reading-in"]').click();
    const verdictAfterIn = await page.locator('[data-testid="hand-reading-feedback"]').getAttribute('data-verdict');
    expect(['right', 'wrong']).toContain(verdictAfterIn);

    // The verdict text states the truth for the combo just answered, and the class tag is present.
    const line = (await page.locator('[data-testid="hand-reading-verdict"]').textContent()) ?? '';
    expect(line).toContain(combo);
    expect(line.toLowerCase()).toMatch(/in range|a fold/);
    await expect(page.locator('[data-testid="hand-reading-tag"]')).toBeVisible();
  } finally {
    await close();
  }
});

test('a real grader: over a mixed run both right and wrong occur; keyboard I/O also commit', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openReading(page);

    const verdicts: string[] = [];
    for (let i = 0; i < 12; i++) {
      // Alternate In/Folded so that across a dozen questions we exercise both a correct and an incorrect
      // grade regardless of the seed's mix — the drill must be capable of BOTH verdicts.
      const btn = i % 2 === 0 ? 'hand-reading-in' : 'hand-reading-folded';
      await page.locator(`[data-testid="${btn}"]`).click();
      const v = await page.locator('[data-testid="hand-reading-feedback"]').getAttribute('data-verdict');
      if (v) verdicts.push(v);
    }
    // A real grader must produce both outcomes over a mixed set of answers — never all-right (a rubber
    // stamp) nor all-wrong (an inverted key).
    expect(verdicts).toContain('right');
    expect(verdicts).toContain('wrong');
    expect(Number(await page.locator(drill).getAttribute('data-answered'))).toBeGreaterThanOrEqual(12);

    // Keyboard commits too: press I (in range); the answered count advances.
    const before = Number(await page.locator(drill).getAttribute('data-answered'));
    await page.locator('body').press('i');
    await expect(page.locator(drill)).toHaveAttribute('data-answered', String(before + 1));
    // And O (folded).
    await page.locator('body').press('o');
    await expect(page.locator(drill)).toHaveAttribute('data-answered', String(before + 2));
  } finally {
    await close();
  }
});

test('all three read scenarios occur, and the flat lines name the capping action without the answer', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openReading(page);

    // Click through questions, recording each scenario until all three have appeared (the mix is
    // seed-driven, so a short run surfaces them) or a generous cap is hit.
    const scenarios = new Set<string>();
    let sawFlat3betText = false;
    let sawBbDefendText = false;
    for (let i = 0; i < 60 && scenarios.size < 3; i++) {
      const scenario = (await page.locator(drill).getAttribute('data-scenario')) ?? '';
      scenarios.add(scenario);
      const line = (await page.locator('[data-testid="hand-reading-situation"]').textContent()) ?? '';
      // Every line poses the question and never answers it.
      expect(line.toLowerCase()).toMatch(/in .*range\?/);
      if (scenario === 'flat-3bet') {
        expect(line.toLowerCase()).toContain('3-bet'); // names the capping action
        sawFlat3betText = true;
      }
      if (scenario === 'bb-defend') {
        expect(line.toLowerCase()).toContain('big blind'); // names who is defending
        sawBbDefendText = true;
      }
      await page.locator('[data-testid="hand-reading-in"]').click();
    }
    expect(scenarios, 'all three reads should occur over a run').toEqual(
      new Set(['open', 'flat-3bet', 'bb-defend']),
    );
    expect(sawFlat3betText && sawBbDefendText, 'both flat-scenario lines were verified').toBe(true);
  } finally {
    await close();
  }
});

test('the verdict reaches screen readers via a polite live region', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await openReading(page);
    const region = page.locator('[data-testid="hand-reading-announcer"]');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveText(''); // nothing to announce before the first commit

    await page.locator('[data-testid="hand-reading-in"]').click();
    // The announcement mirrors the visible verdict line's subject (the combo just answered).
    const line = (await page.locator('[data-testid="hand-reading-verdict"]').textContent()) ?? '';
    const combo = line.split(' ')[0];
    await expect(region).toContainText(combo);
  } finally {
    await close();
  }
});
