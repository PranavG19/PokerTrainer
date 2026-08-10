import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/**
 * REACHABILITY at the documented 900x640 minimum, in the terminal states.
 * A control below the fold with no visible scrollbar is the exact defect class that already
 * shipped here once (action pills below the fold; Playwright auto-scrolls so tests passed).
 */
async function reach(page, label) {
  await settle(page);
  const r = await page.evaluate(() => {
    const ids = ['next-hand', 'btn-rebuy', 'new-session', 'session-over', 'winner-summary', 'coach-mode-toggle', 'win-pct'];
    const out = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const hit = cy >= 0 && cy <= window.innerHeight ? document.elementFromPoint(cx, cy) : null;
      out[id] = {
        top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1),
        belowFoldBy: +(b.bottom - window.innerHeight).toFixed(1),
        centreVisible: cy <= window.innerHeight,
        hittable: hit !== null && (hit === el || el.contains(hit) || hit.contains(el)),
        visiblePx: +Math.max(0, Math.min(b.bottom, window.innerHeight) - Math.max(b.top, 0)).toFixed(1),
        fullyOnScreen: b.top >= 0 && b.bottom <= window.innerHeight,
      };
    }
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      overflow: document.documentElement.scrollHeight - window.innerHeight,
      scrollY: window.scrollY,
      controls: out,
    };
  });
  console.log(`\n--- ${label} ---  scrollHeight=${r.scrollHeight} innerHeight=${r.innerHeight} OVERFLOW=${r.overflow}`);
  for (const [id, c] of Object.entries(r.controls)) {
    if (c === null) continue;
    const flag = c.fullyOnScreen ? 'ok      ' : (c.centreVisible ? 'PARTIAL ' : 'OFFSCREEN');
    console.log(`   ${flag} ${id.padEnd(18)} top=${c.top} bottom=${c.bottom} belowFoldBy=${c.belowFoldBy} visiblePx=${c.visiblePx} hittable=${c.hittable}`);
  }
  return r;
}

// A) coached handover with a graded SERIOUS mistake, at 900x640
{
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, 900, 640);
    await sitDown(page);
    await enableCoach(page);
    await commit(page, 'call', 'sure');
    await page.locator('[data-testid="btn-call"]').click();
    await waitIdle(page);
    await commit(page, 'fold', 'sure');
    await page.locator('[data-testid="btn-fold"]').click();
    await waitIdle(page);
    await reach(page, 'A: coached handover + SERIOUS grade @900x640');
    await shot(page, 'cg-reach-A-coached-graded-handover-900x640');
    // Can the player even scroll to it? (nothing in the app scrolls itself)
    const scrolled = await page.evaluate(() => { window.scrollTo(0, 999); return window.scrollY; });
    console.log('   after window.scrollTo(0,999): scrollY =', scrolled);
    await shot(page, 'cg-reach-A-scrolled');
  } finally { await close(); }
}

// B) uncoached handover with a graded SERIOUS mistake, at 900x640 (is coached mode required?)
{
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, 900, 640);
    await sitDown(page);
    await page.locator('[data-testid="btn-call"]').click();
    await waitIdle(page);
    await page.locator('[data-testid="btn-fold"]').click();
    await waitIdle(page);
    await reach(page, 'B: PLAIN handover + SERIOUS grade @900x640');
    await shot(page, 'cg-reach-B-plain-graded-handover-900x640');
  } finally { await close(); }
}

// C) coached session-over (bust) at 900x640 — the terminal state, three controls stacked
{
  const { app, page, close } = await launch({ seed: 2 });
  try {
    await setViewport(app, page, 900, 640);
    await sitDown(page);
    await enableCoach(page);
    for (let a = 0; a < 40; a++) {
      if ((await waitIdle(page)) === 'handover') break;
      await commit(page, 'raise', 'sure');
      const raise = page.locator('[data-testid="btn-raise"]');
      if (await raise.isEnabled()) {
        await page.locator('[data-testid="preset-allin"]').click();
        await raise.click();
      } else {
        for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
          const b = page.locator(`[data-testid="${id}"]`);
          if (await b.isEnabled()) { await b.click(); break; }
        }
      }
    }
    const d = await dump(page);
    console.log('\n   hero stack at handover:', d.seats[0].stack, 'sessionOver:', JSON.stringify(d.sessionOver));
    await reach(page, 'C: coached SESSION OVER (bust) @900x640');
    await shot(page, 'cg-reach-C-coached-bust-900x640');
    report('C coached bust @900x640', await dump(page));
  } finally { await close(); }
}
