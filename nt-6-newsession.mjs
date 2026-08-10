import { launch, freshDir, readState, shot, dumpHome, dumpProfile, openProfile, openPlay, log, waitIdle, frames, clickFirstEnabled } from './nt-lib.mjs';

const dir = freshDir('newsess');
const { page, close } = await launch({ seed: 2, userDataDir: dir });
try {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="new-hand"]');
  await page.waitForSelector('[data-testid="table-screen"]');

  // shove every hand until busted
  for (let hand = 1; hand <= 14; hand++) {
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
    const busted = await page.evaluate(() => Number(document.querySelector('[data-testid="seat"][data-seat-id="0"] [data-testid="seat-stack"]').textContent));
    if (busted === 0) { console.log(`busted after hand ${hand}`); break; }
    await page.click('[data-testid="next-hand"]');
  }

  const overText = await page.textContent('[data-testid="session-over"]');
  console.log('\nSESSION-OVER TEXT: ' + JSON.stringify(overText));
  await shot(page, 'nt-newsess-busted');

  const stBust = readState(dir);
  console.log('FILE at bust: bankroll=' + stBust.bankroll + ' rebuys=' + stBust.rebuys + ' handsPlayed=' + stBust.stats.handsPlayed + ' netSum=' + stBust.hands.reduce((a, h) => a + h.net, 0));

  // take the "New session" branch (NOT rebuy)
  await page.click('[data-testid="new-session"]');
  await page.waitForSelector('[data-testid="home-screen"]');
  await frames(page, 20);
  const home = await dumpHome(page);
  console.log('\nHOME after New session: bankroll=' + home.bankrollText);
  await openProfile(page);
  const p1 = await dumpProfile(page);
  console.log('PROFILE after New session: rebuys=' + p1.rebuyCount + ' caption=' + JSON.stringify(p1.rebuyCaption) + ' hands=' + p1.counters.Hands);
  await shot(page, 'nt-newsess-profile-after');

  // now actually sit down again: does the hero get 5000 free chips with no rebuy counted?
  await openPlay(page);
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.click('[data-testid="new-hand"]');
  await page.waitForSelector('[data-testid="table-screen"]');
  await waitIdle(page);
  const t = await page.evaluate(() => ({
    stacks: [...document.querySelectorAll('[data-testid="seat-stack"]')].map(s => Number(s.textContent)),
    committed: [...document.querySelectorAll('[data-testid="seat-committed"]')].map(s => Number(s.textContent)),
    pot: Number((document.querySelector('[data-testid="pot"]').textContent ?? '').replace(/[^0-9]/g, '')),
  }));
  const total = t.stacks.reduce((a, b) => a + b, 0) + t.pot;
  console.log('\nNEW TABLE after busting+New session: stacks=' + JSON.stringify(t.stacks) + ' pot=' + t.pot + ' TOTAL=' + total + ' (4x5000=20000)');
  await shot(page, 'nt-newsess-fresh-table');

  const st = readState(dir);
  console.log('FILE now: bankroll=' + st.bankroll + ' rebuys=' + st.rebuys + ' handsPlayed=' + st.stats.handsPlayed);
  console.log('bankroll check: 10000 + sum(nets) = ' + (10000 + st.hands.reduce((a, h) => a + h.net, 0)) + '  vs file ' + st.bankroll);
} finally { await close(); }
console.log('DIR=' + dir);
