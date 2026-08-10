import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

// State 5: SURE-wrong vs GUESS-wrong side by side. Seed 8: fold QQ on the flop = 3.9bb serious.
for (const conf of ['sure', 'guess']) {
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, 1100, 760);
    await sitDown(page);
    await enableCoach(page);
    await commit(page, 'call', 'sure');
    await page.locator('[data-testid="btn-call"]').click();
    await waitIdle(page);
    // second decision: the graded fold
    await commit(page, 'fold', conf);
    await page.locator('[data-testid="btn-fold"]').click();
    await waitIdle(page);
    await settle(page);
    report(`5 REVEAL ${conf.toUpperCase()}-WRONG`, await dump(page));
    await shot(page, `cg-5-${conf}-wrong`);
  } finally {
    await close();
  }
}
