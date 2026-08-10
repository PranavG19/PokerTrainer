import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/** Hunt: hero raises big preflop each hand; find a hand where all villains fold to the hero. */
const seed = Number(process.argv[2] ?? 42);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();

  for (let hand = 1; hand <= 12; hand++) {
    let a = await waitIdle(page);
    // raise pot-size whenever possible; else check/call
    for (let step = 0; step < 12 && a === 'hero'; step++) {
      const potBtn = page.locator('[data-testid="preset-pot"]');
      const raise = page.locator('[data-testid="btn-raise"]');
      if (await potBtn.isEnabled() && await raise.isEnabled()) {
        await potBtn.click(); await raise.click();
      } else {
        let clicked = false;
        for (const id of ['btn-check', 'btn-call', 'btn-fold']) {
          const b = page.locator(`[data-testid="${id}"]`);
          if (await b.isEnabled()) { await b.click(); clicked = true; break; }
        }
        if (!clicked) throw new Error('DEAD END no action');
      }
      a = await waitIdle(page);
    }
    const d = await dump(page);
    const standing = d.seats.filter(s => !s.folded).length;
    const heroWon = (d.winnerSummary ?? '').startsWith('You wins');
    console.log(`seed ${seed} hand ${hand}: standing=${standing} board=${d.board.length} committedSum=${d.committedSum} pot=${d.pot} summary=${JSON.stringify(d.winnerSummary)}`);
    if (standing === 1 && heroWon) {
      report(`4 hero wins uncontested (seed ${seed} hand ${hand})`, d);
      await shot(page, `4-hero-wins-uncontested-seed${seed}-h${hand}`);
      break;
    }
    if (d.sessionOver) { report('busted', d); await shot(page, `4-busted-seed${seed}`); break; }
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
