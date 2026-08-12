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

    // The client also received state, and no message it got contains the deck or a real opponent card
    // field beyond what redaction allows — spot-check the deck never crossed the wire.
    expect(messages.join('')).not.toContain('"deck"');

    expect(errors, 'the multiplayer screen threw').toEqual([]);
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
