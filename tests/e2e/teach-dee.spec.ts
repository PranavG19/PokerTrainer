import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, shot } from './helpers.js';

/**
 * TEACH DEE (BUILD-PLAN 2.4): a Folio rule is taught to Dee, played as a contrast set on the real engine, and repair
 * detection asks for a rewrite when the rule fails. Driven through the real app on the e2e clock; the profile is
 * seeded with one lesson rule, so the deal (seeded from the rule) and its verdicts are the same on every run.
 */

const STATE = 'offsuit-state.json';
const MS_PER_DAY = 86_400_000;
/** Monday 12 October 2026, 8 pm on this machine's clock. */
const MON_8PM = new Date(2026, 9, 12, 20, 0, 0).getTime();
const RULE = 'Suited hands realise their equity better, so I bet them; offsuit I check';
const CONCEPT = 'polarity-picks-the-size';

const freshDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-teach-'));
const readState = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, STATE), 'utf-8')) as Record<string, any>;

function seed(dir: string, progression: Record<string, unknown> = {}): void {
  const writtenDay = Math.floor((MON_8PM - 2 * MS_PER_DAY) / MS_PER_DAY);
  fs.writeFileSync(
    path.join(dir, STATE),
    JSON.stringify({
      schemaVersion: 2,
      progression: {
        dee: { ruleSentences: [{ conceptId: CONCEPT, text: RULE, day: writtenDay }] },
        ...progression,
      },
    }),
  );
}

async function open(at: number, dir: string) {
  const app = await launchApp({ userDataDir: dir, env: { OFFSUIT_NOW: String(at) } });
  await app.page.waitForSelector('[data-testid="home-screen"], [data-testid="onboarding"]');
  return app;
}

async function size(app: Awaited<ReturnType<typeof launchApp>>, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

/** Both documented sizes, no page scroll, and a screenshot at each. */
async function bothSizes(app: Awaited<ReturnType<typeof launchApp>>, name: string): Promise<void> {
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await size(app, w, h);
    const [sh, ih, sw, iw] = await app.page.evaluate(() => [
      document.documentElement.scrollHeight,
      window.innerHeight,
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sh, `${name} ${w}x${h} height`).toBeLessThanOrEqual(ih);
    expect(sw, `${name} ${w}x${h} width`).toBeLessThanOrEqual(iw);
    await shot(app.page, `${name}-${w}x${h}`);
  }
}

/** Play every spot in the set with one move, checking the reveal on each. */
async function playSet(page: Page, move: string): Promise<number> {
  const play = page.locator('[data-testid="teach-play"]');
  const total = Number(await play.getAttribute('data-total'));
  for (let i = 0; i < total; i++) {
    await expect(play).toHaveAttribute('data-index', String(i));
    // Commit before feedback: nothing of Dee's play or the engine's verdict shows before the learner's own play.
    await expect(page.locator('[data-testid="teach-reveal"]')).toHaveCount(0);
    await page.locator(`[data-testid="teach-move"][data-move="${move}"]`).click();
    await expect(page.locator('[data-testid="teach-reveal"]')).toBeVisible();
    await expect(page.locator('[data-testid="teach-you"]')).toContainText('You:');
    await expect(page.locator('[data-testid="teach-engine"]')).toBeVisible();
    if (i < total - 1) await page.locator('[data-testid="teach-next"]').click();
  }
  return total;
}

test.describe('Teach Dee', () => {
  test('1. a rule from the Folio is played as a contrast set, found too broad, rewritten and paid once', async () => {
    const dir = freshDir();
    seed(dir);
    let app = await open(MON_8PM, dir);
    try {
      const { page } = app;
      // Picking a rule: Train › Leaks opens the rule list.
      await page.locator('[data-testid="tab-train"]').click();
      await page.locator('[data-testid="tab-repair"]').click();
      await expect(page.locator('[data-testid="teach-entry"]')).toContainText('1 rule');
      await page.locator('[data-testid="teach-entry"]').click();
      const root = page.locator('[data-testid="teach-screen"]');
      await expect(root).toHaveAttribute('data-phase', 'pick');
      await expect(page.locator('[data-testid="teach-rule"]')).toHaveCount(1);
      await expect(page.locator('[data-testid="teach-rule-meta"]')).toContainText('not taught yet');
      await bothSizes(app, 'teach-pick');

      // The reading: Dee's first guess from the sentence, every part of it the learner's to change.
      await page.locator('[data-testid="teach-rule"]').click();
      await expect(root).toHaveAttribute('data-phase', 'read');
      const reading = page.locator('[data-testid="teach-reading"]');
      await expect(reading).toHaveAttribute('data-axis', 'suitedness');
      await expect(reading).toHaveAttribute('data-value', 'suited');
      await expect(reading).toHaveAttribute('data-action', 'aggressive');
      await expect(reading).toHaveAttribute('data-otherwise', 'passive');
      await expect(page.locator('[data-testid="teach-base"]')).toHaveValue('turn-probe');
      await expect(page.locator('[data-testid="teach-dee-line"]')).toContainText('suited');
      // Nothing is locked: a change of variable is taken, and changing it back restores the guess.
      await page.locator('[data-testid="teach-axis"] [data-value="kickerGap"]').click();
      await expect(reading).toHaveAttribute('data-axis', 'kickerGap');
      await page.locator('[data-testid="teach-axis"] [data-value="suitedness"]').click();
      await page.locator('[data-testid="teach-value"] [data-value="suited"]').click();
      await expect(reading).toHaveAttribute('data-value', 'suited');
      await bothSizes(app, 'teach-read');

      await page.locator('[data-testid="teach-start"]').click();
      await expect(root).toHaveAttribute('data-phase', 'play');
      // The set: spots where the rule applies beside near-misses where it does not.
      const tags = page.locator('[data-testid="teach-tag"]');
      await expect(tags).toContainText(/Suitedness: (suited|offsuit)/);
      await page.locator('[data-testid="teach-move"][data-move="passive"]').click();
      await bothSizes(app, 'teach-contrast-set');
      await page.locator('[data-testid="teach-next"]').click();
      // The rest of the set (the first spot is already committed).
      const play = page.locator('[data-testid="teach-play"]');
      const total = Number(await play.getAttribute('data-total'));
      expect(total).toBeGreaterThanOrEqual(4);
      const applies: string[] = [];
      for (let i = 1; i < total; i++) {
        await expect(play).toHaveAttribute('data-index', String(i));
        applies.push((await play.getAttribute('data-applies')) ?? '');
        await expect(page.locator('[data-testid="teach-reveal"]')).toHaveCount(0);
        await page.locator('[data-testid="teach-move"][data-move="passive"]').click();
        await expect(page.locator('[data-testid="teach-dee-move"]')).toHaveAttribute('data-move', applies[applies.length - 1] === 'true' ? 'aggressive' : 'passive');
        await page.locator('[data-testid="teach-next"]').click();
      }
      expect(applies).toContain('true');
      expect(applies).toContain('false');

      // The repair: Dee's misses on screen, the learner's diagnosis BEFORE the finding is shown.
      await expect(root).toHaveAttribute('data-phase', 'repair');
      await expect(root).toHaveAttribute('data-finding', 'too-broad');
      await expect(page.locator('[data-testid="teach-miss"]').first()).toBeVisible();
      await expect(page.locator('[data-testid="teach-finding"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="teach-diagnose-option"]')).toHaveCount(5);
      await bothSizes(app, 'teach-repair-prompt');
      await page.locator('[data-testid="teach-diagnose-option"][data-finding="too-broad"]').click();
      await expect(page.locator('[data-testid="teach-finding"]')).toHaveAttribute('data-finding', 'too-broad');
      await expect(page.locator('[data-testid="teach-diagnosis"]')).toHaveAttribute('data-match', 'true');
      await expect(page.locator('[data-testid="teach-variable"]')).toHaveAttribute('data-axis', 'kickerGap');
      await bothSizes(app, 'teach-repair-rewrite');

      // The set is on file the moment it finished, and it paid its Reps once.
      await expect.poll(() => readState(dir).progression?.teachDee?.sets?.length ?? 0).toBe(1);
      const set = readState(dir).progression.teachDee.sets[0];
      expect(set).toMatchObject({ conceptId: CONCEPT, base: 'turn-probe', axis: 'suitedness', value: 'suited', finding: 'too-broad' });
      await expect.poll(() => (readState(dir).progression.reps.awards as { key: string; reps: number }[]).filter((a) => a.key.startsWith('contrast:')).map((a) => a.reps)).toEqual([25]);

      // A cached cell is refused with L2's reason; a mechanism sentence is kept.
      await page.locator('[data-testid="teach-rewrite-input"]').fill('K7s is a CO open');
      await page.locator('[data-testid="teach-rewrite-submit"]').click();
      await expect(page.locator('[data-testid="teach-rewrite-feedback"]')).toHaveAttribute('data-verdict', 'rejected');
      await page.locator('[data-testid="teach-rewrite-input"]').fill('Suited connectors realise their equity well enough to bet; gapped suited hands check');
      await page.locator('[data-testid="teach-rewrite-submit"]').click();
      await expect(page.locator('[data-testid="teach-rewrite-feedback"]')).toHaveAttribute('data-verdict', 'accepted');
      await expect(page.locator('[data-testid="teach-again"]')).toBeVisible();
      await expect.poll(() => (readState(dir).lexicon as { outcome: string; conceptId: string }[]).map((a) => `${a.conceptId}:${a.outcome}`)).toEqual([
        `${CONCEPT}:rejected`,
        `${CONCEPT}:accepted`,
      ]);

      // Teaching the new version opens on it.
      await page.locator('[data-testid="teach-again"]').click();
      await expect(root).toHaveAttribute('data-phase', 'read');
      await expect(page.locator('[data-testid="teach-quote"]')).toContainText('Suited connectors realise');
    } finally {
      await app.close();
    }

    // After a relaunch the Folio shows the rewrite as the card's rule, the old one kept, and the last set's finding.
    app = await open(MON_8PM + 3_600_000, dir);
    try {
      const { page } = app;
      await page.locator('[data-testid="tab-learn"]').click();
      await page.locator('[data-testid="open-folio"]').click();
      const card = page.locator('[data-testid="folio-card"]');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('Suited connectors realise');
      await expect(card).toContainText('1 earlier version kept');
      await expect(page.locator('[data-testid="folio-teach-note"]')).toContainText('reaches too far');
      await expect(page.locator('[data-testid="folio-teach-note"]')).not.toContainText('rewrite it');
      await bothSizes(app, 'teach-folio');
    } finally {
      await app.close();
    }
  });

  test('2. a rule left unrewritten comes back on the next day’s Ticket and opens Teach Dee on it', async () => {
    const dir = freshDir();
    const yesterday = MON_8PM - MS_PER_DAY;
    seed(dir, {
      teachDee: {
        sets: [
          {
            at: yesterday,
            conceptId: CONCEPT,
            text: RULE,
            base: 'turn-probe',
            axis: 'suitedness',
            value: 'suited',
            action: 'aggressive',
            otherwise: 'passive',
            finding: 'wrong',
            spots: 4,
            misses: 2,
          },
        ],
      },
    });
    const app = await open(MON_8PM, dir);
    try {
      const { page } = app;
      await page.locator('[data-testid="home-ticket"]').click();
      const item = page.locator('[data-testid="ticket-item"][data-kind="teach"]');
      await expect(item).toHaveCount(1);
      await expect(item).toContainText('Teach Dee again');
      await item.click();
      const root = page.locator('[data-testid="teach-screen"]');
      await expect(root).toHaveAttribute('data-phase', 'read');
      await expect(root).toHaveAttribute('data-concept', CONCEPT);
      await page.locator('[data-testid="teach-start"]').click();
      await playSet(page, 'passive');
      await page.locator('[data-testid="teach-next"]').click();
      await expect(root).toHaveAttribute('data-phase', 'repair');
      // Teaching it again works the Ticket's item, whatever the new set found.
      await expect.poll(() => readState(dir).progression.ticket.done as string[]).toContain(`teach:${CONCEPT}`);
    } finally {
      await app.close();
    }
  });

  test('3. with Character off, the set still plays: the rule’s plays and the verdicts, with no Dee mark or line', async () => {
    const dir = freshDir();
    const writtenDay = Math.floor((MON_8PM - 2 * MS_PER_DAY) / MS_PER_DAY);
    fs.writeFileSync(
      path.join(dir, STATE),
      JSON.stringify({
        schemaVersion: 2,
        progression: { dee: { character: false, ruleSentences: [{ conceptId: CONCEPT, text: RULE, day: writtenDay }] } },
      }),
    );
    const app = await open(MON_8PM, dir);
    try {
      const { page } = app;
      await page.locator('[data-testid="tab-learn"]').click();
      await page.locator('[data-testid="open-folio"]').click();
      await page.locator('[data-testid="folio-teach"]').click();
      const root = page.locator('[data-testid="teach-screen"]');
      await expect(root).toHaveAttribute('data-phase', 'read');
      await page.locator('[data-testid="teach-start"]').click();
      await page.locator('[data-testid="teach-move"][data-move="aggressive"]').click();
      await expect(page.locator('[data-testid="teach-dee-move"]')).toContainText('The rule:');
      await expect(page.locator('[data-testid="teach-dee-line"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="teach-screen"] [data-testid="dee-mark"]')).toHaveCount(0);
      // Back returns to the Rulebook it came from.
      await page.locator('[data-testid="teach-back"]').click();
      await page.locator('[data-testid="teach-back"]').click();
      await page.locator('[data-testid="teach-back"]').click();
      await expect(page.locator('[data-testid="folio-screen"]')).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
