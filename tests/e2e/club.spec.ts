import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchApp, shot, type LaunchedApp } from './helpers.js';
import { hostedInvite, joinAsGuest, type TestGuest } from './mpGuest.js';
import { decodeClubCode, encodeClubCode, nightIdOf } from '../../src/core/club/codes.js';
import { encodeChallenge } from '../../src/core/challengeCode.js';
import { formatInvite } from '../../src/core/relayClient.js';
import { LAN_TABLE, type RoomView } from '../../src/core/multiplayer.js';
import { hostSession, type RelaySession } from '../../src/main/relaySession.js';
import { readOracle } from '../../src/main/netOracle.js';

/**
 * LAN CLUB and HOME GAME NIGHT — through the real app, with a real relay guest (or host) in the test process.
 *
 * Every table here is on loopback at an ephemeral port: the app's own host binds 127.0.0.1 under OFFSUIT_E2E
 * (main.ts mp:host), and the test's own host passes 127.0.0.1. The relay messages are LAN play's own; the club
 * only names the seat and grades the player's own decisions from the view it was sent. The recap pools friends'
 * codes and never shows a per-player number or a chip.
 */

async function size(app: LaunchedApp, w: number, h: number): Promise<void> {
  await app.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
  await app.page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [w, h]);
}

/** Both documented sizes, no page scroll, `mustSee` fully on screen, and a screenshot at each. */
async function bothSizes(app: LaunchedApp, name: string, mustSee: string): Promise<void> {
  for (const [w, h] of [[900, 640], [1100, 760]] as const) {
    await size(app, w, h);
    const [sh, ih, sw, iw] = await app.page.evaluate(() => [
      document.documentElement.scrollHeight,
      window.innerHeight,
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sh, `${name} ${w}x${h} height`).toBeLessThanOrEqual(ih);
    expect(sw, `${name} ${w}x${h} width`).toBeLessThanOrEqual(iw);
    await expect(app.page.locator(mustSee).first(), `${name} ${w}x${h}: ${mustSee} on screen`).toBeInViewport({ ratio: 1 });
    await shot(app.page, `${name}-${w}x${h}`);
  }
}

async function openClub(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="tab-play"]').click();
  await page.locator('[data-testid="play-club"]').click();
  await page.waitForSelector('[data-testid="club-screen"]');
}

async function startClub(page: Page, name = 'Thursday table', table = 'Sam'): Promise<void> {
  if ((await page.locator('[data-testid="club-screen"]').count()) === 0) await openClub(page);
  await page.locator('[data-testid="club-name"]').fill(name);
  await page.locator('[data-testid="club-table-name"]').fill(table);
  await page.locator('[data-testid="club-start"]').click();
  await expect(page.locator('[data-testid="club-title"]')).toHaveText(name);
}

/** The guest's turn, answered the way the test plays every spot: check, else call. */
function guestActs(view: RoomView | undefined, act: (kind: 'check' | 'call') => void): boolean {
  if (!view || !view.yourTurn || view.winners !== null) return false;
  act(view.legal.includes('check') ? 'check' : 'call');
  return true;
}

/** Play one hand to its end: the app's seat clicks Check or Call, the test's seat does the same. */
async function playHand(page: Page, other: () => RoomView | undefined, act: (kind: 'check' | 'call') => void): Promise<void> {
  const deal = page.locator('[data-testid="mp-deal"]');
  for (let i = 0; i < 60 && !(await deal.isVisible()); i += 1) {
    const check = page.locator('[data-testid="mp-check"]');
    const call = page.locator('[data-testid="mp-call"]');
    if (await check.isEnabled().catch(() => false)) await check.click();
    else if (await call.isEnabled().catch(() => false)) await call.click();
    else guestActs(other(), act);
    await page.waitForTimeout(120);
  }
  await expect(deal, 'the hand reached its end').toBeVisible();
}

test('a club starts from Play with nothing locked, and opens no socket until a Game Night is hosted', async () => {
  const oracle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'club-oracle-')), 'net.jsonl');
  const app = await launchApp({ seed: 7, env: { OFFSUIT_NET_ORACLE: oracle } });
  try {
    await openClub(app.page);
    await expect(app.page.locator('[data-testid="club-screen"]')).toHaveAttribute('data-state', 'new');
    await startClub(app.page);
    // The launcher's Host is the screen's one primary; every row is open on a fresh profile.
    await expect(app.page.locator('.club-screen .pill.primary')).toHaveCount(1);
    await expect(app.page.locator('[data-testid="club-host"]')).toBeEnabled();
    await expect(app.page.locator('[data-testid="club-notebook-empty"]')).toBeVisible();
    // Nothing about a club is network: no listener and no connection yet.
    const sockets = readOracle(oracle).filter((r) => r.kind === 'listen' || (r.kind === 'connect' && !r.ipc));
    expect(sockets).toEqual([]);
    // The club survives a relaunch.
    await app.close();
    const again = await launchApp({ seed: 7, userDataDir: app.userDataDir });
    try {
      await openClub(again.page);
      await expect(again.page.locator('[data-testid="club-title"]')).toHaveText('Thursday table');
    } finally {
      await again.close();
    }
  } finally {
    await app.close();
  }
});

test('a hosted Game Night: a guest sits under its own name, the host’s decisions are graded, and the recap pools a friend’s code', async () => {
  test.setTimeout(180_000);
  const app = await launchApp({ seed: 7 });
  const { page } = app;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  let guest: TestGuest | null = null;
  try {
    await startClub(page);
    await page.locator('[data-testid="club-seat-count"]').selectOption('2');
    await page.locator('[data-testid="club-host"]').click();
    // The night waits on the same opt-in as any LAN table, then hosts at once.
    await expect(page.locator('[data-testid="night-bar"]')).toBeVisible();
    await page.locator('[data-testid="mp-enable"]').click();
    const invite = await hostedInvite(page);
    expect(invite.host).toBe('127.0.0.1');
    guest = joinAsGuest(invite, 'Ada');
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });

    // The guest sees the host by the host's table name, and the host sees the guest by theirs.
    await expect.poll(() => guest!.views.at(-1)?.seats.find((s) => !s.isYou && s.inHand)?.name).toBe('Sam');
    await expect(page.locator('[data-testid="mp-seat"][data-you="false"]')).toContainText('Ada');

    const g = guest;
    await playHand(page, () => g.views.at(-1), (kind) => g.session.action({ kind }));
    const bar = page.locator('[data-testid="night-bar"]');
    await expect(bar).toHaveAttribute('data-hands', '1');
    await expect.poll(async () => Number(await bar.getAttribute('data-decisions'))).toBeGreaterThan(0);
    await bothSizes(app, 'game-night', '[data-testid="night-end"]');
    const decisions = await bar.getAttribute('data-decisions');

    expect(guest.errors, 'the guest’s deal checks held all night').toEqual([]);
    await page.locator('[data-testid="night-end"]').click();
    await page.waitForSelector('[data-testid="night-recap"]');
    // Ending the night closes the host's table: the guest is told so, and nothing else went wrong.
    await expect.poll(() => guest!.errors).toEqual(['The table closed the connection.']);
    await expect(page.locator('[data-testid="recap-you-decisions"]')).toContainText(decisions!);
    // The recap code carries this night, this name and these counts, and opens anywhere.
    const code = (await page.locator('[data-testid="recap-code"]').textContent()) ?? '';
    const decoded = decodeClubCode(code);
    expect(decoded.ok && decoded.code.kind === 'recap').toBe(true);
    if (!decoded.ok || decoded.code.kind !== 'recap') throw new Error('no recap');
    expect(decoded.code.recap).toMatchObject({ night: nightIdOf(invite.fingerprint), name: 'Sam', hands: 1, decisions: Number(decisions) });
    await expect(page.locator('[data-testid="recap-qr"]')).toBeVisible();

    // A friend's code joins the table: pooled, never listed per person.
    const friend = encodeClubCode({ kind: 'recap', recap: { ...decoded.code.recap, name: 'Ada', decisions: 4, clean: 4, lossCentiBb: 0 } });
    await page.locator('[data-testid="recap-friend-code"]').fill(friend);
    await page.locator('[data-testid="recap-friend-add"]').click();
    await expect(page.locator('[data-testid="recap-pool"]')).toHaveAttribute('data-players', '2');
    await expect(page.locator('[data-testid="recap-table-decisions"]')).toContainText(String(Number(decisions) + 4));
    await bothSizes(app, 'recap', '[data-testid="recap-done"]');
    // A code from another night is refused with a reason.
    await page.locator('[data-testid="recap-friend-code"]').fill(encodeClubCode({ kind: 'recap', recap: { ...decoded.code.recap, night: '00000000', name: 'Bo' } }));
    await page.locator('[data-testid="recap-friend-add"]').click();
    await expect(page.locator('[data-testid="recap-reader"]')).toHaveAttribute('data-state', 'invalid');

    // The person at the table joins the club from the recap.
    await page.locator('[data-testid="recap-seen-name"][data-name="Ada"] [data-testid="recap-seen-add"]').click();
    await expect(page.locator('[data-testid="recap-seen-add"]')).toHaveCount(0);
    // The page never shows a stack, a pot or a bankroll (it says only that chips are not counted): decisions only.
    await expect(page.locator('[data-testid="night-recap"]')).not.toContainText(/\bstack|\bpot\b|bankroll|\d+ chips/i);

    // A costly spot, if the night had one, goes to the notebook.
    if (await page.locator('[data-testid="recap-spot-add"]').count()) {
      await page.locator('[data-testid="recap-spot-add"]').first().click();
      await expect(page.locator('[data-testid="recap-spot-play"]').first()).toBeVisible();
    }
    await page.locator('[data-testid="recap-done"]').click();
    await expect(page.locator('[data-testid="club-member"][data-name="Ada"]')).toBeVisible();
    await expect(page.locator('[data-testid="club-night"]')).toHaveCount(1);
    await bothSizes(app, 'club', '[data-testid="club-host"]');
    expect(errors).toEqual([]);
  } finally {
    await guest?.session.stop();
    await app.close();
  }
});

test('joining a Game Night hosted elsewhere: the app sits under its name and grades its own decisions only', async () => {
  test.setTimeout(180_000);
  const hostViews: RoomView[] = [];
  const { session: host, info } = await hostSession(
    { ...LAN_TABLE, seatCount: 2 },
    { onState: (v) => hostViews.push(v), onError: () => undefined },
    { host: '127.0.0.1', name: 'Bo' },
  );
  const app = await launchApp({ seed: 7 });
  const { page } = app;
  try {
    await startClub(page, 'Friday table', 'Robin');
    const invite = formatInvite({ host: '127.0.0.1', port: info.port, fingerprint: info.fingerprint, token: info.token });
    await page.locator('[data-testid="club-join-invite"]').fill(invite);
    await page.locator('[data-testid="club-join"]').click();
    await page.locator('[data-testid="mp-enable"]').click();
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });
    await expect.poll(() => hostViews.at(-1)?.seats.find((s) => !s.isYou && s.inHand)?.name).toBe('Robin');

    const hs: RelaySession = host;
    await playHand(page, () => hostViews.at(-1), (kind) => hs.action({ kind }));
    // The guest app cannot deal, but it can ask for the next hand; the night counted the one that ended.
    await expect(page.locator('[data-testid="night-bar"]')).toHaveAttribute('data-hands', '1');
    await page.locator('[data-testid="night-end"]').click();
    await page.waitForSelector('[data-testid="night-recap"]');
    await expect(page.locator('[data-testid="night-recap"]')).toContainText('joined as Robin');
    await expect(page.locator('[data-testid="recap-seen-name"][data-name="Bo"]')).toBeVisible();
  } finally {
    await host.stop();
    await app.close();
  }
});

test('a notebook spot: the answer first, then the grade and what was chosen at the table; a challenge code opens its own screen', async () => {
  const app = await launchApp({ seed: 7 });
  const { page } = app;
  try {
    await startClub(page);
    await page.locator('[data-testid="club-member-name"]').fill('Ada');
    await page.locator('[data-testid="club-member-name"]').press('Enter');
    await expect(page.locator('[data-testid="club-member"][data-name="Ada"]')).toBeVisible();

    const spot = encodeClubCode({
      kind: 'spot',
      spot: { hole: ['9s', '8s'], board: ['2c', '7d', 'Jh', 'Kc'], bb: 50, pot: 600, toCall: 400, stack: 4000, opponents: 1, chosen: 'call' },
    });
    await page.locator('[data-testid="club-code"]').fill(spot.toLowerCase());
    await expect(page.locator('[data-testid="club-reader"]')).toHaveAttribute('data-state', 'valid');
    await page.locator('[data-testid="club-code-from"]').selectOption('Ada');
    await page.locator('[data-testid="club-code-add"]').click();
    await expect(page.locator('[data-testid="club-entry"]')).toHaveCount(1);

    await page.locator('[data-testid="club-entry-open"]').click();
    await page.waitForSelector('[data-testid="club-spot"]');
    // Commit before reveal: neither grade nor Ada's choice shows before an answer.
    await expect(page.locator('[data-testid="club-spot-theirs"]')).toHaveCount(0);
    await page.locator('[data-testid="club-spot-fold"]').click();
    await expect(page.locator('[data-testid="club-spot"]')).toHaveAttribute('data-answered', 'true');
    await expect(page.locator('[data-testid="club-spot-theirs"]')).toContainText('Ada at the table: Call');
    await page.locator('[data-testid="club-spot-back"]').click();
    await expect(page.locator('[data-testid="club-entry"]')).toContainText('Played: fold');

    // A drill code in the notebook opens the drill, as the challenge reader would.
    await page.locator('[data-testid="club-code"]').fill(encodeChallenge({ kind: 'drill', drill: 'spr', index: 3 }));
    await page.locator('[data-testid="club-code-add"]').click();
    await expect(page.locator('[data-testid="club-entry"]')).toHaveCount(2);
    await page.locator('[data-testid="club-entry"]').first().locator('[data-testid="club-entry-open"]').click();
    await expect(page.locator('[data-testid="club-screen"]')).toHaveCount(0);

    // The answer persists.
    await app.close();
    const again = await launchApp({ seed: 7, userDataDir: app.userDataDir });
    try {
      await openClub(again.page);
      await expect(again.page.locator(`[data-testid="club-entry"][data-code="${spot}"]`)).toContainText('Played: fold');
    } finally {
      await again.close();
    }
  } finally {
    await app.close();
  }
});

test('the challenge reader names a club code instead of calling it unknown', async () => {
  const app = await launchApp({ seed: 7 });
  try {
    await app.page.waitForSelector('[data-testid="home-screen"]');
    await app.page.locator('[data-testid="tab-play"]').click();
    await app.page.locator('[data-testid="play-challenge"]').click();
    const recap = encodeClubCode({ kind: 'recap', recap: { night: '0a1b2c3d', day: 20_000 as never, name: 'Ada', hands: 1, decisions: 1, clean: 1, lossCentiBb: 0 } });
    await app.page.locator('[data-testid="challenge-input"]').fill(recap);
    await expect(app.page.locator('[data-testid="challenge-notice"]')).toContainText('LAN Club');
  } finally {
    await app.close();
  }
});
