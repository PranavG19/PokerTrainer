import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/** State 8: toggle coached mode OFF mid-hand, at both sizes. Anything stale left behind? */
for (const [w, h] of [[1100, 760], [900, 640]]) {
  const tag = `${w}x${h}`;
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, w, h);
    await sitDown(page);
    await enableCoach(page);
    await page.locator('[data-testid="stats-toggle"]').click();
    await commit(page, 'call', 'sure');
    await page.locator('[data-testid="btn-call"]').click();
    await waitIdle(page);
    await settle(page);
    report(`8a coached, mid-hand, verdict up ${tag}`, await dump(page));
    await shot(page, `cg-8a-before-toggle-off-${tag}`);

    // Now toggle coached mode OFF mid-hand with the verdict on screen and no commitment.
    await page.locator('[data-testid="coach-mode-toggle"]').click();
    await settle(page);
    report(`8b coached OFF mid-hand ${tag}`, await dump(page));
    await shot(page, `cg-8b-toggled-off-${tag}`);

    // ...and back ON: does the stale verdict return?
    await page.locator('[data-testid="coach-mode-toggle"]').click();
    await settle(page);
    report(`8c coached back ON mid-hand ${tag}`, await dump(page));
    await shot(page, `cg-8c-toggled-back-on-${tag}`);
  } finally {
    await close();
  }
}
