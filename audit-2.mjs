import { launch, setViewport, waitIdle, dump, shot, report, settle } from './audit-lib.mjs';

const { app, page, close } = await launch(42);
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();
  await waitIdle(page);

  // 5. HERO FOLDS mid-hand: call preflop, then fold on the flop, and watch the hand play on.
  await page.locator('[data-testid="btn-call"]').click();
  await waitIdle(page);
  let d = await dump(page);
  console.log('flop before fold: board', d.board.join(' '));
  await page.locator('[data-testid="btn-fold"]').click();

  // Immediately after the fold, before the AI timer, then again mid-AI.
  d = await dump(page);
  report('5a immediately after hero folds on the flop', d);
  await shot(page, '5a-hero-just-folded');

  await page.waitForTimeout(700);
  d = await dump(page);
  report('5b hand playing on without the hero (mid-AI)', d);
  await shot(page, '5b-hero-folded-hand-continues');

  const a = await waitIdle(page);
  d = await dump(page);
  report(`5c settle after hero folded (awaiting=${a})`, d);
  await shot(page, '5c-hero-folded-handover');

  // 7/8. Next hand — check nothing is stale.
  await page.locator('[data-testid="next-hand"]').click();
  d = await dump(page);
  report('8a immediately after clicking Next hand (same JS turn)', d);
  await shot(page, '8a-next-hand-immediate');

  await waitIdle(page);
  d = await dump(page);
  report('8b hand 2, hero to act', d);
  await shot(page, '8b-hand2-hero-to-act');
} finally {
  await close();
}
