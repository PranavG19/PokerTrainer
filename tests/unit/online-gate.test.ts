/**
 * THE ONLINE OPT-IN IS STRUCTURAL — observed with the main-process network oracle (netOracle.ts), the
 * same recorder no-network.spec reads, around main's OnlineController (no Electron needed).
 *
 * Off: nothing connects. On with a server typed in: still nothing (an address is only text). Go online
 * without the 18+ confirmation: refused before any socket. Go online properly: exactly one destination,
 * the configured server, and the device key exists only from that moment.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installNetOracle, isOutbound, readOracle } from '../../src/main/netOracle.js';
import { OnlineController, type OnlineSettingsLike } from '../../src/main/onlineMain.js';
import { startTestServer, type TestServer } from './onlineHarness.js';

let t: TestServer;
beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

function controller(): { c: OnlineController; identityFile: string; settings: () => OnlineSettingsLike } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-gate-'));
  let settings: OnlineSettingsLike = { enabled: false, server: '', pin: '', name: '', adultOn: '' };
  const identityFile = path.join(dir, 'id.json');
  const c = new OnlineController({
    load: () => settings,
    save: (patch) => (settings = { ...settings, ...patch }),
    identityFile,
    push: () => undefined,
    today: () => '2026-10-13',
  });
  return { c, identityFile, settings: () => settings };
}

describe('online play opens no socket until the player goes online', () => {
  it('off, configured, refused, then connected — measured by the oracle', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-oracle-')), 'net.jsonl');
    const uninstall = installNetOracle(file);
    try {
      const { c, identityFile, settings } = controller();
      const address = `127.0.0.1:${t.server.port}`;
      // Off: going online is refused.
      expect(await c.connect({ name: 'Ada', adult: true })).toEqual({ ok: false, error: 'Online play is off.' });
      // On, server and pin typed in: stored, nothing contacted, no key made.
      expect(c.configure({ enabled: true, server: address, pin: t.target.pin }).ok).toBe(true);
      expect(settings().server).toBe(address);
      // Without the 18+ confirmation: refused before any socket.
      expect(await c.connect({ name: 'Ada', adult: false })).toMatchObject({ ok: false });
      expect(await c.connect({ name: 'admin', adult: true })).toMatchObject({ ok: false });
      expect(fs.existsSync(identityFile)).toBe(false);
      expect(readOracle(file).filter(isOutbound), 'connected before the player went online').toEqual([]);
      // Go online: one destination, the server the player set.
      const result = await c.connect({ name: 'Ada', adult: true });
      expect(result.ok).toBe(true);
      expect(fs.existsSync(identityFile)).toBe(true);
      expect(settings().adultOn).toBe('2026-10-13');
      const outbound = readOracle(file).filter(isOutbound);
      expect(outbound.length).toBeGreaterThan(0);
      expect(new Set(outbound.map((r) => r.target))).toEqual(new Set([address]));
      // Turning it off drops the connection.
      c.configure({ enabled: false });
      expect(c.view().status).toBe('offline');
      expect(await c.request('ladder', {})).toEqual({ ok: false, error: 'Not connected to the server.' });
    } finally {
      uninstall();
    }
  });

  it('refuses requests the app does not make, before the wire', async () => {
    const { c } = controller();
    c.configure({ enabled: true, server: `127.0.0.1:${t.server.port}`, pin: t.target.pin });
    expect((await c.connect({ name: 'Bo', adult: true })).ok).toBe(true);
    expect(await c.request('profile', { name: 'x' })).toEqual({ ok: false, error: 'Not a request this app makes.' });
    expect(await c.request('hello', {})).toMatchObject({ ok: false });
    const created = await c.request('room-create', { seats: 2, ranked: true, id: 999, type: 'forget' });
    expect(created.ok).toBe(true);
    c.disconnect();
  });

  it('rejects a malformed server address or pin when configured', () => {
    const { c } = controller();
    expect(c.configure({ server: 'http://evil/path' })).toMatchObject({ ok: false });
    expect(c.configure({ pin: 'short' })).toMatchObject({ ok: false });
  });
});
