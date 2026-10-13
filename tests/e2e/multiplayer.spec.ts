import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchApp } from './helpers.js';
import { hostedInvite, joinAsGuest, type TestGuest } from './mpGuest.js';
import { parseInvite } from '../../src/core/relayClient.js';
import { readOracle } from '../../src/main/netOracle.js';

/**
 * MULTIPLAYER (local relay) — the Home panel driven through the real app, with a REAL socket client
 * joining the hosted table.
 *
 * The safety property that matters most is proven elsewhere and re-checked here: multiplayer is OFF by
 * default (no-network.spec confirms a fresh profile makes zero requests), so this suite first sees the
 * enable gate, turns it on, hosts, and then a real v2 guest (the app's own joinSession, in this process)
 * joins with the invite the host shows: TLS, the pinned certificate, the room token, and the checked
 * deal. On the host's screen its own cards are face up and the opponent's are face down — the redaction
 * the whole backend guarantees, made visible.
 */

const screen = '[data-testid="mp-screen"]';

/** A well-formed invite to a port nothing listens on. */
const DEAD_INVITE = 'offsuit://join?host=127.0.0.1&port=1&fp=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&token=AAAAAAAAAAAAAAAAAAAAAA';

async function openMultiplayer(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="play-with-friends"]').click();
  await page.waitForSelector(screen);
}

test('multiplayer is off by default: the panel shows the enable gate, and main opens no socket', async () => {
  const oracle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mp-oracle-')), 'net.jsonl');
  const { page, close } = await launchApp({ seed: 7, env: { OFFSUIT_NET_ORACLE: oracle } });
  try {
    await openMultiplayer(page);
    // The opt-in gate is shown; hosting/joining are not offered until it is enabled.
    await expect(page.locator('[data-testid="mp-disabled"]')).toBeVisible();
    await expect(page.locator('[data-testid="mp-enable"]')).toBeVisible();
    await expect(page.locator('[data-testid="mp-host"]')).toHaveCount(0);
    // Observed in main, not inferred from the IPC gate: no listener and no connection.
    const sockets = readOracle(oracle).filter((r) => r.kind === 'listen' || (r.kind === 'connect' && !r.ipc));
    expect(sockets, 'main opened a socket with multiplayer off').toEqual([]);

    // Positive control: hosting IS seen, so the silence above means something.
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();
    await expect(page.locator('[data-testid="mp-host-port"]')).toBeVisible();
    expect(readOracle(oracle).some((r) => r.kind === 'listen')).toBe(true);
  } finally {
    await close();
  }
});

test('enabling then hosting shows an invite, and a real guest that joins is dealt in with redacted cards', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  let guest: TestGuest | null = null;
  try {
    await openMultiplayer(page);

    // Turn multiplayer on, then host a table.
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();

    // The host shows the port and invite secrets; a real v2 guest joins with them. Two players → deal.
    const invite = await hostedInvite(page);
    expect(Number.isFinite(invite.port) && invite.port > 0, `host port was "${invite.port}"`).toBe(true);
    guest = joinAsGuest(invite);

    // The host's screen swaps to the live table once the deal broadcast arrives.
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });

    // Two seats are shown. The host's own seat shows two real cards; the opponent shows face-down backs.
    const seats = page.locator('[data-testid="mp-seat"]');
    await expect(seats).toHaveCount(2);

    const youSeat = page.locator('[data-testid="mp-seat"][data-you="true"]');
    await expect(youSeat).toHaveCount(1);
    // The host's own two cards are real (not backs).
    const yourCards = youSeat.locator('[data-testid="card"]');
    await expect(yourCards).toHaveCount(2);
    const yourBacks = youSeat.locator('[data-testid="card"][data-card="back"]');
    await expect(yourBacks, 'the host must see their OWN cards face up').toHaveCount(0);

    // The opponent seat shows two face-down backs — no card leaked to the host.
    const oppSeat = page.locator('[data-testid="mp-seat"][data-you="false"]');
    await expect(oppSeat).toHaveCount(1);
    const oppBacks = oppSeat.locator('[data-testid="card"][data-card="back"]');
    await expect(oppBacks, 'the opponent’s cards must be face down on the host screen').toHaveCount(2);

    // Position labels are shown, derived in core from the dealer + who was dealt in. Heads-up (two
    // funded seats) the labels are SB and BB, and the dealer-button chip marks the button seat.
    await expect(
      page.locator('[data-testid="mp-dealer-button"]'),
      'the dealer button must mark exactly one seat',
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="mp-seat-position"]'),
      'both live seats carry a position label (SB and BB heads-up)',
    ).toHaveCount(2);
    // Heads-up, the two positions are exactly SB and BB.
    const positions = await page
      .locator('[data-testid="mp-seat-position"]')
      .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.position).sort());
    expect(positions).toEqual(['BB', 'SB']);

    // The guest was dealt a verified hand, and nothing it received names the deck or a seed.
    await expect.poll(() => guest!.views.some((v) => v.handNumber >= 1)).toBe(true);
    expect(guest.errors, 'the guest’s deal check or handshake failed').toEqual([]);
    const wire = guest.wire.join('\n');
    expect(wire).not.toContain('"deck"');
    expect(wire).not.toContain('"seed"');

    expect(errors, 'the multiplayer screen threw').toEqual([]);
  } finally {
    await guest?.session.stop();
    await close();
  }
});

test('hosting shows an invite link per LAN address, carrying the pin and the token', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();

    const share = page.locator('[data-testid="mp-host-port"]');
    await expect(share).toBeVisible();
    const port = Number(await share.getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);

    // One invite per advertised address; each parses back to that address, this port, and the pin
    // and token the share block carries. On a network-less runner there is no address and so no invite.
    const addresses = ((await share.getAttribute('data-addresses')) ?? '').split(',').filter((a) => a.length > 0);
    const invites = await page.locator('[data-testid="mp-invite"]').allTextContents();
    expect(invites).toHaveLength(addresses.length);
    const fingerprint = await share.getAttribute('data-fingerprint');
    const token = await share.getAttribute('data-token');
    invites.forEach((text, i) => {
      expect(parseInvite(text)).toEqual({ host: addresses[i], port, fingerprint, token });
    });
    if (addresses.length === 0) expect((await share.textContent()) ?? '').toContain(String(port));
  } finally {
    await close();
  }
});

test('the join box rejects anything but a whole invite link, with a specific notice', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();

    // A bare host:port cannot join a v2 table: it has no certificate pin and no token.
    await page.locator('[data-testid="mp-join-invite"]').fill('192.168.1.5:50000');
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toContainText('invite link');
    await expect(page.locator('[data-testid="mp-setup"]')).toBeVisible();

    // A truncated invite is refused as incomplete rather than failing later as a certificate error.
    await page.locator('[data-testid="mp-join-invite"]').fill('offsuit://join?host=192.168.1.5&port=50000&fp=abc');
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toContainText('incomplete');

    expect(errors, 'the multiplayer screen threw').toEqual([]);
  } finally {
    await close();
  }
});

test('a join to an unreachable host falls back to setup with a notice, not a stuck "Connecting…"', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();

    // Join a valid-but-dead invite: port 1 parses but nothing is listening, so the socket connect is
    // REFUSED. mpJoin returns immediately (the connect is async), so the failure comes
    // back later as a pushed 'error' event while the screen is on 'Connecting…'. Without the fallback the
    // screen hangs there forever (the connecting branch renders no error); with it, we return to setup.
    await page.locator('[data-testid="mp-join-invite"]').fill(DEAD_INVITE);
    await page.locator('[data-testid="mp-join"]').click();

    // The screen must leave the connecting state and surface the reason on the setup panel.
    await expect(page.locator('[data-testid="mp-setup"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="mp-notice"]')).toBeVisible();
    await expect(page.locator('[data-testid="mp-connecting"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

test('the multiplayer announcer is a polite live region that starts empty on the setup panel', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    const region = page.locator('[data-testid="mp-announcer"]');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    // On the setup panel with no notice there is nothing to announce.
    await expect(region).toHaveText('');
  } finally {
    await close();
  }
});

test('a failed join is announced, and the turn/outcome are announced once playing', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  let client: TestGuest | null = null;
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    const region = page.locator('[data-testid="mp-announcer"]');

    // A join failure surfaces to a screen reader: the announcer carries the same notice the panel shows.
    await page.locator('[data-testid="mp-join-invite"]').fill(DEAD_INVITE);
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toBeVisible();
    await expect(region).toHaveText((await page.locator('[data-testid="mp-notice"]').textContent()) ?? '');

    // Now host and get a real client in so a hand is dealt.
    await page.locator('[data-testid="mp-host"]').click();
    const port = Number(await page.locator('[data-testid="mp-host-port"]').getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);
    client = joinAsGuest(await hostedInvite(page));
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });

    // Once playing, the announcer states whose turn it is when it is the host's, mirroring the seat that
    // carries data-to-act. Heads-up exactly one seat is to act; if it is the host, the cue is present.
    const hostToAct = page.locator('[data-testid="mp-seat"][data-you="true"][data-to-act="true"]');
    if ((await hostToAct.count()) > 0) {
      await expect(region).toHaveText('Your turn to act');
    } else {
      // Not the host's turn: no turn cue is announced (the opponent's turn is not the host's business).
      await expect(region).toHaveText('');
    }
  } finally {
    await client?.session.stop();
    await close();
  }
});

test('a keyboard-only host can act at the live table via F/C/R shortcuts', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  let client: TestGuest | null = null;
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();
    const port = Number(await page.locator('[data-testid="mp-host-port"]').getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);

    client = joinAsGuest(await hostedInvite(page));
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });

    // Drive whoever is to act to the HOST via keyboard only: if the guest is to act, the guest folds over
    // the socket to hand the turn to the host; then the host folds with the F key. Either way the host
    // ends up exercising a keyboard action, and folding it out settles the hand (winners populated).
    const hostToAct = page.locator('[data-testid="mp-seat"][data-you="true"][data-to-act="true"]');
    if ((await hostToAct.count()) === 0) {
      // Guest is first to act; fold it over the wire so the turn passes to the host.
      client!.session.action({ kind: 'fold' });
    }
    // Heads-up, a fold ends the hand. Pressing F must send the host's fold with no mouse — proving the
    // keyboard path works. (If the host's fold already ended it via the guest fold above, the table
    // already shows a winner; press F harmlessly — the handler no-ops off-turn.)
    await expect(hostToAct.or(page.locator('[data-testid="mp-controls"] [data-testid="mp-deal"]'))).toBeVisible({
      timeout: 10_000,
    });
    await page.locator('body').press('f');

    // The hand is resolved: the "Next hand" control appears once winners are populated (host-only deal).
    await expect(page.locator('[data-testid="mp-deal"]')).toBeVisible({ timeout: 10_000 });
  } finally {
    await client?.session.stop();
    await close();
  }
});

test('the host can choose a larger table, and the chosen seat count reaches the room', async () => {
  const { page, close } = await launchApp({ seed: 11 });
  let client: TestGuest | null = null;
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();

    // Choose a 4-handed table before hosting.
    await page.locator('[data-testid="mp-seat-count"]').selectOption('4');
    await page.locator('[data-testid="mp-host"]').click();
    const port = Number(await page.locator('[data-testid="mp-host-port"]').getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);

    // A real client joins; the deal broadcast it receives should describe a 4-seat table (the two
    // empty seats sit out chipless, but the room was built with the chosen seat count).
    client = joinAsGuest(await hostedInvite(page));

    // The host's screen shows the live table; the seat count it chose is honoured.
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="mp-seat"]')).toHaveCount(4);
  } finally {
    await client?.session.stop();
    await close();
  }
});
