import { launch, setViewport, waitIdle, dump, shot, report, settle } from './audit-lib.mjs';

const seed = Number(process.argv[2] ?? 42);
const { app, page, close } = await launch(seed);
try {
  await setViewport(app, page, 1100, 760);
  await page.locator('[data-testid="new-hand"]').click();
  await page.locator('[data-testid="table-screen"]').waitFor();
  await waitIdle(page);
  await page.locator('[data-testid="stats-toggle"]').click();

  // 6. hero all-in, board runs out
  const canShove = await page.locator('[data-testid="preset-allin"]').isEnabled()
    && await page.locator('[data-testid="btn-raise"]').isEnabled();
  console.log('canShove', canShove);
  await page.locator('[data-testid="preset-allin"]').click();
  await page.locator('[data-testid="btn-raise"]').click();

  let d = await dump(page);
  report('6a immediately after hero shoves', d);
  await shot(page, `6a-hero-allin-seed${seed}`);

  await page.waitForTimeout(600);
  d = await dump(page);
  report('6b mid-runout after shove', d);
  await shot(page, `6b-hero-allin-mid-seed${seed}`);

  const a = await waitIdle(page);
  d = await dump(page);
  report(`6c handover after all-in runout (awaiting=${a})`, d);
  await shot(page, `6c-allin-handover-seed${seed}`);

  // If a rebuy state, screenshot it too
  if (d.sessionOver) {
    await shot(page, `6d-busted-seed${seed}`);
  } else {
    await page.locator('[data-testid="next-hand"]').click();
    await waitIdle(page);
    d = await dump(page);
    report('6e hand after the all-in hand', d);
    await shot(page, `6e-after-allin-seed${seed}`);
  }
} finally {
  await close();
}
