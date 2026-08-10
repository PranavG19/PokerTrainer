import { launch, freshDir, readState, shot, dumpHome, openProfile, openPlay, waitIdle, frames } from './nt-lib.mjs';

// Fold every hand. A hero on the button posts no blind, so a preflop fold nets exactly 0.
const dir = freshDir('zeroreal');
const { page, close } = await launch({ seed: 42, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="new-hand"]');
  await page.waitForSelector('[data-testid="table-screen"]');
  for (let hand = 1; hand <= 8; hand++) {
    for (let a = 0; a < 40; a++) {
      if ((await waitIdle(page)) === 'handover') break;
      const f = page.locator('[data-testid="btn-fold"]');
      if (await f.isEnabled()) { await f.click(); continue; }
      const c = page.locator('[data-testid="btn-check"]');
      if (await c.isEnabled()) { await c.click(); continue; }
      throw new Error('no action');
    }
    await page.click('[data-testid="next-hand"]');
  }
  for (let i = 0; i < 100; i++) {
    try { if (readState(dir).stats.handsPlayed >= 8) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const st = readState(dir);
  console.log('\nREAL PLAY, fold every hand:');
  console.log('  nets: ' + st.hands.map(h => `#${h.handNumber}=${h.net}`).join(' '));
  console.log('  zero-net hands: ' + st.hands.filter(h => h.net === 0).map(h => h.handNumber).join(',') || '(none)');
  console.log('  bankroll=' + st.bankroll + '  10000+sum=' + (10000 + st.hands.reduce((a, h) => a + h.net, 0)));

  await openProfile(page);
  await openPlay(page);
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  const h = await dumpHome(page);
  console.log('\nHOME rows as rendered:');
  for (const r of h.rows) console.log(`  #${r.hand} "${r.net}" ${r.netClass} ${r.netColor}`);
  await shot(page, 'nt-zeronet-real-home');
} finally { await close(); }
