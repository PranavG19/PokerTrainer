import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

// States 1-4: gate pending / half / full / match reveal. Seed 8 hand 1: QQ, call preflop = free.
for (const [w, h] of [[1100, 760], [900, 640]]) {
  const tag = `${w}x${h}`;
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, w, h);
    await sitDown(page);
    await enableCoach(page);
    await settle(page);
    // open the stats sheet so we can SEE whether the answer is withheld
    await page.locator('[data-testid="stats-toggle"]').click();
    await settle(page);

    report(`1 GATE PENDING (nothing committed) ${tag}`, await dump(page));
    await shot(page, `cg-1-pending-${tag}`);

    await commit(page, 'call', null);
    await settle(page);
    report(`2 HALF COMMITTED (action only) ${tag}`, await dump(page));
    await shot(page, `cg-2-half-${tag}`);

    await commit(page, null, 'sure');
    await settle(page);
    report(`3 FULLY COMMITTED (answer released) ${tag}`, await dump(page));
    await shot(page, `cg-3-committed-${tag}`);

    await page.locator('[data-testid="btn-call"]').click();
    await waitIdle(page);
    await settle(page);
    report(`4 REVEAL: MATCH ${tag}`, await dump(page));
    await shot(page, `cg-4-match-${tag}`);
  } finally {
    await close();
  }
}
