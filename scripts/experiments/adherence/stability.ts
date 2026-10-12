/**
 * EXPERIMENT 1 — re-seed stability: does a verdict survive re-running the Monte Carlo?
 *
 * The suggested Wave 0 target: "no severity flip from re-seeding the Monte Carlo on a fixed spot set".
 * Collects real hero decision states from the engine (grader-adherent hero, shipped lineup), then grades
 * every legal action at each state under several grader seeds and counts the states where any action's
 * verdict word (free / close / notable / serious) differs between seeds.
 *
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/stability.ts [hands] [seed] [regrades]
 */
import { mulberry32 } from '../../../src/core/rng.js';
import type { TableState } from '../../../src/core/table.js';
import { applyAction, createTable, isHandOver, legalActions, settle, startHand } from '../../../src/core/table.js';
import { decideActionAs } from '../../../src/core/ai.js';
import { MIXES, BB, SB, START_STACK } from './harness.js';
import { POLICIES, verdictOf } from './policies.js';
import type { PolicyContext } from './policies.js';
import { GRADER_MODE, gradeHero } from './grade.js';

const hands = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 20260809);
const regrades = Number(process.argv[4] ?? 5);
const mix = MIXES[0];
const archetypes = [null, ...mix.villains] as const;

let table = createTable({
  seats: [
    { name: 'Hero', stack: START_STACK, isHero: true },
    { name: 'V1', stack: START_STACK },
    { name: 'V2', stack: START_STACK },
    { name: 'V3', stack: START_STACK },
  ],
  sb: SB,
  bb: BB,
  seed,
});

const spots: TableState[] = [];
for (let hand = 0; hand < hands; hand++) {
  for (const s of table.seats) s.stack = START_STACK;
  let state = startHand(table);
  const rng = mulberry32((seed ^ Math.imul(state.handNumber, 0x9e3779b1)) >>> 0);
  const ctx: PolicyContext = { rng, graderSeed: seed + state.handNumber, trace: [], archetypes };
  while (!isHandOver(state)) {
    if (legalActions(state).length === 0) break;
    if (state.toAct === 0) {
      spots.push(state);
      state = applyAction(state, POLICIES['adherent-passive'](state, ctx));
    } else {
      state = applyAction(state, decideActionAs(mix.villains[state.toAct - 1], state, state.toAct, rng));
    }
  }
  table = settle(state);
}

let flipped = 0;
let flippedLoud = 0;
const byStreet = new Map<string, { n: number; flipped: number }>();
for (const spot of spots) {
  let any = false;
  let loud = false;
  for (const kind of legalActions(spot)) {
    const words = new Set<string>();
    for (let r = 0; r < regrades; r++) {
      words.add(verdictOf(gradeHero(spot, kind, { graderSeed: 1_000_003 * (r + 1) + spot.handNumber, archetypes })));
    }
    if (words.size > 1) any = true;
    // A loud flip: the same action is called a mistake under one seed and not under another.
    const mistake = [...words].map((w) => w === 'notable' || w === 'serious');
    if (mistake.includes(true) && mistake.includes(false)) loud = true;
  }
  const row = byStreet.get(spot.street) ?? { n: 0, flipped: 0 };
  row.n++;
  if (any) row.flipped++;
  byStreet.set(spot.street, row);
  if (any) flipped++;
  if (loud) flippedLoud++;
}

const pct = (n: number, d: number): string => `${((n / d) * 100).toFixed(1)}%`;
process.stdout.write(`\n== RE-SEED STABILITY (grader mode ${GRADER_MODE}, ${hands} hands, seed ${seed}, ${regrades} grader seeds) ==\n`);
process.stdout.write(`hero decision states: ${spots.length}\n`);
process.stdout.write(`states where some action's verdict word changes with the seed: ${flipped} (${pct(flipped, spots.length)})\n`);
process.stdout.write(`  ...where an action is a mistake under one seed and not another: ${flippedLoud} (${pct(flippedLoud, spots.length)})\n`);
for (const [street, row] of byStreet) process.stdout.write(`  ${street.padEnd(8)} ${row.n} states, ${pct(row.flipped, row.n)} flip\n`);
