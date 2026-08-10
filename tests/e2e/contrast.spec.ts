import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AXIS_AVAILABILITY } from '../../src/core/contrast.js';
import { manifestEntry } from '../../src/core/contrastManifest.js';
import { launchApp, shot } from './helpers.js';

/**
 * THE REPAIR TAB — contrast-set remediation over src/core/contrast.ts. PRODUCT-SPEC B6, S2, and the
 * T2 row of G1's error table.
 *
 * The load-bearing test is #2. B6's entire instructional mechanism is that EXACTLY ONE of the seven
 * variables moves between two spots, and the screen's job is to make which one explicit. So the
 * property is asserted from the DOM in two independent ways for every set the screen can show:
 *   - `data-differs` / `data-hamming`, published straight from core's differingAxes/hammingDistance,
 *      must name exactly the axis the set claims;
 *   - the held-axis cells, which print the other six values, must be IDENTICAL across every spot in
 *      the set — so a pair that moved a second variable would fail even if core's own comparison
 *      were the thing that broke.
 *
 * Test #4 is the honesty requirement: board texture and stack depth need a separately solved tree,
 * and rather than hiding those axes the screen must show them with the reason. Test #5 is B6's rare
 * runtime fallback to a worked example, and it also checks S2 — the fallback is a substitution, not
 * a cut, so a repair is on screen either way.
 *
 * Sync rule: never sleep. The screen root publishes data-concept-id / data-axis / data-kind /
 * data-queue-length on every paint, and those are the only sync points used here.
 */

const repairTab = '[data-testid="tab-repair"]';
const playTab = '[data-testid="tab-play"]';
const repairScreen = '[data-testid="repair-screen"]';
const repairRow = '[data-testid="repair-row"]';
const repairTrigger = '[data-testid="repair-trigger"]';
const axisOffer = '[data-testid="axis-offer"]';
const axisReason = '[data-testid="axis-reason"]';
const contrastSet = '[data-testid="contrast-set"]';
const contrastSpot = '[data-testid="contrast-spot"]';
const contrastToggled = '[data-testid="contrast-toggled"]';
const contrastClaim = '[data-testid="contrast-claim"]';
const workedExample = '[data-testid="worked-example"]';
const workedStep = '[data-testid="worked-step"]';
const fallbackReason = '[data-testid="fallback-reason"]';
const repairDays = '[data-testid="repair-days"]';

const STATE_FILE = 'offsuit-state.json';
const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

/** The concept whose only manifested axes need a solver this build does not have. */
const FALLBACK_CONCEPT = 'flop-cbet-size-by-texture';

interface FixtureGrade {
  severity: string;
  principle: string;
  evLossBb: number;
}

/** Mirrors core/session.ts serialize() — what the app itself writes to disk. */
function seedSave(grades: FixtureGrade[][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-repair-'));
  const leaks: Record<string, number> = {};
  const leakCostBb: Record<string, number> = {};
  for (const hand of grades) {
    for (const grade of hand) {
      leaks[grade.principle] = (leaks[grade.principle] ?? 0) + 1;
      leakCostBb[grade.principle] = (leakCostBb[grade.principle] ?? 0) + grade.evLossBb;
    }
  }
  fs.writeFileSync(
    path.join(dir, STATE_FILE),
    JSON.stringify(
      {
        bankroll: 10000,
        hands: grades.map((hand, index) => ({
          handNumber: index + 1,
          hole: ['Ah', 'Kd'],
          board: [],
          net: -100,
          vpip: true,
          pfr: false,
          grades: hand,
        })),
        rebuys: 0,
        stats: {
          handsPlayed: grades.length,
          vpipHands: grades.length,
          pfrHands: 0,
          evLossBb: 0,
          leaks,
          leakCostBb,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
  return dir;
}

async function withApp(
  opts: { userDataDir?: string } = {},
  body: (ctx: { app: ElectronApplication; page: Page; errors: string[] }) => Promise<void>,
): Promise<void> {
  const { app, page, close } = await launchApp({ seed: 42, userDataDir: opts.userDataDir });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await body({ app, page, errors });
  } finally {
    await close().catch(() => {});
  }
}

/** Open the Repair tab and block until the queue view has published its first paint. */
async function openRepair(page: Page): Promise<void> {
  await page.locator(repairTab).click();
  await page.locator(repairScreen).waitFor();
  await expect(page.locator(repairScreen)).toHaveAttribute('data-view', 'queue');
  await expect(page.locator(repairScreen)).not.toHaveAttribute('data-queue-length', '0');
}

/** Open one repair from the queue, returning to the queue first if another one is open. */
async function openConcept(page: Page, conceptId: string): Promise<void> {
  if ((await page.locator(repairScreen).getAttribute('data-view')) !== 'queue') {
    await page.locator('[data-testid="repair-back"]').click();
    await expect(page.locator(repairScreen)).toHaveAttribute('data-view', 'queue');
  }
  await page.locator(`${repairRow}[data-concept-id="${conceptId}"]`).click();
  await expect(page.locator(repairScreen)).toHaveAttribute('data-concept-id', conceptId);
}

/** The queue's concept ids, in the order the screen ranked them. */
async function queuedConcepts(page: Page): Promise<string[]> {
  return page
    .locator(repairRow)
    .evaluateAll((els) =>
      els.map((el) => (el instanceof HTMLElement ? (el.dataset.conceptId ?? '') : '')),
    );
}

interface ReadSpot {
  role: string;
  differs: string;
  hamming: string;
  toggled: string;
  /** `axis=value` for every axis the set holds fixed, in DOM order. */
  held: string[];
  hole: string[];
  board: string[];
}

/** Everything the assertions below need about the set on screen, in one round trip. */
async function readSet(page: Page): Promise<{ axis: string; spots: ReadSpot[]; claim: string }> {
  return page.evaluate(() => {
    const set = document.querySelector('[data-testid="contrast-set"]');
    if (!(set instanceof HTMLElement)) throw new Error('no contrast set on screen');
    const cardsIn = (root: Element, selector: string): string[] =>
      [...root.querySelectorAll<HTMLElement>(`${selector} [data-testid="card"]`)].map(
        (el) => el.dataset.card ?? '',
      );
    return {
      axis: set.dataset.axis ?? '',
      claim: document.querySelector('[data-testid="contrast-claim"]')?.textContent ?? '',
      spots: [...set.querySelectorAll<HTMLElement>('[data-testid="contrast-spot"]')].map((spot) => ({
        role: spot.dataset.role ?? '',
        differs: spot.dataset.differs ?? '',
        hamming: spot.dataset.hamming ?? '',
        toggled: spot.querySelector('[data-testid="contrast-toggled"]')?.textContent ?? '',
        held: [
          ...spot.querySelectorAll<HTMLElement>('[data-testid="contrast-held"] .contrast-held-cell'),
        ].map((cell) => `${cell.dataset.axis ?? ''}=${cell.dataset.value ?? ''}`),
        hole: cardsIn(spot, '[data-testid="contrast-hole"]'),
        board: cardsIn(spot, '[data-testid="contrast-board"]'),
      })),
    };
  });
}

/** Resize the real window AND pin the render viewport, exactly as layout.spec.ts documents. */
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

test.describe('contrast-set remediation', () => {
  test('1. the queue lists every manifested concept and none of it is locked (N1)', async () => {
    await withApp({}, async ({ page, errors }) => {
      await openRepair(page);

      const rows = page.locator(repairRow);
      // Asserted against the screen's own published count, not a hardcoded manifest length.
      expect(await rows.count()).toBe(
        Number(await page.locator(repairScreen).getAttribute('data-queue-length')),
      );
      expect(await rows.count()).toBeGreaterThan(1);

      const disabled = await rows.evaluateAll(
        (els) => els.filter((el) => el instanceof HTMLButtonElement && el.disabled).length,
      );
      expect(disabled, 'no repair may be locked — N1 locks nothing').toBe(0);

      const ids = await queuedConcepts(page);
      expect(new Set(ids).size, 'concept ids must be unique').toBe(ids.length);

      // With no T2 in the log nothing has fired, and every concept still says what it repairs.
      const fired = await rows.evaluateAll((els) =>
        els.map((el) => (el instanceof HTMLElement ? el.dataset.fired : '')),
      );
      expect(new Set(fired)).toEqual(new Set(['false']));
      await expect(page.locator(repairTrigger).first()).toContainText('Not fired yet');
      expect(errors).toEqual([]);
    });
  });

  test('2. EXACTLY ONE dimension differs, on every axis the screen can offer', async () => {
    await withApp({}, async ({ page, errors }) => {
      await openRepair(page);

      const concepts = await queuedConcepts(page);

      let setsChecked = 0;
      const axesSeen = new Set<string>();

      for (const conceptId of concepts) {
        await openConcept(page, conceptId);

        // Only axes the generator could actually build are offered as controls.
        const offers = await page.locator(axisOffer).evaluateAll((els) =>
          els.map((el) => ({
            axis: el instanceof HTMLElement ? (el.dataset.axis ?? '') : '',
            available: el instanceof HTMLElement ? el.dataset.available : '',
            spots: el instanceof HTMLElement ? Number(el.dataset.spots) : NaN,
          })),
        );
        expect(offers.length, `${conceptId} offers no axis at all`).toBeGreaterThan(0);

        for (const offer of offers.filter((o) => o.available === 'true')) {
          await page.locator(`${axisOffer}[data-axis="${offer.axis}"]`).click();
          await expect(page.locator(repairScreen)).toHaveAttribute('data-axis', offer.axis);

          const set = await readSet(page);
          setsChecked += 1;
          /*
           * The manifest is the source of truth for this base's pot, so the test does not restate a
           * number — it reads the same declaration the screen was built from. contrast.ts turns it
           * into chips (`state.pot = potBb * bb`); the card has to turn it back.
           */
          const entry = manifestEntry(conceptId);
          expect(entry, `${conceptId} is on screen but not in the manifest`).toBeDefined();
          /*
           * POSTFLOP ONLY, and the reason is a distinction I got wrong first and the test caught: on a
           * postflop base contrast.ts seeds the pot directly (`state.pot = potBb * bb`), so the card
           * must print potBb back. PREFLOP it takes the other branch and the pot is built by the
           * posted blinds — sb-squeeze declares potBb: 0 and correctly shows 1.5 bb, meaning "no extra
           * pot is seeded" rather than "the pot is empty". Asserting potBb there would have demanded
           * the screen print a wrong number.
           */
          const expectedPotBb =
            entry !== undefined && entry.base.street !== 'preflop' ? entry.base.potBb : null;
          axesSeen.add(set.axis);
          const where = `${conceptId} / ${set.axis}`;

          expect(set.axis, where).toBe(offer.axis);
          // The set is the size the offer claimed: no padding, no silent truncation.
          expect(set.spots.length, `${where}: spot count`).toBe(offer.spots);
          expect(set.spots.length).toBeGreaterThanOrEqual(2);
          expect(set.spots[0].role).toBe('base');
          expect(set.claim.toLowerCase(), where).toContain('everything else is held');

          // (a) Core's own comparison: exactly this axis moved, Hamming distance exactly 1.
          for (const spot of set.spots.slice(1)) {
            expect(spot.differs, `${where}: differs`).toBe(set.axis);
            expect(spot.hamming, `${where}: hamming`).toBe('1');
            expect(spot.role).toBe('variant');
            // The moved dimension is named on screen, with both of its values.
            expect(spot.toggled.length, `${where}: toggled line`).toBeGreaterThan(0);
            expect(spot.toggled, `${where}: the toggle must show a transition`).toContain('→');
          }
          // The base is labelled as the baseline rather than as a variant of itself.
          expect(set.spots[0].differs).toBe('');
          expect(set.spots[0].hamming).toBe('0');
          expect(set.spots[0].toggled).toContain('baseline');

          // (b) Independent of core's comparison: the six held values are identical everywhere.
          const held = set.spots.map((spot) => spot.held.join('|'));
          expect(new Set(held).size, `${where}: a held axis moved — ${held.join(' vs ')}`).toBe(1);
          // ...and the toggled axis is NOT among the ones printed as held.
          for (const spot of set.spots) {
            expect(spot.held.some((cell) => cell.startsWith(`${set.axis}=`)), where).toBe(false);
            // All seven axes accounted for: six held plus the one toggled.
            expect(spot.held.length, `${where}: held axes`).toBe(6);
          }

          // Something visible actually changed: two spots must not be the same cards in the same
          // seat. A set of identical positions teaches no boundary (contrast.ts's own argument).
          const rendered = set.spots.map((spot) => `${spot.hole.join('')}#${spot.board.join('')}`);
          if (set.axis === 'suitedness' || set.axis === 'kickerGap') {
            expect(new Set(rendered).size, `${where}: hole cards must differ`).toBe(
              set.spots.length,
            );
          } else {
            // position / playersBehind move the seating, not the cards, so the cards must be equal.
            expect(new Set(rendered).size, `${where}: cards must be held`).toBe(1);
          }
          /*
           * Every spot in the set is dealable and hero can act in it, straight off the engine — AND
           * every number on the line is checked, not just the actions clause.
           *
           * The pot is the one figure this screen computes itself (chips / bb; the file's own header
           * admits it is the only local arithmetic), and it was the only unverified one: mutating it
           * to `chips * bb` made the card read "Pot 24 bb" for a 6 bb pot and passed all 7 tests. The
           * stack depth and villain list are read back too, because a screen that silently drops an
           * opponent contradicts the playersBehind cell printed inches away on the same card.
           */
          const facts = await page.locator('[data-testid="contrast-facts"]').allTextContents();
          expect(facts.length).toBe(set.spots.length);
          for (const [index, line] of facts.entries()) {
            expect(line, `${where} spot ${index}`).toMatch(/you can [a-z]/);

            /*
             * THE POT, AGAINST THE MANIFEST'S OWN NUMBER. This is the only figure the screen computes
             * itself, and it must invert what core did: contrast.ts sets `state.pot = potBb * bb`, so
             * printing it back in big blinds has to return exactly the manifest's potBb.
             *
             * A bound-style assertion is not enough — I tried "positive and under 400" first and it
             * passed the very mutation it was written for, because `chips * bb` prints 24 for a 6 bb
             * pot at bb=2 and 24 is a perfectly plausible pot. Only the exact expected value separates
             * a correct division from any other arithmetic.
             */
            const pot = /Pot ([\d.]+) bb/.exec(line);
            expect(pot, `${where} spot ${index}: no pot figure on the facts line`).not.toBeNull();
            if (expectedPotBb !== null) {
              expect(
                Number(pot?.[1]),
                `${where} spot ${index}: the card prints ${pot?.[1]} bb for a ${expectedPotBb} bb pot`,
              ).toBeCloseTo(expectedPotBb, 4);
            } else {
              // Preflop: the pot is whatever the blinds posted, so what is checkable is that it is a
              // real positive figure in blinds rather than raw chips.
              expect(
                Number(pot?.[1]),
                `${where} spot ${index}: preflop pot ${pot?.[1]} is not a positive bb figure`,
              ).toBeGreaterThan(0);
              expect(
                Number(pot?.[1]),
                `${where} spot ${index}: preflop pot ${pot?.[1]} bb is too large to be blinds`,
              ).toBeLessThanOrEqual(10);
            }

            // Depth agrees with the stackDepth the same card publishes as a held axis.
            const depth = /(\d+) bb deep/.exec(line);
            expect(depth, `${where} spot ${index}: no stack depth`).not.toBeNull();
            const depthBb = Number(depth?.[1]);
            const band = set.spots[index].held.find((cell) => cell.startsWith('stackDepth='));
            if (band !== undefined) {
              const expected = depthBb <= 70 ? 'bb40' : depthBb <= 150 ? 'bb100' : 'bb200';
              expect(
                band,
                `${where} spot ${index}: ${depthBb} bb deep but the held cell says ${band}`,
              ).toBe(`stackDepth=${expected}`);
            }

            /*
             * EVERY OPPONENT, not just the first. Truncating the list to one silently drops a villain
             * on the multiway bases — turn-probe and sb-squeeze both seat CO and BTN — which
             * contradicts the playersBehind value the same card publishes as a held axis. Counting is
             * what catches it: a "names at least one" check passed the truncation.
             *
             * The expected count comes from the manifest for the axes that hold seating fixed. On
             * `position` and `playersBehind` the seating is the thing being varied, so the variants
             * legitimately differ from the base and only the base is pinned.
             */
            const villains = /vs ([^·]+)/.exec(line);
            expect(villains, `${where} spot ${index}: no villain named`).not.toBeNull();
            const named = (villains?.[1] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
            const seatingIsVaried = set.axis === 'position' || set.axis === 'playersBehind';
            const expectedVillains = entry?.base.villainPositions.length ?? 0;
            if (!seatingIsVaried || index === 0) {
              expect(
                named,
                `${where} spot ${index}: the card names ${named.length} opponent(s) for a spot seating ${expectedVillains}`,
              ).toEqual([...(entry?.base.villainPositions ?? [])]);
            } else {
              expect(
                named.length,
                `${where} spot ${index}: "vs ${villains?.[1]}" names no opponent`,
              ).toBeGreaterThan(0);
            }
          }
        }
      }

      // A vacuous pass over one axis of one concept would prove nothing about B6.
      expect(setsChecked, 'sets checked').toBeGreaterThan(8);
      expect(
        [...axesSeen].sort(),
        'the suite must exercise several different toggled dimensions',
      ).toEqual(['kickerGap', 'playersBehind', 'position', 'suitedness']);
      expect(errors).toEqual([]);
    });
  });

  test('3. a T2 leak in the log fires its repair and it sorts to the front (the T2 row)', async () => {
    // 'notable' is the T2 band in this build (0.5–2.0 bb): end-of-block correction, not an interrupt.
    const dir = seedSave([
      [
        { severity: 'free', principle: 'pot odds', evLossBb: 0.1 },
        { severity: 'notable', principle: 'pot odds', evLossBb: 0.6 },
      ],
      [
        { severity: 'notable', principle: 'value or bluff', evLossBb: 1.8 },
        { severity: 'serious', principle: 'ranges', evLossBb: 9 },
      ],
    ]);

    await withApp({ userDataDir: dir }, async ({ page, errors }) => {
      await openRepair(page);

      const rows = await page.locator(repairRow).evaluateAll((els) =>
        els.map((el) => ({
          conceptId: el instanceof HTMLElement ? (el.dataset.conceptId ?? '') : '',
          fired: el instanceof HTMLElement ? el.dataset.fired : '',
          trigger: el.querySelector('[data-testid="repair-trigger"]')?.textContent ?? '',
        })),
      );

      const fired = rows.filter((row) => row.fired === 'true');
      expect(fired.length, 'the seeded T2 leaks must fire repairs').toBeGreaterThan(0);
      // Fired repairs come first, worst leak first: 1.8 bb ahead of 0.6 bb.
      expect(rows.slice(0, fired.length).every((row) => row.fired === 'true')).toBe(true);
      expect(fired[0].trigger).toContain('1.8 bb');
      expect(fired[0].trigger).toContain('value or bluff');

      // A T3 'serious' grade is an interrupt band, not this one: it must not be reported as a T2 cost.
      const rangesTrigger = rows.find((row) => row.trigger.includes('ranges'))?.trigger ?? '';
      expect(rangesTrigger, 'a serious (T3) grade must not fire the end-of-block repair').toContain(
        'Not fired yet',
      );

      // And the repair enters the spacing queue rather than being shown once and forgotten.
      await openConcept(page, fired[0].conceptId);
      await expect(page.locator(repairDays)).toHaveAttribute('data-days', '2,9,23');
      await expect(page.locator(repairDays)).toContainText('day 2, day 9, day 23');
      expect(errors).toEqual([]);
    });
  });

  test('4. an axis that needs a solver this build lacks is REPORTED, not hidden (B6)', async () => {
    await withApp({}, async ({ page, errors }) => {
      await openRepair(page);
      await openConcept(page, FALLBACK_CONCEPT);

      const offers = await page.locator(axisOffer).evaluateAll((els) =>
        els.map((el) => ({
          axis: el instanceof HTMLElement ? (el.dataset.axis ?? '') : '',
          available: el instanceof HTMLElement ? el.dataset.available : '',
          spots: el instanceof HTMLElement ? el.dataset.spots : '',
          reason: el.querySelector('[data-testid="axis-reason"]')?.textContent ?? '',
          isButton: el.tagName.toLowerCase(),
        })),
      );

      // The axes this concept was manifested for are on screen, both of them unavailable.
      expect(offers.map((o) => o.axis)).toEqual(['boardTexture', 'stackDepth']);
      for (const offer of offers) {
        expect(offer.available, offer.axis).toBe('false');
        expect(offer.spots).toBe('0');
        // The reason is stated in full — "unavailable" with no reason reads as a bug.
        expect(offer.reason.length, `${offer.axis} reason`).toBeGreaterThan(20);
        expect(offer.reason, offer.axis).toContain('solver');
        // Not a control: a disabled button reads as something withheld, and nothing is withheld.
        expect(offer.isButton, `${offer.axis} must not render as a button`).not.toBe('button');
      }
      await expect(page.locator(axisReason)).toHaveCount(2);

      // On a concept whose sets DO build, an axis that cannot pair off this base is still named.
      await openConcept(page, 'btn-srp-cbet');
      const pinned = page.locator(`${axisOffer}[data-axis="playersBehind"]`);
      await expect(pinned).toHaveCount(1);
      await expect(pinned).toHaveAttribute('data-available', 'false');
      await expect(pinned.locator(axisReason)).toContainText('playersBehind');
      // And the concept still remediates on the axes that do exist.
      await expect(page.locator(contrastSet)).toHaveCount(1);
      expect(errors).toEqual([]);
    });
  });

  test('5. no buildable axis falls back to a worked example, and never to nothing (S2)', async () => {
    await withApp({}, async ({ page, errors }) => {
      await openRepair(page);

      // First: the common case is a set, not a fallback. B6 says the fallback is the RARE one.
      const kinds: string[] = [];
      const concepts = await queuedConcepts(page);
      for (const conceptId of concepts) {
        await openConcept(page, conceptId);
        kinds.push((await page.locator(repairScreen).getAttribute('data-kind')) ?? '');
        // S2's floor: a repair is on screen either way — a set or a worked example, never neither.
        const repairs =
          (await page.locator(contrastSet).count()) + (await page.locator(workedExample).count());
        expect(repairs, `${conceptId} shows no repair at all`).toBe(1);
      }
      expect(kinds.filter((kind) => kind === 'worked-example').length).toBe(1);
      expect(kinds.filter((kind) => kind === 'contrast-sets').length).toBeGreaterThan(
        kinds.filter((kind) => kind === 'worked-example').length,
      );

      // Now the fallback itself.
      await openConcept(page, FALLBACK_CONCEPT);
      await expect(page.locator(repairScreen)).toHaveAttribute('data-kind', 'worked-example');
      await expect(page.locator(contrastSet)).toHaveCount(0);
      await expect(page.locator(contrastSpot)).toHaveCount(0);
      await expect(page.locator(workedExample)).toHaveCount(1);
      // G6's three chunks, ending in a next action.
      await expect(page.locator(workedStep)).toHaveCount(3);
      await expect(page.locator(workedStep).last()).toContainText('Next:');

      // Attributable: the reason names every axis that was tried and why each failed.
      const reason = (await page.locator(fallbackReason).textContent()) ?? '';
      expect(reason).toContain('boardTexture');
      expect(reason).toContain('stackDepth');
      expect(reason).toContain('solver');
      await expect(page.locator('[data-testid="remediation-floor"]')).toContainText(
        'never dropped',
      );
      // The fallback is still queued for spaced repair — it is a substitution, not a cut.
      await expect(page.locator(repairDays)).toHaveAttribute('data-days', '2,9,23');
      expect(errors).toEqual([]);
    });
  });

  test('6. switching concept and axis keeps the screen consistent, and leaves no listener behind', async () => {
    await withApp({}, async ({ page, errors }) => {
      await openRepair(page);
      await openConcept(page, 'bb-defence-vs-cbet');

      // Choosing an axis paints that axis; choosing another repaints, with one set on screen.
      for (const axis of ['suitedness', 'kickerGap', 'position']) {
        const offer = page.locator(`${axisOffer}[data-axis="${axis}"][data-available="true"]`);
        if ((await offer.count()) === 0) continue;
        await offer.click();
        await expect(page.locator(repairScreen)).toHaveAttribute('data-axis', axis);
        await expect(page.locator(contrastSet)).toHaveCount(1);
        await expect(page.locator(contrastSet)).toHaveAttribute('data-axis', axis);
        await expect(page.locator(`${axisOffer}[data-selected="true"]`)).toHaveCount(1);
        // The toggled line must be one per spot, always naming the current axis.
        const toggled = await page.locator(contrastToggled).evaluateAll((els) =>
          els.map((el) => (el instanceof HTMLElement ? el.dataset.axis : '')),
        );
        expect(new Set(toggled)).toEqual(new Set([axis]));
      }

      // A concept switch drops the previous axis pick rather than carrying it onto another base.
      await openConcept(page, FALLBACK_CONCEPT);
      expect(await page.locator(repairScreen).getAttribute('data-axis')).toBeNull();
      await openConcept(page, 'bb-defence-vs-cbet');
      await expect(page.locator(contrastSet)).toHaveCount(1);

      // Back to the queue, which still holds every repair and forgets nothing.
      await page.locator('[data-testid="repair-back"]').click();
      await expect(page.locator(repairScreen)).toHaveAttribute('data-view', 'queue');
      await expect(page.locator(contrastSet)).toHaveCount(0);
      expect(await page.locator(repairRow).count()).toBe(
        Number(await page.locator(repairScreen).getAttribute('data-queue-length')),
      );

      // Leaving the tab tears the screen down; the table's keys must still reach the table.
      await page.locator(playTab).click();
      await expect(page.locator(repairScreen)).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-testid="home-screen"]')).toBeVisible();
      expect(errors).toEqual([]);
    });
  });

  test('7. the screen fits both documented window sizes, then screenshots', async () => {
    await withApp({}, async ({ app, page, errors }) => {
      for (const [width, height] of [
        [DEFAULT_WIDTH, DEFAULT_HEIGHT],
        [MIN_WIDTH, MIN_HEIGHT],
      ]) {
        await useViewport(app, page, width, height);
        await openRepair(page);
        await openConcept(page, 'river-bluff-catch');
        await expect(page.locator(contrastSet)).toHaveCount(1);

        // MEASURE BEFORE SCREENSHOTTING: page.screenshot() drops the device-metrics override and
        // the viewport snaps back to whatever the host window manager wants.
        const geometry = await page.evaluate(() => {
          const rect = (
            id: string,
          ): { top: number; bottom: number; left: number; right: number } | null => {
            const el = document.querySelector(`[data-testid="${id}"]`);
            if (el === null) return null;
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
          };
          const column = document.querySelector('[data-testid="repair-screen"]');
          return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            docScrollHeight: document.documentElement.scrollHeight,
            tabBar: rect('tab-repair'),
            title: rect('repair-concept-title'),
            offers: rect('axis-offers'),
            columnScrolls:
              column instanceof HTMLElement ? column.scrollHeight > column.clientHeight : false,
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
          offers: geometry.offers,
        })) {
          expect(box, `${name} missing at ${width}x${height}`).not.toBeNull();
          if (box === null) continue;
          expect(box.top, `${name} above the viewport`).toBeGreaterThanOrEqual(0);
          expect(box.left, `${name} left of the viewport`).toBeGreaterThanOrEqual(0);
          expect(box.bottom, `${name} below the fold at ${width}x${height}`).toBeLessThanOrEqual(
            height,
          );
          expect(box.right, `${name} past the right edge`).toBeLessThanOrEqual(width);
        }

        await shot(page, `repair-set-${width}x${height}`);

        await useViewport(app, page, width, height);
        await openConcept(page, FALLBACK_CONCEPT);
        await expect(page.locator(workedExample)).toHaveCount(1);
        await shot(page, `repair-worked-example-${width}x${height}`);
      }
      expect(errors).toEqual([]);
    });
  });
});
