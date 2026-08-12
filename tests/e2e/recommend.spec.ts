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

interface GradedEvent {
  kind: 'graded';
  conceptId: string;
  at: number;
  correct: boolean;
}

/** Write a profile with the given leaks, so a scenario is exact rather than played toward. */
function profileWith(opts: { leaks?: Leak[]; recommender?: unknown; fadingLog?: GradedEvent[] } = {}): string {
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
    ...(opts.fadingLog ? { fadingLog: opts.fadingLog } : {}),
    ...(opts.recommender ? { recommender: opts.recommender } : {}),
  };
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state));
  return dir;
}

const MS_PER_DAY = 86_400_000;

/**
 * A graded-drill history for one concept, its first rep `daysAgo` in the past. Used to make a concept
 * genuinely overdue for a spacing wave, so the recommender's spacing-debt source has real data to fire
 * on — the same shape the app itself writes when the Drill is answered.
 */
function drilledConcept(conceptId: string, reps: number, daysAgo: number, now: number): GradedEvent[] {
  const firstSeen = now - daysAgo * MS_PER_DAY;
  return Array.from({ length: reps }, (_, i) => ({
    kind: 'graded' as const,
    conceptId,
    // Cluster the reps around first exposure (a day-0 block), so the concept is well past its day-7 wave.
    at: firstSeen + Math.min(i, 1) * 60_000,
    correct: true,
  }));
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

test('an overdue drill concept produces a spacing-debt suggestion that outranks a cheap leak', async () => {
  /**
   * THE WIRING CLAIM for the recommender: main.ts now derives real ConceptStates from the persisted
   * Drill log (conceptStatesFromLog), so the spacing-debt / mastery sources — dead while concepts was
   * hardcoded to [] — can finally fire on Home. A concept first drilled 15 days ago is well past its
   * day-7 wave, so its spacing debt (weight 100+) must beat a present-but-cheap error-tag leak. This is
   * exactly the case the unit test cannot see: that the app actually feeds the log through.
   */
  const now = Date.now();
  const dir = profileWith({
    // One genuinely overdue concept, plus a cheap leak that WOULD win if concepts were still empty.
    fadingLog: drilledConcept('pot-odds', 10, 15, now),
    leaks: [{ principle: 'overfold-to-turn-bets', count: 3, costBb: 1 }],
  });
  const { page, close } = await launchApp({ seed: 42, userDataDir: dir });
  try {
    await atHome(page);
    await expect(page.locator(card)).toBeVisible();
    // The spacing debt wins — proving the concept states reached the recommender, not just the leak.
    await expect(page.locator(card)).toHaveAttribute('data-source', 'spacing-debt');
    await expect(page.locator(card)).toHaveAttribute('data-subject', 'pot-odds');
    // The reason names the concept, so it is about the drilled KC and not a generic prompt.
    await expect(page.locator(cardReason)).toContainText('pot-odds');
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
    await expect(page.locator(ask), 'a negative decline count triggered the ask').toHaveCount(0);
    expect(errors, 'a corrupt recommender block threw on the launcher').toEqual([]);

    /*
     * THE UNUSABLE ENTRIES ARE DROPPED, ASSERTED ON THE FILE — and this is here because the weaker
     * version of this test (Home renders, nothing throws) let a real mutation through: removing the
     * validity filter entirely, so `{timestamp: 'not-a-number', recommended: 5}` and a bare string are
     * kept as log entries, changed nothing observable on screen.
     *
     * It matters because N4's log is evidence. An entry whose timestamp is a string cannot be placed in
     * time and an entry with no `recommended` names nothing — carrying them forward means the phase-6
     * maintenance view would later render `undefined` as a recommendation the learner declined. So the
     * oracle is the SHAPE OF WHAT SURVIVED: three garbage entries in, zero out, and every surviving
     * entry fully typed.
     */
    /*
     * A SAVE HAS TO HAPPEN FIRST, which my first version of this got wrong: it read the file straight
     * after launch and found the garbage still there — of course it did, nothing had rewritten it yet.
     * The parser runs on LOAD, so its output only reaches disk once the app saves. Skipping the
     * suggestion is the cheapest real save, and it also proves the surviving state is writable rather
     * than merely parseable.
     */
    await page.locator(skip).click();
    await expect
      .poll(() => readPersisted(dir).recommender?.consecutiveDeclines ?? -1, {
        message: 'the app never saved after loading the corrupt block',
      })
      .toBe(1);

    const saved = readPersisted(dir).recommender;
    // One real entry — the decline just made — and none of the three garbage ones.
    expect(saved?.overrides?.length, 'garbage log entries were kept instead of dropped').toBe(1);
    for (const entry of saved?.overrides ?? []) {
      expect(typeof entry.timestamp, 'a surviving entry has an unusable timestamp').toBe('number');
      expect(Number.isFinite(entry.timestamp)).toBe(true);
      expect(typeof entry.recommended, 'a surviving entry names nothing').toBe('string');
      expect(typeof entry.chosen).toBe('string');
    }
    // The negative decline count was clamped to 0 on load, so one skip makes it exactly 1. Carrying
    // -99 forward would have made N4's ask unreachable forever.
    expect(saved?.consecutiveDeclines, 'a negative decline count survived the load').toBe(1);
    // Only the one real source survives the preference list.
    expect(saved?.preferred, 'an unknown preferred source was kept').toEqual(['mastery']);
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

test('the advice card carries no off-palette colour (an undefined --accent used to fall back to blue)', async () => {
  /**
   * PALETTE REGRESSION. styles-screens.css referenced `var(--accent, #4a9eff)` for the recommendation
   * card's left rule, but --accent is defined nowhere, so it fell back to a blue that is outside the
   * entire app palette — on the loudest mark of the launcher, and against the app's own
   * no-off-palette-colour thesis. The rule is gone; the uppercase muted heading carries "advice".
   * Oracle is computed style (the suite has no screenshot diffing), matching charts.spec's hue scan.
   */
  const { page, close } = await launchApp({ seed: 42, userDataDir: profileWith() });
  try {
    await atHome(page);
    await expect(page.locator(card)).toBeVisible();
    const style = await page.locator(card).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { borderLeftWidth: cs.borderLeftWidth, borderLeftColor: cs.borderLeftColor };
    });
    // No left rule at all now, so nothing can carry the off-palette hue.
    expect(style.borderLeftWidth).toBe('0px');
    // And defensively: the blue 74,158,255 must not appear on the card's borders anywhere.
    expect(style.borderLeftColor).not.toContain('74, 158, 255');
  } finally {
    await close();
  }
});
