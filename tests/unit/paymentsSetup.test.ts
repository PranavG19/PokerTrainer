import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/payments-setup.ts');

describe('scripts/payments-setup.ts (the owner’s one command)', () => {
  it('makes the key outside the repo, embeds only the public half, and never prints the private key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-setup-'));
    const config = path.join(dir, 'config.ts');
    fs.copyFileSync(path.join(ROOT, 'src/core/entitlements/config.ts'), config);
    const out = execFileSync(
      process.execPath,
      [SCRIPT, '--dir', path.join(dir, 'keys'), '--config', config, '--kid', 'prod-test', '--price-monthly', '$10 a month', '--checkout-annual', 'https://buy.stripe.com/a'],
      { encoding: 'utf8' },
    );
    const key = JSON.parse(fs.readFileSync(path.join(dir, 'keys', 'prod-test.json'), 'utf8')) as { x: string; d: string };
    expect(fs.statSync(path.join(dir, 'keys', 'prod-test.json')).mode & 0o777).toBe(0o600);
    expect(out).not.toContain(key.d);
    expect(out).toContain('STRIPE_WEBHOOK_SECRETS');
    const written = fs.readFileSync(config, 'utf8');
    expect(written).toContain(`'prod-test': '${key.x}',`);
    expect(written).not.toContain(key.d);
    expect(written).toContain("monthly: '$10 a month',");
    expect(written).toContain("annual: 'https://buy.stripe.com/a',");

    // Never overwrites a key, and refuses a non-https URL.
    const again = spawnSync(process.execPath, [SCRIPT, '--dir', path.join(dir, 'keys'), '--config', config, '--kid', 'prod-test'], { encoding: 'utf8' });
    expect(again.status).toBe(1);
    const http = spawnSync(process.execPath, [SCRIPT, '--dir', path.join(dir, 'k2'), '--config', config, '--kid', 'p2', '--manage', 'http://x'], { encoding: 'utf8' });
    expect(http.status).not.toBe(0);
  });
});

describe('payments-setup flag validation', () => {
  it('a bad flag writes nothing at all', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-setup-'));
    const config = path.join(dir, 'config.ts');
    fs.copyFileSync(path.join(ROOT, 'src/core/entitlements/config.ts'), config);
    const before = fs.readFileSync(config, 'utf8');
    const r = spawnSync(process.execPath, [SCRIPT, '--dir', path.join(dir, 'keys'), '--config', config, '--manage', 'http://x'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, 'keys'))).toBe(false);
    expect(fs.readFileSync(config, 'utf8')).toBe(before);
  });
});
