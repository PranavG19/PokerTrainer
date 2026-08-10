import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export const ROOT = '/Users/pranavgk/Documents/temp1/poke';
export const STATE_FILE = 'offsuit-state.json';

export function freshDir(tag = 'nt') {
  return fs.mkdtempSync(path.join(os.tmpdir(), `offsuit-${tag}-`));
}

export function seedState(fixture, tag = 'seed') {
  const dir = freshDir(tag);
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(fixture, null, 2), 'utf-8');
  return dir;
}

export function readState(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf-8'));
}

export async function launch({ seed = 42, userDataDir } = {}) {
  const dir = userDataDir ?? freshDir();
  const app = await electron.launch({
    args: [path.join(ROOT, 'dist/main/main.js'), `--seed=${seed}`, `--user-data-dir=${dir}`, '--no-sandbox'],
    cwd: ROOT,
    env: { ...process.env, OFFSUIT_E2E: '1', OFFSUIT_SEED: String(seed) },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const close = async () => {
    const pid = app.process().pid;
    const ok = await Promise.race([app.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (!ok && pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  };
  return { app, page, userDataDir: dir, close };
}

export async function frames(page, n = 40) {
  await page.evaluate(async (count) => {
    const nf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < count; i++) await nf();
  }, n);
}

export async function setViewport(app, page, width, height) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(s.width, s.height);
    return w.getSize();
  }, { width, height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await page.waitForFunction((w) => window.innerWidth === w.width && window.innerHeight === w.height, { width, height });
  await frames(page, 60);
}

export async function waitIdle(page) {
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="table-screen"]');
    const a = r instanceof HTMLElement ? r.dataset.awaiting : undefined;
    return a === 'hero' || a === 'handover';
  }, undefined, { timeout: 30000 });
  return page.getAttribute('[data-testid="table-screen"]', 'data-awaiting');
}

export async function clickFirstEnabled(page, selectors) {
  for (const s of selectors) {
    const b = page.locator(s);
    if ((await b.count()) > 0 && (await b.isEnabled())) { await b.click(); return s; }
  }
  return null;
}

/** Play a hand passively (check > call > fold). Returns when at handover. */
export async function playHand(page) {
  for (let i = 0; i < 40; i++) {
    if ((await waitIdle(page)) === 'handover') return;
    const c = await clickFirstEnabled(page, ['[data-testid="btn-check"]', '[data-testid="btn-call"]', '[data-testid="btn-fold"]']);
    if (c === null) throw new Error('hero turn with no enabled action button');
  }
  throw new Error('hand did not settle');
}

/** Play a hand aggressively: all-in preset + raise when possible. */
export async function playHandAggro(page) {
  for (let i = 0; i < 40; i++) {
    if ((await waitIdle(page)) === 'handover') return;
    const raise = page.locator('[data-testid="btn-raise"]');
    if ((await raise.count()) > 0 && (await raise.isEnabled())) {
      await page.locator('[data-testid="preset-allin"]').click();
      await raise.click();
      continue;
    }
    const c = await clickFirstEnabled(page, ['[data-testid="btn-call"]', '[data-testid="btn-check"]', '[data-testid="btn-fold"]']);
    if (c === null) throw new Error('hero turn with no enabled action button');
  }
  throw new Error('hand did not settle');
}

export async function shot(page, name) {
  const dir = path.join(ROOT, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `audit-${name}.png`), fullPage: false });
}

export async function dumpHome(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="home-screen"]');
    const rows = [...document.querySelectorAll('[data-testid="hand-row"]')].map((r) => {
      const net = r.querySelector('.hand-net');
      const box = r.getBoundingClientRect();
      return {
        hand: r.dataset.hand,
        cards: [...r.querySelectorAll('[data-testid="card"]')].map((c) => c.dataset.card),
        net: net?.textContent,
        netClass: net?.className,
        netColor: net ? getComputedStyle(net).color : null,
        top: box.top, bottom: box.bottom,
      };
    });
    return {
      present: root !== null,
      bankrollText: document.querySelector('[data-testid="bankroll"]')?.textContent ?? null,
      empty: document.querySelector('[data-testid="recent-empty"]') !== null,
      rows,
      innerText: root instanceof HTMLElement ? root.innerText : null,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      homeBox: root ? (({ top, bottom, left, right }) => ({ top, bottom, left, right }))(root.getBoundingClientRect()) : null,
    };
  });
}

export async function dumpProfile(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="profile-screen"]');
    const cal = document.querySelector('[data-testid="calibration"]');
    const svg = document.querySelector('[data-testid="session-graph"]');
    const poly = svg?.querySelector('polyline');
    const rect = (el) => el ? (({ top, bottom, left, right, width, height }) => ({ top, bottom, left, right, width, height }))(el.getBoundingClientRect()) : null;
    return {
      present: root !== null,
      graphPoints: poly?.getAttribute('points') ?? null,
      graphBox: rect(svg),
      polyBox: poly ? rect(poly) : null,
      captions: [...document.querySelectorAll('.graph-caption')].map((c) => c.textContent),
      rebuyCount: document.querySelector('[data-testid="rebuy-count"]')?.textContent ?? null,
      rebuyCaption: document.querySelector('[data-testid="rebuy-caption"]')?.textContent ?? null,
      calibration: cal ? { text: cal.textContent, ...cal.dataset } : null,
      leaks: [...document.querySelectorAll('[data-testid="leak-row"]')].map((r) => ({
        principle: r.dataset.principle,
        cost: r.querySelector('[data-testid="leak-cost"]')?.textContent,
        barWidthStyle: r.querySelector('.leak-bar')?.style.width,
        barPx: r.querySelector('.leak-bar')?.getBoundingClientRect().width,
        trackPx: r.querySelector('.leak-track')?.getBoundingClientRect().width,
      })),
      leakEmpty: document.querySelector('.leak-empty')?.textContent ?? null,
      counters: Object.fromEntries([...document.querySelectorAll('.counter')].map((c) => [
        c.querySelector('.stat-label')?.textContent, c.querySelector('.stat-value')?.textContent])),
      sectionLabels: [...document.querySelectorAll('.profile-section > .stat-label')].map((l) => l.textContent),
      innerText: root instanceof HTMLElement ? root.innerText : null,
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      profileBox: rect(root),
    };
  });
}

export async function openProfile(page) {
  await page.click('[data-testid="tab-profile"]');
  await page.waitForSelector('[data-testid="profile-screen"]');
  await frames(page, 10);
}

export async function openPlay(page) {
  await page.click('[data-testid="tab-play"]');
  await frames(page, 10);
}

export const log = (label, obj) => console.log(`\n===== ${label} =====\n` + JSON.stringify(obj, null, 2));
