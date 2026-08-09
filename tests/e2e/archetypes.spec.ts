import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * The three archetypes are the whole teaching premise: the student is supposed to read a seat's
 * label and exploit it. Unit tests prove the *profiles* differ, but nothing proved the renderer
 * wires each seat to the right one, nor that the difference survives into real UI play. If the
 * renderer passed the same seat id to archetypeForSeat for every villain, every unit test would
 * still be green and the app would silently be one opponent repeated three times.
 */

const SEED = 42;
const BB = 50;
const START_STACK = 5000;
const SEATS = 4;

/** archetypeForSeat(id) = ['nit','tag','station'][id % 3]. */
const EXPECTED_LABEL: Record<number, string> = { 1: 'TAG', 2: 'Station', 3: 'Nit' };
const TAG_SEAT = 1;
const STATION_SEAT = 2;
const NIT_SEAT = 3;

/**
 * 24 hands, not 15. The fold-rate gap between nit and station is large per decision, but a seat's
 * fold rate is also driven by position, and the dealer rotates every hand — so only a multiple of
 * SEATS gives each villain the same positional mix. 24 = 6 orbits. Measured at this seed:
 * nit folds 19/24, tag 13/24, station 3/24 — a gap far wider than any single hand's noise, and
 * monotonic in tightness, which is what the archetypes claim to be.
 */
const HANDS = 24;

/** Fewer hands is enough to prove the rng stream is seeded; two launches makes it the expensive test. */
const DETERMINISM_HANDS = 6;

/** The hero folds once per hand, so 2 loop turns suffice; the cap turns a stuck table into a failure. */
const MAX_HERO_TURNS = 8;

/** Highest pot reachable with no bet or raise: every seat calls the big blind and checks it down. */
const NO_AGGRESSION_POT = SEATS * BB;

interface HandOutcome {
  /** Seat ids that ended the hand folded (villains only; the hero always folds by design). */
  foldedVillains: number[];
  /** Total chips awarded at settlement, i.e. the final pot size. */
  potAwarded: number;
}

interface RunResult {
  hands: HandOutcome[];
  /** Largest `seat-committed` ever rendered for each seat during the run. */
  maxCommitted: Record<string, number>;
}

async function sitDown(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator(sel.newHand).click();
  await page.locator(tableScreen).waitFor();
  await waitForIdle(page);
}

/**
 * Record the peak committed chips per seat across every render.
 * A MutationObserver, not polling: the renderer repaints on each villain action, so the observer
 * sees every intermediate betting state without the test guessing at timings.
 */
async function watchCommitted(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __maxCommitted?: Record<string, number> };
    if (w.__maxCommitted) return;
    const maxima: Record<string, number> = {};
    w.__maxCommitted = maxima;
    const scan = (): void => {
      for (const seat of document.querySelectorAll<HTMLElement>('[data-testid="seat"]')) {
        const id = seat.dataset.seatId ?? 'unknown';
        const text = seat.querySelector<HTMLElement>('[data-testid="seat-committed"]')?.textContent;
        const committed = Number(text ?? '0');
        if (Number.isFinite(committed) && committed > (maxima[id] ?? 0)) maxima[id] = committed;
      }
    };
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  });
}

async function readMaxCommitted(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window as unknown as { __maxCommitted?: Record<string, number> }).__maxCommitted ?? {},
  );
}

/** settle() zeroes the pot before the handover render, so the winner summary is the only pot record left. */
async function readAwardedPot(page: Page): Promise<number> {
  const summary = await page.locator('[data-testid="winner-summary"]').innerText();
  const amounts = [...summary.matchAll(/wins (\d+)/g)].map((m) => Number(m[1]));
  if (amounts.length === 0) throw new Error(`no award amounts in winner summary: ${summary}`);
  return amounts.reduce((a, b) => a + b, 0);
}

async function readFoldedVillains(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
      .filter((s) => s.dataset.folded === 'true' && s.dataset.seatId !== '0')
      .map((s) => Number(s.dataset.seatId))
      .sort((a, b) => a - b),
  );
}

/**
 * Fold the hero out at its first turn so the villains are left to play each other, then read the
 * result at handover. Folding the hero is what makes this cheap AND unbiased: the measurement is
 * of villain-vs-villain behaviour, not of how each villain responds to a scripted hero.
 */
async function foldOutOneHand(page: Page): Promise<HandOutcome> {
  for (let turn = 0; turn < MAX_HERO_TURNS; turn++) {
    if ((await waitForIdle(page)) === 'handover') {
      return { foldedVillains: await readFoldedVillains(page), potAwarded: await readAwardedPot(page) };
    }
    const fold = page.locator(sel.btnFold);
    if (await fold.isEnabled()) {
      await fold.click();
      continue;
    }
    // Fold is always legal on the hero's turn; if it ever is not, keep the hand moving rather
    // than hanging, and let the aggregate assertions report the consequence.
    const check = page.locator(sel.btnCheck);
    const call = page.locator(sel.btnCall);
    if (await check.isEnabled()) await check.click();
    else if (await call.isEnabled()) await call.click();
    else throw new Error(`hero turn with no enabled action after ${turn} turns`);
  }
  throw new Error(`hand did not settle within ${MAX_HERO_TURNS} hero turns`);
}

async function runFoldOutHands(seed: number, hands: number): Promise<RunResult> {
  const { page, close } = await launchApp({ seed });
  try {
    await sitDown(page);
    await watchCommitted(page);

    const outcomes: HandOutcome[] = [];
    for (let hand = 1; hand <= hands; hand++) {
      outcomes.push(await foldOutOneHand(page));
      if (hand < hands) await page.locator('[data-testid="next-hand"]').click();
    }
    return { hands: outcomes, maxCommitted: await readMaxCommitted(page) };
  } finally {
    await close();
  }
}

function countFolds(run: RunResult, seatId: number): number {
  return run.hands.filter((h) => h.foldedVillains.includes(seatId)).length;
}

/** One line per hand, so a determinism mismatch names the hand that drifted. */
function foldPattern(run: RunResult): string[] {
  return run.hands.map((h) => h.foldedVillains.join('+'));
}

// The behavioural run is slow (24 hands x ~450ms per villain decision) and three scenarios must be
// measured over the SAME run, so it happens once and is shared. workers:1 / fullyParallel:false
// makes this file strictly sequential, so a lazily memoised promise is safe.
let sharedRun: Promise<RunResult> | null = null;
function behaviourRun(): Promise<RunResult> {
  sharedRun ??= runFoldOutHands(SEED, HANDS);
  return sharedRun;
}

test.describe('archetype wiring', () => {
  test('each villain seat shows its own archetype label', async () => {
    const { page, close } = await launchApp({ seed: SEED });
    try {
      await sitDown(page);
      const labels = await page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')].map((seat) => [
            seat.dataset.seatId ?? 'unknown',
            seat.querySelector<HTMLElement>('[data-testid="seat-archetype"]')?.textContent ?? null,
          ]),
        ),
      );

      // Read scoped per seat, not as a flat list: a flat list of the right three labels would
      // still pass if the seats were permuted, which is exactly the refactor this pins down.
      expect(labels[String(TAG_SEAT)]).toBe(EXPECTED_LABEL[TAG_SEAT]);
      expect(labels[String(STATION_SEAT)]).toBe(EXPECTED_LABEL[STATION_SEAT]);
      expect(labels[String(NIT_SEAT)]).toBe(EXPECTED_LABEL[NIT_SEAT]);
    } finally {
      await close();
    }
  });

  test('the hero seat carries no archetype label', async () => {
    const { page, close } = await launchApp({ seed: SEED });
    try {
      await sitDown(page);
      const heroSeat = page.locator('[data-testid="seat"][data-seat-id="0"]');
      await expect(heroSeat).toHaveCount(1);
      await expect(heroSeat.locator('[data-testid="seat-archetype"]')).toHaveCount(0);
      // Every other seat does have one, so the assertion above cannot pass by the label
      // having disappeared everywhere.
      await expect(page.locator('[data-testid="seat-archetype"]')).toHaveCount(SEATS - 1);
    } finally {
      await close();
    }
  });
});

test.describe('archetype behaviour through the UI', () => {
  test(`the nit folds strictly more often than the station over ${HANDS} hands`, async () => {
    test.setTimeout(900_000);
    const run = await behaviourRun();

    const nitFolds = countFolds(run, NIT_SEAT);
    const stationFolds = countFolds(run, STATION_SEAT);
    const tagFolds = countFolds(run, TAG_SEAT);

    // Aggregate, never a single hand: one hand is a coin flip, the run is the signal.
    expect(
      nitFolds,
      `nit(seat ${NIT_SEAT}) folds ${nitFolds}/${HANDS} vs station(seat ${STATION_SEAT}) ${stationFolds}/${HANDS} (tag ${tagFolds})`,
    ).toBeGreaterThan(stationFolds);
    // Guard the measurement itself: an all-zero or all-24 column would satisfy nothing.
    expect(nitFolds).toBeGreaterThan(0);
    expect(stationFolds).toBeLessThan(HANDS);
  });

  test('the station reaches showdown more often than the nit over the same run', async () => {
    test.setTimeout(900_000);
    const run = await behaviourRun();

    const showdowns = (seatId: number): number => HANDS - countFolds(run, seatId);
    const stationShowdowns = showdowns(STATION_SEAT);
    const nitShowdowns = showdowns(NIT_SEAT);

    expect(
      stationShowdowns,
      `station(seat ${STATION_SEAT}) unfolded at handover ${stationShowdowns}/${HANDS} vs nit(seat ${NIT_SEAT}) ${nitShowdowns}/${HANDS}`,
    ).toBeGreaterThan(nitShowdowns);
  });

  test('villains bet and raise, not merely call', async () => {
    test.setTimeout(900_000);
    const run = await behaviourRun();

    // Signal 1: a villain committed more than the big blind at some render. Preflop that can only
    // be a raise; postflop it can only be a bet or raise, since committed resets each street.
    const villainPeaks = [TAG_SEAT, STATION_SEAT, NIT_SEAT].map((id) => ({
      id,
      peak: run.maxCommitted[String(id)] ?? 0,
    }));
    const aggressors = villainPeaks.filter((v) => v.peak > BB);
    expect(
      aggressors.length,
      `peak committed per villain: ${villainPeaks.map((v) => `${v.id}=${v.peak}`).join(', ')}`,
    ).toBeGreaterThan(0);
    // Nobody can commit more than a full stack; a peak above that would mean the readout is bogus.
    for (const villain of villainPeaks) expect(villain.peak).toBeLessThanOrEqual(START_STACK);

    // Signal 2: independent of the committed readout — a pot larger than everyone-calls-the-blind
    // can only be built by a bet or raise.
    const biggestPot = Math.max(...run.hands.map((h) => h.potAwarded));
    expect(
      biggestPot,
      `largest settled pot over ${HANDS} hands (no-aggression ceiling ${NO_AGGRESSION_POT})`,
    ).toBeGreaterThan(NO_AGGRESSION_POT);
  });
});

test.describe('archetype determinism through the UI', () => {
  test('the same seed replays the same villain fold pattern across two launches', async () => {
    test.setTimeout(900_000);

    const first = await runFoldOutHands(SEED, DETERMINISM_HANDS);
    const second = await runFoldOutHands(SEED, DETERMINISM_HANDS);

    // Villain decisions come off one long-lived seeded stream. If any of it leaked wall-clock
    // timing (or reseeded per render), these two lists would drift apart.
    expect(foldPattern(second)).toEqual(foldPattern(first));
    expect(second.hands.map((h) => h.potAwarded)).toEqual(first.hands.map((h) => h.potAwarded));
    expect(first.hands).toHaveLength(DETERMINISM_HANDS);
    // A run where no villain ever folded would make the comparison vacuous.
    expect(first.hands.some((h) => h.foldedVillains.length > 0)).toBe(true);
  });
});
