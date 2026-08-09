import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const STATE_FILE = path.join(app.getPath('userData'), 'offsuit-state.json');

const DEFAULT_STATE = { bankroll: 10000, hands: [], stats: {} };

export function load(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function save(obj: Record<string, unknown>): void {
  const dir = path.dirname(STATE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `offsuit-state-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, STATE_FILE);
}
