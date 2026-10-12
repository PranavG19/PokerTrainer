import { afterEach, describe, expect, it } from 'vitest';
import * as childProcess from 'node:child_process';
import * as dgram from 'node:dgram';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tls from 'node:tls';
import { installNetOracle, isOutbound, readOracle } from '../../src/main/netOracle.js';

/**
 * MAIN-PROCESS NETWORK ORACLE — it must SEE each kind of egress before its silence in the offline e2e
 * specs means anything. Each test opens one kind of traffic and requires a record.
 */

let uninstall: (() => void) | null = null;
let file = '';
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function install(): void {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-')), 'net.jsonl');
  uninstall = installNetOracle(file);
}

describe('the main-process network oracle sees every kind of egress', () => {
  it('a net socket, a TLS socket, and a server listen', async () => {
    install();
    const server = net.createServer((s) => s.destroy());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((r) => net.connect(port, '127.0.0.1').on('close', () => r()).on('error', () => r()));
    await new Promise<void>((r) => {
      const t = tls.connect({ port, host: '127.0.0.1' });
      t.on('error', () => r());
      t.on('close', () => r());
    });
    server.close();
    const records = readOracle(file);
    expect(records.filter((r) => r.kind === 'listen')).toHaveLength(1);
    expect(records.filter((r) => r.kind === 'connect' && r.target === `127.0.0.1:${port}`).length).toBeGreaterThanOrEqual(2);
    expect(records.filter(isOutbound).length).toBeGreaterThanOrEqual(2);
  });

  it('a UDP datagram and a DNS lookup', async () => {
    install();
    const sock = dgram.createSocket('udp4');
    await new Promise<void>((r) => sock.send(Buffer.from('x'), 9, '127.0.0.1', () => r()));
    sock.close();
    await import('node:dns').then((dns) => new Promise<void>((r) => dns.lookup('localhost', () => r())));
    await import('node:dns').then((dns) => dns.promises.lookup('localhost'));
    // dgram resolves its own address through dns.lookup too; the two lookups of 'localhost' are ours.
    expect(readOracle(file).filter((r) => r.kind === 'dns' && r.target === 'localhost')).toHaveLength(2);
    const kinds = readOracle(file).map((r) => r.kind);
    expect(kinds).toContain('udp');
    expect(kinds).toContain('dns');
  });

  it('child processes, flagging network tools as egress and leaving others as plain spawns', () => {
    install();
    childProcess.spawnSync('true');
    childProcess.spawnSync('curl', ['--version']);
    childProcess.spawnSync('sh', ['-c', 'curl --version >/dev/null']);
    const records = readOracle(file).filter((r) => r.kind === 'spawn');
    expect(records.map((r) => [r.target, r.network])).toEqual([
      ['true', false],
      ['curl', true],
      ['sh', true],
    ]);
    expect(records.filter(isOutbound).map((r) => r.target)).toEqual(['curl', 'sh']);
  });

  it('records nothing once uninstalled, and an IPC path is not egress', async () => {
    install();
    uninstall!();
    uninstall = null;
    childProcess.spawnSync('true');
    expect(readOracle(file)).toEqual([]);
    expect(isOutbound({ kind: 'connect', target: '/tmp/x.sock', ipc: true })).toBe(false);
  });
});
