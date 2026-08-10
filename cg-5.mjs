import { launch, setViewport, sitDown, waitIdle, dump, report, shot, settle } from './cg-lib.mjs';

/**
 * Does the stats sheet at HANDOVER contradict the winner line? At showdown the board is complete
 * and every hand is known, but the sheet still computes equity vs RANDOM opponents.
 * Scan seeds: hero plays passively to showdown, then compare win% against who actually won.
 */
const rows = [];
for (const seed of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]) {
  const { app, page, close } = await launch({ seed });
  try {
    await setViewport(app, page, 1100, 760);
    await sitDown(page);
    for (let i = 0; i < 30; i++) {
      if ((await waitIdle(page)) === 'handover') break;
      for (const id of ['btn-check', 'btn-call']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); break; }
      }
    }
    await settle(page);
    const d = await dump(page);
    const heroFolded = d.seats[0].folded;
    const heroWon = (d.winnerSummary ?? '').includes('You wins');
    rows.push({ seed, board: d.board.length, heroFolded, heroWon, win: d.win, tie: d.tie, winner: d.winnerSummary, withheld: d.withheld, cats: d.cats });
    if (!heroFolded && !heroWon && d.board.length === 5) {
      await shot(page, `cg-handover-hero-lost-seed${seed}`);
      report(`HANDOVER hero LOST showdown seed ${seed}`, d);
    }
  } finally {
    await close();
  }
}
console.log('\nSEED TABLE');
for (const r of rows) console.log(JSON.stringify(r));
