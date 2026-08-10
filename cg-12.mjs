import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/**
 * WORST-CASE HANDOVER HEIGHT MATRIX.
 * Seed 8 hand 1: call preflop (free), then FOLD the flop -> SERIOUS grade, coach panel visible,
 * and the fold ends the hand -> handover with coach + predict verdict + winner + Next hand all up.
 * Measure the document height and where the win% headline lands, at both documented sizes.
 */
async function anatomy(page, label) {
  await settle(page);
  const a = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="table-screen"]');
    const kids = [...root.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { cls: el.className, h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), hidden: el.hidden };
    });
    const wp = document.querySelector('[data-testid="win-pct"]');
    const win = wp.getBoundingClientRect();
    const sheet = document.querySelector('[data-testid="stats-sheet"]').getBoundingClientRect();
    const nh = document.querySelector('[data-testid="next-hand"]');
    const nhr = nh?.getBoundingClientRect();
    return {
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      overflow: document.documentElement.scrollHeight - window.innerHeight,
      kids,
      winText: wp.textContent,
      winBottom: +win.bottom.toFixed(1),
      winTop: +win.top.toFixed(1),
      winClippedBy: +(win.bottom - window.innerHeight).toFixed(1),
      sheetBottom: +sheet.bottom.toFixed(1),
      nextHandBottom: nhr ? +nhr.bottom.toFixed(1) : null,
    };
  });
  console.log(`\n--- ${label} ---`);
  console.log(`scrollHeight=${a.scrollHeight} innerHeight=${a.innerHeight} OVERFLOW=${a.overflow}`);
  console.log(`win="${a.winText}" top=${a.winTop} bottom=${a.winBottom} clippedBy=${a.winClippedBy} sheetBottom=${a.sheetBottom} nextHandBottom=${a.nextHandBottom}`);
  for (const k of a.kids) console.log(`   ${String(k.h).padStart(6)}px  ${k.top}-${k.bottom}  .${k.cls}${k.hidden ? ' [hidden]' : ''}`);
  return a;
}

const results = [];
for (const coached of [false, true]) {
  for (const [w, h] of [[1100, 760], [900, 640]]) {
    const { app, page, close } = await launch({ seed: 8 });
    try {
      await setViewport(app, page, w, h);
      await sitDown(page);
      if (coached) await enableCoach(page);
      const tag = `${coached ? 'coached' : 'plain'}-${w}x${h}`;

      if (coached) await commit(page, 'call', 'sure');
      await page.locator('[data-testid="btn-call"]').click();
      await waitIdle(page);
      if (coached) await commit(page, 'fold', 'sure');
      await page.locator('[data-testid="btn-fold"]').click();
      const aw = await waitIdle(page);

      const a = await anatomy(page, `${tag} handover, GRADED SERIOUS (awaiting=${aw})`);
      results.push({ tag, ...a });
      await shot(page, `cg-worst-handover-${tag}`);
      report(`WORST HANDOVER ${tag}`, await dump(page));
    } finally {
      await close();
    }
  }
}

console.log('\n=== SUMMARY: coach message visible at handover ===');
for (const r of results) {
  console.log(`  ${r.overflow > 1 ? 'OVERFLOW +' + r.overflow : 'ok        '}  win="${r.winText}" clippedBy=${r.winClippedBy}  :: ${r.tag}`);
}
