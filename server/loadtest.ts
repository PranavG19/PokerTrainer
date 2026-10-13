/**
 * LOAD SMOKE — is a $5 VPS (1 vCPU, 512 MB–1 GB) enough? Starts the compiled server as its own plain Node
 * process on localhost (self-signed, pinned), seats TABLES ranked tables of PLAYERS headless clients, has
 * them play for SECONDS with a think time per decision, and samples the server process's CPU and memory
 * from outside with `ps`. Every decision on every table is graded, the worst case for the server.
 *
 *   npm run server:loadtest                              50 tables × 3 players, 60 s, 1.5 s think time
 *   node dist-server/server/loadtest.js --tables 50 --players 3 --seconds 60 --think 1500
 *
 * Prints one JSON summary. Localhost only: it never binds or connects anywhere else.
 */

import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatCode, type RoomInfo } from '../src/core/online/protocol.js';
import type { RoomView } from '../src/core/multiplayer.js';
import { OnlineSession, type OnlineEvent } from '../src/main/onlineClient.js';
import { createIdentity } from '../src/main/onlineIdentity.js';

const arg = (flag: string, fallback: number): number => {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? Number(process.argv[at + 1]) : fallback;
};
const TABLES = arg('--tables', 50);
const PLAYERS = arg('--players', 3);
const SECONDS = arg('--seconds', 60);
const THINK_MS = arg('--think', 1500);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-load-'));
  const here = path.dirname(new URL(import.meta.url).pathname);
  const child = spawn(process.execPath, [path.join(here, 'main.js'), '--state', dir, '--self-signed', '--port', '0', '--host', '127.0.0.1', '--max-per-address', '100000', '--attempts-per-minute', '100000'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const ready = await new Promise<{ port: number; pin: string }>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      for (const line of out.split('\n')) {
        if (line.includes('"server.ready"')) resolve(JSON.parse(line) as { port: number; pin: string });
      }
    });
    child.on('exit', () => reject(new Error('server exited')));
  });
  const target = { host: '127.0.0.1', port: ready.port, pin: ready.pin };

  let hands = 0;
  let actions = 0;
  let violations = 0;
  const sessions: OnlineSession[] = [];
  const idDir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-load-ids-'));
  let n = 0;
  const player = async (): Promise<OnlineSession> => {
    const id = createIdentity(path.join(idDir, `${n++}.json`));
    let session: OnlineSession;
    let lastHand = 0;
    const onEvent = (e: OnlineEvent): void => {
      if (e.type === 'removed') violations += 1;
      if (e.type !== 'state') return;
      const v: RoomView = e.view;
      if (v.winners !== null && v.handNumber > lastHand) {
        lastHand = v.handNumber;
        if (v.seats.some((s) => s.isYou && s.id === 0)) hands += 1;
      }
      if (v.yourTurn && v.winners === null) {
        // A mix of plays so every grader branch runs: mostly check/call, sometimes raise or fold.
        const r = Math.random();
        const kind = r < 0.15 && v.legal.includes('fold') ? 'fold' : r < 0.3 && v.legal.includes('raise') ? 'raise' : v.legal.includes('check') ? 'check' : 'call';
        setTimeout(() => {
          actions += 1;
          session.action({ kind });
        }, THINK_MS * (0.5 + Math.random()));
      }
    };
    session = new OnlineSession(target, id, onEvent, { reconnect: false });
    sessions.push(session);
    await session.connect();
    await session.request('profile', { name: `Load ${n}`, adult: true });
    return session;
  };

  for (let t = 0; t < TABLES; t += 1) {
    const host = await player();
    const room = (await host.request('room-create', { seats: PLAYERS, ranked: true })) as RoomInfo;
    for (let p = 1; p < PLAYERS; p += 1) await (await player()).request('room-join', { code: formatCode(room.code) });
  }

  const samples: { cpu: number; rssMb: number }[] = [];
  const started = Date.now();
  while (Date.now() - started < SECONDS * 1000) {
    await sleep(1000);
    const [cpu, rss] = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(child.pid)]).toString().trim().split(/\s+/).map(Number);
    samples.push({ cpu, rssMb: Math.round(rss / 1024) });
  }
  const elapsedMin = (Date.now() - started) / 60_000;
  for (const s of sessions) s.close();
  child.kill('SIGTERM');
  await new Promise((r) => child.on('exit', r));
  const decisions = fs
    .readdirSync(path.join(dir, 'ledger'))
    .filter((f) => f.startsWith('decisions-'))
    .reduce((sum, f) => sum + fs.readFileSync(path.join(dir, 'ledger', f), 'utf8').split('\n').filter(Boolean).length, 0);
  const cpus = samples.map((s) => s.cpu).sort((a, b) => a - b);
  const mean = (xs: number[]): number => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  process.stdout.write(
    `${JSON.stringify(
      {
        tables: TABLES,
        players: TABLES * PLAYERS,
        seconds: SECONDS,
        thinkMs: THINK_MS,
        node: process.version,
        machine: `${os.cpus()[0]?.model ?? 'cpu'} × ${os.cpus().length}, load avg ${os.loadavg()[0].toFixed(1)}`,
        handsPerMinute: Math.round(hands / elapsedMin),
        actionsPerMinute: Math.round(actions / elapsedMin),
        decisionsGraded: decisions,
        serverCpuPercent: { mean: mean(cpus), p95: cpus[Math.floor(cpus.length * 0.95)] ?? 0, max: cpus.at(-1) ?? 0 },
        serverRssMb: { mean: mean(samples.map((s) => s.rssMb)), max: Math.max(...samples.map((s) => s.rssMb)) },
        dealCheckFailures: violations,
      },
      null,
      2,
    )}\n`,
  );
}

void main();
