import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DownloadError, fetchVerified } from '../../src/main/dee/download.js';
import { downloadUrlAllowed, PERMISSIVE_LICENCES, PHRASING_MANIFEST, platformKey, type PhrasingManifest } from '../../src/main/dee/manifest.js';
import { PhrasingService, type PhrasingStatus } from '../../src/main/dee/service.js';
import { sandboxProfile, sidecarArgs, sidecarCommand } from '../../src/main/dee/sidecar.js';

/**
 * The download and install path, driven for real against a loopback server (the pinned URLs are never fetched in
 * CI). Integrity: host list on every hop, size cap, sha256, archive paths, consent, and a tampered binary.
 */

const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'dee-install-'));

let server: http.Server;
let base = '';
const files = new Map<string, Buffer>();
const redirects = new Map<string, string>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const to = redirects.get(req.url ?? '');
    if (to) {
      res.writeHead(302, { location: to });
      res.end();
      return;
    }
    const body = files.get(req.url ?? '');
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-length': String(body.length) });
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the pinned manifest', () => {
  it('names only commercially permissive licences, and the model is Apache-2.0', () => {
    for (const l of PHRASING_MANIFEST.licences) expect(PERMISSIVE_LICENCES as readonly string[]).toContain(l.spdx);
    expect(PHRASING_MANIFEST.licences.find((l) => l.component.startsWith('Qwen3'))?.spdx).toBe('Apache-2.0');
  });

  it('pins every asset by size and sha256 on an allowed HTTPS host', () => {
    for (const a of [PHRASING_MANIFEST.model, ...Object.values(PHRASING_MANIFEST.runtimes)]) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(a.size).toBeGreaterThan(1_000_000);
      expect(downloadUrlAllowed(a.url), a.url).toBe(true);
    }
    expect(PHRASING_MANIFEST.model.url).toContain('/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/');
  });

  it.each([
    ['https://huggingface.co/x', true],
    ['https://us.aws.cdn.hf.co/xet-bridge-us/abc', true],
    ['https://release-assets.githubusercontent.com/github-production-release-asset/1', true],
    ['http://huggingface.co/x', false],
    ['https://huggingface.co.evil.example/x', false],
    ['https://evilhf.co/x', false],
    ['https://hf.co.evil/x', false],
    ['https://user:pw@huggingface.co/x', false],
    ['https://huggingface.co:8443/x', false],
    ['https://raw.githubusercontent.com/x', false],
    ['http://127.0.0.1:9/x', false],
    ['file:///etc/passwd', false],
    ['not a url', false],
  ])('%s allowed: %s', (url, ok) => {
    expect(downloadUrlAllowed(url)).toBe(ok);
  });

  it('loopback is allowed only in the e2e test mode', () => {
    expect(downloadUrlAllowed('http://127.0.0.1:9/x', true)).toBe(true);
    expect(downloadUrlAllowed('http://localhost:9/x', true)).toBe(false);
  });
});

describe('fetchVerified against a loopback server', () => {
  const body = crypto.randomBytes(200_000);
  files.set('/ok.bin', body);
  files.set('/big.bin', Buffer.concat([body, Buffer.from('x')]));
  redirects.set('/hop', '/ok.bin');
  redirects.set('/away', 'https://evil.example/ok.bin');
  const asset = (url: string, over: Partial<{ size: number; sha256: string }> = {}) => ({ url: `${base}${url}`, size: body.length, sha256: sha(body), ...over });

  it('writes the file only when size and sha256 match, following an allowed redirect', async () => {
    const dir = tmp();
    const progress: number[] = [];
    await fetchVerified(asset('/hop'), path.join(dir, 'f'), { signal: new AbortController().signal, testLoopback: true, onProgress: (p) => progress.push(p.received) });
    expect(sha(fs.readFileSync(path.join(dir, 'f')))).toBe(sha(body));
    expect(progress.at(-1)).toBe(body.length);
    expect(fs.existsSync(path.join(dir, 'f.part'))).toBe(false);
  });

  it.each([
    ['a wrong sha256', '/ok.bin', { sha256: '0'.repeat(64) }, 'sha256'],
    ['a body over the pinned size', '/big.bin', {}, 'size'],
    ['a redirect off the host list', '/away', {}, 'host'],
    ['a missing file', '/none', {}, 'status'],
  ])('%s is refused and nothing is left on disk', async (_n, url, over, code) => {
    const dir = tmp();
    const err = await fetchVerified(asset(url, over), path.join(dir, 'f'), { signal: new AbortController().signal, testLoopback: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect((err as DownloadError).code).toBe(code);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('the pinned (non-test) mode refuses loopback outright', async () => {
    const err = await fetchVerified(asset('/ok.bin'), path.join(tmp(), 'f'), { signal: new AbortController().signal }).catch((e: unknown) => e);
    expect((err as DownloadError).code).toBe('host');
  });
});

/** A fake runtime archive (a shell script standing in for llama-server) and a fake model, served on loopback. */
function fixture(opts: { evilPath?: boolean } = {}): PhrasingManifest {
  const dir = tmp();
  const root = 'llama-test';
  fs.mkdirSync(path.join(dir, root));
  fs.writeFileSync(path.join(dir, root, 'llama-server'), '#!/bin/sh\nexit 0\n');
  const archive = path.join(dir, 'rt.tar.gz');
  if (opts.evilPath) {
    fs.writeFileSync(path.join(dir, 'escape'), 'x');
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', dir, root, 'escape']);
  } else execFileSync('/usr/bin/tar', ['-czf', archive, '-C', dir, root]);
  const rt = fs.readFileSync(archive);
  const model = crypto.randomBytes(50_000);
  const id = crypto.randomBytes(4).toString('hex');
  files.set(`/${id}/rt.tar.gz`, rt);
  files.set(`/${id}/model.gguf`, model);
  return {
    ...PHRASING_MANIFEST,
    id: `test-${id}`,
    model: { url: `${base}/${id}/model.gguf`, size: model.length, sha256: sha(model) },
    runtimes: { [platformKey()]: { url: `${base}/${id}/rt.tar.gz`, size: rt.length, sha256: sha(rt), root, binary: 'llama-server' } },
  };
}

function service(manifest: PhrasingManifest, dir = tmp(), started: string[] = []) {
  let enabled = true;
  const statuses: PhrasingStatus[] = [];
  const s = new PhrasingService({
    dir: path.join(dir, 'dee-model'),
    manifest,
    testLoopback: true,
    loadEnabled: () => enabled,
    saveEnabled: (on) => { enabled = on; },
    onStatus: (st) => statuses.push(st),
    makeModel: (binary) => ({
      id: 'fake', running: false, onExit: null,
      start: async () => { started.push(binary); },
      stop: () => undefined,
      rewrite: async (i) => i.scripted,
    }),
  });
  return { s, statuses, dir: path.join(dir, 'dee-model') };
}

const LICENCES = PHRASING_MANIFEST.licences.map((l) => l.spdx).join('+');

describe.runIf(process.platform === 'darwin')('the install (loopback, fake runtime)', () => {
  it('does nothing without the literal consent and the licence ids shown', async () => {
    const { s, dir } = service(fixture());
    expect((await s.download(false, LICENCES)).state).toBe('absent');
    expect((await s.download('yes', LICENCES)).state).toBe('absent');
    expect((await s.download(true, 'Apache-2.0')).state).toBe('absent');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('downloads, verifies, unpacks, reports progress, and Delete removes it all', async () => {
    const { s, statuses, dir } = service(fixture());
    const done = await s.download(true, LICENCES);
    expect(done.state).toBe('installed');
    expect(done.enabled).toBe(true);
    expect(statuses.some((x) => x.state === 'downloading' && x.received > 0)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'model.gguf'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'staging'))).toBe(false);
    expect(s.remove().state).toBe('absent');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('an archive with a path outside its root is refused and nothing stays installed', async () => {
    const { s, dir } = service(fixture({ evilPath: true }));
    const st = await s.download(true, LICENCES);
    expect(st.state).toBe('error');
    expect(st.error).toMatch(/unexpected path/);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('a corrupted model download is refused and removed', async () => {
    const m = fixture();
    const bad = { ...m, model: { ...m.model, sha256: 'f'.repeat(64) } };
    const { s, dir } = service(bad);
    const st = await s.download(true, LICENCES);
    expect(st.state).toBe('error');
    expect(st.error).toMatch(/sha256/);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('warm starts the installed binary; a binary changed on disk never runs', async () => {
    const started: string[] = [];
    const { s, dir } = service(fixture(), tmp(), started);
    await s.download(true, LICENCES);
    await s.warm();
    expect(started).toHaveLength(1);
    s.stop();
    const bin = fs.readdirSync(path.join(dir, 'runtime')).map((r) => path.join(dir, 'runtime', r, 'llama-server'))[0];
    fs.appendFileSync(bin, 'curl https://example.com\n');
    await s.warm();
    expect(started).toHaveLength(1);
    expect(s.status().error).toMatch(/changed on disk/);
  });

  it('off means no start', async () => {
    const started: string[] = [];
    const { s } = service(fixture(), tmp(), started);
    await s.download(true, LICENCES);
    s.setEnabled(false);
    await s.warm();
    expect(started).toEqual([]);
  });
});

describe('the sidecar command line', () => {
  const paths = { binary: '/x/llama-server', model: '/x/model.gguf' };

  it('is offline, on a unix socket with a key file, with no web UI, slots, port or remote model', () => {
    const args = sidecarArgs(paths, '/tmp/r/dee.sock', '/tmp/r/key');
    expect(args).toEqual(expect.arrayContaining(['--offline', '--no-webui', '--no-slots', '--log-disable']));
    expect(args[args.indexOf('--host') + 1]).toBe('/tmp/r/dee.sock');
    expect(args[args.indexOf('--api-key-file') + 1]).toBe('/tmp/r/key');
    expect(args[args.indexOf('--temp') + 1]).toBe('0');
    expect(args).not.toContain('--port');
    for (const banned of ['-hf', '--hf-repo', '-mu', '--model-url', '--tools', '--props', '--metrics', '--mcp-servers-json', '--webui-mcp-proxy']) expect(args).not.toContain(banned);
  });

  it.runIf(process.platform === 'darwin')('runs under sandbox-exec with network denied except a unix socket', () => {
    const { command, args } = sidecarCommand(paths, '/tmp/r', '/tmp/r/dee.sock', '/tmp/r/key');
    expect(command).toBe('/usr/bin/sandbox-exec');
    const profile = args[args.indexOf('-p') + 1];
    expect(profile).toContain('(deny network*)');
    expect(profile).toContain('(allow network* (local unix))');
    expect(profile).toContain('(deny file-write*)');
    expect(profile).not.toMatch(/remote|tcp/);
    expect(sandboxProfile('/tmp/r')).toBe(profile);
  });
});
