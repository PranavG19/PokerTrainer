import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, sel } from './helpers.js';
import { emptySession, recordHand, serialize, type HandRecord } from '../../src/core/session.js';
import { encodeChallenge, decodeChallenge } from '../../src/core/challengeCode.js';
import { SCENARIOS } from '../../src/core/puzzleScenarios.js';

/**
 * PROFILE EXPORT AND IMPORT, AND CHALLENGE CODES (BUILD-PLAN 2.8), in the running app.
 *
 * The native file dialogs are stubbed from this process (electronApp.evaluate), as pro-tools.spec does: the
 * product has no test hook, and the stub records what main asked for. Screenshots go to test-results/ (not
 * screenshots/, which is tracked).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'test-results', 'profile-export-shots');

async function snap(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${w}x${h}.png`) });
  }
}

const tmp = (prefix: string): string => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function hand(n: number, hole: [string, string]): HandRecord {
  return { handNumber: n, hole, board: ['2c', '7h', 'Td'], net: 100, vpip: true, pfr: false, grades: [], decisions: [], playedAt: 1_760_000_000_000 + n };
}

function profileWith(hands: number, bankroll: number): Record<string, unknown> {
  let s = emptySession();
  for (let i = 1; i <= hands; i++) s = recordHand(s, hand(i, ['As', 'Kd']));
  return { ...serialize(s), bankroll };
}

/** Replace both native dialogs in main. Each records the options it was opened with. */
async function stubDialogs(app: ElectronApplication, picks: { save?: string; open?: string }): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    const g = globalThis as { __dialogCalls?: { kind: string; defaultPath?: string }[] };
    g.__dialogCalls = [];
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const options = args[args.length - 1] as { defaultPath?: string };
      g.__dialogCalls!.push({ kind: 'save', defaultPath: options.defaultPath });
      return p.save === undefined ? { canceled: true, filePath: '' } : { canceled: false, filePath: p.save };
    }) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => {
      g.__dialogCalls!.push({ kind: 'open' });
      return p.open === undefined ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p.open] };
    }) as typeof dialog.showOpenDialog;
  }, picks);
}
const dialogCalls = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __dialogCalls?: { kind: string; defaultPath?: string }[] }).__dialogCalls ?? []);

async function openSettings(page: Page): Promise<void> {
  await page.locator('[data-testid="tab-settings"]').click();
  await page.locator('[data-testid="profile-transfer"]').scrollIntoViewIfNeeded();
}

test('export through the file dialog: the profile, without the licence, named by main', async () => {
  const userDataDir = tmp('offsuit-e2e-');
  const profile = profileWith(3, 12_345);
  (profile.progression as Record<string, unknown>).entitlements = { tier: 'free', granted: [], licence: null, highWater: 0 };
  fs.writeFileSync(path.join(userDataDir, 'offsuit-state.json'), JSON.stringify(profile));
  const out = path.join(tmp('offsuit-export-'), 'my-profile.json');
  const { app, page, close } = await launchApp({ userDataDir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await stubDialogs(app, { save: out });
    await openSettings(page);
    // The bridge takes no path: whatever the renderer passes is ignored, and the dialog decides.
    await page.evaluate(() => (window as unknown as { offsuit: { profileExport: (p: string) => Promise<unknown> } }).offsuit.profileExport('/tmp/not-this'));
    expect(fs.existsSync('/tmp/not-this')).toBe(false);
    fs.rmSync(out, { force: true });

    await page.locator('[data-testid="profile-export"]').click();
    const status = page.locator('[data-testid="profile-transfer-status"]');
    await expect(status).toHaveAttribute('data-state', 'exported');
    await expect(status).toContainText('3 hands');
    await expect(status).toContainText('my-profile.json');
    await snap(page, 'profile-export');

    const calls = await dialogCalls(app);
    expect(calls.map((c) => c.kind)).toEqual(['save', 'save']);
    expect(calls[1].defaultPath).toMatch(/^offsuit-profile-\d{4}-\d{2}-\d{2}\.json$/);
    const written = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(written.format).toBe('offsuit-profile');
    expect(written.formatVersion).toBe(1);
    expect(written.profile.bankroll).toBe(12_345);
    expect(written.profile.hands).toHaveLength(3);
    expect(written.profile.progression.entitlements).toEqual({ tier: 'free', granted: [], licence: null, highWater: 0 });

    // Cancel writes nothing and says nothing.
    await stubDialogs(app, {});
    await page.locator('[data-testid="profile-export"]').click();
    await expect(status).toBeHidden();

    // Never into the app's own folder, where it could replace the live profile.
    await stubDialogs(app, { save: path.join(userDataDir, 'offsuit-state.json') });
    const before = fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8');
    await page.locator('[data-testid="profile-export"]').click();
    await expect(status).toHaveAttribute('data-state', 'failed');
    expect(fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8')).toBe(before);
  } finally {
    await close();
  }
});

test('import through the file dialog: checked, previewed, confirmed, the old profile kept, the Pro store untouched', async () => {
  const userDataDir = tmp('offsuit-e2e-');
  const stateFile = path.join(userDataDir, 'offsuit-state.json');
  fs.writeFileSync(stateFile, JSON.stringify(profileWith(2, 9_000)));
  // A Pro hand-history store beside the profile: an import must never read or write it.
  const hhDir = path.join(userDataDir, 'hand-histories');
  fs.mkdirSync(hhDir);
  fs.writeFileSync(path.join(hhDir, 'hands.ndjson'), '{"marker":true}\n');

  const dir = tmp('offsuit-import-');
  const good = path.join(dir, 'friend.json');
  const incoming = profileWith(5, 777);
  (incoming.progression as Record<string, unknown>).entitlements = { tier: 'pro', granted: ['leak-finder'], licence: 'v1.forged', highWater: 9e12 };
  fs.writeFileSync(good, JSON.stringify({ format: 'offsuit-profile', formatVersion: 1, exportedAt: '2026-10-01T10:00:00.000Z', profile: incoming }));
  const damaged = path.join(dir, 'damaged.json');
  fs.writeFileSync(damaged, JSON.stringify({ ...incoming, hands: [{ hole: ['As'], board: [] }] }));
  const notJson = path.join(dir, 'notes.json');
  fs.writeFileSync(notJson, 'hello');

  const { app, page, close } = await launchApp({ userDataDir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openSettings(page);
    const status = page.locator('[data-testid="profile-transfer-status"]');
    const original = fs.readFileSync(stateFile, 'utf-8');

    // Refused files: a reason, no confirm, nothing written.
    for (const [file, reason] of [[damaged, 'bad-field'], [notJson, 'not-json']] as const) {
      await stubDialogs(app, { open: file });
      await page.locator('[data-testid="profile-import"]').click();
      await expect(status).toHaveAttribute('data-reason', reason);
      await expect(status).toContainText('Nothing was changed');
      await expect(page.locator('[data-testid="import-confirm"]')).toHaveCount(0);
    }
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(original);

    // A confirm main never previewed does nothing.
    const guessed = await page.evaluate(() =>
      (window as unknown as { offsuit: { profileImportConfirm: (id: string, a: boolean) => Promise<unknown> } }).offsuit.profileImportConfirm('guessed', true),
    );
    expect(guessed).toEqual({ replaced: false, reason: 'stale' });

    // The good file: a preview beside the current profile, Cancel focused. Cancel changes nothing.
    await stubDialogs(app, { open: good });
    await page.locator('[data-testid="profile-import"]').click();
    const sheet = page.locator('[data-testid="import-confirm"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-testid="import-file-side"]')).toContainText('5 hands');
    await expect(sheet.locator('[data-testid="import-file-side"]')).toContainText('777 chips');
    await expect(sheet.locator('[data-testid="import-current-side"]')).toContainText('2 hands');
    await expect(sheet.locator('[data-testid="import-source"]')).toContainText('friend.json');
    await expect(page.locator('[data-testid="import-cancel"]')).toBeFocused();
    await snap(page, 'profile-import-confirm');
    await page.locator('[data-testid="import-cancel"]').click();
    await expect(sheet).toHaveCount(0);
    expect(fs.readFileSync(stateFile, 'utf-8')).toBe(original);
    expect(fs.readdirSync(userDataDir).filter((n) => n.includes('pre-import'))).toEqual([]);

    // Again, and replace: the app reloads onto the import.
    await page.locator('[data-testid="profile-import"]').click();
    await expect(sheet).toBeVisible();
    await page.locator('[data-testid="import-replace"]').click();
    await page.waitForSelector('[data-testid="home-screen"]');
    await expect(page.locator(sel.bankroll)).toContainText('777');

    const now = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(now.bankroll).toBe(777);
    expect(now.hands).toHaveLength(5);
    // Main's licence, never the file's.
    expect(now.progression.entitlements.licence).toBeNull();
    expect(now.progression.entitlements.tier).toBe('free');
    const kept = fs.readdirSync(userDataDir).filter((n) => n.startsWith('offsuit-state.json.pre-import-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(userDataDir, kept[0]), 'utf-8')).toBe(original);
    expect(fs.readdirSync(hhDir)).toEqual(['hands.ndjson']);
    expect(fs.readFileSync(path.join(hhDir, 'hands.ndjson'), 'utf-8')).toBe('{"marker":true}\n');

    // Saving works again after the reload (the import's save guard is lifted by the load).
    await page.locator('[data-testid="tab-settings"]').click();
    await page.locator('[data-testid="sound-cues-toggle"]').click();
    await expect.poll(() => JSON.parse(fs.readFileSync(stateFile, 'utf-8')).soundCues).toBe(true);
    expect(JSON.parse(fs.readFileSync(stateFile, 'utf-8')).bankroll).toBe(777);
  } finally {
    await close();
  }
});

/** The hero's hole cards and the button's seat, once the hand is dealt. */
async function dealt(page: Page): Promise<{ hole: string[]; button: string | null }> {
  await page.locator('[data-testid="table-screen"]').waitFor();
  await expect(page.locator(`${sel.heroCards} [data-card]`)).toHaveCount(2);
  const hole = await page.locator(`${sel.heroCards} [data-card]`).evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card ?? ''));
  const button = await page.locator('[data-seat-id]:has([data-testid="dealer-button"])').first().getAttribute('data-seat-id');
  return { hole, button };
}

test('a challenge code: made with a QR, typed in on another profile, deals the same hand, and logs nothing', async () => {
  let code = '';
  let first: { hole: string[]; button: string | null } = { hole: [], button: null };
  {
    const { page, close } = await launchApp({ seed: 42 });
    try {
      await page.waitForSelector('[data-testid="home-screen"]');
      await page.locator('[data-testid="tab-play"]').click();
      await page.locator('[data-testid="play-challenge"]').click();
      await page.locator('[data-testid="challenge-kind-hand"]').click();
      await page.locator('[data-testid="challenge-make"]').click();
      code = (await page.locator('[data-testid="challenge-code"]').textContent()) ?? '';
      expect(decodeChallenge(code).ok).toBe(true);
      const qr = page.locator('[data-testid="challenge-qr"]');
      await expect(qr).toBeVisible();
      await expect(qr).toHaveAttribute('data-text', code);
      await snap(page, 'challenge-qr');
      await page.locator('[data-testid="challenge-play-mine"]').click();
      first = await dealt(page);
      await expect(page.locator('[data-testid="table-screen"]')).toHaveAttribute('data-challenge', 'true');
    } finally {
      await close();
    }
  }

  // Someone else: a different seed and a fresh profile. They type the code with a slip in case and spacing.
  const userDataDir = tmp('offsuit-e2e-');
  const { page, close } = await launchApp({ seed: 7, userDataDir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.locator('[data-testid="tab-play"]').click();
    await page.locator('[data-testid="play-challenge"]').click();
    const input = page.locator('[data-testid="challenge-input"]');
    const reader = page.locator('[data-testid="challenge-reader"]');
    // One character wrong is caught by the checksum.
    const body = code.replace(/^OS-/, '');
    const typo = `OS-${body[0]}${body[1] === '0' ? '1' : '0'}${body.slice(2)}`;
    await input.fill(typo);
    await expect(reader).toHaveAttribute('data-state', 'invalid');
    await expect(reader).toHaveAttribute('data-error', 'checksum');
    await expect(page.locator('[data-testid="challenge-play"]')).toBeDisabled();
    await input.fill(` ${code.toLowerCase().replace(/-/g, ' ')} `);
    await expect(reader).toHaveAttribute('data-state', 'valid');
    await expect(page.locator('[data-testid="challenge-notice"]')).toContainText('4-handed hand at 100 big blinds');
    await page.locator('[data-testid="challenge-play"]').click();
    const second = await dealt(page);
    expect(second).toEqual(first);

    // Play it out: fold, and the hand is practice.
    await page.locator(sel.btnFold).click();
    await page.locator('[data-testid="challenge-done"]').click();
    await expect(page.locator('[data-testid="challenge-screen"]')).toBeVisible();
    const saved = fs.existsSync(path.join(userDataDir, 'offsuit-state.json'))
      ? JSON.parse(fs.readFileSync(path.join(userDataDir, 'offsuit-state.json'), 'utf-8'))
      : { hands: [], bankroll: 10_000 };
    expect(saved.hands ?? []).toHaveLength(0);
    expect(saved.bankroll ?? 10_000).toBe(10_000);
  } finally {
    await close();
  }
});

test('challenge codes for a Math problem and a puzzle open the same spot in Train', async () => {
  const { page, close } = await launchApp({ seed: 42 });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    const open = async (code: string): Promise<void> => {
      await page.locator('[data-testid="tab-play"]').click();
      await page.locator('[data-testid="play-challenge"]').click();
      await page.locator('[data-testid="challenge-input"]').fill(code);
      await page.locator('[data-testid="challenge-play"]').click();
    };
    await open(encodeChallenge({ kind: 'drill', drill: 'mdf', index: 37 }));
    const drill = page.locator('[data-testid="drill-screen"]');
    await expect(drill).toHaveAttribute('data-kind', 'mdf');
    await expect(drill).toHaveAttribute('data-index', '37');

    const scenario = SCENARIOS[3];
    await open(encodeChallenge({ kind: 'puzzle', scenarioId: scenario.id }));
    await expect(page.locator(`[data-scenario="${scenario.id}"]`)).toBeVisible();
  } finally {
    await close();
  }
});
