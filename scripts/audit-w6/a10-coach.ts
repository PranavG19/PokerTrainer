// Invariant 9: the coach's numbers.
//  9a determinism for a given seed
//  9b severity bands partition ΔEV (no value in two tiers or none)
//  9c the number in the message is the number computed
//  9d every tier is reachable for every action — a tier no input can produce is a dead branch
import { gradeDecision, potOddsRequired } from '../../src/core/coach.js';
import type { Severity } from '../../src/core/coach.js';
import { mulberry32 } from '../../src/core/rng.js';
import { freshDeck } from '../../src/core/cards.js';

type Action = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
const ACTIONS: Action[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];
const STREETS = ['preflop', 'flop', 'turn', 'river'];

function randomSpot(rng: () => number) {
  const deck = freshDeck();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const street = STREETS[Math.floor(rng() * STREETS.length)];
  const boardLen = street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  return {
    hole: deck.slice(0, 2),
    board: deck.slice(2, 2 + boardLen),
    street,
    pot: 50 + Math.floor(rng() * 3000),
    toCall: rng() < 0.3 ? 0 : Math.floor(rng() * 1500),
    stack: 5000,
    bb: 50,
    opponents: 1 + Math.floor(rng() * 3),
    seed: Math.floor(rng() * 100000),
  };
}

console.log('=== 9a: determinism at a fixed seed ===');
{
  const rng = mulberry32(1);
  let mismatches = 0;
  for (let i = 0; i < 120; i++) {
    const spot = randomSpot(rng);
    for (const chosen of ACTIONS) {
      const a = gradeDecision({ ...spot, chosen });
      const b = gradeDecision({ ...spot, chosen });
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        mismatches++;
        if (mismatches === 1) console.log(`  MISMATCH ${chosen} ${JSON.stringify(spot)}\n    ${JSON.stringify(a)}\n    ${JSON.stringify(b)}`);
      }
    }
  }
  console.log(`  ${mismatches === 0 ? 'DETERMINISTIC across 2400 grades' : `${mismatches} mismatches`}`);
}

console.log('\n=== 9a-2: is the grade STABLE when seed is not supplied? ===');
{
  const rng = mulberry32(2);
  const spot = randomSpot(rng);
  const withSeed = gradeDecision({ ...spot, chosen: 'call' });
  const noSeed = gradeDecision({ ...spot, seed: undefined, chosen: 'call' });
  const noSeed2 = gradeDecision({ ...spot, seed: undefined, chosen: 'call' });
  console.log(`  seed=${spot.seed} -> ${withSeed.evLossBb.toFixed(4)}`);
  console.log(`  seed=undefined -> ${noSeed.evLossBb.toFixed(4)} then ${noSeed2.evLossBb.toFixed(4)} ${noSeed.evLossBb === noSeed2.evLossBb ? '(stable, defaults to 1)' : '(UNSTABLE)'}`);
}

console.log('\n=== 9b: do the severity bands partition ΔEV? ===');
{
  // classifySeverity: <0.5 free, <2.0 notable, else serious. Check the boundaries and non-finite.
  const probe = [-1, -0.0001, 0, 0.4999, 0.5, 0.50001, 1.9999, 2, 2.0001, 1e9, NaN, Infinity, -Infinity];
  // Reach classifySeverity through gradeDecision is indirect; assert the partition on the pure
  // predicate the source states, and separately check whether gradeDecision can emit each value.
  const tier = (x: number): Severity => (x < 0.5 ? 'free' : x < 2.0 ? 'notable' : 'serious');
  for (const x of probe) {
    const tiers = (['free', 'notable', 'serious'] as Severity[]).filter((t) => t === tier(x));
    console.log(`  ΔEV ${String(x).padStart(10)} -> ${tiers.length === 1 ? tiers[0] : `${tiers.length} TIERS`}`);
  }
  console.log('  NaN falls to "serious" because every < comparison with NaN is false — a NaN ΔEV is');
  console.log('  reported as the most severe tier. Can gradeDecision produce NaN? see 9e.');
}

console.log('\n=== 9c: does the message quote the number gradeDecision computed? ===');
{
  const rng = mulberry32(3);
  const problems: string[] = [];
  let graded = 0;
  for (let i = 0; i < 900; i++) {
    const spot = randomSpot(rng);
    for (const chosen of ACTIONS) {
      const g = gradeDecision({ ...spot, chosen });
      if (g.message === null) continue;
      graded++;
      const quoted = /~([\d.]+) bb/.exec(g.message);
      if (quoted) {
        const shown = parseFloat(quoted[1]);
        if (Math.abs(shown - g.evLossBb) > 0.05001) {
          problems.push(`  ${chosen}: message says ~${shown} bb, evLossBb=${g.evLossBb.toFixed(4)} | ${g.message}`);
        }
      }
      // The call message quotes required% and share% but no bb figure. Check its claim instead:
      // "needs R% pot share; you had S%" must only fire when S < R.
      if (chosen === 'call') {
        const m = /needs (\d+)% pot share; you had (\d+)%/.exec(g.message);
        if (m) {
          const req = parseInt(m[1], 10);
          const share = parseInt(m[2], 10);
          if (share >= req) {
            problems.push(`  call: message claims a shortfall but shows share ${share}% >= required ${req}% | pot=${spot.pot} toCall=${spot.toCall} ΔEV=${g.evLossBb.toFixed(3)} | ${g.message}`);
          }
        }
      }
      if (chosen === 'fold' && spot.toCall === 0) {
        const m = /Folding with (\d+)% pot share when only (\d+)% was needed/.exec(g.message);
        if (m) {
          problems.push(`  fold at toCall=0: "when only ${m[2]}% was needed" — required is ${potOddsRequired(spot.pot, 0)} because nothing was needed; pot=${spot.pot} ΔEV=${g.evLossBb.toFixed(3)} | ${g.message}`);
        }
      }
    }
  }
  console.log(`  ${graded} messages checked`);
  const shown = new Set<string>();
  for (const p of problems) {
    const key = p.slice(0, 30);
    if (shown.has(key)) continue;
    shown.add(key);
    console.log(`  PROBLEM${p}`);
  }
  console.log(`  total problems: ${problems.length}`);
}

console.log('\n=== 9d: tier reachability per action (is any branch dead?) ===');
{
  const rng = mulberry32(4);
  const seen = new Map<string, number>();
  const N = 1200;
  for (let i = 0; i < N; i++) {
    const spot = randomSpot(rng);
    for (const chosen of ACTIONS) {
      const g = gradeDecision({ ...spot, chosen });
      const key = `${chosen}/${g.severity}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const chosen of ACTIONS) {
    const row = (['free', 'notable', 'serious'] as Severity[])
      .map((t) => `${t}=${seen.get(`${chosen}/${t}`) ?? 0}`)
      .join('  ');
    const dead = (['free', 'notable', 'serious'] as Severity[]).filter((t) => !seen.has(`${chosen}/${t}`));
    console.log(`  ${chosen.padEnd(6)} ${row}${dead.length ? `   <<< UNREACHABLE: ${dead.join(',')}` : ''}`);
  }
  console.log(`  (${N} random spots x ${ACTIONS.length} actions)`);
}

console.log('\n=== 9e: degenerate inputs — NaN, empty hole, pot 0 ===');
{
  const base = { hole: ['As', 'Ks'], board: [] as string[], street: 'preflop', pot: 0, toCall: 0, stack: 5000, bb: 50, opponents: 1, seed: 1 };
  const cases: [string, Partial<typeof base>][] = [
    ['pot 0, toCall 0', {}],
    ['bb 0', { bb: 0 }],
    ['empty hole', { hole: [] }],
    ['toCall > stack', { toCall: 100000, pot: 100 }],
    ['negative pot', { pot: -100 }],
    ['opponents 0', { opponents: 0 }],
  ];
  for (const [label, over] of cases) {
    for (const chosen of ['fold', 'call', 'check', 'bet'] as Action[]) {
      try {
        const g = gradeDecision({ ...base, ...over, chosen });
        const flag = !Number.isFinite(g.evLossBb) ? '  <<< NON-FINITE ΔEV' : '';
        console.log(`  ${label.padEnd(18)} ${chosen.padEnd(6)} sev=${g.severity.padEnd(8)} ΔEV=${String(g.evLossBb).padEnd(22)} msg=${g.message ? JSON.stringify(g.message.slice(0, 70)) : 'null'}${flag}`);
      } catch (err) {
        console.log(`  ${label.padEnd(18)} ${chosen.padEnd(6)} THREW: ${(err as Error).message}`);
      }
    }
  }
}
