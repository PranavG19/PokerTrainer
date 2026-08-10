import { launch, seedState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, setViewport, frames } from './nt-lib.mjs';

function base(over = {}) {
  return {
    bankroll: 10000, hands: [], rebuys: 0,
    stats: { handsPlayed: 0, vpipHands: 0, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    calibration: { total: 0, correct: 0, sureWrong: 0 }, coachedMode: false, ...over,
  };
}
const hand = (n, net, extra = {}) => ({ handNumber: n, hole: ['As', 'Kd'], board: ['2s', '5d', '9c', 'Jd', 'Kh'], net, vpip: true, pfr: false, grades: [], ...extra });

async function bars(page, label) {
  const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid="leak-row"]')].map((r) => {
    const bar = r.querySelector('.leak-bar'); const track = r.querySelector('.leak-track');
    const cost = r.querySelector('[data-testid="leak-cost"]');
    return { principle: r.dataset.principle, cost: cost.textContent,
      costPx: +cost.getBoundingClientRect().width.toFixed(1), style: bar.style.width,
      barPx: +bar.getBoundingClientRect().width.toFixed(1), trackPx: +track.getBoundingClientRect().width.toFixed(1) };
  }));
  console.log(`\n--- ${label} ---`);
  const top = rows[0];
  for (const r of rows) {
    const bb = Number(/([\d.]+) bb/.exec(r.cost)[1]);
    const topbb = Number(/([\d.]+) bb/.exec(top.cost)[1]);
    console.log(`  ${r.principle.padEnd(16)} cost="${r.cost}" costTextPx=${r.costPx} track=${r.trackPx} BAR=${r.barPx}px  pixel%ofTop=${(r.barPx / top.barPx * 100).toFixed(1)}  true%ofTop=${(bb / topbb * 100).toFixed(1)}`);
  }
  const bad = rows.slice(1).find((r, i) => r.barPx > rows[0].barPx);
  console.log('  INVERTED (a lower-ranked leak draws a LONGER bar): ' + (bad ? `YES → ${bad.principle}` : 'no'));
  return rows;
}

// A) realistic near-tie with a one-character text-length difference
{
  const dir = seedState(base({
    bankroll: 8800,
    hands: [hand(1, -600), hand(2, -300), hand(3, -200), hand(4, -100)],
    stats: { handsPlayed: 4, vpipHands: 3, pfrHands: 1, evLossBb: 20.8,
      leaks: { 'pot odds': 12, 'value or bluff': 3 },
      leakCostBb: { 'pot odds': 10.5, 'value or bluff': 10.3 } },
  }), 'realistic');
  const { page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    await bars(page, 'A) REALISTIC: pot odds 10.5bb (12x) vs value or bluff 10.3bb (3x)');
    await shot(page, 'nt-bars-realistic');
  } finally { await close(); }
}

// B) equal costs, different count text lengths -> bars must be EQUAL
{
  const dir = seedState(base({
    bankroll: 9500,
    hands: [hand(1, -500)],
    stats: { handsPlayed: 20, vpipHands: 10, pfrHands: 4, evLossBb: 24,
      leaks: { 'pot odds': 8, ranges: 100 },
      leakCostBb: { 'pot odds': 12.0, ranges: 12.0 } },
  }), 'equalcost');
  const { page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    await bars(page, 'B) IDENTICAL COSTS 12.0 bb each, counts 8x vs 100x');
    await shot(page, 'nt-bars-equalcost');
  } finally { await close(); }
}

// C) hand-log cap: handsPlayed > hands.length (MAX_HAND_LOG=500)
{
  const hands = Array.from({ length: 500 }, (_, i) => hand(113 + i, i % 3 === 0 ? 40 : -20));
  const dir = seedState(base({
    bankroll: 9400, hands, rebuys: 1,
    stats: { handsPlayed: 612, vpipHands: 300, pfrHands: 120, evLossBb: 55.5,
      leaks: { 'pot odds': 40 }, leakCostBb: { 'pot odds': 55.5 } },
    calibration: { total: 30, correct: 19, sureWrong: 5 },
  }), 'cap');
  const { page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await openProfile(page);
    const p = await dumpProfile(page);
    console.log('\n--- C) HAND LOG CAP: file handsPlayed=612, hands array length=500 ---');
    console.log('  graph caption      : ' + p.captions[0]);
    console.log('  Lifetime "Hands"   : ' + p.counters.Hands);
    console.log('  graph point count  : ' + p.graphPoints.trim().split(/\s+/).length);
    await shot(page, 'nt-cap-profile');
  } finally { await close(); }
}

// D) clipping at both sizes, both tabs, with a full session
{
  const dir = seedState(base({
    bankroll: 9400,
    hands: [hand(1, -600), hand(2, 300), hand(3, -200), hand(4, -100), hand(5, 0)],
    rebuys: 1,
    stats: { handsPlayed: 5, vpipHands: 4, pfrHands: 2, evLossBb: 33,
      leaks: { 'pot odds': 4, ranges: 2, 'value or bluff': 1 },
      leakCostBb: { 'pot odds': 18, ranges: 10, 'value or bluff': 5 } },
    calibration: { total: 9, correct: 5, sureWrong: 3 },
  }), 'clip');
  const { app, page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    for (const [w, h] of [[1100, 760], [900, 640]]) {
      await setViewport(app, page, w, h);
      await openPlay(page);
      await page.waitForSelector('[data-testid="home-screen"]');
      await frames(page, 20);
      const clip = await page.evaluate(() => {
        const out = { innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight, canScroll: null, clipped: [] };
        const before = window.scrollY; window.scrollTo(0, 99999); out.canScroll = window.scrollY > before; window.scrollTo(0, before);
        const targets = [...document.querySelectorAll('[data-testid="hand-row"], .counter, .leak-row, .rebuy-summary, .calibration, .empty-state')];
        for (const t of targets) {
          const r = t.getBoundingClientRect();
          if (r.bottom > window.innerHeight) out.clipped.push({ what: t.className + (t.dataset.hand ? ' #' + t.dataset.hand : '') + ' :: ' + (t.textContent ?? '').slice(0, 40), top: +r.top.toFixed(0), bottom: +r.bottom.toFixed(0), pxHidden: +(r.bottom - window.innerHeight).toFixed(0) });
        }
        return out;
      });
      console.log(`\n--- D) HOME clipping @${w}x${h} ---\n` + JSON.stringify(clip, null, 2));
      await shot(page, `nt-clip-home-${w}x${h}`);

      await openProfile(page);
      await frames(page, 20);
      const clipP = await page.evaluate(() => {
        const out = { innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight, canScroll: null, clipped: [] };
        const before = window.scrollY; window.scrollTo(0, 99999); out.canScroll = window.scrollY > before; window.scrollTo(0, before);
        for (const t of [...document.querySelectorAll('.counter, .leak-row, .rebuy-summary, .calibration, .profile-section > .stat-label')]) {
          const r = t.getBoundingClientRect();
          if (r.bottom > window.innerHeight) out.clipped.push({ what: t.className + ' :: ' + (t.textContent ?? '').slice(0, 40), top: +r.top.toFixed(0), bottom: +r.bottom.toFixed(0), pxHidden: +(r.bottom - window.innerHeight).toFixed(0) });
        }
        return out;
      });
      console.log(`\n--- D) PROFILE clipping @${w}x${h} ---\n` + JSON.stringify(clipP, null, 2));
      await shot(page, `nt-clip-profile-${w}x${h}`);
    }
  } finally { await close(); }
}
