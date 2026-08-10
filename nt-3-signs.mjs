import { launch, seedState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, setViewport, frames } from './nt-lib.mjs';

function mk({ nets, rebuys = 0, leaks = {}, leakCostBb = {}, calibration = { total: 0, correct: 0, sureWrong: 0 }, bankrollOverride }) {
  const hands = nets.map((net, i) => ({
    handNumber: i + 1, hole: ['As', 'Kd'], board: ['2s', '5d', '9c', 'Jd', 'Kh'],
    net, vpip: true, pfr: i % 2 === 0, grades: [],
  }));
  const evLossBb = Object.values(leakCostBb).reduce((a, b) => a + b, 0);
  return {
    bankroll: bankrollOverride ?? (10000 + nets.reduce((a, b) => a + b, 0)),
    hands, rebuys,
    stats: { handsPlayed: hands.length, vpipHands: hands.length, pfrHands: hands.filter((_, i) => i % 2 === 0).length, evLossBb, leaks, leakCostBb },
    calibration, coachedMode: false,
  };
}

async function look(tag, fixture, extra) {
  const dir = seedState(fixture, tag);
  const { app, page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await frames(page, 20);
    const home = await dumpHome(page);
    log(`${tag} HOME`, { bankrollText: home.bankrollText, fileBankroll: fixture.bankroll, rows: home.rows.map(r => `${r.hand} ${r.net} ${r.netClass} ${r.netColor}`), scroll: `${home.scrollHeight}/${home.innerHeight}`, innerText: home.innerText });
    await shot(page, `nt-${tag}-home`);
    await openProfile(page);
    const p = await dumpProfile(page);
    log(`${tag} PROFILE`, p);
    await shot(page, `nt-${tag}-profile`);
    if (extra) await extra({ app, page, dir });
  } finally { await close(); }
}

// State 3a: pure winning session
await look('s3a-win', mk({ nets: [400, 250, 900, 120, 60] }));

// State 3b: pure losing session
await look('s3b-loss', mk({ nets: [-400, -250, -900, -120, -60] }));

// State: bankroll driven negative by rebuys (reachable: bust 3x)
await look('s3c-negative', mk({ nets: [-5000, -5000, -5000], rebuys: 3 }), async ({ page }) => {
  const scrollable = await page.evaluate(() => {
    const before = window.scrollY;
    window.scrollTo(0, 9999);
    const after = window.scrollY;
    return { before, after, scrollHeight: document.documentElement.scrollHeight, innerHeight: window.innerHeight,
      lifetimeVisible: (() => {
        const el = [...document.querySelectorAll('.profile-section')].find(s => s.querySelector('.stat-label')?.textContent === 'Lifetime');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      })() };
  });
  console.log('\nSCROLL PROBE (profile)', JSON.stringify(scrollable));
});

// Long principle names + big numbers: does the bar length still match the ratio?
await look('s6b-bars', mk({
  nets: [-1000],
  leaks: { 'pot odds': 1, 'value or bluff': 17, ranges: 3 },
  leakCostBb: { 'pot odds': 120.0, 'value or bluff': 60.0, ranges: 6.0 },
}), async ({ page }) => {
  const bars = await page.evaluate(() => [...document.querySelectorAll('[data-testid="leak-row"]')].map((r) => {
    const bar = r.querySelector('.leak-bar'); const track = r.querySelector('.leak-track');
    return { principle: r.dataset.principle, cost: r.querySelector('[data-testid="leak-cost"]')?.textContent,
      style: bar.style.width, barPx: +bar.getBoundingClientRect().width.toFixed(1), trackPx: +track.getBoundingClientRect().width.toFixed(1) };
  }));
  const top = bars[0].barPx;
  console.log('\nBAR RATIO CHECK');
  for (const b of bars) {
    const declared = Number(/([\d.]+) bb/.exec(b.cost)[1]);
    console.log(`  ${b.principle}: cost=${declared}bb  style=${b.style}  barPx=${b.barPx} (track ${b.trackPx})  pixelRatio=${(b.barPx / top * 100).toFixed(1)}%  trueRatio=${(declared / 120 * 100).toFixed(1)}%`);
  }
});
