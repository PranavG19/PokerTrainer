import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertNoNetwork, launchApp, sel, shot, goTo } from './helpers.js';
import { playToShowdown, tableScreen, waitForIdle } from './flow.js';
import { buildStrategyRequest } from '../../src/main/tutor/requests.js';
import { promptHash } from '../../src/main/tutor/replayCache.js';
import { BACKUP_DEPTH, DELETE_CONFIRM_PHRASE, backupPath } from '../../src/core/backup.js';
import { systemDayKeyOf } from '../../src/core/localDay.js';
import type { GradePayload, VisibleTable } from '../../src/main/tutor/types.js';

const STATE_FILE = 'offsuit-state.json';
const SETTINGS_FILE = 'offsuit-settings.json';

const homeScreen = '[data-testid="home-screen"]';
const settingsScreen = '[data-testid="settings-screen"]';
const tabSettings = '[data-testid="tab-settings"]';

const DEFAULT_WIDTH = 1100;
const DEFAULT_HEIGHT = 760;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 640;

const TABLE: VisibleTable = {
  positions: ['BTN', 'BB'],
  stacksBb: [97, 88],
  potBb: 11,
  board: ['Kh', 'Td', '4c'],
  heroCards: ['Ah', 'Qs'],
  toAct: 'BTN',
  street: 'flop',
};

const GRADE: GradePayload = {
  tier: 'T3',
  deltaEvBb: 1.73,
  errorTag: 'TEXTURE',
  potBeforeActionBb: 11,
  chosenAction: 'check',
  bestAction: 'bet',
  actionEvsBb: { check: 3.41, bet: 5.14 },
  equityPct: 63,
  principle: 'Nut advantage sets the size',
  boundaryHand: 'AJo',
  flippingVariable: 'one seat of position',
  classRwBbPer100: 2.87,
};

/**
 * Trips four of the guard's checks at once (leading pronoun, you-are,
 * you-habitually, and the numeral 99 which is in no payload), so the diagnostics
 * assertion does not depend on which single rule fires first.
 */
const GUARD_VIOLATING_COMPLETION = 'You are always folding 99 percent of these flops.';

interface StatusView {
  tutorId: string;
  credentialsConfigured: boolean;
  egressAllowlist: string[];
  guardFailures: number;
}

interface SettingsView {
  tutorEnabled: boolean;
  tutorId: string;
  credentialsConfigured: boolean;
  egressAllowlist: string[];
  guardFailures: { requestKind: string; attempt: number; violations: unknown[] }[];
  profile: { path: string; backupCount: number; lastRecovery: string };
  deleteConfirmPhrase: string;
}

interface Bridge {
  tutorStatus(): Promise<StatusView>;
  askTutor(input: unknown): Promise<{ text: string | null; verdict: string }>;
  readSettings(): Promise<SettingsView>;
  deleteProfile(confirmation: string): Promise<{ deleted: boolean; refusedBecause?: string }>;
}

function freshUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-settings-'));
}

function statePath(userDataDir: string): string {
  return path.join(userDataDir, STATE_FILE);
}

/** Go through the contextBridge, so what is asserted is the shipped preload → IPC → main path. */
function readSettingsOverIpc(page: Page): Promise<SettingsView> {
  return page.evaluate(() => (window as unknown as { offsuit: Bridge }).offsuit.readSettings());
}

function tutorStatus(page: Page): Promise<StatusView> {
  return page.evaluate(() => (window as unknown as { offsuit: Bridge }).offsuit.tutorStatus());
}

function ask(page: Page, input: unknown): Promise<{ text: string | null; verdict: string }> {
  return page.evaluate(
    (payload) => (window as unknown as { offsuit: Bridge }).offsuit.askTutor(payload),
    input,
  );
}

function deleteOverIpc(
  page: Page,
  confirmation: string,
): Promise<{ deleted: boolean; refusedBecause?: string }> {
  return page.evaluate(
    (phrase) => (window as unknown as { offsuit: Bridge }).offsuit.deleteProfile(phrase),
    confirmation,
  );
}

async function openSettings(page: Page): Promise<void> {
  await page.click(tabSettings);
  await page.waitForSelector(settingsScreen);
}

/** The toggle click plus its settled state — never a sleep; the attribute is the oracle. */
async function clickToggleOff(page: Page): Promise<void> {
  await page.click('[data-testid="tutor-toggle"]');
  await expect(page.locator('[data-testid="tutor-toggle"]')).toHaveAttribute(
    'data-enabled',
    'false',
  );
}

function seedState(userDataDir: string, state: Record<string, unknown>): void {
  fs.writeFileSync(statePath(userDataDir), JSON.stringify(state), 'utf-8');
}

function profileFixture(bankroll: number, handsPlayed: number): Record<string, unknown> {
  return {
    bankroll,
    hands: Array.from({ length: handsPlayed }, (_, i) => ({
      handNumber: i + 1,
      hole: ['Ah', 'Kd'],
      board: [],
      net: 0,
      vpip: false,
      pfr: false,
      grades: [],
    })),
    rebuys: 0,
    stats: {
      handsPlayed,
      vpipHands: 0,
      pfrHands: 0,
      evLossBb: 0,
      leaks: {},
      leakCostBb: {},
    },
    calibration: { total: 0, correct: 0, sureWrong: 0 },
    coachedMode: false,
  };
}

/**
 * Bedrock settings that make resolveTutor report credentials as configured
 * without any of them being reachable. Paired with a pre-seeded replay cache the
 * live path never opens a socket: the cached completion satisfies the client, so
 * the guard runs on real text and records a real failure.
 */
function credentialEnv(replayDir: string): Record<string, string> {
  return {
    OFFSUIT_BEDROCK_PROFILE: 'offsuit-e2e-not-a-real-profile',
    OFFSUIT_BEDROCK_REGION: 'us-west-2',
    OFFSUIT_BEDROCK_MODEL: 'offsuit-e2e-not-a-real-model',
    OFFSUIT_REPLAY_MODE: 'replay',
    OFFSUIT_REPLAY_DIR: replayDir,
  };
}

/**
 * Seed the replay cache with a completion the guard must reject, keyed by the
 * hash of the envelope the app will actually build for this ask.
 */
function seedReplay(completion: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-replay-'));
  const built = buildStrategyRequest(
    { prompt: 'explain the miss', table: TABLE, grade: GRADE, lexicon: [] },
    'correction',
  );
  fs.writeFileSync(
    path.join(dir, `${promptHash(built.envelope)}.json`),
    JSON.stringify({ prompt: built.envelope, completion }),
    'utf-8',
  );
  return dir;
}

/**
 * launchApp forwards process.env, so credentials are injected by setting them for
 * the duration of one launch. Restored in a finally so no later test inherits a
 * configured tutor — that would silently invert the T1 assertions in tutor.spec.
 */
async function withEnv<T>(
  vars: Record<string, string>,
  body: () => Promise<T>,
): Promise<T> {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  try {
    return await body();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Resize the real window, then pin the render viewport to the same numbers.
 * Technique lifted from layout.spec.ts: setSize() alone is cosmetic under a
 * tiling window manager, and the device-metrics override makes the measurement
 * describe the size SPEC.md documents regardless of the host WM.
 */
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
  expect(applied, `setSize(${width}, ${height}) was rejected by Electron`).toEqual([width, height]);

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

test.describe('story 45 — no credentials: the screen says so and the allowlist renders empty', () => {
  test('the tutor reads as off, the allowlist is empty, and both come from the resolved tutor', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);

      // What main resolved, and what the screen renders, must be the same thing.
      const resolved = await readSettingsOverIpc(page);
      expect(resolved.credentialsConfigured).toBe(false);
      expect(resolved.egressAllowlist).toEqual([]);
      expect(resolved.tutorId).toBe('null');

      await expect(page.locator(settingsScreen)).toHaveAttribute('data-tutor-live', 'false');
      await expect(page.locator('[data-testid="tutor-state"]')).toHaveText('The tutor is off');
      await expect(page.locator('[data-testid="tutor-state-detail"]')).toContainText(
        'No credentials are configured',
      );

      // The allowlist renders as empty rather than as an absent section, and no
      // host row exists at all.
      const allowlist = page.locator('[data-testid="egress-allowlist"]');
      await expect(allowlist).toHaveAttribute('data-count', '0');
      await expect(page.locator('[data-testid="egress-host"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="egress-empty"]')).toBeVisible();

      // Story 44: "off" must not read as "broken".
      await expect(page.locator('[data-testid="tutor-fallback-note"]')).toContainText(
        'works either way',
      );
    } finally {
      await close();
    }
  });

  test('the rendered host list is the resolved allowlist, not renderer copy', async () => {
    const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
    await withEnv(credentialEnv(replayDir), async () => {
      const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
      try {
        await page.waitForSelector(homeScreen);
        await openSettings(page);

        const resolved = await readSettingsOverIpc(page);
        expect(resolved.credentialsConfigured).toBe(true);
        // Exactly one host, derived from the configured region by the tutor module.
        expect(resolved.egressAllowlist).toEqual(['bedrock-runtime.us-west-2.amazonaws.com']);

        // The DOM shows precisely that list — same length, same strings.
        const rendered = await page
          .locator('[data-testid="egress-host"]')
          .allInnerTexts();
        expect(rendered.map((t) => t.trim())).toEqual(resolved.egressAllowlist);
        await expect(page.locator('[data-testid="egress-allowlist"]')).toHaveAttribute(
          'data-count',
          '1',
        );
        await expect(page.locator('[data-testid="tutor-state"]')).toHaveText('The tutor is live');
      } finally {
        await close();
      }
    });
  });
});

test.describe('what is sent and what is never sent', () => {
  test('both statements render every item the Security section lists', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);

      const sent = (await page.locator('[data-testid="sent-item"]').allInnerTexts()).join(' ');
      for (const item of ['hole cards', 'board', 'action', 'stack', 'pot', 'sure', 'reason', 'lexicon']) {
        expect(sent.toLowerCase(), `"what is sent" omits ${item}`).toContain(item);
      }
      // Bounded to ONE node.
      await expect(page.locator('[data-testid="sent-bound"]')).toContainText('One decision per request');

      const never = (await page.locator('[data-testid="never-sent-item"]').allInnerTexts()).join(' ');
      for (const item of ['decision log', 'session history', 'profile file', 'credentials', 'drill']) {
        expect(never.toLowerCase(), `"what is never sent" omits ${item}`).toContain(item);
      }
      expect(never.toLowerCase()).toContain('assessment');
    } finally {
      await close();
    }
  });
});

test.describe('story 45 — the off switch', () => {
  test('turning the tutor off empties the allowlist and swaps in the null tutor', async () => {
    const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
    await withEnv(credentialEnv(replayDir), async () => {
      const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
      try {
        await page.waitForSelector(homeScreen);
        await openSettings(page);
        expect((await readSettingsOverIpc(page)).egressAllowlist).toHaveLength(1);

        await page.click('[data-testid="tutor-toggle"]');
        await expect(page.locator('[data-testid="tutor-toggle"]')).toHaveAttribute(
          'data-enabled',
          'false',
        );

        const off = await readSettingsOverIpc(page);
        expect(off.tutorEnabled).toBe(false);
        // The credentials are still there — the switch, not their absence, is what
        // closed the egress. That is the property story 45 asks for.
        expect(off.credentialsConfigured).toBe(true);
        expect(off.egressAllowlist).toEqual([]);
        expect(off.tutorId).toBe('null');

        // And the ask path itself now resolves to the null tutor, so there is no
        // client left to leak through.
        expect((await tutorStatus(page)).tutorId).toBe('null');
        await expect(page.locator(settingsScreen)).toHaveAttribute('data-tutor-live', 'false');
        await expect(page.locator('[data-testid="egress-empty"]')).toBeVisible();
      } finally {
        await close();
      }
    });
  });

  test('the switch survives a restart', async () => {
    const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
    const userDataDir = freshUserDataDir();
    await withEnv(credentialEnv(replayDir), async () => {
      const first = await launchApp({ seed: 42, userDataDir });
      try {
        await first.page.waitForSelector(homeScreen);
        await openSettings(first.page);
        await clickToggleOff(first.page);
      } finally {
        await first.close();
      }
      expect(fs.existsSync(path.join(userDataDir, SETTINGS_FILE))).toBe(true);

      const second = await launchApp({ seed: 42, userDataDir });
      try {
        await second.page.waitForSelector(homeScreen);
        const restored = await readSettingsOverIpc(second.page);
        expect(restored.tutorEnabled).toBe(false);
        expect(restored.egressAllowlist).toEqual([]);
      } finally {
        await second.close();
      }
    });
  });

  /**
   * The zero-network assertion, using persistence.spec.ts's approach: install the
   * route interceptor, reload through it so an empty list proves silence rather
   * than a dead handler, then exercise the app.
   *
   * What this proves and what it does not: page routing sees requests made by the
   * renderer, and the reload plus the `file:` assertion shows the handler is live.
   * The main process's own egress is covered separately by the empty allowlist and
   * by the null tutor being what the ask path resolves to — a structural property
   * rather than an observed absence.
   */
  test('with the switch off, no non-file request is attempted anywhere in the app', async () => {
    const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
    await withEnv(credentialEnv(replayDir), async () => {
      const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
      try {
        await page.waitForSelector(homeScreen);
        await openSettings(page);
        await clickToggleOff(page);

        const attempted = await assertNoNetwork(page);
        const routed: string[] = [];
        page.on('request', (request) => routed.push(request.url()));
        const failedHttp: string[] = [];
        page.on('requestfailed', (request) => {
          if (/^https?:/.test(request.url())) failedHttp.push(request.url());
        });

        await page.reload();
        await page.waitForSelector(homeScreen);
        expect(routed.some((url) => url.startsWith('file:'))).toBe(true);

        // The switch is persisted, so it is still off after the reload — and the
        // ask path resolves to the null tutor, which is the structural half of the
        // claim. Asserted here because "no request was seen" alone would also pass
        // against a live tutor whose replay cache happened to answer offline.
        const afterReload = await readSettingsOverIpc(page);
        expect(afterReload.tutorEnabled).toBe(false);
        expect(afterReload.egressAllowlist).toEqual([]);
        expect((await tutorStatus(page)).tutorId).toBe('null');

        // Exercise every path that could plausibly reach out: a tutor ask in each
        // context that admits one, a full hand, and the settings screen itself.
        for (const context of ['spot-post-reveal', 'table-ungraded', 'dossier-progress'] as const) {
          const answer = await ask(page, {
            context,
            question: 'explain the miss',
            table: TABLE,
            grade: GRADE,
          });
          // Fixed text, not a model answer — and never the seeded violating string.
          expect(answer.text).not.toBe(null);
          expect(answer.text).not.toContain('99');
        }

        await page.click(sel.newHand);
        await page.waitForSelector(tableScreen);
        await playToShowdown(page);
        await openSettings(page);

        expect(attempted, 'a non-file request was attempted with the tutor off').toEqual([]);
        expect(failedHttp).toEqual([]);

        // The main process blocks anything non-file regardless of this app's code.
        const sentinel = await page.evaluate(() =>
          fetch('http://example.com/offsuit-settings-sentinel')
            .then((response) => `reached ${response.status}`)
            .catch(() => 'blocked'),
        );
        expect(sentinel).toBe('blocked');
        expect(attempted.filter((url) => /^https?:/.test(url))).toEqual([]);
      } finally {
        await close();
      }
    });
  });
});

test.describe('T4 — guard diagnostics are visible in settings', () => {
  test('a real guard failure renders with its count and what failed', async () => {
    const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
    await withEnv(credentialEnv(replayDir), async () => {
      const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
      try {
        await page.waitForSelector(homeScreen);
        await openSettings(page);
        await expect(page.locator('[data-testid="guard-failure-count"]')).toHaveAttribute(
          'data-count',
          '0',
        );
        await expect(page.locator('[data-testid="guard-empty"]')).toBeVisible();

        // Provoke it for real: the cached completion trips the guard, so the live
        // tutor rejects it, records the failure and falls back to fixed text.
        const answer = await ask(page, {
          context: 'spot-post-reveal',
          question: 'explain the miss',
          table: TABLE,
          grade: GRADE,
        });
        expect(answer.text).not.toBe(null);
        // The guard did its job: the rejected text never reached the learner.
        expect(answer.text).not.toContain('99');
        expect(answer.text).toContain('Nut advantage sets the size');

        await page.click(sel.tabPlay);
        await page.waitForSelector(homeScreen);
        await openSettings(page);

        const recorded = await readSettingsOverIpc(page);
        // One per attempt: T4 allows one regeneration before the fixed table.
        expect(recorded.guardFailures.length).toBeGreaterThan(0);

        const count = page.locator('[data-testid="guard-failure-count"]');
        await expect(count).toHaveAttribute('data-count', String(recorded.guardFailures.length));
        await expect(count).toHaveText(String(recorded.guardFailures.length));

        const failures = page.locator('[data-testid="guard-failure"]');
        expect(await failures.count()).toBeGreaterThan(0);
        await expect(failures.first()).toHaveAttribute('data-request-kind', 'strategy');

        // "with what failed" — the check name and its detail, not just a count.
        const why = (await page.locator('[data-testid="guard-failure-why"]').allInnerTexts()).join(' ');
        expect(why).toContain('leading-pronoun');
        expect(why).toMatch(/ban-list|number-provenance/);
      } finally {
        await close();
      }
    });
  });
});

test.describe('reversibility — the one hard delete', () => {
  test('the delete button is disabled until the exact phrase is typed', async () => {
    const userDataDir = freshUserDataDir();
    seedState(userDataDir, profileFixture(12345, 2));
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);

      const button = page.locator('[data-testid="delete-confirm-button"]');
      const input = page.locator('[data-testid="delete-confirm-input"]');
      await expect(button).toBeDisabled();

      for (const wrong of ['delete profile', 'DELETE', 'DELETE PROFILES', '']) {
        await input.fill(wrong);
        await expect(button, `"${wrong}" must not enable the delete`).toBeDisabled();
      }

      await input.fill(DELETE_CONFIRM_PHRASE);
      await expect(button).toBeEnabled();

      // The profile is still on disk: enabling a button is not performing a delete.
      expect(fs.existsSync(statePath(userDataDir))).toBe(true);
    } finally {
      await close();
    }
  });

  test('main refuses an unconfirmed delete even when the renderer asks for one', async () => {
    const userDataDir = freshUserDataDir();
    seedState(userDataDir, profileFixture(12345, 2));
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);

      // Bypass the UI entirely — the gate must not live in the renderer.
      for (const wrong of ['', 'delete profile', 'yes', 'DELETE PROFILE ']) {
        const outcome = await deleteOverIpc(page, wrong);
        expect(outcome.deleted, `main accepted "${wrong}"`).toBe(false);
        expect(outcome.refusedBecause).toBe('not-confirmed');
        expect(fs.existsSync(statePath(userDataDir))).toBe(true);
      }

      // The decision log is intact and still reaches the screen.
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);
      await expect(page.locator(sel.bankroll)).toHaveText('12345');
    } finally {
      await close();
    }
  });

  test('the confirmed delete removes the profile and every backup, and the app stays usable', async () => {
    const userDataDir = freshUserDataDir();
    seedState(userDataDir, profileFixture(12345, 2));
    for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
      fs.writeFileSync(
        backupPath(statePath(userDataDir), slot),
        JSON.stringify(profileFixture(999, 1)),
        'utf-8',
      );
    }

    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);
      await expect(page.locator('[data-testid="backup-count"]')).toHaveAttribute(
        'data-count',
        String(BACKUP_DEPTH),
      );

      await page.locator('[data-testid="delete-confirm-input"]').fill(DELETE_CONFIRM_PHRASE);
      await page.click('[data-testid="delete-confirm-button"]');

      await expect(page.locator('[data-testid="backup-count"]')).toHaveAttribute('data-count', '0');
      expect(fs.existsSync(statePath(userDataDir))).toBe(false);
      for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
        expect(
          fs.existsSync(backupPath(statePath(userDataDir), slot)),
          `backup ${slot} survived the delete`,
        ).toBe(false);
      }

      // N1: nothing is locked. The app is still playable straight after a delete.
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);
      await expect(page.locator(sel.bankroll)).toHaveText('10000');
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      await expect(page.locator(`${sel.heroCards} ${sel.card}`)).toHaveCount(2);
      await playToShowdown(page);
    } finally {
      await close();
    }
  });

  test('resetting a concept is stated as not a delete, so it needs no gate', async () => {
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);
      const copy = await page.innerText('[data-testid="reset-not-a-delete"]');
      expect(copy).toContain('not a delete');
      expect(copy.toLowerCase()).toContain('worked out again');
    } finally {
      await close();
    }
  });
});

test.describe('the rolling backup survives a corrupted profile', () => {
  /** Every corruption shape the store can meet on disk. */
  for (const [label, garbage] of [
    ['truncated json', '{"bankroll": 777'],
    ['an array', '[1,2,3]'],
    ['empty', ''],
  ] as const) {
    test(`a ${label} live profile is restored from backup 1, not silently reset`, async () => {
      const userDataDir = freshUserDataDir();
      const RESTORED_BANKROLL = 13579;
      fs.writeFileSync(statePath(userDataDir), garbage, 'utf-8');
      fs.writeFileSync(
        backupPath(statePath(userDataDir), 1),
        JSON.stringify(profileFixture(RESTORED_BANKROLL, 3)),
        'utf-8',
      );

      const { page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        await page.waitForSelector(homeScreen);

        // The recovered bankroll and the recovered hand log both reached the UI —
        // a silent reset would show 10000 and no hands.
        await expect(page.locator(sel.bankroll)).toHaveText(String(RESTORED_BANKROLL));
        await expect(page.locator('[data-testid="hand-row"]')).toHaveCount(3);

        await openSettings(page);
        const recovered = await readSettingsOverIpc(page);
        expect(recovered.profile.lastRecovery).toBe('backup-1');
        // "with an explicit warning rather than a silent reset".
        await expect(page.locator('[data-testid="recovery-notice"]')).toBeVisible();
      } finally {
        await close();
      }
    });
  }

  test('playing hands accumulates rolling backups, capped at three', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);

      for (let hand = 1; hand <= 5; hand++) {
        await playToShowdown(page);
        if (hand < 5) await page.click('[data-testid="next-hand"]');
      }
      // Each completed hand triggers a save, and each save after the first keeps a copy.
      await expect
        .poll(() => {
          let present = 0;
          for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
            if (fs.existsSync(backupPath(statePath(userDataDir), slot))) present++;
          }
          return present;
        })
        .toBe(BACKUP_DEPTH);

      // Never a fourth slot.
      expect(fs.existsSync(backupPath(statePath(userDataDir), BACKUP_DEPTH + 1))).toBe(false);
      // And every kept version is readable — the point of keeping them.
      for (let slot = 1; slot <= BACKUP_DEPTH; slot++) {
        const raw = fs.readFileSync(backupPath(statePath(userDataDir), slot), 'utf-8');
        expect(() => JSON.parse(raw) as unknown).not.toThrow();
      }

      await openSettings(page);
      await expect(page.locator('[data-testid="backup-count"]')).toHaveAttribute(
        'data-count',
        String(BACKUP_DEPTH),
      );
    } finally {
      await close();
    }
  });
});

test.describe('screenshots and layout', () => {
  for (const [width, height] of [
    [DEFAULT_WIDTH, DEFAULT_HEIGHT],
    [MIN_WIDTH, MIN_HEIGHT],
  ] as const) {
    test(`the settings screen fits and is reachable at ${width}x${height}`, async () => {
      const replayDir = seedReplay(GUARD_VIOLATING_COMPLETION);
      await withEnv(credentialEnv(replayDir), async () => {
        const userDataDir = freshUserDataDir();
        seedState(userDataDir, profileFixture(12345, 2));
        const { app, page, close } = await launchApp({ seed: 42, userDataDir });
        try {
          await page.waitForSelector(homeScreen);
          // A guard failure so the diagnostics section has real content in the shot.
          await ask(page, {
            context: 'spot-post-reveal',
            question: 'explain the miss',
            table: TABLE,
            grade: GRADE,
          });
          await useViewport(app, page, width, height);
          await openSettings(page);

          /*
           * MEASURE BEFORE SHOOTING. page.screenshot() clears the CDP device
           * metrics override, so the viewport snaps back to the host window
           * manager's size and any assertion after a shot describes a window
           * nobody configured. Every expect below runs first.
           */
          const geometry = await page.evaluate(() => {
            const ids = [
              'tutor-state',
              'tutor-toggle',
              'egress-allowlist',
              'sent-list',
              'never-sent-list',
              'guard-failure-count',
              'delete-confirm-input',
              'delete-confirm-button',
            ];
            const root = document.querySelector('[data-testid="settings-screen"]');
            return {
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              // The column scrolls itself; the document must not.
              documentScrollHeight: document.documentElement.scrollHeight,
              rootScrollHeight: root === null ? 0 : root.scrollHeight,
              present: ids.filter(
                (id) => document.querySelector(`[data-testid="${id}"]`) !== null,
              ),
              missing: ids.filter(
                (id) => document.querySelector(`[data-testid="${id}"]`) === null,
              ),
              // Everything must sit inside the column's horizontal bounds.
              overflowsRight: ids.filter((id) => {
                const el = document.querySelector(`[data-testid="${id}"]`);
                if (el === null) return false;
                return el.getBoundingClientRect().right > window.innerWidth;
              }),
            };
          });

          expect(geometry.innerWidth).toBe(width);
          expect(geometry.innerHeight).toBe(height);
          expect(geometry.missing, 'settings controls absent from the DOM').toEqual([]);
          expect(geometry.overflowsRight, 'settings content hangs past the right edge').toEqual([]);
          expect(
            geometry.documentScrollHeight,
            `the document itself scrolls: ${geometry.documentScrollHeight}px in ${height}px`,
          ).toBeLessThanOrEqual(height + 1);

          // Now, and only now, capture the image.
          await shot(page, `settings-${width}x${height}`);

          /*
           * The diagnostics and delete sections sit below the fold in the
           * scrolling column, so they need their own shot to be looked at. The
           * viewport must be re-pinned first: the shot above cleared the device
           * metrics override, and without this the second image would describe
           * the host window manager's size instead of `width`x`height`.
           */
          await useViewport(app, page, width, height);
          await page.locator('[data-testid="delete-confirm-button"]').scrollIntoViewIfNeeded();
          const bottom = await page.evaluate(() => {
            const button = document.querySelector('[data-testid="delete-confirm-button"]');
            const count = document.querySelector('[data-testid="guard-failure-count"]');
            return {
              innerWidth: window.innerWidth,
              innerHeight: window.innerHeight,
              buttonBottom: button === null ? -1 : button.getBoundingClientRect().bottom,
              guardCount: count === null ? '' : (count.textContent ?? ''),
            };
          });
          expect(bottom.innerWidth).toBe(width);
          expect(bottom.innerHeight).toBe(height);
          // Scrolled to it, the delete control is genuinely reachable.
          expect(bottom.buttonBottom).toBeGreaterThan(0);
          expect(bottom.buttonBottom).toBeLessThanOrEqual(height);
          // And the diagnostics section has the provoked failure in it.
          expect(Number(bottom.guardCount)).toBeGreaterThan(0);

          await shot(page, `settings-bottom-${width}x${height}`);
        } finally {
          await close();
        }
      });
    });
  }

  test('the Settings tab round-trips with Play and Profile without throwing', async () => {
    const errors: string[] = [];
    const { page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.waitForSelector(homeScreen);
      for (let i = 0; i < 3; i++) {
        await openSettings(page);
        await goTo(page, 'tab-profile');
        await page.waitForSelector('[data-testid="profile-screen"]');
        await page.click(sel.tabPlay);
        await page.waitForSelector(homeScreen);
      }

      // Leaving Settings for a live table and back must tear the table down cleanly.
      await page.click(sel.newHand);
      await page.waitForSelector(tableScreen);
      expect(await waitForIdle(page)).toBe('hero');
      await openSettings(page);
      await expect(page.locator(tableScreen)).toHaveCount(0);
      await page.click(sel.tabPlay);
      await page.waitForSelector(homeScreen);

      expect(errors, 'uncaught renderer exceptions around the Settings tab').toEqual([]);
    } finally {
      await close();
    }
  });
});

/**
 * 1.8 — Settings › Character, Celebrations and the local trial (core/trial.ts). Character and the quieter level are
 * the same fields Dee's own screen sets; the milestone sound sits behind the app's sound switch (D13); the trial is
 * set up with a prediction first, hides the layer in an off week without touching the switches, and its results
 * turn the layer off when a criterion trips. Everything is counted on this machine.
 */
test.describe('1.8 — Character, Celebrations and the local trial', () => {
  const todayKey = (): number => systemDayKeyOf()(Date.now());
  const readProfile = (dir: string): Record<string, any> => JSON.parse(fs.readFileSync(statePath(dir), 'utf-8'));
  const counts = (over: Record<string, number> = {}) => ({
    activeDays: 5, sessions: 6, lateSessions: 0, busyDays: 0, decisions: 120, assessed: 40, assessedLossBb: 4, delayed: 25, delayedCorrect: 20, reps: 40, repsOnMastered: 4, ...over,
  });
  const cal = (n: number) => ({ total: n, sureTotal: Math.floor(n / 2), sureCorrect: Math.floor(n / 3) });
  /** A trial that started `daysAgo` days ago, with every week counted (late sessions in the on weeks trip one criterion). */
  function trialProfile(daysAgo: number, onLate = 0): Record<string, unknown> {
    return {
      schemaVersion: 2,
      progression: {
        trial: {
          status: 'running',
          startedOn: todayKey() - daysAgo,
          prediction: 'With Dee on I practise on more days and my assessment EV loss holds.',
          ownCriterion: 'I start opening the app only to keep the streak.',
          baseline: cal(0),
          blocks: [0, 1, 2, 3].map((i) => ({ calibrationStart: cal(i * 40), calibrationEnd: cal(i * 40 + 40), counts: counts(i % 2 === 0 ? { lateSessions: onLate } : {}) })),
          reports: [{ day: todayKey() - daysAgo + 1, answer: 'wanted' }],
          finishedOn: null,
          outcome: null,
        },
      },
    };
  }

  test('Character and the quieter level persist and agree with Dee’s own screen; Celebrations follow their switches and the sound switch', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);
      const character = page.locator('[data-testid="settings-character-toggle"]');
      await expect(character).toHaveAttribute('aria-checked', 'true');
      await character.click();
      await expect(page.locator('[data-testid="settings-character-toggle"]')).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('html')).toHaveAttribute('data-character', 'off');
      await page.locator('[data-testid="settings-quiet-quietest"]').click();
      await expect(page.locator('[data-testid="settings-quiet"]')).toHaveAttribute('data-value', 'quietest');
      await expect.poll(() => readProfile(userDataDir).progression?.dee?.personality?.quiet).toBe('quietest');
      expect(readProfile(userDataDir).progression.dee.character).toBe(false);

      // The same fields on Dee's screen.
      await page.locator('[data-testid="open-dee-settings"]').click();
      await expect(page.locator('[data-testid="dee-character-toggle"]')).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('[data-testid="dee-quiet"] button[aria-checked="true"]')).toHaveText('Quietest');
      await page.locator('[data-testid="dee-character-toggle"]').click();
      await openSettings(page);
      await expect(page.locator('[data-testid="settings-character-toggle"]')).toHaveAttribute('aria-checked', 'true');

      // Celebrations: on by default; the milestone sound cannot be on while the sound switch is off.
      await expect(page.locator('html')).toHaveAttribute('data-celebrations', 'on');
      const sound = page.locator('[data-testid="celebrations-sound-toggle"]');
      await expect(sound).toBeDisabled();
      await expect(sound).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('[data-testid="celebrations-sound-toggle-note"]')).toContainText('A sound on a mistake');
      await page.locator('[data-testid="sound-cues-toggle"]').click();
      await expect(page.locator('[data-testid="celebrations-sound-toggle"]')).toBeEnabled();
      await expect(page.locator('[data-testid="celebrations-sound-toggle"]')).toHaveAttribute('aria-checked', 'true');
      await page.locator('[data-testid="celebrations-sound-toggle"]').click();
      await expect(page.locator('[data-testid="celebrations-sound-toggle"]')).toHaveAttribute('aria-checked', 'false');

      await page.locator('[data-testid="celebrations-motion-still"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'still');
      await page.locator('[data-testid="celebrations-toggle"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-celebrations', 'off');
      await expect(page.locator('[data-testid="celebrations-motion-system"]')).toBeDisabled();
      await expect.poll(() => readProfile(userDataDir).progression?.celebrations).toEqual({ on: false, motion: 'still', sound: false });
      // A toggle low on the page keeps the column where it was.
      expect(await page.locator(settingsScreen).evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    } finally {
      await close();
    }

    // All of it survives a restart.
    const again = await launchApp({ seed: 42, userDataDir });
    try {
      await again.page.waitForSelector(homeScreen);
      await expect(again.page.locator('html')).toHaveAttribute('data-celebrations', 'off');
      await expect(again.page.locator('html')).toHaveAttribute('data-motion', 'still');
      await openSettings(again.page);
      await expect(again.page.locator('[data-testid="settings-quiet"]')).toHaveAttribute('data-value', 'quietest');
    } finally {
      await again.close();
    }
  });

  test('the trial: a prediction first, criteria shown in advance, locked once started, counted locally', async () => {
    const userDataDir = freshUserDataDir();
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await openSettings(page);
      await expect(page.locator('[data-testid="trial-line"]')).toContainText('on this Mac only');
      await page.locator('[data-testid="open-trial"]').click();
      await expect(page.locator('[data-testid="trial-screen"]')).toHaveAttribute('data-phase', 'none');
      await expect(page.locator('[data-testid="trial-criterion"]')).toHaveCount(7);
      const start = page.locator('[data-testid="trial-start"]');
      await expect(start).toBeDisabled();
      await page.locator('[data-testid="trial-prediction"]').fill('Dee on');
      await expect(start).toBeDisabled();
      await page.locator('[data-testid="trial-prediction"]').fill('With Dee on I practise on more days, and my EV loss holds.');
      await page.locator('[data-testid="trial-own-criterion"]').fill('I start dreading it.');
      await expect(start).toBeEnabled();
      await start.click();

      await expect(page.locator('[data-testid="trial-screen"]')).toHaveAttribute('data-phase', 'running');
      await expect(page.locator('[data-testid="trial-prediction-locked"]')).toHaveText('With Dee on I practise on more days, and my EV loss holds.');
      await expect(page.locator('[data-testid="trial-prediction"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="trial-where"]')).toContainText('Day 1 of 28');
      await expect(page.locator('[data-testid="trial-strip"] [data-current="true"]')).toContainText('Week 1');
      await page.locator('[data-testid="trial-report-wanted"]').click();
      await expect(page.locator('[data-testid="trial-report-wanted"]')).toHaveAttribute('aria-pressed', 'true');
      const saved = readProfile(userDataDir).progression.trial;
      expect(saved).toMatchObject({ status: 'running', startedOn: todayKey(), ownCriterion: 'I start dreading it.', reports: [{ day: todayKey(), answer: 'wanted' }] });

      // A hand played now is counted in week 1, from the hand log on this machine.
      await page.locator('[data-testid="trial-back"]').click();
      await page.click(sel.tabPlay);
      await page.click(sel.newHand);
      await playToShowdown(page);
      await expect.poll(() => readProfile(userDataDir).progression.trial.blocks[0]?.counts?.sessions ?? 0).toBe(1);
      expect(await assertNoNetwork(page)).toEqual([]);
    } finally {
      await close();
    }
  });

  test('an off week hides Dee and pauses Celebrations without touching either switch', async () => {
    const userDataDir = freshUserDataDir();
    seedState(userDataDir, trialProfile(8));
    const { page, close } = await launchApp({ seed: 42, userDataDir });
    try {
      await page.waitForSelector(homeScreen);
      await expect(page.locator('html')).toHaveAttribute('data-character', 'off');
      await expect(page.locator('html')).toHaveAttribute('data-celebrations', 'off');
      await openSettings(page);
      await expect(page.locator('[data-testid="settings-character-toggle"]')).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-testid="settings-character-toggle-note"]')).toContainText('off week');
      await expect(page.locator('[data-testid="celebrations-toggle-note"]')).toContainText('off week');
      await expect(page.locator('[data-testid="trial-line"]')).toContainText('Week 2 of 4: the layer is off');
    } finally {
      await close();
    }
  });

  for (const [width, height] of [
    [DEFAULT_WIDTH, DEFAULT_HEIGHT],
    [MIN_WIDTH, MIN_HEIGHT],
  ] as const) {
    test(`results after four weeks: a tripped criterion turns the layer off; every view fits ${width}x${height}`, async () => {
      const userDataDir = freshUserDataDir();
      seedState(userDataDir, trialProfile(28, 2));
      const { app, page, close } = await launchApp({ seed: 42, userDataDir });
      try {
        await page.waitForSelector(homeScreen);
        await useViewport(app, page, width, height);
        await openSettings(page);
        await page.locator('[data-testid="settings-character"]').scrollIntoViewIfNeeded();
        const fits = async (): Promise<void> => {
          const g = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight, right: Math.max(...[...document.querySelectorAll('.settings-screen *')].map((e) => e.getBoundingClientRect().right)) }));
          expect(g.doc, 'the document itself scrolls').toBeLessThanOrEqual(height + 1);
          expect(g.right, 'content hangs past the right edge').toBeLessThanOrEqual(width);
        };
        await fits();
        await shot(page, `settings-habit-${width}x${height}`);
        await useViewport(app, page, width, height);

        await page.locator('[data-testid="open-trial"]').click();
        await expect(page.locator('[data-testid="trial-screen"]')).toHaveAttribute('data-phase', 'ready');
        await expect(page.locator('[data-testid="trial-results"]')).toHaveAttribute('data-tripped', 'true');
        await expect(page.locator('[data-testid="trial-verdict"][data-id="late-night"]')).toHaveAttribute('data-status', 'tripped');
        await expect(page.locator('[data-testid="trial-verdict"][data-id="ev-loss"]')).toHaveAttribute('data-status', 'clear');
        await expect(page.locator('[data-testid="trial-verdict"][data-id="had-to"]')).toHaveAttribute('data-status', 'too-little');
        await fits();
        await shot(page, `trial-results-${width}x${height}`);
        await useViewport(app, page, width, height);

        await page.locator('[data-testid="trial-finish"]').click();
        await expect(page.locator('[data-testid="trial-screen"]')).toHaveAttribute('data-phase', 'finished');
        await expect(page.locator('[data-testid="trial-summary"]')).toContainText('turned off');
        await expect(page.locator('html')).toHaveAttribute('data-character', 'off');
        await expect(page.locator('html')).toHaveAttribute('data-celebrations', 'off');
        await expect.poll(() => readProfile(userDataDir).progression.trial.outcome).toBe('off');
        const p = readProfile(userDataDir).progression;
        expect(p.dee.character).toBe(false);
        expect(p.celebrations.on).toBe(false);
      } finally {
        await close();
      }
    });

    test(`the trial setup fits ${width}x${height}`, async () => {
      const { app, page, close } = await launchApp({ seed: 42, userDataDir: freshUserDataDir() });
      try {
        await page.waitForSelector(homeScreen);
        await useViewport(app, page, width, height);
        await openSettings(page);
        await page.locator('[data-testid="open-trial"]').click();
        await page.locator('[data-testid="trial-prediction"]').fill('With Dee on I practise on more days, and my EV loss holds.');
        const doc = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(doc).toBeLessThanOrEqual(height + 1);
        await shot(page, `trial-setup-${width}x${height}`);
      } finally {
        await close();
      }
    });
  }
});
