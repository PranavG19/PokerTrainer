import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

const width = Number(process.argv[2] ?? 900);
const height = Number(process.argv[3] ?? 640);
const { app, page, close } = await launch(42);
try {
  await setViewport(app, page, width, height);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();

  const heroTurnsPerHand = [];
  for (let hand = 1; hand <= 6; hand++) {
    let a = await waitIdle(page);
    let turns = 0;
    for (let step = 0; step < 15 && a === 'hero'; step++) {
      turns++;
      const allin = page.locator('[data-testid="preset-allin"]');
      const raise = page.locator('[data-testid="btn-raise"]');
      if (hand < 5 && await allin.isEnabled() && await raise.isEnabled()) {
        await allin.click(); await raise.click();
      } else {
        let clicked = false;
        for (const id of ['btn-check', 'btn-call', 'btn-fold']) {
          const b = page.locator(`[data-testid="${id}"]`);
          if (await b.isEnabled()) { await b.click(); clicked = true; break; }
        }
        if (!clicked) throw new Error(`DEAD END hand ${hand}`);
      }
      a = await waitIdle(page);
    }
    const d = await dump(page);
    heroTurnsPerHand.push(turns);
    console.log(`hand ${hand}: heroTurns=${turns} pot=${d.pot} pills=${d.seats.map(s=>s.committed).join('/')} summary=${JSON.stringify(d.winnerSummary)} scroll=${d.bodyScrollHeight}/${d.innerHeight}`);
    if (/wins 0\b/.test(d.winnerSummary ?? '')) {
      report(`E3 at ${width}x${height}: "wins 0", hero got ${turns} turns this hand`, d);
      await shot(page, `E3-wins-zero-${width}x${height}`);
      break;
    }
    if (hand === 2) { await shot(page, `F2-stale-pill-${width}x${height}`); const dd = await dump(page); console.log(`  F2 scroll ${dd.bodyScrollHeight}/${dd.innerHeight}`); }
    await page.locator('[data-testid="next-hand"]').click();
  }
  console.log('heroTurnsPerHand', heroTurnsPerHand);
} finally {
  await close();
}
