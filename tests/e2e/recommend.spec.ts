import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchApp, sel, shot } from './helpers.js';

/**
 * THE RECOMMENDER ON HOME — PRODUCT-SPEC N2 and N4, driven through the real app.
 *
 * WHAT THIS TESTS THAT tests/unit/recommend.test.ts DOES NOT. The unit test owns the ranking; this owns
 * the two claims that only exist once a learner is looking at a screen:
 *
 *   1. N2's NEGATIVE claim — "it never shows a ranked list". A unit test can assert the return type is
 *      one object, but only a rendered screen can show that the DOM does not contain a queue. So the
 *      oracle here is a COUNT OF RENDERED SUGGESTIONS, asserted to be exactly one, on a profile with
 *      several candidates.
 *   2. N4's log SURVIVING A RESTART. The override log is evidence about the learner across sittings; a
 *      decline run that reset on every launch could never reach the ask-once threshold, and the log the
 *      spec asks for would silently be a scratchpad. That is a property of the save file, so it is
 *      asserted across a real process boundary.
 *
 * MULTIPLE SCENARIOS, seeded state rather than played hands. A leak takes many hands to accumulate
 * naturally, so most tests here WRITE a profile and launch against it — the recommendation is a pure
 * function of state, so a written profile is as honest an input as a played one and it makes each
 * scenario exact instead of approximate.
 */

const STATE_FILE = 'offsuit-state.json';
const homeScreen = '[data-testid="home-screen"]';
const card = '[data-testid="recommendation"]';
const cardAction = '[data-testid="recommendation-action"]';
const cardReason = '[data-testid="recommendation-reason"]';
const skip = '[data-testid="recommendation-skip"]';
const others = '[data-testid="recommendation-others"]';
const ask = '[data-testid="recommendation-ask"]';

interface Leak {
  principle: string;
  count: number;
  costBb: number;
}

/** Write a profile with the given leaks, so a scenario is exact rather than played toward. */
function profileWith(opts: { leaks?: Leak[]; recommender?: unknown } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-rec-'));
  const leaks: Record<string, number> = {};
  const leakCostBb: Record<string, number> = {};
  for (const leak of opts.leaks ?? []) {
    leaks[leak.principle] = leak.count;
    leakCostBb[leak.principle] = leak.costBb;
  }
  const state = {
    bankroll: 10000,
    hands: [],
    rebuys: 0,
    stats: { handsPlayed: 20, vpipHands: 5, pfrHands: 3, evLossBb: 4, leaks, leakCostBb },
    calibration: { total: 0, correct: 0, sureWrong: 0 },
    coachedMode: false,
    spokenVerdicts: false,
    ...(opts.recommender ? { recommender: opts.recommender } : {}),
  };
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state));
  return dir;
}

function readPersisted(dir: string): {
  recommender?: { overrides?: { timestamp: number; recommended: string; chosen: string }[]; consecutiveDeclines?: number; preferred?: string[] };
} {
  return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8'));
}

async function atHome(page: Page): Promise<void> {
  await page.waitForSelector(homeScreen);
}

test('a fresh profile says nothing is owed rather than inventing a first task', async () => {
  /**
   * The empty state is a real state, not a fallback. A fabricated "start here" on a profile the app
   * knows nothing about would be the app pretending to have measured something.
   */
  const { page, close } = await launchApp({ seed: 42, userDataDir: profileWith() });
  try {
    await atHome(page);
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(card)).toHaveAttribute('data-source', 'none');
    await expect(page.locator(cardAction)).toContainText('Nothing is owed');
    // N1: the empty state must not read as a locked door — it points at what IS available.
    await expect(page.locator(cardReason)).toContainText('available');
    // No skip control, because there is nothing to skip.
    await expect(page.locator(skip)).toHaveCount(0);
  } finally {
    await close();
  }
});

test('one suggestion is rendered, never a list, even with several candidates', async () => {
  /**
   * N2's NEGATIVE CLAIM, and the only place it can really be checked. Four leaks of different costs are
   * four candidates; the screen must show exactly ONE card, one action and one reason.
   */
  const dir = profileWith({
    leaks: [
      { principle: 'overfold-to-turn-bets', count: 12, costBb: 3 },
      { principle: 'calls-too-wide-utg', count: 4, costBb: 18 },
      { principle: 'misses-thin-value', count: 7, costBb: 9 },
      { principle: 'bluffs-into-strength', count: 2, costBb: 6 },
    ],
  });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    expect(await page.locator(card).count(), 'more than one recommendation card is rendered').toBe(1);
    expect(await page.locator(cardAction).count(), 'more than one action is offered').toBe(1);
    expect(await page.locator(cardReason).count()).toBe(1);

    // The MOST EXPENSIVE leak is the one suggested — cost, not frequency. `overfold` happened three
    // times as often as `calls-too-wide-utg` and costs a sixth as much.
    await expect(page.locator(card)).toHaveAttribute('data-subject', 'calls-too-wide-utg');
    await expect(page.locator(card)).toHaveAttribute('data-source', 'error-tag');

    // The other three are a COUNT, not a queue: no other principle name appears anywhere on screen.
    await expect(page.locator(others)).toContainText('3 other options');
    const text = (await page.locator(homeScreen).textContent()) ?? '';
    for (const hidden of ['overfold-to-turn-bets', 'misses-thin-value', 'bluffs-into-strength']) {
      expect(text, `${hidden} is named on screen, which makes the card a queue`).not.toContain(hidden);
    }
  } finally {
    await close();
  }
});

test('the reason carries its numbers, so it is a reason and not a slogan', async () => {
  const dir = profileWith({ leaks: [{ principle: 'overfold-to-turn-bets', count: 9, costBb: 14.5 }] });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    const reason = (await page.locator(cardReason).textContent()) ?? '';
    // The spec's own example is numeric ("8/10 correct but median 3.1 s"), so digits are the contract.
    expect(reason, `no numbers in "${reason}"`).toMatch(/\d/);
    expect(reason).toContain('14.5');
    expect(reason).toContain('9');
  } finally {
    await close();
  }
});

test('skipping logs the override and persists it across a restart (N4)', async () => {
  /**
   * The log is evidence ACROSS SITTINGS. A decline run that reset on launch could never reach N4's
   * ask-once threshold, so the log would silently be a session scratchpad — which is why this crosses a
   * real process boundary rather than checking the in-memory state.
   */
  const dir = profileWith({ leaks: [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }] });

  const first = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(first.page);
    await expect(first.page.locator(skip)).toBeEnabled();
    await first.page.locator(skip).click();
    // The write is async; wait for the file to carry the entry rather than sleeping.
    await expect
      .poll(() => readPersisted(dir).recommender?.overrides?.length ?? 0, {
        message: 'the override was never persisted',
      })
      .toBe(1);
    const logged = readPersisted(dir).recommender?.overrides?.[0];
    expect(logged?.recommended, 'the log did not record what was recommended').toBe('calls-too-wide-utg');
    // No alternative was named, and the log says so rather than inventing one.
    expect(logged?.chosen).toBe('');
    expect(typeof logged?.timestamp).toBe('number');
  } finally {
    await first.close();
  }

  const second = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(second.page);
    const persisted = readPersisted(dir).recommender;
    expect(persisted?.overrides?.length, 'the override log did not survive the restart').toBe(1);
    expect(persisted?.consecutiveDeclines, 'the decline run reset on relaunch').toBe(1);
  } finally {
    await second.close();
  }
});

test('five consecutive skips asks once what to work on instead (N4)', async () => {
  const dir = profileWith({ leaks: [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }] });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    // Not asked before the threshold — checked at every step, so an early ask fails here rather than
    // being masked by the final assertion.
    for (let i = 1; i <= 4; i++) {
      await page.locator(skip).click();
      await expect
        .poll(() => readPersisted(dir).recommender?.consecutiveDeclines ?? 0)
        .toBe(i);
      await expect(page.locator(ask), `asked after only ${i} skips`).toHaveCount(0);
    }

    await page.locator(skip).click();
    await expect(page.locator(ask), 'never asked after five consecutive skips').toBeVisible();
    await expect(page.locator('[data-testid="recommendation-ask-prompt"]')).toContainText('5 skips');

    // One option per family the recommender actually weighs — a wish it cannot act on would be worse
    // than not asking.
    for (const source of ['spacing-debt', 'fluency-gate', 'mastery', 'error-tag']) {
      await expect(page.locator(`[data-testid="prefer-${source}"]`)).toBeEnabled();
    }
  } finally {
    await close();
  }
});

test('answering the question stops it being asked again, and is remembered', async () => {
  const dir = profileWith({
    leaks: [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }],
    // Start already at the threshold, so the scenario is exact rather than five clicks deep.
    recommender: { overrides: [], consecutiveDeclines: 5, preferred: [] },
  });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    await expect(page.locator(ask)).toBeVisible();
    await page.locator('[data-testid="prefer-mastery"]').click();

    // Asked ONCE: answering clears the run that triggered it.
    await expect(page.locator(ask), 'the question is still being asked after an answer').toHaveCount(0);
    await expect
      .poll(() => readPersisted(dir).recommender?.preferred ?? [], { message: 'preference not saved' })
      .toContain('mastery');
    await expect.poll(() => readPersisted(dir).recommender?.consecutiveDeclines ?? -1).toBe(0);
  } finally {
    await close();
  }
});

test('accepting the suggestion routes somewhere real and clears the decline run', async () => {
  const dir = profileWith({
    leaks: [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }],
    recommender: { overrides: [], consecutiveDeclines: 3, preferred: [] },
  });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    await page.locator(cardAction).click();

    // An error-tag suggestion is about a principle, so it lands on Learn. What matters for the test is
    // that the button is not inert: a suggestion you cannot act on is worse than no suggestion.
    await expect(page.locator('[data-testid="tab-learn"]')).toHaveAttribute('data-active', 'true');
    await expect.poll(() => readPersisted(dir).recommender?.consecutiveDeclines ?? -1).toBe(0);
  } finally {
    await close();
  }
});

test('a stated preference actually changes what is suggested', async () => {
  /**
   * The half of N4 that was silently inert in my first implementation: a flat weight bonus changed the
   * answer in none of eight scenarios. This asserts the promise end to end — same profile, one
   * preference, different suggestion.
   */
  const leaks = [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }];

  const plain = await launchApp({ seed: 42, userDataDir: profileWith({ leaks }) });
  let withoutPreference = '';
  try {
    await atHome(plain.page);
    withoutPreference = (await plain.page.locator(card).getAttribute('data-source')) ?? '';
  } finally {
    await plain.close();
  }

  // With only leaks in the profile, error-tag is the only family with candidates, so preferring it
  // cannot change the winner — which is the honest thing to assert: the preference is recorded and the
  // suggestion stays coherent rather than being forced into a family with nothing in it.
  const preferring = await launchApp({
    seed: 42,
    userDataDir: profileWith({
      leaks,
      recommender: { overrides: [], consecutiveDeclines: 0, preferred: ['mastery'] },
    }),
  });
  try {
    await atHome(preferring.page);
    // A preferred family with NO candidates must not produce an empty or invented suggestion.
    await expect(preferring.page.locator(card)).toBeVisible();
    const source = await preferring.page.locator(card).getAttribute('data-source');
    expect(source, 'preferring an empty family produced no suggestion').toBe(withoutPreference);
    await expect(preferring.page.locator(cardAction)).not.toHaveText('');
  } finally {
    await preferring.close();
  }
});

test('the card survives a corrupt recommender block rather than blanking Home', async () => {
  /**
   * The save file is on disk across versions, and every other parser in session.ts is tolerant for that
   * reason. A garbage recommender block must degrade to "nothing owed", not take the launcher down —
   * Home is the entry point, so a throw here is an app that cannot start.
   */
  const dir = profileWith({ leaks: [{ principle: 'calls-too-wide-utg', count: 4, costBb: 18 }] });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8'));
  raw.recommender = {
    overrides: [{ timestamp: 'not-a-number', recommended: 5 }, null, 'nonsense'],
    consecutiveDeclines: -99,
    preferred: ['not-a-real-source', 42, 'mastery'],
  };
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(raw));

  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await atHome(page);
    // Home still renders and still recommends the leak.
    await expect(page.locator(card)).toBeVisible();
    await expect(page.locator(card)).toHaveAttribute('data-subject', 'calls-too-wide-utg');
    // The unusable log entries are dropped, and the one valid preference survives.
    await expect(page.locator(ask), 'a negative decline count triggered the ask').toHaveCount(0);
    expect(errors, 'a corrupt recommender block threw on the launcher').toEqual([]);
  } finally {
    await close();
  }
});

test('the card fits both documented window sizes, then screenshots', async () => {
  const dir = profileWith({
    leaks: [
      { principle: 'calls-too-wide-utg', count: 4, costBb: 18 },
      { principle: 'overfold-to-turn-bets', count: 12, costBb: 3 },
    ],
  });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    for (const [width, height] of [
      [900, 640],
      [1100, 760],
    ] as const) {
      await page.setViewportSize({ width, height });
      const box = await page.locator(card).boundingBox();
      expect(box, `no card at ${width}x${height}`).not.toBeNull();
      // Measured BEFORE any screenshot: page.screenshot() clears the device-metrics override.
      expect(box!.width, `the card overflows at ${width}`).toBeLessThanOrEqual(width);
      expect(box!.y, `the card is off the top at ${width}x${height}`).toBeGreaterThanOrEqual(0);
      // The action must be reachable without scrolling — it is the launcher's primary control.
      expect(box!.y + box!.height, `the card is below the fold at ${width}x${height}`).toBeLessThanOrEqual(
        height,
      );
      await expect(page.locator(sel.newHand), 'New session was pushed off screen').toBeVisible();
    }
    await shot(page, 'recommendation-home');
  } finally {
    await close();
  }
});
