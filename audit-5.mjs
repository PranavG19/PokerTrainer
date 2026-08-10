import { launch, setViewport, waitIdle, dump, shot, report } from './audit-lib.mjs';

/**
 * Hunt A: a hero decision point where the coach panel is ALREADY visible from an earlier street.
 * Hunt B: every handover, log committedSum (the yellow chip pills) against pot 0.
 */
const seed = Number(process.argv[2] ?? 42);
const { app, page, close } = await launch(seed);
let staleCoachShot = false;
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();

  for (let hand = 1; hand <= 10; hand++) {
    let a = await waitIdle(page);
    let lastCoach = null;
    for (let step = 0; step < 15 && a === 'hero'; step++) {
      const d = await dump(page);
      if (d.coachHidden === false) {
        console.log(`  [hand ${hand}] hero to act on board=${d.board.length} pot=${d.pot} WITH COACH VISIBLE: ${JSON.stringify(d.coachMessage)} (raised at previous decision: ${JSON.stringify(lastCoach)})`);
        if (!staleCoachShot) {
          report(`A: stale coach line at a NEW decision (hand ${hand}, board ${d.board.length})`, d);
          await shot(page, `A-stale-coach-seed${seed}-h${hand}-b${d.board.length}`);
          staleCoachShot = true;
        }
      }
      // passive line
      let clicked = null;
      for (const id of ['btn-check', 'btn-call', 'btn-fold']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); clicked = id; break; }
      }
      if (clicked === null) throw new Error('DEAD END no action');
      const after = await dump(page);
      lastCoach = after.coachHidden === false ? after.coachMessage : null;
      a = await waitIdle(page);
    }
    const d = await dump(page);
    const standing = d.seats.filter(s => !s.folded).length;
    console.log(`hand ${hand} handover: pot=${d.pot} committedPills=${d.committedSum} (${d.seats.map(s=>s.committed).join('/')}) stacks=${d.stacksSum} displayedTotal=${d.stacksSum + d.committedSum} standing=${standing} summary=${JSON.stringify(d.winnerSummary)}`);
    if (d.sessionOver) { report('busted', d); break; }
    await page.locator('[data-testid="next-hand"]').click();
  }
} finally {
  await close();
}
