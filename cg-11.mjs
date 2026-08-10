import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, shot, settle } from './cg-lib.mjs';

/**
 * Decompose the 900x640 coached-handover overflow: which block grew, and by how much?
 * Measures every child of .table-screen plus the controls' internal rows.
 */
async function anatomy(page, label) {
  await settle(page);
  const a = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    const kids = [...root.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), hidden: el.hidden };
    });
    const controls = document.querySelector('.controls');
    const ctrlKids = [...controls.children].map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.dataset.testid ?? el.className}@${r.top.toFixed(0)}-${r.bottom.toFixed(0)}`;
    });
    const win = document.querySelector('[data-testid="win-pct"]').getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      rootH: +root.getBoundingClientRect().height.toFixed(1),
      kids, ctrlKids,
      winBottom: +win.bottom.toFixed(1),
      winClippedBy: +(win.bottom - window.innerHeight).toFixed(1),
      winText: document.querySelector('[data-testid="win-pct"]').textContent,
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(`scrollHeight=${a.scrollHeight} innerHeight=${a.innerHeight} rootH=${a.rootH}`);
  console.log(`win="${a.winText}" bottom=${a.winBottom} clippedBy=${a.winClippedBy}`);
  for (const k of a.kids) console.log(`   ${k.h.toString().padStart(6)}px  ${k.top}-${k.bottom}  .${k.cls}${k.hidden ? ' [hidden]' : ''}`);
  console.log('   controls rows: ' + a.ctrlKids.join(' | '));
  return a;
}

for (const coached of [false, true]) {
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, 900, 640);
    await sitDown(page);
    if (coached) await enableCoach(page);
    const tag = coached ? 'coached' : 'plain';
    await anatomy(page, `${tag} mid-hand hero turn`);
    for (let i = 0; i < 20; i++) {
      if ((await waitIdle(page)) === 'handover') break;
      if (coached) await commit(page, 'call', 'sure');
      for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); break; }
      }
    }
    await anatomy(page, `${tag} HANDOVER`);
  } finally {
    await close();
  }
}
