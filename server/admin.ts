/**
 * Operator commands, run on the server against its state directory (stop the service for `forget`, or
 * run it while the server is up for the read-only ones):
 *
 *   node dist-server/server/admin.js --state <dir> stats              players, leagues, seasons, ledger sizes
 *   node dist-server/server/admin.js --state <dir> signals [season]   collusion signals per pair (operator only)
 *   node dist-server/server/admin.js --state <dir> regrade [season]   recompute every stored grade and report any that differ
 *   node dist-server/server/admin.js --state <dir> export <key>       everything stored about one key, as JSON
 *   node dist-server/server/admin.js --state <dir> forget <key>       erase one key (a deletion request by e-mail)
 *   node dist-server/server/admin.js pin <cert.pem>                   the certificate pin players would paste
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { GRADER_VERSION, graderFingerprint, gradeInput, seasonOf } from '../src/core/online/ranked.js';
import { silentLog } from './log.js';
import { pemFingerprint } from './main.js';
import { Rankings } from './rankings.js';
import { Store, type DecisionLine } from './store.js';

export function regrade(store: Store, season: string): { checked: number; differ: { d: string; stored: number; now: number }[] } {
  const differ: { d: string; stored: number; now: number }[] = [];
  const lines = store.read<DecisionLine>('decisions', season);
  for (const line of lines) {
    const now = Math.round(gradeInput(line.in) * 10_000) / 10_000;
    if (Math.abs(now - line.ev) > 1e-9) differ.push({ d: line.d, stored: line.ev, now });
  }
  return { checked: lines.length, differ };
}

function run(argv: readonly string[]): unknown {
  if (argv[0] === 'pin') return { pin: pemFingerprint(fs.readFileSync(argv[1], 'utf8')) };
  const at = argv.indexOf('--state');
  if (at < 0) throw new Error('--state <dir> is required');
  const rest = argv.filter((_a, i) => i !== at && i !== at + 1);
  const [command, arg] = rest;
  // Only `forget` (run with the service stopped) writes; everything else may run beside the live server.
  const store = Store.open(path.resolve(argv[at + 1]), { readOnly: command !== 'forget' });
  const season = arg ?? seasonOf(Date.now());
  switch (command) {
    case 'stats':
      return {
        players: store.playerCount(),
        seasons: store.ledgerSeasons().map((s) => ({ season: s, decisions: store.read('decisions', s).length, hands: store.read('hands', s).length })),
        grader: { version: GRADER_VERSION, fingerprint: graderFingerprint() },
      };
    case 'signals':
      return new Rankings(store, silentLog, Date.now).signals(season).slice(0, 50);
    case 'regrade': {
      const result = regrade(store, season);
      return { season, checked: result.checked, differing: result.differ.length, sample: result.differ.slice(0, 20) };
    }
    case 'export':
      return store.exportFor(String(arg));
    case 'forget':
      store.forget(String(arg));
      store.eraseLedgers();
      return { forgotten: true };
  }
  throw new Error(`unknown command: ${String(command)}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`offsuit-admin: ${(error as Error).message}\n`);
    process.exit(2);
  }
}
