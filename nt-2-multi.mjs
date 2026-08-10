import { launch, seedState, readState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, setViewport, frames } from './nt-lib.mjs';

/** Five hands, several DIFFERENT principles, cost and count disagreeing, a loss overall. */
const hands = [
  { handNumber: 1, hole: ['As', 'Kd'], board: ['2s', '5d', '9c', 'Jd', 'Kh'], net: -1200, vpip: true, pfr: true,
    grades: [{ severity: 'serious', principle: 'pot odds', evLossBb: 4.0 }] },
  { handNumber: 2, hole: ['7h', '7c'], board: ['2s', '5d', '9c'], net: -50, vpip: false, pfr: false,
    grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 1.0 }] },
  { handNumber: 3, hole: ['Qs', 'Jh'], board: ['2s', '5d', '9c', 'Jd'], net: 900, vpip: true, pfr: false,
    grades: [{ severity: 'serious', principle: 'ranges', evLossBb: 9.5 }] },
  { handNumber: 4, hole: ['2c', '9d'], board: ['2s', '5d', '9c', 'Jd', 'Kh'], net: -2000, vpip: true, pfr: false,
    grades: [{ severity: 'serious', principle: 'value or bluff', evLossBb: 22.0 },
             { severity: 'notable', principle: 'pot odds', evLossBb: 1.5 }] },
  { handNumber: 5, hole: ['Td', 'Ts'], board: ['2s', '5d', '9c', 'Jd', 'Kh'], net: 300, vpip: true, pfr: true,
    grades: [{ severity: 'notable', principle: 'pot odds', evLossBb: 0.8 }] },
];
const leaks = {}; const leakCostBb = {}; let evLossBb = 0;
for (const h of hands) for (const g of h.grades) {
  leaks[g.principle] = (leaks[g.principle] ?? 0) + 1;
  leakCostBb[g.principle] = (leakCostBb[g.principle] ?? 0) + g.evLossBb;
  evLossBb += g.evLossBb;
}
const netSum = hands.reduce((a, h) => a + h.net, 0);
const fixture = {
  bankroll: 10000 + netSum - 5000, // two rebuys' worth of loss already booked below
  hands,
  rebuys: 2,
  stats: { handsPlayed: hands.length, vpipHands: hands.filter(h => h.vpip).length, pfrHands: hands.filter(h => h.pfr).length, evLossBb, leaks, leakCostBb },
  calibration: { total: 7, correct: 4, sureWrong: 2 },
  coachedMode: true,
};
console.log('FIXTURE arithmetic: netSum=' + netSum + ' evLossBb=' + evLossBb + ' leaks=' + JSON.stringify(leaks) + ' costs=' + JSON.stringify(leakCostBb) + ' bankroll=' + fixture.bankroll);

const dir = seedState(fixture, 'multi');
const { app, page, close } = await launch({ seed: 42, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  log('S3/S6 HOME 5 hands, net loss (DOM)', await dumpHome(page));
  await shot(page, 'nt-s3-home-5hands-loss');

  await openProfile(page);
  log('S6/S7 PROFILE 5 hands + rebuys + calibration (DOM)', await dumpProfile(page));
  await shot(page, 'nt-s6-profile-5hands');
  // full page so I can see what's below the fold
  await page.screenshot({ path: 'screenshots/audit-nt-s6-profile-5hands-full.png', fullPage: true });

  // ---- 900x640 both tabs
  await setViewport(app, page, 900, 640);
  log('S9 PROFILE 900x640 (DOM)', await dumpProfile(page));
  await shot(page, 'nt-s9-profile-900x640');
  await openPlay(page);
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  log('S9 HOME 900x640 (DOM)', await dumpHome(page));
  await shot(page, 'nt-s9-home-900x640');
} finally {
  await close();
}
console.log('DIR=' + dir);
