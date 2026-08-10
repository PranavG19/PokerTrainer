import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/**
 * Reproduce the degenerate blind structure once two villains are busted:
 * the dealer rotation puts BOTH blinds on chipless seats, so a hand is dealt with pot 0.
 */
const seed = 42;
const width = Number(process.argv[2] ?? 1100);
const height = Number(process.argv[3] ?? 760);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, width, height);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();

  for (let hand = 1; hand <= 6; hand++) {
    let a = await waitIdle(page);

    // Capture the PREFLOP hero decision of the target hand (hand 5 = pot 0).
    if (a === 'hero') {
      const pre = await dump(page);
      console.log(`hand ${hand} preflop: pot=${pre.pot} pills=${pre.seats.map(s=>s.committed).join('/')} dealer=${pre.seats.findIndex(s=>s.dealer)} board=${pre.board.length}`);
      if (pre.pot === 0) {
        report(`E: hand dealt with NO blinds posted, pot 0 (hand ${hand})`, pre);
        await shot(page, `E-pot-zero-preflop-${width}x${height}`);
      }
    }

    for (let step = 0; step < 15 && a === 'hero'; step++) {
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
    console.log(`hand ${hand} handover: pot=${d.pot} pills=${d.seats.map(s=>s.committed).join('/')} stacks=${d.seats.map(s=>s.stack).join('/')} summary=${JSON.stringify(d.winnerSummary)}`);
    if (/wins 0\b/.test(d.winnerSummary ?? '')) {
      report(`E2: winner summary says "wins 0" (hand ${hand})`, d);
      await shot(page, `E2-wins-zero-handover-${width}x${height}`);
      break;
    }
    if (hand === 2) {
      report(`F: handover where the hero's whole stack is still rendered as a committed chip pill (hand ${hand})`, d);
      await shot(page, `F-stale-committed-pill-${width}x${height}`);
    }
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
