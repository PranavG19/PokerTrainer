import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
  } = {},
): Promise<LaunchedApp> {
  const seed = opts.seed ?? 42;
  const userDataDir =
    opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-e2e-'));

  const app = await electron.launch({
    args: [
      path.join(ROOT, 'dist/main/main.js'),
      `--seed=${seed}`,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      ...(opts.extraArgs ?? []),
    ],
    cwd: ROOT,
    // `env` last so a test can override a default; nothing here is read by the renderer.
    env: { ...process.env, OFFSUIT_E2E: '1', OFFSUIT_SEED: String(seed), ...opts.env },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

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
  tabPlay: '[data-testid="tab-play"]',
  tabProfile: '[data-testid="tab-profile"]',
};

export async function shot(page: Page, name: string): Promise<void> {
  const dir = path.join(ROOT, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false });
}
