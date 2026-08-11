import { expect, test, type Page } from '@playwright/test';
import { launchApp, sel } from './helpers.js';
import { tableScreen, waitForIdle } from './flow.js';

/**
 * O1/O3 — SIX archetypes wired into live play, label HIDDEN until the hand ends.
 *
 * The six archetypes are the teaching premise: the learner watches a seat's behaviour, classifies
 * it, and only at handover sees whether they were right. Unit tests prove the *profiles* differ and
 * that jitter stays in band; nothing there proves the renderer seats a seeded 3-of-6 selection, hides
 * the label mid-hand, reveals it at handover, and that a tight archetype actually folds more than a
 * loose one through the real UI. If the renderer leaked the label mid-hand, or seated one opponent
 * three times, every unit test would still be green.
 *
 * WHY THIS GENERALISES THE OLD 3-ARCHETYPE SPEC. Live play used to drive villains through ai.ts's
 * three fixed archetypes at fixed seats, and this file hardcoded ['Nit','Station','TAG'] at seats
 * 3/2/1. Live play now routes through archetypes.ts: a seeded 3-of-6 pick per session, jittered per
 * session, label hidden until handover. So the label assertions become "hidden until handover, then
 * a distinct real label per seat", the behavioural assertion keys off the *revealed* class rather
 * than a fixed seat id, and a new reachability test proves all six are seatable across seeds.
 */

const SEED = 42;
const BB = 50;
const START_STACK = 5000;
const SEATS = 4;

/** The six labels, exactly as ARCHETYPE_EXPLOITS spells them. Any revealed tag must be one of these. */
const ARCHETYPE_LABELS = ['Nit', 'Station', 'LAG', 'TAG-reg', 'Over-folder', 'Maniac'];
/** Tight types fold too much to a bet; loose types call/raise too wide. TAG-reg is the neutral baseline. */
const TIGHT_LABELS = new Set(['Nit', 'Over-folder']);
const LOOSE_LABELS = new Set(['Station', 'Maniac', 'LAG']);

/**
 * 24 hands, not 15. A seat's fold rate is driven by position too, and the dealer rotates every hand,
 * so only a multiple of SEATS gives each seat the same positional mix. 24 = 6 orbits — a gap far
 * wider than any single hand's noise, and monotonic in tightness, which is what the archetypes claim.
 */
const HANDS = 24;

/** Fewer hands is enough to prove the rng stream is seeded; two launches makes it the expensive test. */
const DETERMINISM_HANDS = 6;

/** Seeds 1..5 already seat all six labels somewhere; 1..6 gives margin. Bounded so the loop is cheap. */
const REACHABILITY_SEEDS = [1, 2, 3, 4, 5, 6];

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
  /** The revealed archetype label per villain seat id, read at a handover (constant for the session). */
  seatLabels: Record<string, string>;
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

/** The revealed label per villain seat. Only meaningful at handover, where O3 unhides it. */
async function readRevealedLabels(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
        .filter((s) => s.dataset.seatId !== '0')
        .map((s) => {
          const tag = s.querySelector<HTMLElement>('[data-testid="seat-archetype"]');
          return [s.dataset.seatId ?? 'unknown', tag?.textContent ?? ''];
        }),
    ),
  );
}

/**
 * Fold the hero out at its first turn so the villains are left to play each other, then read the
 * result at handover. Folding the hero is what makes this cheap AND unbiased: the measurement is of
 * villain-vs-villain behaviour, not of how each villain responds to a scripted hero.
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
    let seatLabels: Record<string, string> = {};
    for (let hand = 1; hand <= hands; hand++) {
      outcomes.push(await foldOutOneHand(page));
      // The label is only revealed at handover, and it is constant for the session, so reading it on
      // the first hand (and every hand) captures the seat->archetype mapping this run measures.
      if (hand === 1) seatLabels = await readRevealedLabels(page);
      if (hand < hands) await page.locator('[data-testid="next-hand"]').click();
    }
    return { hands: outcomes, maxCommitted: await readMaxCommitted(page), seatLabels };
  } finally {
    await close();
  }
}

function countFolds(run: RunResult, seatId: number): number {
  return run.hands.filter((h) => h.foldedVillains.includes(seatId)).length;
}

/** Villain seat ids whose revealed label is in `labels`. */
function seatsOfClass(run: RunResult, labels: Set<string>): number[] {
  return Object.entries(run.seatLabels)
    .filter(([, label]) => labels.has(label))
    .map(([id]) => Number(id));
}

/** One line per hand, so a determinism mismatch names the hand that drifted. */
function foldPattern(run: RunResult): string[] {
  return run.hands.map((h) => h.foldedVillains.join('+'));
}

// The behavioural run is slow (24 hands x ~450ms per villain decision) and multiple scenarios must be
// measured over the SAME run, so it happens once and is shared. workers:1 / fullyParallel:false makes
// this file strictly sequential, so a lazily memoised promise is safe.
let sharedRun: Promise<RunResult> | null = null;
function behaviourRun(): Promise<RunResult> {
  sharedRun ??= runFoldOutHands(SEED, HANDS);
  return sharedRun;
}

test.describe('archetype label reveal', () => {
  test('villain labels are hidden mid-hand and revealed distinct at handover', async () => {
    const { page, close } = await launchApp({ seed: SEED });
    try {
      await sitDown(page);

      // Mid-hand: every villain reads 'Unknown' with data-revealed='false'. The hero has no tag.
      const midHand = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
          .filter((s) => s.dataset.seatId !== '0')
          .map((s) => {
            const tag = s.querySelector<HTMLElement>('[data-testid="seat-archetype"]');
            return { text: tag?.textContent ?? null, revealed: tag?.dataset.revealed ?? null };
          }),
      );
      expect(midHand).toHaveLength(SEATS - 1);
      for (const tag of midHand) {
        expect(tag.revealed).toBe('false');
        expect(tag.text).toBe('Unknown');
      }
      // The mid-hand tooltip must not leak the archetype on hover either.
      const titles = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat-archetype"]')].map((t) => t.title),
      );
      for (const title of titles) expect(title).toBe('');

      // Fold the hero out to reach handover, where O3 unhides the label.
      const fold = page.locator(sel.btnFold);
      for (let turn = 0; turn < MAX_HERO_TURNS; turn++) {
        if ((await waitForIdle(page)) === 'handover') break;
        if (await fold.isEnabled()) await fold.click();
        else await page.locator(sel.btnCheck).click();
      }
      await expect(page.locator(tableScreen)).toHaveAttribute('data-awaiting', 'handover');

      const revealed = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid="seat"]')]
          .filter((s) => s.dataset.seatId !== '0')
          .map((s) => {
            const tag = s.querySelector<HTMLElement>('[data-testid="seat-archetype"]');
            return { text: tag?.textContent ?? null, revealed: tag?.dataset.revealed ?? null };
          }),
      );
      expect(revealed).toHaveLength(SEATS - 1);
      for (const tag of revealed) {
        expect(tag.revealed).toBe('true');
        expect(ARCHETYPE_LABELS, `revealed label "${tag.text}"`).toContain(tag.text);
      }
      // A seeded 3-of-6 draw with no repeats: the three seated archetypes are distinct.
      expect(new Set(revealed.map((t) => t.text)).size).toBe(SEATS - 1);
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
      // Every villain seat does have one, so the assertion above cannot pass by the tag having
      // disappeared everywhere.
      await expect(page.locator('[data-testid="seat-archetype"]')).toHaveCount(SEATS - 1);
    } finally {
      await close();
    }
  });
});

test.describe('archetype behaviour through the UI', () => {
  test(`every tight-revealed seat folds more than every loose-revealed seat over ${HANDS} hands`, async () => {
    test.setTimeout(900_000);
    const run = await behaviourRun();

    const tightSeats = seatsOfClass(run, TIGHT_LABELS);
    const looseSeats = seatsOfClass(run, LOOSE_LABELS);
    // The behaviour claim needs a tight seat AND a loose seat to compare; a session that happened to
    // seat neither (or only one class) has nothing to prove here. SEED 42 seats both, so this never
    // skips at the pinned seed — the guard is honesty about the general case, not a way to pass.
    test.skip(
      tightSeats.length === 0 || looseSeats.length === 0,
      `seed ${SEED} did not seat both a tight and a loose archetype: ${JSON.stringify(run.seatLabels)}`,
    );

    // PER-SEAT STRICT DOMINATION, not a mean comparison. A mean is a weak oracle here: if behaviour
    // were decoupled from the label (e.g. every seat played the same profile) the per-seat fold
    // counts still differ by table noise, and a mean-vs-mean `>` survives that on residual variance.
    // Requiring the WORST tight seat to out-fold the BEST loose seat only holds when the label really
    // drives play — measured at this seed the gap is min(tight)=17 vs max(loose)=0, and every
    // "one profile for all seats" mutant collapses it (min(tight) <= max(loose)).
    const tightFolds = tightSeats.map((id) => ({ id, label: run.seatLabels[String(id)], folds: countFolds(run, id) }));
    const looseFolds = looseSeats.map((id) => ({ id, label: run.seatLabels[String(id)], folds: countFolds(run, id) }));
    const detail = `tight ${JSON.stringify(tightFolds)} vs loose ${JSON.stringify(looseFolds)}`;
    const minTight = Math.min(...tightFolds.map((s) => s.folds));
    const maxLoose = Math.max(...looseFolds.map((s) => s.folds));
    expect(minTight, detail).toBeGreaterThan(maxLoose);
    // Guard the measurement itself: an all-24 tight column or an all-0 loose column read from a
    // stuck table would satisfy the domination vacuously.
    expect(minTight).toBeGreaterThan(0);
    expect(maxLoose).toBeLessThan(HANDS);
  });

  test('villains bet and raise, not merely call', async () => {
    test.setTimeout(900_000);
    const run = await behaviourRun();

    // Signal 1: a villain committed more than the big blind at some render. Preflop that can only
    // be a raise; postflop it can only be a bet or raise, since committed resets each street.
    const villainPeaks = [1, 2, 3].map((id) => ({ id, peak: run.maxCommitted[String(id)] ?? 0 }));
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
  test('the same seed replays the same villains, fold pattern, and revealed labels', async () => {
    test.setTimeout(900_000);

    const first = await runFoldOutHands(SEED, DETERMINISM_HANDS);
    const second = await runFoldOutHands(SEED, DETERMINISM_HANDS);

    // Villain decisions come off one long-lived seeded stream, and the 3-of-6 selection is a pure
    // function of the seed. If any of it leaked wall-clock timing (or reseeded per render), these
    // would drift apart.
    expect(second.seatLabels).toEqual(first.seatLabels);
    expect(foldPattern(second)).toEqual(foldPattern(first));
    expect(second.hands.map((h) => h.potAwarded)).toEqual(first.hands.map((h) => h.potAwarded));
    expect(first.hands).toHaveLength(DETERMINISM_HANDS);
    // The mapping is non-empty and every label is a real archetype, so the equality above is not
    // comparing two empty objects.
    expect(Object.keys(first.seatLabels)).toHaveLength(SEATS - 1);
    for (const label of Object.values(first.seatLabels)) expect(ARCHETYPE_LABELS).toContain(label);
    // A run where no villain ever folded would make the fold-pattern comparison vacuous.
    expect(first.hands.some((h) => h.foldedVillains.length > 0)).toBe(true);
  });
});

test.describe('archetype reachability (O1)', () => {
  test('all six archetypes are seatable across a bounded set of seeds', async () => {
    test.setTimeout(900_000);

    const seen = new Set<string>();
    for (const seed of REACHABILITY_SEEDS) {
      const run = await runFoldOutHands(seed, 1);
      for (const label of Object.values(run.seatLabels)) {
        expect(ARCHETYPE_LABELS, `seed ${seed} revealed unknown label "${label}"`).toContain(label);
        seen.add(label);
      }
    }
    // Every one of the six must have been seated at seat 1+ in at least one session.
    expect([...seen].sort(), `labels seen across seeds ${REACHABILITY_SEEDS.join(',')}`).toEqual(
      [...ARCHETYPE_LABELS].sort(),
    );
  });
});
