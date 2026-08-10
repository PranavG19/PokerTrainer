import { launch, setViewport, sitDown, waitIdle, enableCoach, commit, dump, report, shot, settle } from './cg-lib.mjs';

/** States 9-12: bust / session-over, rebuy, hand after rebuy (25000), two rebuys (30000), no-rebuy. */
const COACHED = process.argv[2] === 'coached';
const { app, page, close } = await launch({ seed: 2 });
try {
  await setViewport(app, page, 1100, 760);
  await sitDown(page);
  if (COACHED) await enableCoach(page);

  async function shove() {
    if (COACHED) await commit(page, 'raise', 'sure');
    const raise = page.locator('[data-testid="btn-raise"]');
    if (await raise.isEnabled()) {
      await page.locator('[data-testid="preset-allin"]').click();
      await raise.click();
      return;
    }
    for (const id of ['btn-call', 'btn-check', 'btn-fold']) {
      const b = page.locator(`[data-testid="${id}"]`);
      if (await b.isEnabled()) { await b.click(); return; }
    }
    throw new Error('DEAD END: hero turn, no enabled action');
  }

  async function bust(maxHands = 40) {
    for (let hand = 1; hand <= maxHands; hand++) {
      for (let a = 0; a < 40; a++) {
        if ((await waitIdle(page)) === 'handover') break;
        await shove();
      }
      const d = await dump(page);
      if (d.seats[0].stack === 0) return hand;
      await page.locator('[data-testid="next-hand"]').click();
    }
    throw new Error('hero never busted');
  }

  const hands = await bust();
  await settle(page);
  const tag = COACHED ? 'coached' : 'plain';
  report(`9 SESSION OVER / bust after ${hands} hands (${tag})`, await dump(page));
  await shot(page, `cg-9-bust-${tag}`);

  // Can the still-mounted predict pills be clicked here? (dead control check)
  if (COACHED) {
    const before = await dump(page);
    await page.locator('[data-testid="predict-raise"]').click();
    await page.locator('[data-testid="confidence-sure"]').click();
    await settle(page);
    const after = await dump(page);
    console.log('\n   DEAD-CONTROL PROBE at bust: predict pills clickable?');
    console.log('    before:', before.predictAction, before.predictConfidence, '| after:', after.predictAction, after.predictConfidence);
    console.log('    buttons after:', after.buttons.join(' '));
    await shot(page, `cg-9b-bust-pills-clicked-${tag}`);
    report(`9b bust after clicking predict pills (${tag})`, after);
    // Keyboard: does F/C/R do anything from a busted handover?
    await page.keyboard.press('f'); await page.keyboard.press('c'); await page.keyboard.press('r');
    await settle(page);
    const afterKeys = await dump(page);
    console.log('    after keys f/c/r awaiting=', afterKeys.awaiting, 'buttons=', afterKeys.buttons.join(' '));
  }

  // 10. rebuy
  await page.locator('[data-testid="btn-rebuy"]').click();
  let awaiting = await waitIdle(page);
  await settle(page);
  let d = await dump(page);
  report(`10 HAND AFTER FIRST REBUY (awaiting=${awaiting}) (${tag}) — chips should be 25000`, d);
  console.log(`   CHIP EXPECT 25000 GOT ${d.chipTotal}`);
  await shot(page, `cg-10-after-rebuy1-${tag}`);

  // 11. bust again, second rebuy
  await bust();
  await settle(page);
  report(`11a bust #2 (${tag})`, await dump(page));
  await shot(page, `cg-11a-bust2-${tag}`);
  await page.locator('[data-testid="btn-rebuy"]').click();
  awaiting = await waitIdle(page);
  await settle(page);
  d = await dump(page);
  report(`11b AFTER SECOND REBUY (${tag}) — chips should be 30000`, d);
  console.log(`   CHIP EXPECT 30000 GOT ${d.chipTotal}`);
  await shot(page, `cg-11b-after-rebuy2-${tag}`);

  // 12. bust a third time and DO NOT rebuy: New session instead.
  await bust();
  await settle(page);
  report(`12a bust #3, refusing rebuy (${tag})`, await dump(page));
  await shot(page, `cg-12a-bust3-${tag}`);
  await page.locator('[data-testid="new-session"]').click();
  await page.waitForSelector('[data-testid="home-screen"]');
  await settle(page);
  const home = await page.evaluate(() => ({
    bankroll: document.querySelector('[data-testid="bankroll"]')?.textContent,
    buttons: [...document.querySelectorAll('button')].map((b) => `${b.dataset.testid ?? b.className}${b.disabled ? '(off)' : ''}`),
    text: document.body.innerText.slice(0, 600),
  }));
  console.log('\n===== 12b HOME after refusing rebuy =====');
  console.log(JSON.stringify(home, null, 1));
  await shot(page, `cg-12b-home-after-no-rebuy-${tag}`);
} finally {
  await close();
}
