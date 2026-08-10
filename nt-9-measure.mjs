import { launch, seedState, log } from './nt-lib.mjs';

const dir = seedState({
  bankroll: 9000, hands: [], rebuys: 0,
  stats: { handsPlayed: 30, vpipHands: 20, pfrHands: 8, evLossBb: 300,
    leaks: { 'pot odds': 137, 'value or bluff': 9, ranges: 1 },
    leakCostBb: { 'pot odds': 199.9, 'value or bluff': 100.0, ranges: 1.0 } },
  calibration: { total: 0, correct: 0, sureWrong: 0 }, coachedMode: false,
}, 'measure');

const { page, close } = await launch({ seed: 42, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="tab-profile"]');
  await page.waitForSelector('[data-testid="profile-screen"]');
  const m = await page.evaluate(() => [...document.querySelectorAll('[data-testid="leak-row"]')].map((r) => {
    const p = r.querySelector('.leak-principle'); const c = r.querySelector('.leak-count'); const t = r.querySelector('.leak-track');
    const w = (el) => +el.getBoundingClientRect().width.toFixed(1);
    return { rowWidth: w(r), principle: p.textContent, principlePx: w(p), count: c.textContent, countPx: w(c), trackPx: w(t) };
  }));
  log('WIDEST-CASE MEASUREMENTS', m);
  const list = await page.evaluate(() => {
    const l = document.querySelector('[data-testid="leak-list"]');
    const cs = getComputedStyle(l);
    return { widthPx: +l.getBoundingClientRect().width.toFixed(1), padding: cs.padding };
  });
  console.log('leak-list: ' + JSON.stringify(list));
} finally { await close(); }
