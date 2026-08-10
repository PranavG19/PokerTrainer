import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export const ROOT = '/Users/pranavgk/Documents/temp1/poke';

export async function launch(seed = 42) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-audit-'));
  const app = await electron.launch({
    args: [path.join(ROOT, 'dist/main/main.js'), `--seed=${seed}`, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: ROOT,
    env: { ...process.env, OFFSUIT_E2E: '1', OFFSUIT_SEED: String(seed) },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page, close: async () => { const pid = app.process().pid; const ok = await Promise.race([app.close().then(()=>true), new Promise(r=>setTimeout(()=>r(false), 8000))]); if(!ok && pid) { try{process.kill(pid,'SIGKILL')}catch{} } } };
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

export async function waitIdle(page) {
  await page.waitForFunction(() => {
    const r = document.querySelector('[data-testid="table-screen"]');
    const a = r instanceof HTMLElement ? r.dataset.awaiting : undefined;
    return a === 'hero' || a === 'handover';
  }, undefined, { timeout: 30000 });
  return page.getAttribute('[data-testid="table-screen"]', 'data-awaiting');
}

/** Full text/number dump of the table for cross-checking. */
export async function dump(page) {
  return page.evaluate(() => {
    const t = (s) => document.querySelector(s)?.textContent ?? null;
    const cards = (root) => root ? [...root.querySelectorAll('[data-testid="card"]')].map(c => c.dataset.card ?? '?') : [];
    const backs = (root) => root ? root.querySelectorAll('.card-back').length : 0;
    const seats = [...document.querySelectorAll('[data-testid="seat"]')].map(s => ({
      id: Number(s.dataset.seatId),
      name: s.querySelector('.seat-name')?.textContent,
      archetype: s.querySelector('[data-testid="seat-archetype"]')?.textContent ?? null,
      stack: Number(s.querySelector('[data-testid="seat-stack"]')?.textContent ?? 'NaN'),
      committed: Number(s.querySelector('[data-testid="seat-committed"]')?.textContent ?? '0'),
      folded: s.dataset.folded === 'true',
      allin: s.dataset.allin === 'true',
      toAct: s.dataset.toAct === 'true',
      dealer: s.querySelector('[data-testid="dealer-button"]') !== null,
      faceUp: cards(s),
      faceDown: backs(s),
    }));
    const potText = t('[data-testid="pot"]');
    const pot = Number((potText ?? '').replace(/[^0-9-]/g, ''));
    const stacks = seats.reduce((a, s) => a + s.stack, 0);
    const committed = seats.reduce((a, s) => a + s.committed, 0);
    const sheet = document.querySelector('[data-testid="stats-sheet"]');
    const buttons = [...document.querySelectorAll('.controls button')].map(b => ({
      id: b.dataset.testid, label: b.textContent, disabled: b.disabled,
    }));
    const coachRoot = document.querySelector('.coach');
    return {
      awaiting: document.querySelector('[data-testid="table-screen"]')?.dataset.awaiting,
      potText, pot,
      board: cards(document.querySelector('[data-testid="board"]')),
      hero: cards(document.querySelector('[data-testid="hero-cards"]')),
      seats,
      stacksSum: stacks,
      committedSum: committed,
      chipTotal: stacks + pot,
      winPct: t('[data-testid="win-pct"]'),
      tiePct: document.querySelector('.stats-tie .stat-value')?.textContent ?? null,
      statsOpen: sheet?.dataset.open, statsWithheld: sheet?.dataset.withheld,
      statsBody: sheet ? [...sheet.querySelectorAll('.stats-cat')].map(r => r.textContent) : [],
      coachHidden: coachRoot?.hidden, coachSeverity: coachRoot?.dataset.severity,
      coachMessage: t('[data-testid="coach-message"]'),
      coachPrinciple: document.querySelector('.coach-principle')?.textContent ?? null,
      winnerSummary: t('[data-testid="winner-summary"]'),
      sessionOver: t('[data-testid="session-over"]'),
      predictPanel: document.querySelector('[data-testid="predict-panel"]') !== null,
      predictResult: t('[data-testid="predict-result"]'),
      buttons,
      raiseAmount: t('[data-testid="raise-amount"]'),
      bodyScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

export async function shot(page, name) {
  const dir = path.join(ROOT, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `audit-${name}.png`), fullPage: false });
}

export function report(label, d) {
  const line = (k, v) => console.log(`   ${k}: ${v}`);
  console.log(`\n=== ${label} ===`);
  line('awaiting', d.awaiting);
  line('pot', `${d.potText}  (parsed ${d.pot})`);
  line('board', `${d.board.join(' ')} (${d.board.length})`);
  line('hero', d.hero.join(' '));
  for (const s of d.seats) {
    line(`seat${s.id} ${s.name}`, `stack=${s.stack} committed=${s.committed} folded=${s.folded} allin=${s.allin} toAct=${s.toAct} D=${s.dealer} faceUp=[${s.faceUp.join(' ')}] backs=${s.faceDown} arch=${s.archetype ?? '-'}`);
  }
  line('CHIP CHECK', `stacks ${d.stacksSum} + pot ${d.pot} = ${d.chipTotal} (want 20000 + rebuys)`);
  line('committedSum vs pot', `${d.committedSum} vs ${d.pot}`);
  line('stats', `open=${d.statsOpen} withheld=${d.statsWithheld} win=${d.winPct} tie=${d.tiePct} cats=${JSON.stringify(d.statsBody)}`);
  line('coach', `hidden=${d.coachHidden} sev=${d.coachSeverity} msg=${JSON.stringify(d.coachMessage)} principle=${JSON.stringify(d.coachPrinciple)}`);
  line('winner', JSON.stringify(d.winnerSummary));
  line('sessionOver', JSON.stringify(d.sessionOver));
  line('predict', `panel=${d.predictPanel} result=${JSON.stringify(d.predictResult)}`);
  line('buttons', d.buttons.map(b => `${b.id}${b.disabled ? '(off)' : ''}="${b.label}"`).join(' '));
  line('scroll', `${d.bodyScrollHeight} vs viewport ${d.innerHeight}`);
}
