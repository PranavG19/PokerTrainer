import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export const ROOT = '/Users/pranavgk/Documents/temp1/poke';
export const TABLE = '[data-testid="table-screen"]';

export async function launch({ seed = 8, userDataDir } = {}) {
  const dir = userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-cg-'));
  const app = await electron.launch({
    args: [path.join(ROOT, 'dist/main/main.js'), `--seed=${seed}`, `--user-data-dir=${dir}`, '--no-sandbox'],
    cwd: ROOT,
    env: { ...process.env, OFFSUIT_E2E: '1', OFFSUIT_SEED: String(seed) },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app, page, dir,
    close: async () => {
      const pid = app.process().pid;
      const ok = await Promise.race([app.close().then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
      if (!ok && pid) { try { process.kill(pid, 'SIGKILL'); } catch {} }
    },
  };
}

export async function settle(page) {
  await page.evaluate(async () => {
    const nf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const read = () => {
      const r = document.querySelector('[data-testid="table-screen"]')?.getBoundingClientRect();
      return r ? `${r.width}x${r.height}@${r.top}` : 'absent';
    };
    let prev = read();
    for (let i = 0; i < 180; i++) { await nf(); const cur = read(); if (cur === prev && cur !== 'absent') return true; prev = cur; }
    return false;
  });
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
  await settle(page);
}

export async function waitIdle(page) {
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="table-screen"]');
    const a = r instanceof HTMLElement ? r.dataset.awaiting : undefined;
    return a === 'hero' || a === 'handover';
  }, undefined, { timeout: 40000 });
  return page.getAttribute(TABLE, 'data-awaiting');
}

export async function sitDown(page) {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator(TABLE).waitFor();
  return waitIdle(page);
}

export async function enableCoach(page) {
  await page.locator('[data-testid="coach-mode-toggle"]').click();
  await page.waitForSelector('[data-testid="predict-panel"]');
}

export async function commit(page, action, confidence) {
  if (action) await page.locator(`[data-testid="predict-${action}"]`).click();
  if (confidence) await page.locator(`[data-testid="confidence-${confidence}"]`).click();
}

export async function shot(page, name) {
  const dir = path.join(ROOT, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `audit-${name}.png`), fullPage: false });
}

export async function dump(page) {
  return page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent ?? null;
    const cards = (root) => root ? [...root.querySelectorAll('[data-testid="card"]')].map((c) => c.dataset.card ?? '?') : [];
    const seats = [...document.querySelectorAll('[data-testid="seat"]')].map((s) => ({
      id: Number(s.dataset.seatId),
      name: s.querySelector('.seat-name')?.textContent,
      stack: Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      committed: Number(s.querySelector('[data-testid="seat-committed"]')?.textContent ?? '0'),
      folded: s.dataset.folded === 'true',
      allin: s.dataset.allin === 'true',
      toAct: s.dataset.toAct === 'true',
    }));
    const pot = Number((t('[data-testid="pot"]') ?? '').replace(/[^0-9-]/g, ''));
    const sheet = document.querySelector('[data-testid="stats-sheet"]');
    const predict = document.querySelector('[data-testid="predict-panel"]');
    const result = document.querySelector('[data-testid="predict-result"]');
    const coach = document.querySelector('.coach');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const hit = r.width && r.height ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return {
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        onScreen: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
        covered: hit === null ? 'nothing' : (hit === el || el.contains(hit) || hit.contains(el)) ? null : `<${hit.tagName.toLowerCase()} class="${String(hit.className)}">`,
      };
    };
    const style = (el) => el === null ? null : (() => { const c = getComputedStyle(el); return { color: c.color, fontSize: c.fontSize, fontWeight: c.fontWeight, background: c.backgroundColor }; })();
    return {
      awaiting: document.querySelector('[data-testid="table-screen"]')?.dataset.awaiting,
      pot, potText: t('[data-testid="pot"]'),
      board: cards(document.querySelector('[data-testid="board"]')),
      hero: cards(document.querySelector('[data-testid="hero-cards"]')),
      seats,
      chipTotal: seats.reduce((a, s) => a + s.stack, 0) + pot,
      win: t('[data-testid="win-pct"]'),
      tie: document.querySelector('.stats-tie .stat-value')?.textContent ?? null,
      statsOpen: sheet?.dataset.open, withheld: sheet?.dataset.withheld,
      cats: sheet ? [...sheet.querySelectorAll('.stats-cat')].map((r) => r.textContent) : [],
      predictMounted: predict !== null,
      predictPrompt: predict?.querySelector('.predict-prompt')?.textContent ?? null,
      predictAction: predict?.dataset.predictAction ?? null,
      predictConfidence: predict?.dataset.predictConfidence ?? null,
      predictPills: [...document.querySelectorAll('.predict-choice')].map((b) => `${b.dataset.testid}${b.disabled ? '(off)' : ''}${b.dataset.selected === 'true' ? '*SEL*' : ''}`),
      resultHidden: result?.hidden ?? null,
      resultOutcome: result?.dataset.outcome ?? null,
      resultText: result?.textContent ?? null,
      resultStyle: style(result),
      resultBox: box(result),
      coachHidden: coach?.hidden, coachSeverity: coach?.dataset.severity,
      coachMessage: t('[data-testid="coach-message"]'),
      coachPrinciple: document.querySelector('.coach-principle')?.textContent ?? null,
      coachStyle: style(document.querySelector('[data-testid="coach-message"]')),
      winPctStyle: style(document.querySelector('[data-testid="win-pct"]')),
      toggleLabel: t('[data-testid="coach-mode-toggle"]'),
      toggleOn: document.querySelector('[data-testid="coach-mode-toggle"]')?.dataset.on,
      buttons: [...document.querySelectorAll('.controls button')].map((b) => `${b.dataset.testid}${b.disabled ? '(off)' : ''}="${b.textContent}"`),
      winnerSummary: t('[data-testid="winner-summary"]'),
      sessionOver: t('[data-testid="session-over"]'),
      boxes: Object.fromEntries(['btn-fold', 'btn-call', 'btn-raise', 'predict-fold', 'confidence-sure', 'predict-result', 'stats-sheet', 'win-pct', 'coach-mode-toggle'].map((id) => [id, box(document.querySelector(`[data-testid="${id}"]`))])),
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight, innerWidth: window.innerWidth,
    };
  });
}

export function report(label, d) {
  const L = (k, v) => console.log(`   ${k}: ${v}`);
  console.log(`\n===== ${label} =====`);
  L('awaiting', d.awaiting);
  L('pot', `${d.potText} (${d.pot})`);
  L('board', `[${d.board.join(' ')}] hero=[${d.hero.join(' ')}]`);
  for (const s of d.seats) L(`seat${s.id} ${s.name}`, `stack=${s.stack} cmt=${s.committed} folded=${s.folded} allin=${s.allin} toAct=${s.toAct}`);
  L('CHIPS', `stacks+pot = ${d.chipTotal}`);
  L('stats', `open=${d.statsOpen} withheld=${d.withheld} WIN=${d.win} TIE=${d.tie} cats=${d.cats.length} ${JSON.stringify(d.cats)}`);
  L('winPctStyle', JSON.stringify(d.winPctStyle));
  L('coach', `hidden=${d.coachHidden} sev=${d.coachSeverity} msg=${JSON.stringify(d.coachMessage)} pr=${JSON.stringify(d.coachPrinciple)} style=${JSON.stringify(d.coachStyle)}`);
  L('predict', `mounted=${d.predictMounted} action=${d.predictAction} conf=${d.predictConfidence} pills=${d.predictPills.join(' ')}`);
  L('result', `hidden=${d.resultHidden} outcome=${d.resultOutcome} text=${JSON.stringify(d.resultText)} style=${JSON.stringify(d.resultStyle)} box=${JSON.stringify(d.resultBox)}`);
  L('toggle', `${JSON.stringify(d.toggleLabel)} on=${d.toggleOn}`);
  L('buttons', d.buttons.join(' '));
  L('winner', JSON.stringify(d.winnerSummary));
  L('sessionOver', JSON.stringify(d.sessionOver));
  L('scroll', `${d.scrollHeight} vs ${d.innerWidth}x${d.innerHeight}`);
  for (const [id, b] of Object.entries(d.boxes)) {
    if (b === null) continue;
    if (!b.onScreen || b.covered !== null) L(`!! GEOMETRY ${id}`, JSON.stringify(b));
  }
}
