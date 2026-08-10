import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * Optional spoken narration of coach verdicts.
 *
 * Nothing here asserts audible sound — that is not testable and not the risk. The risks are:
 *
 *   1. An off switch that still fires. This is THE load-bearing test: with narration off, no speak
 *      IPC may cross the bridge at all. "Main declines to act on it" is not off.
 *   2. Text reaching a shell. The verdict is user-influenced text (the coach composes it from live
 *      pot sizes), and it is handed to a system binary. It goes as an ARGUMENT or the design is
 *      wrong. Asserted by recording the real argv the app spawns and looking for side effects.
 *   3. Speech becoming load-bearing. A broken, missing or failing voice must leave the hand and the
 *      on-screen verdict untouched.
 *   4. Two voices talking over each other.
 *
 * `say` is replaced with a RECORDER for every test, so the suite is silent and fast while the code
 * under test is the shipped path: renderer preference gate -> preload channel -> ipcMain ->
 * child_process.spawn. The recorder is a node script, never a shell script, so the recording itself
 * cannot be the thing that interprets a metacharacter.
 */

const homeScreen = '[data-testid="home-screen"]';
const settingsScreen = '[data-testid="settings-screen"]';
const tabSettings = '[data-testid="tab-settings"]';
const speakToggle = '[data-testid="speak-verdicts-toggle"]';
const coachPanel = '.coach';
const nextHand = '[data-testid="next-hand"]';

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

interface SpeakResult {
  spoken: boolean;
  reason: string | null;
}

/** One `say` process the app spawned, as the fake itself recorded it. */
interface Utterance {
  argv: string[];
  pid: number;
}

/** A stand-in for /usr/bin/say: how it behaves, and what it recorded about itself. */
interface FakeSay {
  binary: string;
  /** Every invocation's argv and pid, in spawn order. `[]` when it was never spawned. */
  invocations: () => Utterance[];
  /** Just the argv arrays, for the argument-not-shell assertions. */
  argvs: () => string[][];
  /**
   * Whether each spawned process is STILL RUNNING, by pid, checked from outside the app.
   *
   * This is the anti-overlap oracle, and it deliberately does not consult anything the app said: an
   * IPC result of 'cancelled' is the app's own bookkeeping, and a `speak` that forgot to cancel
   * still returns it. Only "is that process alive" can tell a real kill from a claimed one.
   */
  alive: () => boolean[];
  /** A path the fake never creates. Its existence would prove a shell ran the verdict text. */
  sideEffect: string;
}

/**
 * Write a fake `say` and return a handle on what it recorded.
 *
 * `mode` picks the behaviour being simulated:
 *   'record'  — exits 0 immediately, like a voice that finished speaking.
 *   'fail'    — exits 3, like a voice that is broken.
 *   'hang'    — stays alive, ignoring nothing, so a real cancellation is observable as a dead pid.
 *   'missing' — no file at all, so the executability check is the thing exercised.
 */
function fakeSay(mode: 'record' | 'fail' | 'hang' | 'missing'): FakeSay {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-say-'));
  const binary = path.join(dir, 'say-fake');
  const log = path.join(dir, 'argv.jsonl');
  const sideEffect = path.join(dir, 'SHELL-RAN-THE-TEXT');

  if (mode !== 'missing') {
    const tail =
      mode === 'fail'
        ? 'process.exit(3);'
        : mode === 'hang'
          ? // Outlives any plausible test, so a pid that has gone away was killed, not finished.
            'setTimeout(() => process.exit(0), 600000);'
          : 'process.exit(0);';
    // node, not sh: a shell recorder could itself be blamed for interpreting the argument.
    const script = [
      `#!${process.execPath}`,
      `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }) + '\\n');`,
      tail,
      '',
    ].join('\n');
    fs.writeFileSync(binary, script, { mode: 0o755 });
  }

  const invocations = (): Utterance[] => {
    if (!fs.existsSync(log)) return [];
    return fs
      .readFileSync(log, 'utf-8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Utterance);
  };

  return {
    binary,
    invocations,
    argvs: () => invocations().map((utterance) => utterance.argv),
    // signal 0 probes for existence without delivering anything.
    alive: () =>
      invocations().map((utterance) => {
        try {
          process.kill(utterance.pid, 0);
          return true;
        } catch {
          return false;
        }
      }),
    sideEffect,
  };
}

/**
 * Count what crosses the speak channel by wrapping the SHIPPED ipcMain handler, so the real handler
 * still runs. This is the only oracle that can prove the off case: a spy on the spawn alone cannot
 * distinguish "the renderer never asked" from "main asked and declined", and those are exactly the
 * two designs the requirement separates.
 */
async function installSpeechSpy(app: ElectronApplication): Promise<void> {
  const installed = await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
      }
    )._invokeHandlers;
    const original = handlers.get('speech:speak');
    if (original === undefined) return false;

    const seen: unknown[] = [];
    (globalThis as unknown as { __speechSpy: unknown[] }).__speechSpy = seen;
    handlers.set('speech:speak', (event: unknown, ...args: unknown[]) => {
      seen.push(args[0]);
      return original(event, ...args);
    });
    return true;
  });
  expect(installed, 'the speech:speak channel is not registered in main at all').toBe(true);
}

/** Everything the renderer has sent over the speak channel, in order. `null` is a cancel. */
async function speakCalls(app: ElectronApplication): Promise<unknown[]> {
  return app.evaluate(() => [
    ...((globalThis as unknown as { __speechSpy?: unknown[] }).__speechSpy ?? []),
  ]);
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-voice-'));
}

function readSaved(userDataDir: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

async function withApp(
  opts: { seed?: number; userDataDir?: string; say?: FakeSay },
  body: (ctx: { app: ElectronApplication; page: Page }) => Promise<void>,
): Promise<void> {
  const launched = await launchApp({
    seed: opts.seed ?? 8,
    userDataDir: opts.userDataDir ?? freshUserDataDir(),
    env: opts.say === undefined ? undefined : { OFFSUIT_SAY_BINARY: opts.say.binary },
  });
  try {
    await launched.page.waitForSelector(homeScreen);
    await installSpeechSpy(launched.app);
    await body({ app: launched.app, page: launched.page });
  } finally {
    await launched.close();
  }
}

/** Ask main to speak over the real bridge — the same preload channel the app itself uses. */
function speakViaBridge(page: Page, text: string | null): Promise<SpeakResult> {
  return page.evaluate(
    (payload) =>
      (window as unknown as { offsuit: { speak: (t: string | null) => Promise<SpeakResult> } }).offsuit.speak(
        payload,
      ),
    text,
  );
}

/**
 * Start an utterance without awaiting it, and hand back a getter for its eventual result.
 *
 * The catch-to-sentinel is not cosmetic. A long utterance's promise is still pending when a failing
 * test tears the app down, and that rejection was measured MASKING the real assertion failure —
 * Playwright reported "Target page ... has been closed" instead of the overlap it had detected.
 */
function speakInBackground(page: Page, text: string): () => Promise<SpeakResult | 'never settled'> {
  let settled: SpeakResult | 'never settled' = 'never settled';
  const pending = speakViaBridge(page, text).then(
    (result) => {
      settled = result;
    },
    () => undefined,
  );
  return async () => {
    await Promise.race([pending, Promise.resolve()]);
    return settled;
  };
}

async function setNarration(page: Page, on: boolean): Promise<void> {
  await page.click(tabSettings);
  await page.waitForSelector(settingsScreen);
  const toggle = page.locator(speakToggle);
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
 * Seed 8, hand 1, pinned by coach.spec.ts: hero holds QsQh on 8c9h8s. Calling 50 preflop is free
 * (silent); folding for 99 into a 348 pot throws away 3.9bb and grades SERIOUS. Exactly one verdict
 * out of two decisions, which is what makes "one speak per verdict" a real count rather than a
 * coincidence.
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

test.describe('the off switch', () => {
  /**
   * THE test. An off switch that still crosses the IPC boundary is the actual risk: main would be
   * the only thing standing between an untouched preference and a voice, and every future edit to
   * main could break it silently.
   */
  test('1. with narration off, a graded verdict sends NO speak IPC and spawns nothing', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      // Off is the default — nothing is clicked to get here.
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      await expect(page.locator(speakToggle)).toHaveAttribute('data-on', 'false');
      await expect(page.locator(speakToggle)).toHaveText('Off');
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);

      await openTable(page);
      // Non-vacuous: there WAS a verdict to speak, and it is on screen in full.
      const verdict = await playToOneVerdict(page);
      expect(verdict).not.toBe('');

      expect(await speakCalls(app), 'narration is off, yet the renderer used the channel').toEqual([]);
      expect(say.invocations(), 'narration is off, yet a voice process was spawned').toEqual([]);
    });
  });

  test('2. turning it back off stops the channel again, mid-session', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      await playToOneVerdict(page);
      expect((await speakCalls(app)).length, 'on: the verdict should have been sent').toBe(1);

      // Off mid-session. The cancel is itself a speak message, so count from here on.
      await setNarration(page, false);
      const afterOff = (await speakCalls(app)).length;

      await openTable(page);
      await playToOneVerdict(page);
      expect(
        (await speakCalls(app)).length - afterOff,
        'switched off, yet a later verdict still crossed the channel',
      ).toBe(0);
    });
  });
});

test.describe('with narration on', () => {
  test('3. exactly one speak request per verdict, carrying the verdict text', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);

      // One request, for the one verdict — not one per decision and not one per render.
      expect(await speakCalls(app)).toEqual([verdict]);

      // And it reached the binary as the verdict, after the `--` separator.
      await expect
        .poll(() => say.invocations().length, { message: 'the fake say was never spawned' })
        .toBe(1);
      expect(say.argvs()[0]).toEqual(['--', verdict]);
    });
  });

  test('4. the text stays fully on screen — speech is additive, never the only channel', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);

      // Same assertions coach.spec.ts makes with no narration in the picture at all.
      await expect(page.locator(coachPanel)).toBeVisible();
      await expect(page.locator(sel.coach)).toHaveText(verdict);
      await expect(page.locator('.coach-principle')).toContainText('pot odds');
      expect(await speakCalls(app)).toEqual([verdict]);
    });
  });

  test('5. a silenced verdict is not spoken — the silence rule reaches the voice too', async () => {
    const say = fakeSay('record');
    // Seed 42, hand 1, pinned by coach.spec.ts: call preflop and check the flop are both 'free', so
    // the panel stays hidden. A voice reading a verdict the panel never showed would be information
    // in audio only.
    await withApp({ seed: 42, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);

      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(sel.btnCall).click();
      expect(await waitForIdle(page)).toBe('hero');
      await page.locator(sel.btnCheck).click();

      await expect(page.locator(coachPanel)).toBeHidden();
      await expect(page.locator(coachPanel)).toHaveAttribute('data-severity', 'none');
      expect(await speakCalls(app), 'a free grade must be silent in audio as well as on screen').toEqual([]);
      expect(say.invocations()).toEqual([]);
    });
  });

  test('6. a new hand cancels the verdict still being read', async () => {
    const say = fakeSay('hang');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      await expect.poll(() => say.invocations().length).toBe(1);
      expect(say.alive()).toEqual([true]);

      // The panel drops the verdict at the next hand; the voice must drop it too, so the cancel
      // rides the same channel rather than being left to a timeout.
      expect(await waitForIdle(page)).toBe('handover');
      await page.locator(nextHand).click();
      await waitForIdle(page);

      expect(await speakCalls(app)).toEqual([verdict, null]);
      // The process really stopped — not merely a cancel message that main ignored.
      await expect
        .poll(() => say.alive(), { message: 'the previous hand is still being narrated' })
        .toEqual([false]);
      // Nothing new was spawned: cancelling is not another utterance.
      expect(say.invocations().length).toBe(1);
    });
  });

  test('7. leaving the table cancels the verdict being read', async () => {
    const say = fakeSay('hang');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      await expect.poll(() => say.alive()).toEqual([true]);

      await page.click(sel.tabProfile);
      await page.waitForSelector('[data-testid="profile-screen"]');
      expect(await speakCalls(app)).toEqual([verdict, null]);
      await expect
        .poll(() => say.alive(), { message: 'a voice is still narrating a table that is unmounted' })
        .toEqual([false]);
    });
  });
});

test.describe('never two voices at once', () => {
  /**
   * The overlap guarantee. Two verdicts read over each other are worse than silence: neither is
   * intelligible, and the learner cannot tell which spot is being described.
   *
   * The oracle is the FIRST PROCESS'S LIVENESS, observed from the test runner with signal 0 — not
   * the IPC reason. `speak` reports 'cancelled' from its own bookkeeping, so a version that forgot
   * to kill anything still says 'cancelled' while both voices talk; that mutation was measured
   * surviving an IPC-reason assertion. A dead pid cannot be faked by bookkeeping.
   */
  test('8. a second verdict kills the process still reading the first', async () => {
    const say = fakeSay('hang');
    await withApp({ seed: 8, say }, async ({ page }) => {
      const first = speakInBackground(page, 'first verdict, still being read');
      // Ordered by the invoke queue on one channel, so the second cannot be handled before the first.
      await expect.poll(() => say.invocations().length).toBe(1);
      expect(say.alive(), 'the first utterance should be in flight').toEqual([true]);

      const second = speakInBackground(page, 'second verdict, arriving early');
      await expect.poll(() => say.invocations().length).toBe(2);

      // THE assertion: the first process is gone and only the second is alive. A 'hang' fake exits
      // on its own only after ten minutes, so a dead pid here means it was killed.
      await expect
        .poll(() => say.alive(), {
          message: 'the first voice is still running while the second speaks — they overlap',
        })
        .toEqual([false, true]);
      await expect.poll(first).toEqual({ spoken: false, reason: 'cancelled' });

      // And the survivor is stoppable in turn, so nothing is left talking after the test.
      await speakViaBridge(page, null);
      await expect.poll(second).toEqual({ spoken: false, reason: 'cancelled' });
      await expect.poll(() => say.alive()).toEqual([false, false]);
      expect(say.argvs()).toEqual([
        ['--', 'first verdict, still being read'],
        ['--', 'second verdict, arriving early'],
      ]);
    });
  });
});

test.describe('the verdict text is an argument, never a command', () => {
  /**
   * The security property, tested directly rather than by reading the source. The text goes to
   * spawn() in an argv array with shell:false, so a shell never parses it. Two independent oracles:
   * the recorded argv is byte-identical to the input, and the side-effect file a shell would have
   * created does not exist.
   */
  test('9. shell metacharacters are spoken, not interpreted', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ page }) => {
      const hostile = [
        `$(touch ${say.sideEffect})`,
        `\`touch ${say.sideEffect}\``,
        `; touch ${say.sideEffect}`,
        `&& touch ${say.sideEffect}`,
        `| tee ${say.sideEffect}`,
        `x > ${say.sideEffect}`,
        `$(echo pwned) & touch ${say.sideEffect} #`,
      ];

      for (const text of hostile) {
        const result = await speakViaBridge(page, text);
        expect(result.spoken, `"${text}" did not reach the binary`).toBe(true);
      }

      await expect.poll(() => say.invocations().length).toBe(hostile.length);
      // Byte-identical argv, each preceded by the `--` end-of-flags separator.
      expect(say.argvs()).toEqual(hostile.map((text) => ['--', text]));
      expect(
        fs.existsSync(say.sideEffect),
        `a shell executed the verdict text and created ${say.sideEffect}`,
      ).toBe(false);
    });
  });

  /**
   * The other half of the argv contract, and the reason for `--`: without it, text that begins with
   * a dash is consumed by `say` as its own flags instead of being read out.
   */
  test('10. text that looks like a flag is still spoken as text', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ page }) => {
      for (const text of ['-v Alice', '--voice=Alice', '-o /tmp/offsuit-should-not-exist.aiff']) {
        expect((await speakViaBridge(page, text)).spoken, text).toBe(true);
      }
      await expect.poll(() => say.invocations().length).toBe(3);
      expect(say.argvs()).toEqual([
        ['--', '-v Alice'],
        ['--', '--voice=Alice'],
        ['--', '-o /tmp/offsuit-should-not-exist.aiff'],
      ]);
      expect(fs.existsSync('/tmp/offsuit-should-not-exist.aiff')).toBe(false);
    });
  });
});

test.describe('a broken voice cannot break the app', () => {
  test('11. a voice that exits non-zero reports the failure and leaves the hand playable', async () => {
    const say = fakeSay('fail');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);

      // The app asked for the verdict to be read, and the voice refused.
      expect(await speakCalls(app)).toEqual([verdict]);

      // The failure is reported over IPC, not thrown. Asked directly, because a verdict's own speak
      // is fire-and-forget by design — the hand must never wait on a voice to find out it failed.
      expect(await speakViaBridge(page, 'a verdict nobody will hear')).toEqual({
        spoken: false,
        reason: 'exit-3',
      });

      // The app is untouched: the verdict is still readable and the hand still finishes.
      await expect(page.locator(sel.coach)).toHaveText(verdict);
      expect(await waitForIdle(page)).toBe('handover');
      await page.locator(nextHand).click();
      expect(await waitForIdle(page)).toBe('hero');
      await expect(page.locator(`${sel.heroCards} ${sel.card}`)).toHaveCount(2);
      await expect(page.locator(sel.btnFold)).toBeEnabled();
    });
  });

  test('12. a missing voice binary is reported, and the hand plays to showdown regardless', async () => {
    const say = fakeSay('missing');
    expect(fs.existsSync(say.binary), 'the missing-binary fixture must not exist').toBe(false);

    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      expect(await speakCalls(app)).toEqual([verdict]);

      expect(await speakViaBridge(page, 'nothing can say this')).toEqual({
        spoken: false,
        reason: 'unavailable',
      });

      await expect(page.locator(sel.coach)).toHaveText(verdict);

      // Play three more hands with a dead voice on every verdict.
      for (let hand = 0; hand < 3; hand++) {
        expect(await waitForIdle(page)).toBe('handover');
        await page.locator(nextHand).click();
        for (let step = 0; step < 20; step++) {
          if ((await waitForIdle(page)) === 'handover') break;
          const check = page.locator(sel.btnCheck);
          if (await check.isEnabled()) await check.click();
          else await page.locator(sel.btnCall).click();
        }
      }
      await expect(page.locator('[data-testid="winner-summary"]')).toBeVisible();
    });
  });

  test('13. an empty or non-text message is refused without a spawn', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ page }) => {
      expect(await speakViaBridge(page, '   ')).toEqual({ spoken: false, reason: 'empty' });
      expect(await speakViaBridge(page, '')).toEqual({ spoken: false, reason: 'empty' });
      expect(
        await page.evaluate(() =>
          (
            window as unknown as {
              offsuit: { speak: (t: unknown) => Promise<SpeakResult> };
            }
          ).offsuit.speak(42),
        ),
      ).toEqual({ spoken: false, reason: 'not-text' });
      expect(say.invocations()).toEqual([]);
    });
  });
});

test.describe('the preference', () => {
  test('14. the toggle persists and comes back on after a restart', async () => {
    const userDataDir = freshUserDataDir();
    const say = fakeSay('record');

    await withApp({ seed: 8, userDataDir, say }, async ({ page }) => {
      await setNarration(page, true);
      await expect
        .poll(() => {
          try {
            return readSaved(userDataDir).spokenVerdicts;
          } catch {
            return undefined;
          }
        })
        .toBe(true);
    });

    await withApp({ seed: 8, userDataDir, say }, async ({ app, page }) => {
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      await expect(page.locator(speakToggle)).toHaveAttribute('data-on', 'true');
      await expect(page.locator(speakToggle)).toHaveText('On');

      // Restored ON means it actually narrates, not merely that the pill remembers.
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      expect(await speakCalls(app)).toEqual([verdict]);
    });
  });

  test('15. switching it off cancels whatever is being said right now', async () => {
    const say = fakeSay('hang');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      await setNarration(page, true);
      await openTable(page);
      const verdict = await playToOneVerdict(page);
      await expect.poll(() => say.invocations().length).toBe(1);

      // Reaching Settings unmounts the table, which cancels on its own (test 7) — so measure the
      // toggle's own effect from here rather than from the start of the session.
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      expect(await speakCalls(app)).toEqual([verdict, null]);

      // Speak again from the settings screen so there is definitely a live utterance for the switch
      // to stop; without this the assertion below could pass on an app that cancels nothing.
      speakInBackground(page, 'still being read when the switch is thrown');
      await expect.poll(() => say.invocations().length).toBe(2);
      await expect.poll(() => say.alive()).toEqual([false, true]);

      await page.locator(speakToggle).click();
      await expect(page.locator(speakToggle)).toHaveAttribute('data-on', 'false');

      // A cancel, and no new utterance: reaching for the switch mid-sentence stops the sentence.
      expect(await speakCalls(app)).toEqual([
        verdict,
        null,
        'still being read when the switch is thrown',
        null,
      ]);
      await expect
        .poll(() => say.alive(), { message: 'the switch is off but the voice is still talking' })
        .toEqual([false, false]);
      expect(say.invocations().length).toBe(2);
    });
  });

  /** N1: nothing on the settings screen is locked, greyed out or gated behind anything. */
  test('16. the toggle is enabled and reachable with no voice installed at all', async () => {
    const say = fakeSay('missing');
    await withApp({ seed: 8, say }, async ({ page }) => {
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      const toggle = page.locator(speakToggle);
      await expect(toggle).toBeEnabled();
      await toggle.click();
      await expect(toggle).toHaveAttribute('data-on', 'true');
      await expect(toggle).toHaveText('On');
    });
  });
});

test.describe('the settings screen fits', () => {
  test('17. the row and its toggle are on screen at both documented sizes', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ app, page }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
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

        await page.click(tabSettings);
        await page.waitForSelector(settingsScreen);

        /*
         * Scroll the toggle into view before measuring. This test was written against a settings
         * screen holding narration alone; the shipped screen carries six sections above it (tutor
         * state, the egress allowlist, what-is-sent, what-is-never-sent, guard diagnostics) and
         * scrolls its own column by design, so "above the fold unscrolled" describes a screen that
         * no longer exists. The requirement it was reaching for is that the control is REACHABLE and
         * not clipped or covered, which is exactly how settings.spec.ts already asserts the delete
         * control. Every other assertion below is unchanged and still measured against the pinned
         * viewport — including that the DOCUMENT never scrolls, only the column.
         */
        await page.locator(speakToggle).scrollIntoViewIfNeeded();

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() clears the device-metrics override.
        const geometry = await page.evaluate(() => {
          const box = (id: string): { top: number; bottom: number; left: number; right: number; width: number; height: number; coveredBy: string | null } | null => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
              width: r.width,
              height: r.height,
              coveredBy:
                hit === null
                  ? 'nothing (outside the viewport)'
                  : hit === el || el.contains(hit) || hit.contains(el)
                    ? null
                    : `<${hit.tagName.toLowerCase()} class="${String(hit.className)}">`,
            };
          };
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollHeight: document.documentElement.scrollHeight,
            toggle: box('speak-verdicts-toggle'),
            tab: box('tab-settings'),
            noteClipped: (() => {
              const note = document.querySelector('.settings-note');
              return note instanceof HTMLElement ? note.scrollHeight > note.clientHeight + 1 : null;
            })(),
          };
        });

        expect(geometry.innerWidth).toBe(width);
        expect(geometry.innerHeight).toBe(height);
        expect(
          geometry.docScrollHeight,
          `document is ${geometry.docScrollHeight}px in a ${height}px viewport`,
        ).toBeLessThanOrEqual(height + 1);
        expect(geometry.noteClipped, 'the explanatory note is clipped').toBe(false);

        for (const [name, rect] of Object.entries({ toggle: geometry.toggle, tab: geometry.tab })) {
          expect(rect, `${name} missing at ${width}x${height}`).not.toBeNull();
          if (rect === null) continue;
          expect(rect.width, `${name} has zero width`).toBeGreaterThan(0);
          expect(rect.height, `${name} has zero height`).toBeGreaterThan(0);
          expect(rect.top, `${name} above the viewport`).toBeGreaterThanOrEqual(0);
          expect(rect.left, `${name} left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(rect.bottom, `${name} below the fold at ${width}x${height}`).toBeLessThanOrEqual(height);
          expect(rect.right, `${name} past the right edge`).toBeLessThanOrEqual(width);
          expect(rect.coveredBy, `${name} is covered by ${String(rect.coveredBy)}`).toBeNull();
        }

        await shot(page, `voice-settings-off-${width}x${height}`);
      }

      // And once more with it on, so the screenshot shows the live state, not only the default.
      await page.click(tabSettings);
      await page.waitForSelector(settingsScreen);
      await page.locator(speakToggle).click();
      await expect(page.locator(speakToggle)).toHaveAttribute('data-on', 'true');
      await shot(page, 'voice-settings-on');
    });
  });

  test('18. the table still renders and narrates with a verdict on screen', async () => {
    const say = fakeSay('record');
    await withApp({ seed: 8, say }, async ({ page }) => {
      await setNarration(page, true);
      await openTable(page);
      await playToOneVerdict(page);
      await expect.poll(() => say.invocations().length).toBe(1);
      await shot(page, 'voice-table-verdict-spoken');
    });
  });
});
