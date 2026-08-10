import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/** State 7: coached mode at handover, at both sizes, coached vs uncoached, sheet closed and open. */
async function drive(page, coached) {
  await sitDown(page);
  if (coached) await enableCoach(page);
  for (let i = 0; i < 20; i++) {
    if ((await waitIdle(page)) === 'handover') return;
    if (coached) await commit(page, 'call', 'sure');
    for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
      const b = page.locator(`[data-testid="${id}"]`);
      if (await b.isEnabled()) { await b.click(); break; }
    }
  }
  throw new Error('no handover');
}

for (const coached of [true, false]) {
  for (const [w, h] of [[1100, 760], [900, 640]]) {
    const tag = `${coached ? 'coached' : 'plain'}-${w}x${h}`;
    const { app, page, close } = await launch({ seed: 8 });
    try {
      await setViewport(app, page, w, h);
      await drive(page, coached);
      await settle(page);
      const d = await dump(page);
      report(`7 HANDOVER ${tag} (sheet closed)`, d);
      const geo = await page.evaluate(() => {
        const ids = ['next-hand', 'coach-mode-toggle', 'winner-summary', 'stats-sheet', 'predict-result', 'hero-cards', 'board'];
        return Object.fromEntries(ids.map((id) => {
          const el = document.querySelector(`[data-testid="${id}"]`);
          if (!el) return [id, null];
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return [id, {
            top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1),
            offBottom: +(r.bottom - window.innerHeight).toFixed(1),
            covered: hit === null ? 'nothing' : (hit === el || el.contains(hit) || hit.contains(el)) ? null : hit.tagName + '.' + String(hit.className),
          }];
        }));
      });
      console.log('   GEO ' + JSON.stringify(geo));
      await shot(page, `cg-7-handover-${tag}`);
    } finally {
      await close();
    }
  }
}
