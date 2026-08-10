import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/** Hunt: a handover where the hero reached showdown and LOST, with the stats sheet open. */
const seed = Number(process.argv[2] ?? 42);
const width = Number(process.argv[3] ?? 1100);
const height = Number(process.argv[4] ?? 760);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, width, height);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();
  await waitIdle(page);
  await page.locator('[data-testid="stats-toggle"]').click(); // open the sheet and keep it open

  for (let hand = 1; hand <= 12; hand++) {
    let a = await waitIdle(page);
    for (let step = 0; step < 15 && a === 'hero'; step++) {
      let clicked = null;
      for (const id of ['btn-check', 'btn-call']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); clicked = id; break; }
      }
      if (clicked === null) throw new Error('DEAD END: no check/call available');
      a = await waitIdle(page);
    }
    const d = await dump(page);
    const heroFolded = d.seats[0].folded;
    const heroWon = /\bYou wins\b/.test(d.winnerSummary ?? '');
    const revealed = d.seats.filter(s => !s.folded && s.id !== 0 && s.faceUp.length === 2).length;
    console.log(`seed ${seed} hand ${hand}: heroFolded=${heroFolded} heroWon=${heroWon} revealed=${revealed} win%=${d.winPct} tie=${d.tiePct} committedPills=${d.seats.map(s=>s.committed).join('/')} summary=${JSON.stringify(d.winnerSummary)}`);
    if (!heroFolded && !heroWon && revealed >= 1) {
      report(`C: handover, hero reached showdown and LOST (seed ${seed} hand ${hand})`, d);
      await shot(page, `C-hero-lost-showdown-seed${seed}-h${hand}-${width}x${height}`);
      break;
    }
    if (d.sessionOver) { report('busted', d); await shot(page, `C-busted-seed${seed}`); break; }
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
