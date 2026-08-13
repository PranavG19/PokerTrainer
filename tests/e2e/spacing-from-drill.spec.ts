import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp } from './helpers.js';

/**
 * THE WIRING TEST for the spacing engine (roadmap keystone). The scheduler in core/schedule.ts is
 * fully built and unit-tested, but until now it was DEAD in the real app: main.ts opened the Spacing
 * tab with no concept records, so the queue was only ever populated by the e2e `__offsuitSpacing`
 * seam. This asserts the honest path end-to-end: real Drill answers emit graded fading events, the
 * app groups them into ConceptStates through conceptStatesFromLog, and the Spacing screen renders a
 * concept row for the drilled kind — WITHOUT the seam — that survives an app restart.
 *
 * It is the counterpart to spacing.spec.ts (which pins scheduler behaviour through the seam): this one
 * proves the seam is no longer the only way the screen ever sees data.
 */

const STATE_FILE = 'offsuit-state.json';
const drillScreen = '[data-testid="drill-screen"]';
const answerBox = '[data-testid="drill-answer"]';
const spacingScreen = '[data-testid="spacing-screen"]';

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-spacing-'));
}

/** Read the persisted fading log so the restart step waits on disk, not on a race with the IPC save. */
function persistedGradedCount(userDataDir: string, conceptId: string): number {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, STATE_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as { fadingLog?: { kind: string; conceptId: string }[] };
    return (parsed.fadingLog ?? []).filter(
      (event) => event.kind === 'graded' && event.conceptId === conceptId,
    ).length;
  } catch {
    return -1;
  }
}

/**
 * Commit `count` answers on the currently-selected drill kind. Correctness is irrelevant to this test
 * — every commit, right or wrong, emits one graded fading event, and the spacing queue counts
 * opportunities, not hits. A fixed obviously-wrong answer avoids computing the right one per problem.
 */
async function commitDrillAnswers(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.fill(answerBox, '0');
    await page.keyboard.press('Enter');
    await expect(page.locator(drillScreen)).toHaveAttribute('data-phase', 'graded');
    if (i < count - 1) {
      const before = Number(await page.getAttribute(drillScreen, 'data-index'));
      await page.keyboard.press('Enter');
      await page.waitForFunction(
        (want: number) =>
          Number(
            (document.querySelector('[data-testid="drill-screen"]') as HTMLElement | null)?.dataset
              .index ?? '-1',
          ) === want,
        before + 1,
      );
    }
  }
}

async function openDrillKind(page: Page, kind: string): Promise<void> {
  // Math (drill) and Upkeep (spacing) both live behind the Train hub now.
  await page.click('[data-testid="tab-train"]');
  await page.click('[data-testid="tab-drill"]');
  await page.waitForSelector(drillScreen);
  await page.click(`[data-testid="drill-kind-btn"][data-kind="${kind}"]`);
  await expect(page.locator(drillScreen)).toHaveAttribute('data-kind', kind);
  await expect(page.locator(answerBox)).toBeVisible();
}

test.describe('the Spacing queue runs on real Drill history, not only the e2e seam', () => {
  test('drilling a kind creates a matching concept row that survives a restart', async () => {
    const userDataDir = freshUserDataDir();
    const CONCEPT = 'pot-odds';
    const REPS = 3;

    const first = await launchApp({ seed: 42, userDataDir });
    try {
      await openDrillKind(first.page, CONCEPT);
      await commitDrillAnswers(first.page, REPS);

      // Open Spacing WITHOUT injecting __offsuitSpacing — the screen must see the drill history on its
      // own. A row appears for the drilled concept with exactly the opportunity count we committed.
      await first.page.click('[data-testid="tab-spacing"]');
      await first.page.waitForSelector(spacingScreen);
      const row = first.page.locator(`[data-testid="concept-row"][data-concept="${CONCEPT}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-opportunities', String(REPS));
      // The visible id, not just the attribute, so the screen cannot render a row for the wrong concept.
      await expect(row.locator('[data-testid="concept-id"]')).toHaveText(CONCEPT);

      // The fading log must reach disk before the relaunch can see it.
      await expect.poll(() => persistedGradedCount(userDataDir, CONCEPT)).toBe(REPS);
    } finally {
      await first.close();
    }

    // Restart against the same profile: the derived concept row is rebuilt from the persisted log.
    const second = await launchApp({ seed: 42, userDataDir });
    try {
      await second.page.click('[data-testid="tab-train"]');
      await second.page.click('[data-testid="tab-spacing"]');
      await second.page.waitForSelector(spacingScreen);
      const row = second.page.locator(`[data-testid="concept-row"][data-concept="${CONCEPT}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toHaveAttribute('data-opportunities', String(REPS));
    } finally {
      await second.close();
    }
  });

  test('a fresh profile shows the honest empty queue, with the ladder still present', async () => {
    const userDataDir = freshUserDataDir();
    const app = await launchApp({ seed: 42, userDataDir });
    try {
      await app.page.click('[data-testid="tab-train"]');
      await app.page.click('[data-testid="tab-spacing"]');
      await app.page.waitForSelector(spacingScreen);
      // No drill history: no concept rows, and the screen says so rather than inventing one.
      await expect(app.page.locator('[data-testid="concept-row"]')).toHaveCount(0);
      await expect(app.page.locator('[data-testid="concept-empty"]')).toBeVisible();
      // The schedule itself is a property of the app, so the wave ladder is on screen regardless.
      await expect(app.page.locator('[data-testid="wave-ladder"]')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
