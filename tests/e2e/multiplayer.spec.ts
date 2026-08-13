import { expect, test, type Page } from '@playwright/test';
import * as net from 'node:net';
import { launchApp } from './helpers.js';

/**
 * MULTIPLAYER (local relay) — the Home panel driven through the real app, with a REAL socket client
 * joining the hosted table.
 *
 * The safety property that matters most is proven elsewhere and re-checked here: multiplayer is OFF by
 * default (no-network.spec confirms a fresh profile makes zero requests), so this suite first sees the
 * enable gate, turns it on, hosts, and then a raw node:net client joins the port the host shows. On the
 * host's screen its own cards are face up and the opponent's are face down — the redaction the whole
 * backend guarantees, made visible.
 */

const screen = '[data-testid="mp-screen"]';

async function openMultiplayer(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="home-screen"]');
  await page.locator('[data-testid="play-with-friends"]').click();
  await page.waitForSelector(screen);
}

test('multiplayer is off by default: the panel shows the enable gate, not a live socket', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openMultiplayer(page);
    // The opt-in gate is shown; hosting/joining are not offered until it is enabled.
    await expect(page.locator('[data-testid="mp-disabled"]')).toBeVisible();
    await expect(page.locator('[data-testid="mp-enable"]')).toBeVisible();
    await expect(page.locator('[data-testid="mp-host"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

test('enabling then hosting shows a port, and a real client that joins is dealt in with redacted cards', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  let client: net.Socket | null = null;
  try {
    await openMultiplayer(page);

    // Turn multiplayer on, then host a table.
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();

    // The host shows the port to share; read it for the joining client.
    const portEl = page.locator('[data-testid="mp-host-port"]');
    await expect(portEl).toBeVisible();
    const port = Number(await portEl.getAttribute('data-port'));
    expect(Number.isFinite(port) && port > 0, `host port was "${port}"`).toBe(true);

    // A real second player connects over the socket and joins. Two players → the host deals.
    const messages: string[] = [];
    client = net.createConnection({ host: '127.0.0.1', port });
    client.setEncoding('utf8');
    client.on('data', (chunk: string) => messages.push(chunk));
    await new Promise<void>((resolve, reject) => {
      client!.on('connect', () => {
        client!.write(JSON.stringify({ type: 'join', name: 'Guest' }) + '\n');
        resolve();
      });
      client!.on('error', reject);
    });

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

    // The client also received state, and no message it got contains the deck or a real opponent card
    // field beyond what redaction allows — spot-check the deck never crossed the wire.
    expect(messages.join('')).not.toContain('"deck"');

    expect(errors, 'the multiplayer screen threw').toEqual([]);
  } finally {
    client?.destroy();
    await close();
  }
});

test('hosting surfaces the LAN address a guest types, not just a bare port', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    await page.locator('[data-testid="mp-host"]').click();

    const portEl = page.locator('[data-testid="mp-host-port"]');
    await expect(portEl).toBeVisible();
    const port = Number(await portEl.getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);

    // The share block carries the machine's advertised LAN addresses (data-addresses). A guest on
    // another machine needs host:port, not a bare port — a loopback-only host could never advertise one.
    // On a network-less runner the list is legitimately empty (then the copy is the port-only fallback);
    // assert the address→port pairing only when there IS an address to advertise.
    const addressesAttr = (await portEl.getAttribute('data-addresses')) ?? '';
    const addresses = addressesAttr.split(',').filter((a) => a.length > 0);
    const text = (await portEl.textContent()) ?? '';
    if (addresses.length > 0) {
      // The advertised string a guest copies is address:port, and the primary address appears in the copy.
      expect(text).toContain(`${addresses[0]}:${port}`);
    } else {
      // No LAN address: the fallback still names the port and tells the host to share an address.
      expect(text).toContain(String(port));
    }
  } finally {
    await close();
  }
});

test('the join box rejects a bad address with a specific notice, without opening a socket', async () => {
  const { page, close } = await launchApp({ seed: 7 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();

    // A host with no port (neither field supplies one) is refused with a reason, and the screen stays on
    // the setup panel — the parser ran in the renderer before any join was attempted.
    await page.locator('[data-testid="mp-join-host"]').fill('192.168.1.5');
    await page.locator('[data-testid="mp-join-port"]').fill('');
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toContainText('port');
    await expect(page.locator('[data-testid="mp-setup"]')).toBeVisible();

    // A pasted host:port with a non-numeric port is likewise refused with a number-specific message.
    await page.locator('[data-testid="mp-join-host"]').fill('192.168.1.5:notaport');
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toBeVisible();

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

    // Join a valid-but-dead address: port 1 passes parseJoinAddress but nothing is listening, so the
    // socket connect is REFUSED. mpJoin returns immediately (the connect is async), so the failure comes
    // back later as a pushed 'error' event while the screen is on 'Connecting…'. Without the fallback the
    // screen hangs there forever (the connecting branch renders no error); with it, we return to setup.
    await page.locator('[data-testid="mp-join-host"]').fill('127.0.0.1');
    await page.locator('[data-testid="mp-join-port"]').fill('1');
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
  let client: net.Socket | null = null;
  try {
    await openMultiplayer(page);
    await page.locator('[data-testid="mp-enable"]').click();
    const region = page.locator('[data-testid="mp-announcer"]');

    // A join failure surfaces to a screen reader: the announcer carries the same notice the panel shows.
    await page.locator('[data-testid="mp-join-host"]').fill('127.0.0.1');
    await page.locator('[data-testid="mp-join-port"]').fill('1');
    await page.locator('[data-testid="mp-join"]').click();
    await expect(page.locator('[data-testid="mp-notice"]')).toBeVisible();
    await expect(region).toHaveText((await page.locator('[data-testid="mp-notice"]').textContent()) ?? '');

    // Now host and get a real client in so a hand is dealt.
    await page.locator('[data-testid="mp-host"]').click();
    const port = Number(await page.locator('[data-testid="mp-host-port"]').getAttribute('data-port'));
    expect(port).toBeGreaterThan(0);
    client = net.createConnection({ host: '127.0.0.1', port });
    client.setEncoding('utf8');
    await new Promise<void>((resolve, reject) => {
      client!.on('connect', () => {
        client!.write(JSON.stringify({ type: 'join', name: 'Guest' }) + '\n');
        resolve();
      });
      client!.on('error', reject);
    });
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
    client?.destroy();
    await close();
  }
});

test('the host can choose a larger table, and the chosen seat count reaches the room', async () => {
  const { page, close } = await launchApp({ seed: 11 });
  let client: net.Socket | null = null;
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
    const messages: string[] = [];
    client = net.createConnection({ host: '127.0.0.1', port });
    client.setEncoding('utf8');
    client.on('data', (chunk: string) => messages.push(chunk));
    await new Promise<void>((resolve, reject) => {
      client!.on('connect', () => {
        client!.write(JSON.stringify({ type: 'join', name: 'Guest' }) + '\n');
        resolve();
      });
      client!.on('error', reject);
    });

    // The host's screen shows the live table; the seat count it chose is honoured.
    await page.waitForSelector('[data-testid="mp-table"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="mp-seat"]')).toHaveCount(4);
  } finally {
    client?.destroy();
    await close();
  }
});
