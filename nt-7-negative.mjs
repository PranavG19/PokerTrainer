import { launch, freshDir, seedState, readState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, waitIdle, frames, clickFirstEnabled } from './nt-lib.mjs';

// ---------- A) zero-net hand row ----------
{
  const dir = seedState({
    bankroll: 10000,
    hands: [
      { handNumber: 1, hole: ['As', 'Kd'], board: [], net: 0, vpip: false, pfr: false, grades: [] },
      { handNumber: 2, hole: ['7h', '7c'], board: [], net: -50, vpip: false, pfr: false, grades: [] },
      { handNumber: 3, hole: ['Qs', 'Jh'], board: [], net: 50, vpip: true, pfr: false, grades: [] },
    ],
    rebuys: 0,
    stats: { handsPlayed: 3, vpipHands: 1, pfrHands: 0, evLossBb: 0, leaks: {}, leakCostBb: {} },
    calibration: { total: 0, correct: 0, sureWrong: 0 }, coachedMode: false,
  }, 'zeronet');
  const { page, close } = await launch({ seed: 42, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await frames(page, 20);
    const h = await dumpHome(page);
    console.log('\n===== A) ZERO-NET ROW =====');
    for (const r of h.rows) console.log(`  #${r.hand}: text="${r.net}" class=${r.netClass} colour=${r.netColor}`);
    await shot(page, 'nt-zeronet-home');
  } finally { await close(); }
}

// ---------- B) bust 3x, take the rebuy each time, watch bankroll go negative ----------
{
  const dir = freshDir('negative');
  const { page, close } = await launch({ seed: 2, userDataDir: dir });
  try {
    await page.waitForSelector('[data-testid="home-screen"]');
    await page.click('[data-testid="new-hand"]');
    await page.waitForSelector('[data-testid="table-screen"]');

    const stackOf = () => page.evaluate(() => Number(document.querySelector('[data-testid="seat"][data-seat-id="0"] [data-testid="seat-stack"]').textContent));
    let busts = 0;
    for (let hand = 1; hand <= 60 && busts < 3; hand++) {
      for (let a = 0; a < 40; a++) {
        if ((await waitIdle(page)) === 'handover') break;
        const raise = page.locator('[data-testid="btn-raise"]');
        if ((await raise.count()) > 0 && (await raise.isEnabled())) {
          await page.locator('[data-testid="preset-allin"]').click();
          await raise.click();
        } else {
          const c = await clickFirstEnabled(page, ['[data-testid="btn-call"]', '[data-testid="btn-check"]', '[data-testid="btn-fold"]']);
          if (c === null) throw new Error('no action');
        }
      }
      if ((await stackOf()) === 0) {
        busts++;
        const st = readState(dir);
        const tableTotal = await page.evaluate(() => [...document.querySelectorAll('[data-testid="seat-stack"]')].map(s => Number(s.textContent)).reduce((a, b) => a + b, 0)
          + Number((document.querySelector('[data-testid="pot"]').textContent ?? '').replace(/[^0-9]/g, '')));
        console.log(`\nBUST ${busts} after hand ${hand}: file bankroll=${st.bankroll} rebuys=${st.rebuys} chipsOnTable=${tableTotal}`);
        await shot(page, `nt-neg-bust${busts}`);
        if (busts >= 3) break;
        await page.click('[data-testid="btn-rebuy"]');
        continue;
      }
      await page.click('[data-testid="next-hand"]');
    }
    console.log('\n===== B) after 3 busts / 2 rebuys =====');
    const st = readState(dir);
    console.log('FILE: bankroll=' + st.bankroll + ' rebuys=' + st.rebuys + ' handsPlayed=' + st.stats.handsPlayed + ' netSum=' + st.hands.reduce((a, h2) => a + h2.net, 0));

    // Third rebuy: bankroll is already 0, so this hands the hero 5000 chips they do not own.
    const rebuyStillOffered = await page.locator('[data-testid="btn-rebuy"]').count();
    console.log('rebuy still offered at bankroll ' + st.bankroll + '? ' + (rebuyStillOffered > 0));
    if (rebuyStillOffered > 0) {
      await page.click('[data-testid="btn-rebuy"]');
      await waitIdle(page);
      const after = await page.evaluate(() => ({
        heroStack: Number(document.querySelector('[data-testid="seat"][data-seat-id="0"] [data-testid="seat-stack"]').textContent),
        heroCommitted: Number(document.querySelector('[data-testid="seat"][data-seat-id="0"] [data-testid="seat-committed"]')?.textContent ?? '0'),
      }));
      const st2 = readState(dir);
      console.log('AFTER 3rd rebuy: heroStack=' + after.heroStack + '+' + after.heroCommitted + '  file bankroll=' + st2.bankroll + ' rebuys=' + st2.rebuys);
      await shot(page, 'nt-neg-after-3rd-rebuy');

      // play this "free" stack away so the bankroll is forced negative
      for (let hand = 1; hand <= 10; hand++) {
        for (let a = 0; a < 40; a++) {
          if ((await waitIdle(page)) === 'handover') break;
          const raise = page.locator('[data-testid="btn-raise"]');
          if ((await raise.count()) > 0 && (await raise.isEnabled())) {
            await page.locator('[data-testid="preset-allin"]').click();
            await raise.click();
          } else {
            const c = await clickFirstEnabled(page, ['[data-testid="btn-call"]', '[data-testid="btn-check"]', '[data-testid="btn-fold"]']);
            if (c === null) throw new Error('no action');
          }
        }
        const s = await stackOf();
        const stx = readState(dir);
        if (stx.bankroll < 0) { console.log(`\nBANKROLL WENT NEGATIVE: ${stx.bankroll} after ${stx.stats.handsPlayed} hands, rebuys=${stx.rebuys}`); break; }
        if (s === 0) { await page.click('[data-testid="btn-rebuy"]'); continue; }
        await page.click('[data-testid="next-hand"]');
      }
    }
    // land on Home / Profile and LOOK at it
    const stF = readState(dir);
    await page.click('[data-testid="tab-profile"]');
    await page.waitForSelector('[data-testid="profile-screen"]');
    await frames(page, 20);
    const p = await dumpProfile(page);
    await shot(page, 'nt-neg-profile');
    await openPlay(page);
    await page.waitForSelector('[data-testid="home-screen"]');
    await frames(page, 20);
    const h = await dumpHome(page);
    await shot(page, 'nt-neg-home');
    console.log('\nFINAL FILE : bankroll=' + stF.bankroll + ' rebuys=' + stF.rebuys + ' handsPlayed=' + stF.stats.handsPlayed + ' netSum=' + stF.hands.reduce((a, x) => a + x.net, 0));
    console.log('HOME shows : "' + h.bankrollText + '"');
    console.log('PROFILE    : rebuys=' + p.rebuyCount + ' "' + p.rebuyCaption + '" hands=' + p.counters.Hands + ' graphLastPoint=' + p.graphPoints.trim().split(/\s+/).slice(-1));
  } finally { await close(); }
  console.log('DIR=' + dir);
}
