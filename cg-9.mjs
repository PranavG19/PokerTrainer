import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/**
 * Overflow matrix at the documented 900x640 minimum:
 *   coached on/off  x  sheet open/closed  x  mid-hand / handover
 * Reports document scrollHeight and whether the Win headline is inside the viewport.
 */
const rows = [];

async function measure(page, label) {
  await settle(page);
  const m = await page.evaluate(() => {
    const win = document.querySelector('[data-testid="win-pct"]');
    const sheet = document.querySelector('[data-testid="stats-sheet"]');
    const r = win.getBoundingClientRect();
    const sr = sheet.getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      winBottom: +r.bottom.toFixed(1),
      winOnScreen: r.bottom <= window.innerHeight,
      sheetBottom: +sr.bottom.toFixed(1),
      sheetOpen: sheet.dataset.open,
      withheld: sheet.dataset.withheld,
      winText: win.textContent,
    };
  });
  rows.push({ label, ...m });
  console.log(label, JSON.stringify(m));
}

for (const coached of [false, true]) {
  const { app, page, close } = await launch({ seed: 8 });
  try {
    await setViewport(app, page, 900, 640);
    await sitDown(page);
    if (coached) await enableCoach(page);
    const tag = coached ? 'coached' : 'plain';

    await measure(page, `${tag} midhand sheet-closed pending`);
    if (coached) await commit(page, 'call', 'sure');
    await measure(page, `${tag} midhand sheet-closed committed`);
    await page.locator('[data-testid="stats-toggle"]').click();
    await measure(page, `${tag} midhand sheet-OPEN committed`);
    await shot(page, `cg-overflow-${tag}-midhand-open-900x640`);
    await page.locator('[data-testid="stats-toggle"]').click();

    // drive to handover
    for (let i = 0; i < 20; i++) {
      if ((await waitIdle(page)) === 'handover') break;
      if (coached) await commit(page, 'call', 'sure');
      for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
        const b = page.locator(`[data-testid="${id}"]`);
        if (await b.isEnabled()) { await b.click(); break; }
      }
    }
    await measure(page, `${tag} HANDOVER sheet-closed`);
    await shot(page, `cg-overflow-${tag}-handover-closed-900x640`);
    // stats-toggle lives in .controls, which handover replaces — toggle via the sheet header.
    await page.evaluate(() => document.querySelector('.stats-header').click());
    await measure(page, `${tag} HANDOVER sheet-OPEN`);
    await shot(page, `cg-overflow-${tag}-handover-open-900x640`);
  } finally {
    await close();
  }
}

console.log('\nOVERFLOW MATRIX (900x640, overflow = scrollHeight > 641):');
for (const r of rows) {
  console.log(`  ${r.scrollHeight > 641 ? 'OVERFLOW' : 'ok      '} h=${r.scrollHeight} winBottom=${r.winBottom} winOnScreen=${r.winOnScreen} win="${r.winText}" :: ${r.label}`);
}
