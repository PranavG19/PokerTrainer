import { launch, setViewport, waitIdle, dump, shot, report, settle } from './audit-lib.mjs';

const { app, page, close } = await launch(42);
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();
  let awaiting = await waitIdle(page);

  // 1. Preflop, hero to act, stats sheet CLOSED
  let d = await dump(page);
  report('1a preflop hero-to-act STATS CLOSED', d);
  await shot(page, '1a-preflop-stats-closed');

  // 1b stats open
  await page.locator('[data-testid="stats-toggle"]').click();
  await settle(page);
  d = await dump(page);
  report('1b preflop hero-to-act STATS OPEN', d);
  await shot(page, '1b-preflop-stats-open');

  // Play passively, capturing each street where the hero is still in
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    awaiting = await waitIdle(page);
    d = await dump(page);
    const key = `street${d.board.length}`;
    if (awaiting === 'handover') {
      report(`2z handover (board ${d.board.length})`, d);
      await shot(page, 'showdown-handover');
      break;
    }
    if (!seen.has(key)) {
      seen.add(key);
      const label = ['preflop', '?', '?', 'flop', 'turn', 'river'][d.board.length] ?? `board${d.board.length}`;
      report(`2-${label} hero to act`, d);
      await shot(page, `2-${label}`);
    }
    // passive: check else call else fold
    let clicked = null;
    for (const id of ['btn-check', 'btn-call', 'btn-fold']) {
      const b = page.locator(`[data-testid="${id}"]`);
      if (await b.isEnabled()) { await b.click(); clicked = id; break; }
    }
    if (clicked === null) throw new Error('DEAD END: hero turn with no enabled action');
    console.log(`   -> clicked ${clicked}`);
  }
} finally {
  await close();
}
