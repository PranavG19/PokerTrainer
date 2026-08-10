import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/** Hunt: bust every villain by shoving every hand, then see what the table offers. */
const seed = Number(process.argv[2] ?? 42);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();

  for (let hand = 1; hand <= 30; hand++) {
    let a = await waitIdle(page);
    for (let step = 0; step < 15 && a === 'hero'; step++) {
      const allin = page.locator('[data-testid="preset-allin"]');
      const raise = page.locator('[data-testid="btn-raise"]');
      if (await allin.isEnabled() && await raise.isEnabled()) {
        await allin.click(); await raise.click();
      } else {
        let clicked = false;
        for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
          const b = page.locator(`[data-testid="${id}"]`);
          if (await b.isEnabled()) { await b.click(); clicked = true; break; }
        }
        if (!clicked) throw new Error(`DEAD END hand ${hand}: hero turn, no enabled action`);
      }
      a = await waitIdle(page);
    }
    const d = await dump(page);
    const liveVillains = d.seats.filter(s => s.id !== 0 && s.stack > 0).length;
    console.log(`hand ${hand}: heroStack=${d.seats[0].stack} liveVillains=${liveVillains} stacks=${d.seats.map(s=>s.stack).join('/')} pillSum=${d.committedSum} pot=${d.pot} summary=${JSON.stringify(d.winnerSummary)} buttons=${d.buttons.map(b=>b.id).join(',')}`);
    if (liveVillains === 0) {
      report(`D: every villain is busted (hand ${hand})`, d);
      await shot(page, `D-all-villains-busted-seed${seed}-h${hand}`);
      // Click Next hand a few times and see whether anything can happen.
      for (let k = 0; k < 3; k++) {
        const next = page.locator('[data-testid="next-hand"]');
        if (await next.count() === 0) { console.log('  no next-hand button'); break; }
        await next.click();
        const a2 = await waitIdle(page);
        const dd = await dump(page);
        console.log(`  after Next hand #${k + 1}: awaiting=${a2} stacks=${dd.seats.map(s=>s.stack).join('/')} pot=${dd.pot} hero cards=${dd.hero.join(' ')} summary=${JSON.stringify(dd.winnerSummary)} buttons=${dd.buttons.map(b=>b.id+(b.disabled?'(off)':'')).join(',')}`);
        await shot(page, `D-next-hand-${k + 1}-seed${seed}`);
      }
      break;
    }
    if (d.sessionOver) {
      report(`hero busted (hand ${hand})`, d);
      await shot(page, `D-hero-busted-seed${seed}-h${hand}`);
      await page.locator('[data-testid="btn-rebuy"]').click();
      await waitIdle(page);
      const dd = await dump(page);
      report('after rebuy', dd);
      await shot(page, `D-after-rebuy-seed${seed}`);
      continue;
    }
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
