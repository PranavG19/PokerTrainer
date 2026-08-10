import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/**
 * State 6: coached mode across a street boundary.
 * Also probes: is the withheld win% visible while a VILLAIN is acting (awaiting=ai)?
 * If it is, the gate is decorative for any decision that has a villain acting before it.
 */
const { app, page, close } = await launch({ seed: 8 });
try {
  await setViewport(app, page, 1100, 760);
  await sitDown(page);
  await enableCoach(page);
  await page.locator('[data-testid="stats-toggle"]').click();
  await settle(page);

  console.log('PREFLOP hero turn:', JSON.stringify(await page.evaluate(() => ({
    awaiting: document.querySelector('[data-testid="table-screen"]').dataset.awaiting,
    win: document.querySelector('[data-testid="win-pct"]').textContent,
    withheld: document.querySelector('[data-testid="stats-sheet"]').dataset.withheld,
    board: [...document.querySelectorAll('[data-testid="board"] [data-testid="card"]')].map((c) => c.dataset.card),
  }))));

  await commit(page, 'call', 'guess');
  await page.locator('[data-testid="btn-call"]').click();

  // Sample the sheet WHILE the villains act.
  const samples = [];
  let shotTaken = false;
  for (let i = 0; i < 400; i++) {
    const s = await page.evaluate(() => ({
      awaiting: document.querySelector('[data-testid="table-screen"]')?.dataset.awaiting ?? null,
      win: document.querySelector('[data-testid="win-pct"]')?.textContent ?? null,
      withheld: document.querySelector('[data-testid="stats-sheet"]')?.dataset.withheld ?? null,
      board: [...document.querySelectorAll('[data-testid="board"] [data-testid="card"]')].map((c) => c.dataset.card).join(' '),
      cats: document.querySelectorAll('.stats-cat').length,
    }));
    const key = `${s.awaiting}|${s.board}|${s.win}|${s.withheld}|${s.cats}`;
    if (samples[samples.length - 1] !== key) samples.push(key);
    if (s.awaiting === 'ai' && s.board !== '' && !shotTaken) {
      shotTaken = true;
      await shot(page, 'cg-6-winpct-during-ai-turn');
      console.log('SHOT during villain turn with flop out:', JSON.stringify(s));
    }
    if (s.awaiting === 'hero' && s.board !== '') break;
    if (s.awaiting === 'handover') break;
    await page.waitForTimeout(25);
  }
  console.log('\nSAMPLES (awaiting|board|win|withheld|cats):');
  for (const s of samples) console.log('  ' + s);

  const awaiting = await waitIdle(page);
  await settle(page);
  report(`6 NEW STREET, hero to act (awaiting=${awaiting})`, await dump(page));
  await shot(page, 'cg-6-new-street-gate');
} finally {
  await close();
}
