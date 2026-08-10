import fs from 'node:fs';
import path from 'node:path';
import { launch, freshDir, shot, dumpHome, dumpProfile, openProfile, openPlay, log, playHand, waitIdle, readState, STATE_FILE, frames } from './nt-lib.mjs';

const dir = freshDir('fresh');
console.log('userDataDir', dir, 'files before launch:', fs.readdirSync(dir));

const { app, page, close } = await launch({ seed: 42, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  log('S1 HOME fresh (DOM)', await dumpHome(page));
  console.log('state file exists after boot?', fs.existsSync(path.join(dir, STATE_FILE)));
  await shot(page, 'nt-s1-home-fresh');

  await openProfile(page);
  log('S4 PROFILE zero hands (DOM)', await dumpProfile(page));
  await shot(page, 'nt-s4-profile-zero');

  // ---- 1 hand
  await openPlay(page);
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="new-hand"]');
  await page.waitForSelector('[data-testid="table-screen"]');
  await waitIdle(page);
  await playHand(page);
  // wait for persistence
  for (let i = 0; i < 100; i++) {
    try { if (readState(dir).stats.handsPlayed === 1) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const st1 = readState(dir);
  console.log('\nPERSISTED after 1 hand:', JSON.stringify({ bankroll: st1.bankroll, hands: st1.hands.map(h => ({ n: h.handNumber, net: h.net, vpip: h.vpip, pfr: h.pfr, grades: h.grades })), stats: st1.stats, rebuys: st1.rebuys, calibration: st1.calibration }, null, 2));

  await openProfile(page);
  await openPlay(page);
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  log('S2 HOME after 1 hand (DOM)', await dumpHome(page));
  await shot(page, 'nt-s2-home-1hand');

  await openProfile(page);
  log('S5 PROFILE 1 hand (DOM)', await dumpProfile(page));
  await shot(page, 'nt-s5-profile-1hand');
} finally {
  await close();
}
console.log('\nDIR=' + dir);
