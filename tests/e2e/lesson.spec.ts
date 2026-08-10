import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, shot } from './helpers.js';

/**
 * LESSON MODE (the 'learn' tab).
 *
 * The load-bearing test here is #3: G5 says the reveal must be STRUCTURALLY unreachable before the
 * learner commits, and a CSS-hidden reveal passes any click-based test while still sitting in the
 * DOM for anyone who opens devtools — or for a screen reader. So the gate is asserted twice: the
 * node must be absent from `querySelector`, and the authored `reasoning` string must not appear
 * anywhere in the rendered text. The commit is then driven by DISPATCHED events rather than by
 * Playwright clicks, so nothing about the assertion depends on hit-testing.
 *
 * Sync rule: never sleep. The screen root publishes data-view / data-lesson-id / data-committed on
 * every render, and those are the only sync points these tests use.
 */

const learnTab = '[data-testid="tab-learn"]';
const playTab = '[data-testid="tab-play"]';
const lessonScreen = '[data-testid="lesson-screen"]';
const lessonRow = '[data-testid="lesson-row"]';
const phaseSection = '[data-testid="phase-section"]';
const reveal = '[data-testid="lesson-reveal"]';
const commitAnswer = '[data-testid="commit-answer"]';
const commitBtn = '[data-testid="commit-btn"]';
const sentenceInput = '[data-testid="sentence-input"]';
const sentenceSave = '[data-testid="sentence-save"]';
const lexiconEntry = '[data-testid="lexicon-entry"]';
const lexiconCurrent = '[data-testid="lexicon-current"]';
const lessonEmpty = '[data-testid="lesson-empty"]';
const tutorRail = '[data-testid="lesson-tutor-rail"]';

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** Mirrors src/core/lessons/types.ts. Declared, not imported, and deliberately NOT `as const`:
 *  `as const` makes the arrays readonly, which the Lesson interface rejects. */
interface LessonFixture {
  id: string;
  phase: 0 | 1 | 2 | 3;
  title: string;
  mechanism: string;
  prerequisites: string[];
  examples: {
    id: string;
    hole: string[];
    board: string[];
    street: string;
    pot: number;
    heroStack: number;
    villainStacks: number[];
    bb: number;
    position: string;
    toCall: number;
    prompt: string;
    reasoning: string;
  }[];
  acceptanceKeywords: string[];
}

async function withApp(body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

/** Open the Learn tab and block until the screen has published its first render. */
async function openLearn(page: Page): Promise<void> {
  await page.locator(learnTab).click();
  await page.locator(lessonScreen).waitFor();
  await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'list');
}

/**
 * Replace the registry the screen reads, for the degenerate cases only. The real 17 lessons stay
 * in src/core/lessons — deleting one to test an empty list would break 28 validator unit tests.
 * Object.assign, not a typed property write: the global is declared as readonly Lesson[].
 */
async function stubRegistry(page: Page, lessons: LessonFixture[]): Promise<void> {
  await page.evaluate((fixture: LessonFixture[]) => {
    Object.assign(window, { __offsuitLessonsStub: fixture });
  }, lessons);
}

function fixture(overrides: Partial<LessonFixture> = {}): LessonFixture {
  return {
    id: 'stub-lesson',
    phase: 1,
    title: 'Stub lesson',
    mechanism: 'A stubbed mechanism sentence for the renderer to show.',
    prerequisites: [],
    examples: [
      {
        id: 'stub-example',
        hole: ['Ah', 'Kd'],
        board: [],
        street: 'preflop',
        pot: 150,
        heroStack: 2000,
        villainStacks: [1800],
        bb: 50,
        position: 'BTN',
        toCall: 0,
        prompt: 'Stub prompt: how would you play it?',
        reasoning: 'STUB-REASONING-SENTINEL that must never be in the DOM before a commit.',
      },
    ],
    acceptanceKeywords: ['equity realisation'],
    ...overrides,
  };
}

interface ScreenText {
  /** The whole rendered text of the screen, for "this string is nowhere on the page" assertions. */
  body: string;
  revealPresent: boolean;
  reasoningNodes: number;
}

async function readScreen(page: Page, needle: string): Promise<ScreenText> {
  return page.evaluate((sentinel: string) => {
    const root = document.querySelector('[data-testid="lesson-screen"]');
    return {
      body: root === null ? '' : (root.textContent ?? ''),
      revealPresent: document.querySelector('[data-testid="lesson-reveal"]') !== null,
      reasoningNodes: [...document.querySelectorAll('*')].filter(
        (el) => el.childElementCount === 0 && (el.textContent ?? '').includes(sentinel),
      ).length,
    };
  }, needle);
}

/** Type into a textarea and commit WITHOUT a Playwright click: events only, so no hit-testing. */
async function commitByDispatch(page: Page, answer: string): Promise<void> {
  await page.evaluate((value: string) => {
    const box = document.querySelector('[data-testid="commit-answer"]');
    if (!(box instanceof HTMLTextAreaElement)) throw new Error('commit-answer missing');
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.querySelector('[data-testid="commit-btn"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error('commit-btn missing');
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, answer);
}

async function saveSentence(page: Page, sentence: string): Promise<void> {
  await page.locator(sentenceInput).fill(sentence);
  await page.locator(sentenceSave).click();
}

/** Resize the real window AND pin the render viewport, exactly as layout.spec.ts documents. */
async function useViewport(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  const applied = await app.evaluate(async ({ BrowserWindow }, size: { width: number; height: number }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(size.width, size.height);
    return win.getSize();
  }, { width, height });
  expect(applied, `setSize(${width}, ${height}) was rejected`).toEqual([width, height]);

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
}

test.describe('lesson mode', () => {
  test('1. the list is grouped by spine phase and every lesson is enterable (N1)', async () => {
    await withApp(async ({ page }) => {
      await openLearn(page);

      const rows = page.locator(lessonRow);
      const count = await rows.count();
      // Whatever the registry holds — asserted against the screen's own published count, not 17.
      expect(count, 'the list must render every lesson in the registry').toBe(
        Number(await page.locator(lessonScreen).getAttribute('data-lesson-count')),
      );
      expect(count).toBeGreaterThan(0);

      // Phases appear in spine order, and each section only holds its own phase's lessons.
      const phases = await page.locator(phaseSection).evaluateAll((sections) =>
        sections.map((s) => (s instanceof HTMLElement ? Number(s.dataset.phase) : NaN)),
      );
      expect(phases).toEqual([...phases].sort((a, b) => a - b));
      expect(new Set(phases).size, 'phases must not repeat as sections').toBe(phases.length);

      // N1: nothing is locked. No row is disabled, greyed out by an attribute, or non-interactive.
      const disabled = await rows.evaluateAll((els) =>
        els.filter((el) => el instanceof HTMLButtonElement && el.disabled).length,
      );
      expect(disabled, 'no lesson row may be disabled — nothing is ever locked').toBe(0);

      // Prerequisites are ADVICE. A lesson that has them says so, and still opens.
      const advised = page.locator(`${lessonRow}:has([data-testid="lesson-advice"])`).first();
      expect(await advised.count(), 'expected at least one lesson with prerequisites').toBe(1);
      await expect(advised.locator('[data-testid="lesson-advice"]')).toContainText('not a gate');
      await advised.click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'lesson');
      await expect(page.locator('[data-testid="lesson-title"]')).not.toBeEmpty();
    });
  });

  test('2. a lesson renders its example position with the shared card component', async () => {
    await withApp(async ({ page }) => {
      await openLearn(page);
      await page.locator(`${lessonRow}[data-lesson-id="pot-odds-as-a-price"]`).click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', 'pot-odds-as-a-price');

      // Cards come from components/card.ts: same data-testid, same data-card contract.
      const spot = await page.evaluate(() => {
        const cardsIn = (selector: string): string[] =>
          [...document.querySelectorAll<HTMLElement>(`${selector} [data-testid="card"]`)].map(
            (el) => `${el.dataset.card ?? ''}:${el.className}`,
          );
        return {
          hole: cardsIn('[data-testid="lesson-hole"]'),
          board: cardsIn('[data-testid="lesson-board"]'),
          groups: [...document.querySelectorAll('.spot-group')].map(
            (el) => el.querySelector('.stat-label')?.textContent ?? '',
          ),
          prompt: document.querySelector('[data-testid="lesson-prompt"]')?.textContent ?? '',
          mechanism: document.querySelector('[data-testid="lesson-mechanism"]')?.textContent ?? '',
          meta: document.querySelector('[data-testid="example-meta"]')?.textContent ?? '',
        };
      });

      expect(spot.hole).toEqual(['9h:card red', '8h:card red']);
      expect(spot.board).toEqual(['Th:card red', '6d:card red', '2h:card red']);
      // Both groups must be named: unlabelled, two hole cards beside a three-card flop read as one
      // row of five and the learner cannot tell which two are theirs.
      expect(spot.groups).toEqual(['Your hand', 'Board']);
      expect(spot.prompt).toContain('What price is on offer');
      expect(spot.mechanism).toContain('Pot odds are a price');
      // The example is the thing being reasoned from, so its numbers must be on screen.
      expect(spot.meta).toContain('BB');
      expect(spot.meta).toContain('flop');

      // G5: the prompt asks how to play it and the app never names the spot type for the learner.
      expect(spot.prompt.toLowerCase()).not.toContain('bluff-catch');

      /**
       * The tutor rail's mount seam. This assertion used to require the seam be EMPTY, because the
       * rail was another agent's unbuilt surface; it is now built (components/tutorRail.ts), so the
       * same structural fact is asserted at its new value rather than dropped: the seam still exists
       * exactly once, and it holds exactly one child — the rail and nothing else. What this test is
       * for is that the lesson screen owns one mount point and does not scatter tutor UI through the
       * example, and that is what is checked.
       */
      await expect(page.locator(tutorRail)).toHaveCount(1);
      expect(await page.locator(tutorRail).evaluate((el) => el.childElementCount)).toBe(1);
      await expect(page.locator(`${tutorRail} > [data-testid="tutor-rail"]`)).toHaveCount(1);
      // Still no tutor UI anywhere but the seam.
      expect(await page.locator('[data-testid="tutor-rail"]').count()).toBe(1);
    });
  });

  test('3. the reveal is ABSENT from the DOM until the learner commits, then present', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openLearn(page);
      await stubRegistry(page, [fixture()]);
      // Re-enter the tab so the stub is the registry this render reads.
      await page.locator(playTab).click();
      await openLearn(page);
      await page.locator(lessonRow).first().click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'false');

      const sentinel = 'STUB-REASONING-SENTINEL';
      const before = await readScreen(page, sentinel);
      expect(before.revealPresent, 'the reveal node must not exist before a commit').toBe(false);
      expect(before.reasoningNodes, 'the reasoning text must not be in the DOM at all').toBe(0);
      expect(before.body).not.toContain(sentinel);
      expect(before.body).toContain('Stub prompt');
      await expect(page.locator(reveal)).toHaveCount(0);

      // An empty commit is not a commit: the control refuses and the reveal stays absent.
      await expect(page.locator(commitBtn)).toBeDisabled();
      await page.locator(commitAnswer).fill('   ');
      await expect(page.locator(commitBtn)).toBeDisabled();
      expect((await readScreen(page, sentinel)).revealPresent).toBe(false);

      // Dispatched events, not a click: a CSS-hidden reveal would already have failed above, and
      // this proves the gate is not merely "the button was unreachable".
      await commitByDispatch(page, 'I would call, the price is cheap enough.');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'true');

      const after = await readScreen(page, sentinel);
      expect(after.revealPresent).toBe(true);
      expect(after.body).toContain(sentinel);
      // 4: the stored reasoning is shown, and the learner's own words are quoted back unchanged.
      await expect(page.locator('[data-testid="lesson-reasoning"]')).toContainText(sentinel);
      await expect(page.locator('[data-testid="committed-answer"]')).toHaveText(
        'I would call, the price is cheap enough.',
      );
      // No re-grading and no invented verdict: nothing on the reveal says right or wrong.
      const revealText = (await page.locator(reveal).textContent()) ?? '';
      for (const word of ['correct', 'wrong', 'right', 'well done', 'good']) {
        expect(revealText.toLowerCase(), `the reveal must not grade: found "${word}"`).not.toContain(word);
      }

      // The commit control is gone once used — there is nothing left to re-commit.
      await expect(page.locator(commitBtn)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });

  test('4. an empty registry renders an empty state, and the tab is not hidden (N1)', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openLearn(page);
      await stubRegistry(page, []);
      await page.locator(playTab).click();
      await openLearn(page);

      await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-count', '0');
      await expect(page.locator(lessonEmpty)).toHaveCount(1);
      await expect(page.locator(lessonEmpty)).toContainText('Nothing is locked');
      await expect(page.locator(lessonRow)).toHaveCount(0);
      await expect(page.locator(learnTab)).toBeVisible();

      // Keyboard nav on an empty registry must be inert, not throw.
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'list');
      expect(errors).toEqual([]);

      // A one-lesson registry is the other degenerate shape: no example tabs, both nav pills dead.
      await stubRegistry(page, [fixture()]);
      await page.locator(playTab).click();
      await openLearn(page);
      await page.locator(lessonRow).first().click();
      await expect(page.locator('[data-testid="lesson-position"]')).toHaveText('1 / 1');
      await expect(page.locator('[data-testid="lesson-prev"]')).toBeDisabled();
      await expect(page.locator('[data-testid="lesson-next"]')).toBeDisabled();
      await expect(page.locator('[data-testid="example-tab"]')).toHaveCount(0);
      // A preflop example has no board: say so rather than render an empty row.
      await expect(page.locator('[data-testid="lesson-board"]')).toHaveText('No board yet');
      expect(errors).toEqual([]);
    });
  });

  test('5. accepted vs rejected sentences, both kept, most recent quoted (L2/L3)', async () => {
    await withApp(async ({ page }) => {
      await openLearn(page);
      await page.locator(`${lessonRow}[data-lesson-id="equity-realisation"]`).click();

      await expect(page.locator(lexiconCurrent)).toHaveAttribute('data-present', 'false');

      // A cached cell, not a mechanism: L2 rejects it — and keeps it, because it is diagnostic.
      await saveSentence(page, 'K7s is a CO open');
      await expect(page.locator('[data-testid="sentence-verdict"]')).toHaveAttribute('data-accepted', 'false');
      await expect(page.locator(lexiconEntry)).toHaveCount(1);
      await expect(page.locator(lexiconCurrent)).toHaveAttribute('data-present', 'false');

      // A mechanism framing from the lesson's own acceptanceKeywords.
      await saveSentence(page, 'Being out of position costs me equity realisation on later streets.');
      await expect(page.locator('[data-testid="sentence-verdict"]')).toHaveAttribute('data-accepted', 'true');
      await expect(page.locator(lexiconCurrent)).toHaveAttribute('data-present', 'true');
      await expect(page.locator(lexiconCurrent)).toContainText('equity realisation');

      // L3: additive. The rejected attempt is still visible, and the newest is quoted.
      await expect(page.locator(lexiconEntry)).toHaveCount(2);
      const history = await page.locator(lexiconEntry).evaluateAll((items) =>
        items.map((el) => ({
          text: el.querySelector('.lexicon-entry-text')?.textContent ?? '',
          accepted: el instanceof HTMLElement ? el.dataset.accepted : undefined,
        })),
      );
      expect(history[0].accepted).toBe('true');
      expect(history[1]).toEqual({ text: 'K7s is a CO open', accepted: 'false' });

      // A second accepted sentence supersedes the quote without deleting the first.
      await saveSentence(page, 'Position buys equity realisation because I see the price last.');
      await expect(page.locator(lexiconCurrent)).toContainText('I see the price last');
      await expect(page.locator(lexiconEntry)).toHaveCount(3);
      // Immutable: no control on the screen edits or removes an entry.
      expect(
        await page.locator(`${lexiconEntry} button`).count(),
        'history entries must not be editable',
      ).toBe(0);

      // Entries belong to their own lesson, not to the screen.
      await page.locator('[data-testid="lesson-back"]').click();
      await page.locator(`${lessonRow}[data-lesson-id="spr-sets-the-plan"]`).click();
      await expect(page.locator(lexiconEntry)).toHaveCount(0);
      await expect(page.locator(lexiconCurrent)).toHaveAttribute('data-present', 'false');
    });
  });

  test('6. a saved mechanism sentence survives a reload', async () => {
    await withApp(async ({ page }) => {
      await openLearn(page);
      await page.locator(`${lessonRow}[data-lesson-id="combos-not-hands"]`).click();
      // 'card removal' is one of this lesson's own acceptanceKeywords.
      await saveSentence(page, 'Counting combos is card removal made concrete.');
      await expect(page.locator(lexiconCurrent)).toContainText('card removal');

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await openLearn(page);
      await page.locator(`${lessonRow}[data-lesson-id="combos-not-hands"]`).click();

      await expect(page.locator(lexiconCurrent)).toHaveAttribute('data-present', 'true');
      await expect(page.locator(lexiconCurrent)).toContainText('card removal made concrete');
      await expect(page.locator(lexiconEntry)).toHaveCount(1);
    });
  });

  test('7. keyboard navigation moves between lessons and examples', async () => {
    await withApp(async ({ page }) => {
      await openLearn(page);

      // In the list: the cursor moves and Enter opens whatever it is on.
      await page.keyboard.press('ArrowDown');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-cursor', '1');
      await page.keyboard.press('ArrowUp');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-cursor', '0');
      await page.keyboard.press('Enter');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'lesson');

      const first = await page.locator(lessonScreen).getAttribute('data-lesson-id');
      await page.keyboard.press('ArrowRight');
      const second = await page.locator(lessonScreen).getAttribute('data-lesson-id');
      expect(second).not.toBe(first);
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', String(first));

      // Within a lesson, vertical keys walk its example positions.
      const example = await page.locator(lessonScreen).getAttribute('data-example-id');
      await page.keyboard.press('ArrowDown');
      expect(await page.locator(lessonScreen).getAttribute('data-example-id')).not.toBe(example);
      await page.keyboard.press('ArrowUp');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-example-id', String(example));

      // Typing an answer must not navigate: the learner's keystrokes belong to the textarea.
      await page.locator(commitAnswer).click();
      await page.keyboard.type('jk');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', String(first));
      await expect(page.locator(commitAnswer)).toHaveValue('jk');

      await page.keyboard.press('Escape');
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'list');

      // The screen's keydown handler must not survive the tab switch and eat the table's keys.
      await page.locator(playTab).click();
      await expect(page.locator(lessonScreen)).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-testid="home-screen"]')).toBeVisible();
    });
  });

  test('8. every lesson in the real registry renders, with its cards and prompt, without throwing', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openLearn(page);
      const ids = await page.locator(lessonRow).evaluateAll((rows) =>
        rows.map((row) => (row instanceof HTMLElement ? (row.dataset.lessonId ?? '') : '')),
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size, 'lesson ids must be unique in the list').toBe(ids.length);

      for (const id of ids) {
        await page.locator(`${lessonRow}[data-lesson-id="${id}"]`).click();
        await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', id);

        // Walk every example of this lesson, not only the first.
        const examples = await page.locator('[data-testid="example-tab"]').count();
        for (let i = 0; i < Math.max(1, examples); i++) {
          if (examples > 0) await page.locator('[data-testid="example-tab"]').nth(i).click();
          const drawn = await page.evaluate(() => ({
            hole: document.querySelectorAll('[data-testid="lesson-hole"] [data-testid="card"]').length,
            board: document.querySelectorAll('[data-testid="lesson-board"] [data-testid="card"]').length,
            street:
              document.querySelector('[data-testid="example-meta"]')?.textContent?.match(
                /preflop|flop|turn|river/,
              )?.[0] ?? '',
            prompt: (document.querySelector('[data-testid="lesson-prompt"]')?.textContent ?? '').length,
            title: (document.querySelector('[data-testid="lesson-title"]')?.textContent ?? '').length,
            reveal: document.querySelectorAll('[data-testid="lesson-reveal"]').length,
          }));
          const where = `${id} example ${i + 1}`;
          expect(drawn.hole, `${where}: two hole cards`).toBe(2);
          expect(drawn.title, `${where}: a title`).toBeGreaterThan(0);
          expect(drawn.prompt, `${where}: a prompt`).toBeGreaterThan(0);
          expect(drawn.reveal, `${where}: reveal must stay absent pre-commit`).toBe(0);
          const expected = { preflop: 0, flop: 3, turn: 4, river: 5 }[drawn.street];
          expect(drawn.board, `${where}: board must match street ${drawn.street}`).toBe(expected);
        }

        await page.locator('[data-testid="lesson-back"]').click();
        await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'list');
      }

      expect(errors, 'no lesson may throw while rendering').toEqual([]);
    });
  });

  test('9. the screen fits both documented window sizes, then screenshots', async () => {
    await withApp(async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
        await useViewport(app, page, width, height);
        await openLearn(page);
        await page.locator(`${lessonRow}[data-lesson-id="pot-odds-as-a-price"]`).click();
        await expect(page.locator(lessonScreen)).toHaveAttribute('data-view', 'lesson');

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() drops the device-metrics override and
        // the viewport snaps back to whatever the host window manager wants.
        const geometry = await page.evaluate(() => {
          const rect = (id: string): { top: number; bottom: number; left: number; right: number } | null => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollHeight: document.documentElement.scrollHeight,
            tabBar: rect('tab-learn'),
            title: rect('lesson-title'),
            prompt: rect('lesson-prompt'),
            columnScrolls: (() => {
              const column = document.querySelector('[data-testid="lesson-screen"]');
              return column instanceof HTMLElement
                ? column.scrollHeight > column.clientHeight
                : false;
            })(),
          };
        });

        expect(geometry.innerWidth).toBe(width);
        expect(geometry.innerHeight).toBe(height);
        // The column scrolls itself, so the document never does and the tab bar stays reachable.
        expect(
          geometry.docScrollHeight,
          `document is ${geometry.docScrollHeight}px in a ${height}px viewport`,
        ).toBeLessThanOrEqual(height + 1);
        for (const [name, box] of Object.entries({
          tabBar: geometry.tabBar,
          title: geometry.title,
          prompt: geometry.prompt,
        })) {
          expect(box, `${name} missing at ${width}x${height}`).not.toBeNull();
          if (box === null) continue;
          expect(box.top, `${name} above the viewport`).toBeGreaterThanOrEqual(0);
          expect(box.left, `${name} left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(box.bottom, `${name} below the fold at ${width}x${height}`).toBeLessThanOrEqual(height);
          expect(box.right, `${name} past the right edge`).toBeLessThanOrEqual(width);
        }

        await shot(page, `lesson-${width}x${height}`);
      }
    });
  });

  /**
   * The list and the post-commit reveal, at both documented sizes. Screenshots only, and every
   * useViewport is re-applied after a shot: page.screenshot() drops the device-metrics override,
   * so a size applied before a shot describes nothing after it.
   */
  test('10. screenshots of the list and of a committed reveal', async () => {
    await withApp(async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
        await useViewport(app, page, width, height);
        await openLearn(page);
        await shot(page, `lesson-list-${width}x${height}`);

        await useViewport(app, page, width, height);
        await page.locator(`${lessonRow}[data-lesson-id="minimum-defence-frequency"]`).click();
        await commitByDispatch(page, 'I fold: I am below the defence frequency with this hand.');
        await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'true');
        await page.locator(sentenceInput).fill('The bet size sets how often I must defend.');
        await page.locator(sentenceSave).click();
        await shot(page, `lesson-reveal-${width}x${height}`);

        await useViewport(app, page, width, height);
        await page.locator('[data-testid="lesson-back"]').click();
      }
    });
  });
});
