import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/**
 * Hunt: a hero decision where the coach line still on screen quotes a POT that differs from the
 * live "Pot N" readout, and the equity it quotes is for a previous street.
 */
const seed = 42;
const width = Number(process.argv[2] ?? 1100);
const height = Number(process.argv[3] ?? 760);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, width, height);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();
  let shots = 0;

  for (let hand = 1; hand <= 12 && shots < 2; hand++) {
    let a = await waitIdle(page);
    for (let step = 0; step < 15 && a === 'hero'; step++) {
      const d = await dump(page);
      if (d.coachHidden === false) {
        const m = /(?:Calling|Checking).*?(?:into a (\d+) pot|later street)/.exec(d.coachMessage ?? '');
        const quotedPot = m?.[1] ? Number(m[1]) : null;
        console.log(`hand ${hand} board=${d.board.length}: livePot=${d.pot} coachQuotedPot=${quotedPot} winPct=${d.winPct} coach=${JSON.stringify(d.coachMessage)}`);
        if (quotedPot !== null && quotedPot !== d.pot && shots < 2) {
          report(`G: coach line quotes pot ${quotedPot} while "Pot ${d.pot}" is on screen (hand ${hand})`, d);
          await shot(page, `G-coach-pot-mismatch-h${hand}-${width}x${height}`);
          shots++;
        }
      }
      let clicked = null;
      for (const id of ['btn-check', 'btn-call']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); clicked = id; break; }
      }
      if (clicked === null) { await page.locator('[data-testid="btn-fold"]').click(); }
      a = await waitIdle(page);
    }
    const d = await dump(page);
    if (d.sessionOver) break;
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
