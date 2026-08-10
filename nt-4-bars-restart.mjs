import { launch, seedState, readState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, frames, playHand, waitIdle } from './nt-lib.mjs';

// ---------- A) bar-width inversion probe ----------
// Ranked 1st by cost but with a LONG cost string; 2nd is nearly as expensive with a SHORT string.
const fixtureA = {
  bankroll: 9000,
  hands: [{ handNumber: 1, hole: ['As', 'Kd'], board: [], net: -1000, vpip: true, pfr: false, grades: [] }],
  rebuys: 0,
  stats: {
    handsPlayed: 1, vpipHands: 1, pfrHands: 0, evLossBb: 49,
    leaks: { 'pot odds': 137, ranges: 1 },
    leakCostBb: { 'pot odds': 25.0, ranges: 24.0 },
  },
  calibration: { total: 0, correct: 0, sureWrong: 0 },
  coachedMode: false,
};
{
  const dir = seedState(fixtureA, 'bars');
  const { page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    const bars = await page.evaluate(() => [...document.querySelectorAll('[data-testid="leak-row"]')].map((r) => {
      const bar = r.querySelector('.leak-bar'); const track = r.querySelector('.leak-track');
      const cost = r.querySelector('[data-testid="leak-cost"]');
      return { rank: null, principle: r.dataset.principle, cost: cost.textContent,
        costPx: +cost.getBoundingClientRect().width.toFixed(1),
        style: bar.style.width, barPx: +bar.getBoundingClientRect().width.toFixed(1),
        trackPx: +track.getBoundingClientRect().width.toFixed(1) };
    }));
    console.log('\n===== BAR INVERSION PROBE =====');
    for (const [i, b] of bars.entries()) {
      console.log(`  rank${i + 1} ${b.principle}: cost="${b.cost}" (text ${b.costPx}px) style=${b.style} track=${b.trackPx}px BAR=${b.barPx}px`);
    }
    const inverted = bars.length > 1 && bars[1].barPx > bars[0].barPx;
    console.log(`  => rank-1 bar ${bars[0].barPx}px vs rank-2 bar ${bars[1].barPx}px : INVERTED=${inverted}`);
    await shot(page, 'nt-bars-inversion');
  } finally { await close(); }
}

// ---------- B) restart persistence (state 8) ----------
{
  const { launch: l } = await import('./nt-lib.mjs');
  const dir = seedState({
    bankroll: 11200,
    hands: [
      { handNumber: 1, hole: ['As', 'Kd'], board: ['2s', '5d', '9c'], net: 700, vpip: true, pfr: true, grades: [] },
      { handNumber: 2, hole: ['7h', '7c'], board: ['2s', '5d', '9c', 'Jd', 'Kh'], net: 500, vpip: true, pfr: false, grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1.2 }] },
    ],
    rebuys: 2,
    stats: { handsPlayed: 2, vpipHands: 2, pfrHands: 1, evLossBb: 1.2, leaks: { 'pot odds': 1 }, leakCostBb: { 'pot odds': 1.2 } },
    calibration: { total: 5, correct: 3, sureWrong: 1 },
    coachedMode: false,
  }, 'restart');

  const before = {};
  {
    const { page, close } = await l({ seed: 42, userDataDir: dir });
    try {
      await page.waitForSelector('[data-testid="home-screen"]');
      await frames(page, 20);
      const h = await dumpHome(page);
      await openProfile(page);
      const p = await dumpProfile(page);
      before.bankroll = h.bankrollText; before.rows = h.rows.map(r => `${r.hand}${r.net}`);
      before.profile = { rebuy: p.rebuyCaption, cal: p.calibration.text, counters: p.counters, graph: p.graphPoints, leaks: p.leaks.map(l2 => `${l2.principle}:${l2.cost}`) };
      await shot(page, 'nt-s8-before-restart');
    } finally { await close(); }
  }
  // restart, same dir, no play at all
  const after = {};
  {
    const { page, close } = await l({ seed: 42, userDataDir: dir });
    try {
      await page.waitForSelector('[data-testid="home-screen"]');
      await frames(page, 20);
      const h = await dumpHome(page);
      await openProfile(page);
      const p = await dumpProfile(page);
      after.bankroll = h.bankrollText; after.rows = h.rows.map(r => `${r.hand}${r.net}`);
      after.profile = { rebuy: p.rebuyCaption, cal: p.calibration.text, counters: p.counters, graph: p.graphPoints, leaks: p.leaks.map(l2 => `${l2.principle}:${l2.cost}`) };
      await shot(page, 'nt-s8-after-restart');
    } finally { await close(); }
  }
  log('S8 BEFORE restart', before);
  log('S8 AFTER restart', after);
  console.log('IDENTICAL: ' + (JSON.stringify(before) === JSON.stringify(after)));
  console.log('FILE: ' + JSON.stringify(readState(dir).stats));
}
