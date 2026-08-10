import { launch, seedState, shot, dumpHome, dumpProfile, openProfile, setViewport, frames } from './nt-lib.mjs';

const dir = seedState({
  bankroll: 9700,
  hands: [
    { handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [] },
    { handNumber: 2, hole: ['7h', '7c'], board: [], net: -600, vpip: true, pfr: false, grades: [] },
    { handNumber: 3, hole: ['Qs', 'Jh'], board: [], net: 0, vpip: false, pfr: false, grades: [] },
    { handNumber: 4, hole: ['Td', 'Ts'], board: [], net: 300, vpip: true, pfr: true, grades: [] },
  ],
  rebuys: 1,
  stats: { handsPlayed: 4, vpipHands: 2, pfrHands: 1, evLossBb: 49,
    leaks: { 'pot odds': 137, ranges: 1, 'value or bluff': 4 },
    leakCostBb: { 'pot odds': 25.0, ranges: 24.0, 'value or bluff': 6.0 } },
  calibration: { total: 9, correct: 5, sureWrong: 3 }, coachedMode: false,
}, 'after');

const { app, page, close } = await launch({ seed: 42, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  const h = await dumpHome(page);
  console.log('HOME rows: ' + h.rows.map(r => `#${r.hand} "${r.net}" ${r.netClass} ${r.netColor}`).join(' | '));
  await shot(page, 'nt-after-home');
  await openProfile(page);
  await shot(page, 'nt-after-profile');
  await setViewport(app, page, 900, 640);
  await shot(page, 'nt-after-profile-900x640');
} finally { await close(); }
