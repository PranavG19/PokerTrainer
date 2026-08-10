/**
 * EXPERIMENT 4 — the scoreboard. Joins the guard pass rate with the truth/leak measurements so a
 * variant is ranked on what actually ships: an output that passes the guard AND is not false.
 *
 * Reads the stored completions and the relations/leaks logs, so it re-derives nothing and makes no
 * model calls.
 */
import { readFileSync } from 'node:fs';

const OUT = 'scripts/experiments/tutorPrompts/out';

function guardPass(file: string, variant: string): { pass: number; total: number; words: number } {
  const d = JSON.parse(readFileSync(`${OUT}/${file}.json`, 'utf8')) as {
    rows: { variant: string; guard: { pass: boolean; wordCount: number } }[];
  };
  const sub = d.rows.filter((r) => r.variant === variant);
  return {
    pass: sub.filter((r) => r.guard.pass).length,
    total: sub.length,
    words: sub.reduce((a, r) => a + r.guard.wordCount, 0) / sub.length,
  };
}

/** The "AT LEAST ONE" line from a relations or leaks log. */
function countFromLog(path: string, marker: RegExp): number {
  const line = readFileSync(`${OUT}/${path}`, 'utf8').split('\n').find((l) => marker.test(l));
  const m = line?.match(/(\d+)\/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

const EXPLAINER: [string, string][] = [
  ['terse', 'explainer'], ['example', 'explainer'], ['banlist', 'explainer'],
  ['terse2', 'explainer-v2'], ['banlist2', 'explainer-v2'],
];
const INTERROGATOR: [string, string][] = [
  ['terse', 'interrogator'], ['example', 'interrogator'], ['banlist', 'interrogator'],
  ['terse2', 'interrogator-v2'], ['banlist2', 'interrogator-v2'],
];

console.log('EXPLAINER — n = 149 graded decisions per variant');
console.log('variant     guard-pass        avg words   false-relationship   USABLE (pass & true)');
for (const [v, f] of EXPLAINER) {
  const g = guardPass(f, v);
  const bad = countFromLog(`relations-${v}.log`, /AT LEAST ONE/);
  const usable = g.pass - bad;
  console.log(
    `${v.padEnd(11)} ${String(g.pass).padStart(3)}/${g.total} (${((g.pass / g.total) * 100).toFixed(1).padStart(5)}%)   ` +
    `${g.words.toFixed(1).padStart(5)}      ${String(bad).padStart(3)}/${g.pass} (${((bad / g.pass) * 100).toFixed(1).padStart(5)}%)   ` +
    `${String(usable).padStart(3)}/${g.total} = ${((usable / g.total) * 100).toFixed(1)}%`,
  );
}

console.log('\nINTERROGATOR — n = 149');
console.log('variant     guard-pass        avg words   leak rate            USABLE (pass & no leak)');
for (const [v, f] of INTERROGATOR) {
  const g = guardPass(f, v);
  const leaks = countFromLog(`leaks-${v}.log`, /LEAK RATE/);
  const usable = g.pass - leaks;
  console.log(
    `${v.padEnd(11)} ${String(g.pass).padStart(3)}/${g.total} (${((g.pass / g.total) * 100).toFixed(1).padStart(5)}%)   ` +
    `${g.words.toFixed(1).padStart(5)}      ${String(leaks).padStart(3)}/${g.pass} (${((leaks / g.pass) * 100).toFixed(1).padStart(5)}%)   ` +
    `${String(usable).padStart(3)}/${g.total} = ${((usable / g.total) * 100).toFixed(1)}%`,
  );
}

console.log('\nSILENCE — n = 32 T0 decisions per variant per representation');
for (const f of ['silence', 'silence-v2']) {
  const d = JSON.parse(readFileSync(`${OUT}/${f}.json`, 'utf8')) as {
    rows: { variant: string; mode: string; silent: boolean; output: string }[];
  };
  for (const mode of ['empty', 'sentinel']) {
    for (const v of [...new Set(d.rows.map((r) => r.variant))]) {
      const sub = d.rows.filter((r) => r.mode === mode && r.variant === v);
      if (!sub.length) continue;
      const ok = sub.filter((r) => r.silent).length;
      console.log(`  ${mode.padEnd(9)} ${v.padEnd(10)} ${ok}/${sub.length} silent`);
    }
  }
}
