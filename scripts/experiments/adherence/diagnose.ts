/**
 * EXPERIMENT 1 — grader diagnostics. Not a policy comparison: this asks *what the grader says*,
 * so the report can quote evidence instead of inferring mechanism from win rates.
 *
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/diagnose.ts [hands] [seed]
 *
 * Collects, over real spots produced by the real engine while the hero plays grader-adherent:
 *   1. the full per-action EV-loss table at every hero decision;
 *   2. how often the grader has NO opinion (every legal action free) and how often the minimum ties;
 *   3. which action the passive and aggressive tie-breaks pick, per street;
 *   4. a direct probe of whether gradeDecision reacts to bet size at all.
 */
import { gradeDecision } from '../../../src/core/coach.js';
import { mulberry32 } from '../../../src/core/rng.js';
import type { ActionKind, TableState } from '../../../src/core/table.js';
import { applyAction, createTable, isHandOver, legalActions, settle, startHand } from '../../../src/core/table.js';
import { decideActionAs } from '../../../src/core/ai.js';
import { MIXES, BB, SB, START_STACK } from './harness.js';
import { POLICIES } from './policies.js';
import type { DecisionTrace, PolicyContext } from './policies.js';

const hands = Number(process.argv[2] ?? 300);
const seed = Number(process.argv[3] ?? 20260809);
const mix = MIXES[0];

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

const traces: DecisionTrace[] = [];
/** One row per (street, chosen action) so the report can show what adherence actually plays. */
const chosenByStreet = new Map<string, number>();
let facingBetDecisions = 0;
let facingBetAllFree = 0;

for (let hand = 0; hand < hands; hand++) {
  for (const s of table.seats) s.stack = START_STACK;
  let state: TableState = startHand(table);
  const rng = mulberry32((seed ^ Math.imul(state.handNumber, 0x9e3779b1)) >>> 0);
  const ctx: PolicyContext = { rng, graderSeed: seed + state.handNumber, trace: [] };

  while (!isHandOver(state)) {
    if (legalActions(state).length === 0) break;
    if (state.toAct === 0) {
      const before = ctx.trace.length;
      const hero = state.seats[0];
      const facingBet = state.currentBet - hero.committed > 0;
      const action = POLICIES['adherent-passive'](state, ctx);
      const t = ctx.trace[before];
      if (facingBet) {
        facingBetDecisions++;
        if (t.allFree) facingBetAllFree++;
      }
      const key = `${t.street}/${t.chosen}`;
      chosenByStreet.set(key, (chosenByStreet.get(key) ?? 0) + 1);
      state = applyAction(state, action);
    } else {
      state = applyAction(state, decideActionAs(mix.villains[state.toAct - 1], state, state.toAct, rng));
    }
  }
  traces.push(...ctx.trace);
  table = settle(state);
}

const total = traces.length;
const allFree = traces.filter((t) => t.allFree).length;
const tied = traces.filter((t) => t.tiedAtMin > 1).length;

process.stdout.write(`\n== GRADER OPINION RATE (${hands} hands, seed ${seed}, mix ${mix.name}) ==\n`);
process.stdout.write(`hero decisions graded:               ${total}\n`);
process.stdout.write(`every legal action graded FREE:       ${allFree} (${((allFree / total) * 100).toFixed(1)}%)\n`);
process.stdout.write(`minimum shared by >1 action:         ${tied} (${((tied / total) * 100).toFixed(1)}%)\n`);
process.stdout.write(`decisions facing a bet:              ${facingBetDecisions}\n`);
process.stdout.write(`  ...of which all-free:              ${facingBetAllFree} (${((facingBetAllFree / facingBetDecisions) * 100).toFixed(1)}%)\n`);

process.stdout.write('\n== ACTION CHOSEN BY GRADER-ADHERENT (passive tie-break) ==\n');
for (const [key, n] of [...chosenByStreet.entries()].sort()) {
  process.stdout.write(`${key.padEnd(20)} ${String(n).padStart(5)} (${((n / total) * 100).toFixed(1)}%)\n`);
}

process.stdout.write('\n== TIE WIDTH HISTOGRAM (how many actions sat at the minimum) ==\n');
const widths = new Map<number, number>();
for (const t of traces) widths.set(t.tiedAtMin, (widths.get(t.tiedAtMin) ?? 0) + 1);
for (const [w, n] of [...widths.entries()].sort((a, b) => a[0] - b[0])) {
  process.stdout.write(`${w} action(s) tied: ${String(n).padStart(5)} (${((n / total) * 100).toFixed(1)}%)\n`);
}

process.stdout.write('\n== IS AGGRESSION EVER AT THE GRADED MINIMUM? ==\n');
const aggLegal = traces.filter((t) => t.aggressionLegal);
const aggAtMin = aggLegal.filter((t) => t.aggressionAtMin);
process.stdout.write(`decisions where bet/raise/all-in was legal: ${aggLegal.length}\n`);
process.stdout.write(
  `  ...of which aggression tied for the graded minimum: ${aggAtMin.length} ` +
    `(${((aggAtMin.length / aggLegal.length) * 100).toFixed(1)}%)\n`,
);
const aggChosen = traces.filter((t) => t.chosen === 'bet' || t.chosen === 'raise' || t.chosen === 'allin');
process.stdout.write(`  ...of which the passive tie-break actually played aggression: ${aggChosen.length}\n`);

// ── Direct probe: does gradeDecision see bet size or stack at all? ───────────

process.stdout.write('\n== BET-SIZE SENSITIVITY PROBE ==\n');
const probe = (chosen: ActionKind, betSize: number | undefined, stack: number): string => {
  const g = gradeDecision({
    hole: ['7c', '2d'],
    board: ['As', 'Kh', 'Qd'],
    street: 'flop',
    pot: 100,
    toCall: 0,
    stack,
    bb: 50,
    chosen,
    betSize,
    opponents: 1,
    seed: 7,
  });
  return `${g.severity} evLoss=${g.evLossBb.toFixed(3)}bb`;
};
process.stdout.write(`72o on AKQ, bet betSize=50   stack=5000: ${probe('bet', 50, 5000)}\n`);
process.stdout.write(`72o on AKQ, bet betSize=5000 stack=5000: ${probe('bet', 5000, 5000)}\n`);
process.stdout.write(`72o on AKQ, allin           stack=5000: ${probe('allin', undefined, 5000)}\n`);
process.stdout.write(`72o on AKQ, check                      : ${probe('check', undefined, 5000)}\n`);

process.stdout.write('\n== "CHECK IS ALWAYS FREE" PROBE (nuts, no bet to call) ==\n');
for (const street of ['flop', 'turn', 'river']) {
  const g = gradeDecision({
    hole: ['As', 'Ah'],
    board: ['Ad', 'Ac', '7h'],
    street,
    pot: 100,
    toCall: 0,
    stack: 5000,
    bb: 50,
    chosen: 'check',
    opponents: 1,
    seed: 7,
  });
  const b = gradeDecision({
    hole: ['As', 'Ah'],
    board: ['Ad', 'Ac', '7h'],
    street,
    pot: 100,
    toCall: 0,
    stack: 5000,
    bb: 50,
    chosen: 'bet',
    opponents: 1,
    seed: 7,
  });
  process.stdout.write(
    `quad aces, ${street.padEnd(6)} check=${g.evLossBb.toFixed(2)}bb (${g.severity})  bet=${b.evLossBb.toFixed(2)}bb (${b.severity})\n`,
  );
}
