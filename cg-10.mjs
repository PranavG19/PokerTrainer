import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, shot, settle } from './cg-lib.mjs';

/**
 * How long is the withheld answer actually readable? Instrument inside the page with a
 * MutationObserver-free rAF sampler so no round-trip latency distorts the measurement.
 */
const { app, page, close } = await launch({ seed: 8 });
try {
  await setViewport(app, page, 1100, 760);
  await sitDown(page);
  await enableCoach(page);
  await page.locator('[data-testid="stats-toggle"]').click();
  await settle(page);

  for (const street of ['preflop', 'flop']) {
    await commit(page, 'call', 'guess');
    // start sampling, then act
    await page.evaluate(() => {
      window.__samples = [];
      const tick = () => {
        const sheet = document.querySelector('[data-testid="stats-sheet"]');
        const root = document.querySelector('[data-testid="table-screen"]');
        window.__samples.push({
          t: performance.now(),
          awaiting: root.dataset.awaiting,
          withheld: sheet.dataset.withheld,
          win: document.querySelector('[data-testid="win-pct"]').textContent,
          board: document.querySelectorAll('[data-testid="board"] [data-testid="card"]').length,
        });
        if (window.__samples.length < 1200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator('[data-testid="btn-call"]').click();
    const awaiting = await waitIdle(page);
    const stats = await page.evaluate(() => {
      const s = window.__samples;
      const t0 = s[0].t;
      // contiguous windows where a numeric win% was on screen
      const runs = [];
      let cur = null;
      for (const x of s) {
        const leaking = /\d/.test(x.win);
        if (leaking && cur === null) cur = { start: x.t - t0, board: x.board, win: x.win, awaiting: x.awaiting };
        if (!leaking && cur !== null) { cur.end = x.t - t0; runs.push(cur); cur = null; }
      }
      if (cur !== null) { cur.end = s[s.length - 1].t - t0; runs.push(cur); }
      return { samples: s.length, span: +(s[s.length - 1].t - t0).toFixed(0), runs: runs.map((r) => ({ ...r, ms: +(r.end - r.start).toFixed(0) })) };
    });
    console.log(`\nAfter hero acted on ${street} (next idle = ${awaiting}):`);
    console.log('  sampler span ms:', stats.span, 'samples:', stats.samples);
    for (const r of stats.runs) {
      console.log(`  LEAK WINDOW ${r.ms}ms  win="${r.win}" board=${r.board} awaiting=${r.awaiting}  (t=${r.start.toFixed(0)}..${r.end.toFixed(0)})`);
    }
    if (awaiting !== 'hero') break;
  }
} finally {
  await close();
}
