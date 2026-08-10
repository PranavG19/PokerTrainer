/**
 * EXPERIMENT 4 — step 1: collect graded spots, stratify by street x tier, compute boundary hands
 * for the sample, and write out/sample.json. Deterministic: no Math.random anywhere.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { collectSpots, computeBoundary, explainerPayload } from './spots.js';
import type { Spot } from './spots.js';
import { mulberry32 } from '../../../src/core/rng.js';

const spots = collectSpots({ seeds: [7, 11, 23, 42, 99, 137, 251, 404, 555, 808], maxPerSeed: 10 });

const dist: Record<string, number> = {};
for (const s of spots) dist[`${s.street}/${s.tier}`] = (dist[`${s.street}/${s.tier}`] ?? 0) + 1;
console.log('collected', spots.length, 'graded decisions');
console.log('street/tier distribution:', dist);

/** Stratified draw: walk each (street, tier) cell and take up to `per` in a seeded shuffle. */
function stratify(all: Spot[], per: number): Spot[] {
  const cells = new Map<string, Spot[]>();
  for (const s of all) {
    const k = `${s.street}/${s.tier}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(s);
  }
  const rng = mulberry32(20260809);
  const picked: Spot[] = [];
  for (const [, list] of [...cells.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const shuffled = list.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // Prefer distinct (hand, board) so the sample is not one node re-graded five ways.
    const seen = new Set<string>();
    for (const s of shuffled) {
      const key = `${s.heroHole.join('')}|${s.board.join('')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(s);
      if (seen.size >= per) break;
    }
  }
  return picked;
}

/** Graded (tier >= T1) spots for the guard/fidelity/interrogator measurements. */
const graded = stratify(spots.filter((s) => s.tier !== 'T0'), 12);
/** T0 spots for the silence measurement. */
const silent = stratify(spots.filter((s) => s.tier === 'T0'), 8);

console.log('sampled graded (tier>=T1):', graded.length, 'by cell:',
  graded.reduce<Record<string, number>>((a, s) => ((a[`${s.street}/${s.tier}`] = (a[`${s.street}/${s.tier}`] ?? 0) + 1), a), {}));
console.log('sampled T0:', silent.length, 'by street:',
  silent.reduce<Record<string, number>>((a, s) => ((a[s.street] = (a[s.street] ?? 0) + 1), a), {}));

for (const s of graded) s.boundary = computeBoundary(s);
console.log('graded with a boundary hand:', graded.filter((s) => s.boundary !== null).length, '/', graded.length);

/**
 * Class reach-weight (G2): mean(dEV over decisions in that class) x reach(class) x 100, at
 * (street x action) granularity, over the FULL collected set. This is an aggregate the engine
 * computes; the tutor only ever reads it.
 */
function classRw(all: Spot[]): Map<string, number> {
  const byClass = new Map<string, Spot[]>();
  for (const s of all) {
    const k = `${s.street}/${s.chosen}`;
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k)!.push(s);
  }
  const out = new Map<string, number>();
  for (const [k, list] of byClass) {
    const meanLoss = list.reduce((a, s) => a + s.grade.evLossBb, 0) / list.length;
    const reach = list.length / all.length;
    out.set(k, Math.round(meanLoss * reach * 100 * 10) / 10);
  }
  return out;
}
const rw = classRw(spots);

const payloadFor = (s: Spot) => explainerPayload(s, rw.get(`${s.street}/${s.chosen}`) ?? 0);

mkdirSync('scripts/experiments/tutorPrompts/out', { recursive: true });
writeFileSync(
  'scripts/experiments/tutorPrompts/out/sample.json',
  JSON.stringify(
    {
      collectedTotal: spots.length,
      distribution: dist,
      graded: graded.map((s) => ({ spot: s, payload: payloadFor(s) })),
      silent: silent.map((s) => ({ spot: s, payload: payloadFor(s) })),
    },
    null,
    2,
  ),
);
console.log('wrote out/sample.json');
