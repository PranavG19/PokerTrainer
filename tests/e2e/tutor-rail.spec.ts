import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { assertNoNetwork, launchApp, shot } from './helpers.js';


/**
 * THE TUTOR RAIL, run with NO CREDENTIALS — which is the only configuration a test may run in.
 * `launchApp` passes `process.env` through untouched, so resolveTutor() sees no
 * OFFSUIT_BEDROCK_* vars and returns the null tutor. Every assertion below is therefore offline
 * and deterministic, and no test in this file makes a live Bedrock call.
 *
 * The load-bearing test is #4. The mute matrix lives in MAIN (src/main/tutor/muteMatrix.ts) and the
 * rail must go through it rather than around it, so the test does not merely check that a refusal
 * message appeared: it asserts that the answer text contains none of the solver numerals from a
 * grade the rail never sends, AND that a strategy question is refused while a mechanics question
 * typed into the same box is answered. A rail that had smuggled a local answer table in would pass
 * the first assertion and fail the second.
 *
 * Sync rule: never sleep. The rail root publishes data-state / data-pending / data-tutor and each
 * answer publishes its own data-state, and those attributes are the only sync points used here.
 */

const learnTab = '[data-testid="tab-learn"]';
const lessonScreen = '[data-testid="lesson-screen"]';
const lessonRow = '[data-testid="lesson-row"]';
const seam = '[data-testid="lesson-tutor-rail"]';
const rail = '[data-testid="tutor-rail"]';
const provenance = '[data-testid="tutor-provenance"]';
const input = '[data-testid="tutor-input"]';
const sendBtn = '[data-testid="tutor-send"]';
const answer = '[data-testid="tutor-answer"]';
const turn = '[data-testid="tutor-turn"]';
const source = '[data-testid="tutor-source"]';

/**
 * The shipped contextBridge, as the tests that wrap it see it. Declared rather than imported: it is
 * an IPC contract, and it is only ever read inside page.evaluate where types are erased anyway.
 */
interface RealBridge {
  tutorStatus(): Promise<unknown>;
  askTutor(input: unknown): Promise<unknown>;
}

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/**
 * The solver digits from tests/e2e/tutor.spec.ts's GRADE fixture. Nothing the rail renders may
 * contain one: lesson mode has no grader, so the rail sends no grade and every payload it builds is
 * a RulesRequest, which has no field that could carry any of these.
 */
const SOLVER_DIGITS = ['1.73', '3.41', '5.14', '2.87'];

async function withApp(
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42 });
  try {
    await body({ app, page });
  } finally {
    await close().catch(() => {});
  }
}

/** Open Learn and enter a lesson, so the rail has an example position to describe. */
async function openLesson(page: Page, id = 'pot-odds-as-a-price'): Promise<void> {
  await page.locator(learnTab).click();
  await page.locator(lessonScreen).waitFor();
  await page.locator(`${lessonRow}[data-lesson-id="${id}"]`).click();
  await expect(page.locator(lessonScreen)).toHaveAttribute('data-lesson-id', id);
}

/** Ask, then block until the rail reports nothing in flight. No sleep, no fixed wait. */
async function askAndSettle(page: Page, question: string): Promise<void> {
  await page.locator(input).fill(question);
  await page.locator(sendBtn).click();
  await expect(page.locator(rail)).toHaveAttribute('data-pending', '0');
}

/** Resize the real window AND pin the render viewport, exactly as lesson.spec.ts documents. */
async function useViewport(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const applied = await app.evaluate(
    async ({ BrowserWindow }, size: { width: number; height: number }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setSize(size.width, size.height);
      return win.getSize();
    },
    { width, height },
  );
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

test.describe('the tutor rail', () => {
  test('1. it mounts in the lesson seam and is honest about the null tutor before anything is asked', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openLesson(page);

      // Mounted in the existing seam rather than anywhere else on the screen.
      await expect(page.locator(`${seam} ${rail}`)).toHaveCount(1);

      // Provenance resolves from tutor:status. 'null', never optimistically 'live'.
      await expect(page.locator(rail)).toHaveAttribute('data-tutor', 'null');
      const said = (await page.locator(provenance).textContent()) ?? '';
      expect(said, 'the rail must say plainly that no model is configured').toContain(
        'No model is configured',
      );
      // It must not look live when it is not.
      expect(said.toLowerCase()).not.toContain('connected');
      expect(said.toLowerCase()).not.toContain('bedrock');

      // Nothing is disabled or greyed out as a gate: the box is live from the first paint, and the
      // Ask control is merely empty-input-inert, which the next keystroke undoes.
      await expect(page.locator(input)).toBeEnabled();
      await expect(page.locator(sendBtn)).toBeDisabled();
      await page.locator(input).fill('x');
      await expect(page.locator(sendBtn)).toBeEnabled();

      expect(errors).toEqual([]);
    });
  });

  test('2. zero network attempts across a whole conversation, allowed and refused alike', async () => {
    await withApp(async ({ page }) => {
      const attempted = await assertNoNetwork(page);
      const failedHttp: string[] = [];
      page.on('requestfailed', (request) => {
        if (/^https?:/.test(request.url())) failedHttp.push(request.url());
      });

      // Reload through the interceptor so an empty list proves silence rather than a dead route.
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await openLesson(page);

      for (const question of [
        'what does check mean',
        'who acts first on the flop',
        'should I call here',
        'what is my equity',
        'which hand beats a flush',
      ]) {
        await askAndSettle(page, question);
      }

      await expect(page.locator(answer)).toHaveCount(5);
      expect(attempted, 'the rail attempted a network request').toEqual([]);
      expect(failedHttp).toEqual([]);
    });
  });

  test('3. the null tutor answers from the fixed table and every answer says where it came from', async () => {
    await withApp(async ({ page }) => {
      await openLesson(page);
      await askAndSettle(page, 'which hand beats a flush');

      const first = page.locator(answer).first();
      await expect(first).toHaveAttribute('data-state', 'answered');
      const text = (await first.locator('[data-testid="tutor-turn-body"]').textContent()) ?? '';
      // The fixed rules answer from src/main/tutor/nullTutor.ts — useful, not merely non-empty.
      expect(text).toContain('rules card');
      expect(text.length).toBeGreaterThan(20);

      // Provenance is repeated on the answer itself, not only in the heading.
      await expect(first.locator(source)).toContainText('written notes');
      await expect(first.locator(source)).toContainText('no model is configured');

      // The learner's own question is in the transcript, so it reads as a conversation.
      const learner = page.locator(`${turn}[data-role="learner"]`);
      await expect(learner).toHaveCount(1);
      await expect(learner).toHaveText('which hand beats a flush');

      // A second question appends rather than replacing: back-and-forth, not a single answer slot.
      await askAndSettle(page, 'what does check mean');
      await expect(page.locator(answer)).toHaveCount(2);
      await expect(page.locator(`${turn}[data-role="learner"]`)).toHaveCount(2);
    });
  });

  test('4. a pre-commit strategy question is refused and cannot surface a solver numeral', async () => {
    await withApp(async ({ page }) => {
      await openLesson(page);
      // Pre-commit is the strict row: strategy blocked, rules allowed.
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'false');

      for (const question of [
        'should I call here',
        'what is my equity',
        'is raising the best play',
        'how wide is their range',
      ]) {
        await askAndSettle(page, question);
        const latest = page.locator(answer).last();
        await expect(latest, `"${question}" must be held back pre-commit`).toHaveAttribute(
          'data-state',
          'blocked',
        );
        const body =
          (await latest.locator('[data-testid="tutor-turn-body"]').textContent()) ?? '';
        expect(body).toContain('Held back');
        // Not a crash, and no raw internals: no stack, no check name, no violation list.
        for (const leak of ['Error', 'TypeError', 'undefined', 'muteMatrix', 'verdict']) {
          expect(body, `refusal dumped internals: ${leak}`).not.toContain(leak);
        }
      }

      // THE CORE ASSERTION. No solver numeral anywhere in the rail — not in a refusal, and not in
      // the mechanics answer either. The rail sends no grade, so nothing downstream has these.
      await askAndSettle(page, 'what is the minimum raise');
      const railText = (await page.locator(rail).textContent()) ?? '';
      for (const digits of SOLVER_DIGITS) {
        expect(railText, `the rail surfaced solver output: ${digits}`).not.toContain(digits);
      }

      // And the matrix is not being used as a blanket refusal: the mechanics question WAS answered
      // from the same box in the same context. A local answer table would fail this pairing.
      await expect(page.locator(answer).last()).toHaveAttribute('data-state', 'answered');
    });
  });

  test('5. the payload the rail actually sends carries no grade and no solver field', async () => {
    await withApp(async ({ page }) => {
      await openLesson(page);

      /**
       * Record what the rail hands the transport, then delegate to the real window.offsuit so the
       * answer still comes from main. This inspects the rail's own outgoing payload — the thing no
       * assertion on rendered text can see.
       */
      await page.evaluate(() => {
        const real = (window as unknown as { offsuit: RealBridge }).offsuit;
        const sent: unknown[] = [];
        Object.assign(window, {
          __offsuitSent: sent,
          __offsuitTutorTransport: {
            tutorStatus: () => real.tutorStatus(),
            askTutor: (payload: unknown) => {
              sent.push(payload);
              return real.askTutor(payload);
            },
          },
        });
      });
      // Re-enter the lesson so the rail is built against the recording transport.
      await page.locator('[data-testid="tab-play"]').click();
      await openLesson(page);
      await askAndSettle(page, 'what does check mean');

      const sent = await page.evaluate(
        () => (window as unknown as { __offsuitSent: unknown[] }).__offsuitSent,
      );
      expect(sent).toHaveLength(1);
      const payload = sent[0] as Record<string, unknown>;

      // No grade is sent at all — which is what makes the request a RulesRequest in main.
      expect(Object.keys(payload).sort()).toEqual(['context', 'question', 'table']);
      expect(payload.grade, 'the rail must never send a grade').toBeUndefined();
      expect(payload.context).toBe('spot-pre-commit');

      // The visible table only. Every key here is already drawn on the lesson screen.
      const table = payload.table as Record<string, unknown>;
      expect(Object.keys(table).sort()).toEqual([
        'board',
        'heroCards',
        'positions',
        'potBb',
        'stacksBb',
        'street',
        'toAct',
      ]);
      const serialised = JSON.stringify(payload);
      for (const forbidden of [
        'deltaEvBb',
        'actionEvsBb',
        'bestAction',
        'equityPct',
        'tier',
        'errorTag',
      ]) {
        expect(serialised, `payload carried ${forbidden}`).not.toContain(forbidden);
      }
    });
  });

  test('6. pending state renders while a call is in flight, and the UI never freezes', async () => {
    await withApp(async ({ page }) => {
      await openLesson(page);

      /**
       * Hold each answer open so the pending state is observable, and release them INDIVIDUALLY —
       * one resolver per in-flight call, addressed by the order it was sent. The delay is applied to
       * the TRANSPORT, not to the rail: the rail's own pending handling is what is under test, and
       * the real IPC still produces the answer once released.
       */
      await page.evaluate(() => {
        const real = (window as unknown as { offsuit: RealBridge }).offsuit;
        const gates: (() => void)[] = [];
        Object.assign(window, {
          __offsuitRelease: (index: number) => gates[index](),
          __offsuitTutorTransport: {
            tutorStatus: () => real.tutorStatus(),
            askTutor: async (payload: unknown) => {
              await new Promise<void>((resolve) => {
                gates.push(resolve);
              });
              return real.askTutor(payload);
            },
          },
        });
      });
      await page.locator('[data-testid="tab-play"]').click();
      await openLesson(page);

      await page.locator(input).fill('what does check mean');
      await page.locator(sendBtn).click();

      // Pending is published on the root AND on the turn, in words the learner can read.
      await expect(page.locator(rail)).toHaveAttribute('data-state', 'pending');
      await expect(page.locator(rail)).toHaveAttribute('data-pending', '1');
      const inFlight = page.locator(answer).first();
      await expect(inFlight).toHaveAttribute('data-state', 'pending');
      await expect(inFlight.locator('[data-testid="tutor-turn-body"]')).toContainText('Working');

      // NOT FROZEN: the composer still accepts a second question while the first is in flight.
      await expect(page.locator(input)).toBeEnabled();
      await page.locator(input).fill('who acts first on the flop');
      await expect(page.locator(sendBtn)).toBeEnabled();
      await page.locator(sendBtn).click();
      await expect(page.locator(rail)).toHaveAttribute('data-pending', '2');
      await expect(page.locator(answer)).toHaveCount(2);

      /**
       * Release the SECOND question first. Out of order on purpose: it is the only way to prove an
       * answer lands in the turn that asked for it rather than in whichever turn is newest — with
       * in-order releases, "append to the end" and "write into my own turn" are indistinguishable.
       */
      const release = (index: number): Promise<void> =>
        page.evaluate(
          (at: number) =>
            (window as unknown as { __offsuitRelease(i: number): void }).__offsuitRelease(at),
          index,
        );

      await release(1);
      await expect(page.locator(rail)).toHaveAttribute('data-pending', '1');
      // The second question is answered while the FIRST is still visibly pending.
      await expect(page.locator(answer).last()).toHaveAttribute('data-state', 'answered');
      await expect(page.locator(answer).first()).toHaveAttribute('data-state', 'pending');
      await expect(page.locator(answer).last().locator('[data-testid="tutor-turn-body"]')).toContainText(
        'rules card',
      );

      await release(0);
      await expect(page.locator(rail)).toHaveAttribute('data-pending', '0');
      await expect(page.locator(rail)).toHaveAttribute('data-state', 'answered');
      await expect(page.locator(answer).first()).toHaveAttribute('data-state', 'answered');
    });
  });

  test('7. an unreachable tutor and a timeout both render visibly, and neither is a crash', async () => {
    await withApp(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await openLesson(page);

      /**
       * UNREACHABLE, produced by the real main process. Sending a malformed context makes
       * ipcMain's tutor:ask handler throw, so the rejection the rail handles is a genuine IPC
       * rejection over the shipped channel rather than a fabricated one.
       */
      await page.evaluate(() => {
        const real = (window as unknown as { offsuit: RealBridge }).offsuit;
        Object.assign(window, {
          __offsuitTutorTransport: {
            tutorStatus: () => real.tutorStatus(),
            askTutor: () => real.askTutor({ context: 'NOT-A-CONTEXT', question: 'x', table: {} }),
          },
        });
      });
      await page.locator('[data-testid="tab-play"]').click();
      await openLesson(page);
      await askAndSettle(page, 'what does check mean');

      const failed = page.locator(answer).first();
      await expect(failed).toHaveAttribute('data-state', 'failed');
      const failedText = (await failed.locator('[data-testid="tutor-turn-body"]').textContent()) ?? '';
      expect(failedText).toContain('could not be reached');
      // Visible and plain: no stack trace, no remote-method noise, no raw internals.
      for (const leak of ['TypeError', 'Error invoking', 'ipc', 'undefined', 'toLowerCase']) {
        expect(failedText, `the failure dumped internals: ${leak}`).not.toContain(leak);
      }
      // Not a crash: the composer still works and the lesson is untouched.
      await expect(page.locator(input)).toBeEnabled();
      await expect(page.locator('[data-testid="lesson-title"]')).not.toBeEmpty();
      expect(errors, 'a transport failure must not throw into the page').toEqual([]);

      /**
       * TIMEOUT. The bound is overridden rather than waited out — never sleep in a test — and the
       * transport never settles, which is exactly the shape of an unreachable endpoint that does
       * not reject.
       */
      await page.evaluate(() => {
        const real = (window as unknown as { offsuit: RealBridge }).offsuit;
        Object.assign(window, {
          __offsuitTutorTimeoutMs: 60,
          __offsuitTutorTransport: {
            tutorStatus: () => real.tutorStatus(),
            askTutor: () => new Promise(() => {}),
          },
        });
      });
      await page.locator('[data-testid="tab-play"]').click();
      await openLesson(page);
      await askAndSettle(page, 'what does check mean');

      const timedOut = page.locator(answer).first();
      await expect(timedOut).toHaveAttribute('data-state', 'timeout');
      await expect(timedOut.locator('[data-testid="tutor-turn-body"]')).toContainText('in time');
      await expect(page.locator(input)).toBeEnabled();
      expect(errors).toEqual([]);
    });
  });

  test('8. it fits both documented window sizes, then screenshots', async () => {
    await withApp(async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
        await useViewport(app, page, width, height);
        await openLesson(page);
        await askAndSettle(page, 'which hand beats a flush');
        await askAndSettle(page, 'should I call here');

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() drops the device-metrics override and
        // the viewport snaps back to whatever the host window manager wants.
        const geometry = await page.evaluate(() => {
          const box = (
            selector: string,
          ): { top: number; bottom: number; left: number; right: number; width: number } | null => {
            const el = document.querySelector(selector);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width };
          };
          const column = document.querySelector('[data-testid="lesson-screen"]');
          const transcript = document.querySelector('[data-testid="tutor-transcript"]');
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollHeight: document.documentElement.scrollHeight,
            railBox: box('[data-testid="tutor-rail"]'),
            inputBox: box('[data-testid="tutor-input"]'),
            sendBox: box('[data-testid="tutor-send"]'),
            columnWidth: column instanceof HTMLElement ? column.clientWidth : 0,
            railScrollWidth:
              document.querySelector('[data-testid="tutor-rail"]')?.scrollWidth ?? 0,
            /**
             * The newest answer's LAST line, measured against the transcript's own visible box.
             * Unbounded, the transcript ran under the composer and the final reply was clipped
             * mid-sentence with its source line entirely hidden — visible only in a screenshot, and
             * invisible to any assertion about the composer's position. This is that oracle.
             */
            lastSource: (() => {
              const sources = document.querySelectorAll('[data-testid="tutor-source"]');
              const last = sources[sources.length - 1];
              if (!(last instanceof HTMLElement) || !(transcript instanceof HTMLElement)) {
                return null;
              }
              const r = last.getBoundingClientRect();
              const view = transcript.getBoundingClientRect();
              return {
                bottom: r.bottom,
                height: r.height,
                viewBottom: view.bottom,
                text: (last.textContent ?? '').length,
              };
            })(),
          };
        });

        expect(geometry.innerWidth).toBe(width);
        expect(geometry.innerHeight).toBe(height);
        // The lesson column scrolls itself, so the document never does (lesson.spec.ts test 9).
        expect(
          geometry.docScrollHeight,
          `document is ${geometry.docScrollHeight}px in a ${height}px viewport`,
        ).toBeLessThanOrEqual(height + 1);

        /**
         * THE COMPOSER MUST STILL BE ON SCREEN AFTER TWO ANSWERS.
         *
         * This is the assertion the first screenshot review earned. With an unbounded transcript the
         * rail grew with every reply and pushed the input and the Ask button off the bottom of the
         * window — at both documented sizes — leaving the learner looking at a conversation they
         * could no longer add to, with the last source line clipped mid-sentence.
         */
        for (const [name, rect] of Object.entries({
          rail: geometry.railBox,
          input: geometry.inputBox,
          send: geometry.sendBox,
        })) {
          expect(rect, `${name} missing at ${width}x${height}`).not.toBeNull();
          if (rect === null) continue;
          expect(rect.left, `${name} left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(rect.right, `${name} past the right edge`).toBeLessThanOrEqual(width);
        }

        /**
         * The two CONTROLS must be fully inside the viewport, vertically as well.
         *
         * Asserted on the input and the button rather than on the rail root: the rail is a section
         * inside a column that scrolls itself, so its own box may legitimately extend past the fold
         * (it did, at 853px in a 760px window, with the composer still perfectly usable). What may
         * never happen is the thing that actually happened before this — the box that takes the next
         * question ending up under the bottom edge once a reply rendered.
         */
        for (const [name, rect] of Object.entries({
          input: geometry.inputBox,
          send: geometry.sendBox,
        })) {
          if (rect === null) continue;
          expect(
            rect.bottom,
            `${name} is below the fold at ${width}x${height} (bottom ${rect.bottom.toFixed(1)})`,
          ).toBeLessThanOrEqual(height);
          expect(
            rect.top,
            `${name} is above the viewport at ${width}x${height} (top ${rect.top.toFixed(1)})`,
          ).toBeGreaterThanOrEqual(0);
        }
        /**
         * NOTHING CLIPPED VERTICALLY EITHER. The newest reply must be readable to its last line —
         * the transcript has to swallow its own overflow instead of running under the composer.
         */
        expect(geometry.lastSource, `no answer source line at ${width}x${height}`).not.toBeNull();
        if (geometry.lastSource !== null) {
          const { bottom, viewBottom, height: lineHeight, text } = geometry.lastSource;
          expect(text, 'the source line must actually say something').toBeGreaterThan(0);
          expect(lineHeight, 'the source line must be laid out').toBeGreaterThan(0);
          expect(
            bottom,
            `the newest answer is clipped at ${width}x${height}: its last line ends at ${bottom.toFixed(1)} but the transcript is only visible to ${viewBottom.toFixed(1)}`,
          ).toBeLessThanOrEqual(viewBottom + 1);
        }

        // Nothing clipped horizontally: the rail fits the column it is mounted in.
        if (geometry.railBox !== null) {
          expect(
            geometry.railBox.width,
            `the rail is ${geometry.railBox.width}px in a ${geometry.columnWidth}px column`,
          ).toBeLessThanOrEqual(geometry.columnWidth + 1);
          expect(
            geometry.railScrollWidth,
            `the rail's content overflows it: ${geometry.railScrollWidth} > ${geometry.railBox.width}`,
          ).toBeLessThanOrEqual(Math.ceil(geometry.railBox.width) + 1);
        }

        await shot(page, `tutor-rail-${width}x${height}`);
      }
    });
  });

  /**
   * 9. THE CONTEXT MUST TRACK THE COMMIT, NOT BE A CONSTANT.
   *
   * railContext() returns 'spot-pre-commit' before commit and 'spot-post-reveal' after, and that
   * choice is what selects the T5 row. Nothing asserted the post-commit half, so a rail hard-wired
   * to 'spot-pre-commit' passed the whole suite while silently refusing every strategy question the
   * learner has earned by committing. The oracle is the OUTGOING context plus the verdict flip:
   * the identical question must be blocked before commit and allowed after it.
   */
  test('9. committing flips the context it sends, and the same question stops being refused', async () => {
    await withApp(async ({ page }) => {
      await openLesson(page);

      await page.evaluate(() => {
        const real = (window as unknown as { offsuit: RealBridge }).offsuit;
        const sent: unknown[] = [];
        Object.assign(window, {
          __offsuitSent: sent,
          __offsuitTutorTransport: {
            tutorStatus: () => real.tutorStatus(),
            askTutor: (payload: unknown) => {
              sent.push(payload);
              return real.askTutor(payload);
            },
          },
        });
      });
      await page.locator('[data-testid="tab-play"]').click();
      await openLesson(page);

      const question = 'should I call here';

      // BEFORE COMMIT: pre-commit row, strategy refused.
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'false');
      await askAndSettle(page, question);
      await expect(page.locator(answer).last()).toHaveAttribute('data-state', 'blocked');

      // Commit the position. This is the learner earning the answer.
      await page.locator('[data-testid="commit-answer"]').fill('I call, the price is good');
      await page.locator('[data-testid="commit-btn"]').click();
      await expect(page.locator(lessonScreen)).toHaveAttribute('data-committed', 'true');

      // AFTER COMMIT: post-reveal row, the same words are answered.
      await askAndSettle(page, question);
      await expect(page.locator(answer).last()).toHaveAttribute('data-state', 'answered');

      const contexts = await page.evaluate(() =>
        (window as unknown as { __offsuitSent: Record<string, unknown>[] }).__offsuitSent.map(
          (payload) => payload.context,
        ),
      );
      expect(
        contexts,
        'the context must be read at send time, so committing changes the row it is judged in',
      ).toEqual(['spot-pre-commit', 'spot-post-reveal']);
    });
  });

  /**
   * 10. A CONFIGURED-BUT-UNREACHABLE MODEL MUST NOT BE CREDITED WITH THE WRITTEN NOTES.
   *
   * liveTutor falls back to the fixed string table SILENTLY when the model fails, times out or is
   * guard-rejected. Provenance inferred from `tutorId` therefore lied: with credentials set, the
   * notes answered and the rail said "From the configured model." This launches with a nonexistent
   * AWS profile — credentialsConfigured is true and the model is unreachable, which is the exact
   * shape of that bug — and pins the answer to what actually produced it.
   *
   * Offline by construction: the profile does not exist, so the `aws` CLI cannot authenticate or
   * send anything. No live call is made here.
   */
  test('10. with credentials set but the model unreachable, the answer is credited to the notes', async () => {
    const { app, page, close } = await launchApp({
      seed: 42,
      env: {
        OFFSUIT_BEDROCK_PROFILE: 'offsuit-e2e-nonexistent-profile',
        OFFSUIT_BEDROCK_REGION: 'us-east-1',
        OFFSUIT_BEDROCK_MODEL: 'offsuit-e2e.nonexistent.model',
      },
    });
    try {
      void app;
      await openLesson(page);

      // The heading reports the configuration truthfully: a model IS configured.
      await expect(page.locator(rail)).toHaveAttribute('data-tutor', 'live');

      await askAndSettle(page, 'which hand beats a flush');
      const latest = page.locator(answer).last();
      await expect(latest).toHaveAttribute('data-state', 'answered');

      // The body is the fixed note, so the source line must not credit the model.
      await expect(latest.locator('[data-testid="tutor-turn-body"]')).toContainText('rules card');
      const said = (await latest.locator(source).textContent()) ?? '';
      expect(said, 'the notes answered, so the rail must say so').toContain('written notes');
      expect(said, 'the rail credited a model that never answered').not.toBe(
        'From the configured model.',
      );

      // Plain wording, no internals: no stack, no CLI noise, no check names.
      for (const leak of ['Error', 'aws', 'profile', 'undefined', 'guard']) {
        expect(said, `the source line dumped internals: ${leak}`).not.toContain(leak);
      }
    } finally {
      await close().catch(() => {});
    }
  });
});
