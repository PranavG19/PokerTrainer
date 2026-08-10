import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/** State 12: busted hero who does NOT rebuy -> New session. Plus: why did the 3rd bust stall? */
const { app, page, close } = await launch({ seed: 2 });
try {
  await setViewport(app, page, 1100, 760);
  await sitDown(page);
  await enableCoach(page);

  async function shove() {
    await commit(page, 'raise', 'sure');
    const raise = page.locator('[data-testid="btn-raise"]');
    if (await raise.isEnabled()) {
      await page.locator('[data-testid="preset-allin"]').click();
      await raise.click();
      return;
    }
    for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
      const b = page.locator(`[data-testid="${id}"]`);
      if (await b.isEnabled()) { await b.click(); return; }
    }
    throw new Error('DEAD END: hero turn, no enabled action');
  }

  // bust #1
  for (let a = 0; a < 40; a++) {
    if ((await waitIdle(page)) === 'handover') break;
    await shove();
  }
  let d = await dump(page);
  console.log('bust1 hero stack', d.seats[0].stack);
  await page.locator('[data-testid="btn-rebuy"]').click();

  // bust #2
  for (let hand = 0; hand < 40; hand++) {
    for (let a = 0; a < 40; a++) {
      if ((await waitIdle(page)) === 'handover') break;
      await shove();
    }
    d = await dump(page);
    if (d.seats[0].stack === 0) break;
    await page.locator('[data-testid="next-hand"]').click();
  }
  await page.locator('[data-testid="btn-rebuy"]').click();

  // Now watch every hand of the 3rd attempt: why does it not bust?
  for (let hand = 0; hand < 25; hand++) {
    for (let a = 0; a < 40; a++) {
      if ((await waitIdle(page)) === 'handover') break;
      await shove();
    }
    d = await dump(page);
    console.log(`hand ${hand}: hero=${d.seats[0].stack} ada=${d.seats[1].stack}(f=${d.seats[1].folded}) bo=${d.seats[2].stack} cy=${d.seats[3].stack} chips=${d.chipTotal} winner=${JSON.stringify(d.winnerSummary)} buttons=${d.buttons.join(' ')}`);
    if (d.seats[0].stack === 0) break;
    if (hand === 3) { await shot(page, 'cg-villain-busted-table'); report('villain-busted table state', d); }
    await page.locator('[data-testid="next-hand"]').click();
  }

  // If we reached a bust, refuse the rebuy.
  d = await dump(page);
  if (d.buttons.some((b) => b.includes('btn-rebuy'))) {
    report('12a bust, refusing rebuy', d);
    await shot(page, 'cg-12a-bust-refuse');
    await page.locator('[data-testid="new-session"]').click();
    await page.waitForSelector('[data-testid="home-screen"]');
    await settle(page);
    const home = await page.evaluate(() => ({
      bankroll: document.querySelector('[data-testid="bankroll"]')?.textContent,
      buttons: [...document.querySelectorAll('button')].map((b) => `${b.dataset.testid ?? b.className}${b.disabled ? '(off)' : ''}`),
      text: document.body.innerText,
    }));
    console.log('\n===== 12b HOME after refusing rebuy =====');
    console.log(JSON.stringify(home, null, 1));
    await shot(page, 'cg-12b-home-no-rebuy');
    // And sitting down again from here: playable? coached mode still on?
    await page.locator('[data-testid="new-hand"]').click();
    await page.locator('[data-testid="table-screen"]').waitFor();
    const aw = await waitIdle(page);
    await settle(page);
    report(`12c new table after refusing rebuy (awaiting=${aw})`, await dump(page));
    await shot(page, 'cg-12c-new-table');
  } else {
    console.log('never busted again; buttons=', d.buttons.join(' '));
  }
} finally {
  await close();
}
