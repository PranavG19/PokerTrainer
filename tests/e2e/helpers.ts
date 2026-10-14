import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { OLD_TABS } from '../../src/renderer/nav.js';

// package.json is "type": "module", so the transpiled spec has no __dirname.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Launch the built Electron app with a fixed seed and an isolated userData dir.
 * Isolation matters: tests assert on persisted bankroll, so they must not inherit
 * each other's state or the developer's real save file.
 */
export async function launchApp(
  opts: {
    seed?: number;
    userDataDir?: string;
    env?: Record<string, string>;
    /** Extra Chromium switches. no-network.spec.ts uses this to route the app through a proxy. */
    extraArgs?: readonly string[];
    /**
     * The visible tier: the window is shown inactive and moved to AeroSpace workspace 12, never focused.
     * Only for a spec that truly needs an on-screen window; every other launch is hidden (never shown).
     * `OFFSUIT_E2E_VISIBLE=1` forces every launch visible, to compare the two modes.
     */
    visible?: boolean;
  } = {},
): Promise<LaunchedApp> {
  const seed = opts.seed ?? 42;
  const userDataDir =
    opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-e2e-'));

  const visible = opts.visible === true || process.env.OFFSUIT_E2E_VISIBLE === '1';
  if (visible) requireAerospace();

  const app = await electron.launch({
    args: [
      path.join(ROOT, 'dist/main/main.js'),
      `--seed=${seed}`,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      ...(opts.extraArgs ?? []),
    ],
    cwd: ROOT,
    // `opts.env` overrides the defaults (not the hidden flag); nothing here is read by the renderer.
    env: {
      ...withoutRunAsNode(process.env),
      OFFSUIT_E2E: '1',
      OFFSUIT_SEED: String(seed),
      ...opts.env,
      // After opts.env: the main process and moveToWorkspace12 must agree on the mode.
      OFFSUIT_E2E_HIDDEN: visible ? '0' : '1',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  if (visible) await moveToWorkspace12(app);

  return {
    app,
    page,
    userDataDir,
    close: async () => {
      await app.close().catch(() => {});
    },
  };
}

/**
 * A shell that exports ELECTRON_RUN_AS_NODE=1 makes Electron run as plain Node, so `_electron.launch`
 * hangs waiting for a window that never comes. Dropped here so the suite runs from any shell.
 */
function withoutRunAsNode(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) out[key] = value;
  }
  return out;
}

const VISIBLE_WORKSPACE = '12';

function requireAerospace(): void {
  try {
    // Not `--version`: that succeeds with the AeroSpace server down, and the move would then fail later.
    execFileSync('aerospace', ['list-workspaces', '--focused'], { stdio: 'ignore' });
  } catch {
    throw new Error(
      'Visible-tier e2e needs `aerospace` on PATH with AeroSpace running, to park the window on workspace 12 ' +
        'without taking focus. Start AeroSpace or run the hidden tier only.',
    );
  }
}

/**
 * Park the app's window on workspace 12 without ever focusing it.
 *
 * Under e2e the app runs with the accessory activation policy (src/main/main.ts), which is what stops
 * it activating at launch — but AeroSpace only manages regular apps, so it cannot see that window.
 * So: wait for the main process's `showInactive()`, THEN switch to the regular policy (which does not
 * activate; measured, the focused app and workspace stay put), then move the window by id. Without
 * `--focus-follows-window` the move never moves focus. AeroSpace tiles the window onto the focused
 * workspace for about 100ms before the move lands; that flash is the price of the visible tier.
 * The window is then made floating and put back at 1100x760, so AeroSpace's tiling does not change the
 * geometry the layout specs measure.
 */
async function moveToWorkspace12(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid;
  if (pid === undefined) throw new Error('Visible tier: the Electron process has no pid.');
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const shownBy = Date.now() + 10_000;
  while (!(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false))) {
    if (Date.now() > shownBy) throw new Error('Visible tier: the window was never shown.');
    await sleep(50);
  }
  await app.evaluate(({ app: electronApp }) => electronApp.setActivationPolicy('regular'));

  const listedBy = Date.now() + 10_000;
  while (Date.now() < listedBy) {
    const rows = execFileSync(
      'aerospace',
      ['list-windows', '--all', '--format', '%{window-id}|%{app-pid}|%{workspace}'],
      { encoding: 'utf-8' },
    )
      .split('\n')
      .map((row) => row.split('|'))
      .filter(([, appPid]) => Number(appPid) === pid);
    if (rows.length > 0) {
      for (const [windowId, , workspace] of rows) {
        if (workspace !== VISIBLE_WORKSPACE) {
          execFileSync('aerospace', ['move-node-to-workspace', '--window-id', windowId, VISIBLE_WORKSPACE]);
        }
        execFileSync('aerospace', ['layout', '--window-id', windowId, 'floating']);
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 760));
      return;
    }
    await sleep(50);
  }
  throw new Error(`Visible tier: AeroSpace never listed a window for pid ${pid}.`);
}

/**
 * Renderer-level network watch: records any non-local URL the PAGE requests.
 *
 * SCOPE, STATED because the name overpromises. `page.route` intercepts what the RENDERER asks for and
 * nothing else — it is blind to Chromium's own traffic (component updates, safe-browsing lists, domain
 * reliability beacons, the updater), which lives in the browser process. That is exactly the gap
 * PRODUCT-SPEC's Security section calls out about v1's "any outbound request" claim. It is still worth
 * having here, because a renderer that tries to fetch is a real bug and this is the cheapest way for an
 * unrelated spec to notice one in passing.
 *
 * The browser-process guarantee is tests/e2e/no-network.spec.ts (loopback proxy + onBeforeRequest +
 * the main process's own module state). Do not read a clean result from this function as "the app made
 * no network request".
 */
export async function assertNoNetwork(page: Page): Promise<string[]> {
  const attempted: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (!/^(file|data|blob|devtools):/.test(url)) attempted.push(url);
    route.continue().catch(() => {});
  });
  return attempted;
}

export const sel = {
  card: '[data-testid="card"]',
  board: '[data-testid="board"]',
  heroCards: '[data-testid="hero-cards"]',
  seat: '[data-testid="seat"]',
  pot: '[data-testid="pot"]',
  btnFold: '[data-testid="btn-fold"]',
  btnCheck: '[data-testid="btn-check"]',
  btnCall: '[data-testid="btn-call"]',
  btnRaise: '[data-testid="btn-raise"]',
  statsSheet: '[data-testid="stats-sheet"]',
  winPct: '[data-testid="win-pct"]',
  coach: '[data-testid="coach-message"]',
  bankroll: '[data-testid="bankroll"]',
  newHand: '[data-testid="new-hand"]',
  /**
   * The launcher (bankroll, New session, recent hands). It was the Play tab; since the 7-tab nav (1.14) it is
   * Home, and Play holds the tables. The name is kept so every spec that "goes back to Play" reads the same.
   */
  tabPlay: '[data-testid="tab-home"]',
};

/**
 * Open an old tab's destination through the 7-tab nav (src/renderer/nav.ts OLD_TABS): one click on the section,
 * then the sub-nav button or rail rung that carries the old testid. `tab-profile` is the old Profile screen (the
 * session record), which is You › Hands now; the new Profile is `tab-you` alone.
 */
export async function goTo(page: Page, oldTab: keyof typeof OLD_TABS): Promise<void> {
  for (const id of OLD_TABS[oldTab]) await page.locator(`[data-testid="${id}"]`).click();
}

export async function shot(page: Page, name: string): Promise<void> {
  const dir = path.join(ROOT, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}
