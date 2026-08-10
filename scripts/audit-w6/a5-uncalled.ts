// Invariant 2/6, strong form: a winner cannot be paid MORE than each opponent actually matched.
// An uncalled bet must be returned to the bettor, not shipped to whoever is left.
import { applyAction, legalActions, makeTable, settle, startHand, startStacksOf, chipsOnTable, type TableState } from './lib.js';
import { fuzz } from './lib.js';
import { mulberry32 } from '../../src/core/rng.js';

/** Max any single seat can legitimately collect: its own stake + min(its stake, each rival's stake). */
function entitlement(pre: TableState, seatId: number): number {
  const start = startStacksOf(pre);
  const paid = pre.seats.map((s, i) => start[i] - s.stack);
  const mine = paid[seatId];
  let cap = mine;
  for (let i = 0; i < pre.seats.length; i++) {
    if (i === seatId) continue;
    cap += Math.min(mine, paid[i]);
  }
  return cap;
}

console.log('=== SCENARIO 1: heads-up, BB all-in short for 9, SB posts 25 and folds ===');
{
  // seed 3082 hand#4 from the fuzz run, reconstructed directly.
  let s = startHand(makeTable([16, 1984], 25, 50, 99));
  console.log(`  log: ${s.log.join(' | ')}`);
  console.log(`  toAct=seat${s.toAct} currentBet=${s.currentBet} pot=${s.pot} committed=${JSON.stringify(s.seats.map((x) => x.committed))}`);
  console.log(`  startStacks=${JSON.stringify(startStacksOf(s))} legal=[${legalActions(s).join(',')}]`);
  const pre = applyAction(s, { kind: 'fold' });
  console.log(`  after SB folds: street=${pre.street} pot=${pre.pot}`);
  const done = settle(pre);
  const start = startStacksOf(pre);
  console.log(`  winners=${JSON.stringify(done.winners)}`);
  for (const w of done.winners ?? []) {
    console.log(
      `  seat${w.seatId} paid in ${start[w.seatId] - pre.seats[w.seatId].stack}, entitled to at most ${entitlement(pre, w.seatId)}, was PAID ${w.amount}`,
    );
  }
  console.log(`  final stacks=${JSON.stringify(done.seats.map((x) => x.stack))} (started ${JSON.stringify(start)})`);
  console.log(`  chips: ${chipsOnTable(done)} — conservation still holds, which is why this was never caught`);
}

console.log('\n=== SCENARIO 2: same shape, bigger gap (BB all-in for 1 vs SB 25) ===');
{
  let s = startHand(makeTable([1, 5000], 25, 50, 5));
  console.log(`  log: ${s.log.join(' | ')} | toAct=seat${s.toAct} currentBet=${s.currentBet} pot=${s.pot}`);
  if (!legalActions(s).includes('fold')) {
    console.log('  (SB cannot fold here; skipping)');
  } else {
    const pre = applyAction(s, { kind: 'fold' });
    const done = settle(pre);
    const start = startStacksOf(pre);
    for (const w of done.winners ?? []) {
      console.log(
        `  seat${w.seatId} paid in ${start[w.seatId] - pre.seats[w.seatId].stack}, entitled to at most ${entitlement(pre, w.seatId)}, PAID ${w.amount}  -> overpaid by ${w.amount - entitlement(pre, w.seatId)}`,
      );
    }
    console.log(`  seat0 stack ${start[0]} -> ${done.seats[0].stack}: a 1-chip stack turned into ${done.seats[0].stack}`);
  }
}

console.log('\n=== SCENARIO 3: 4-handed, one deep raiser folds out to a short all-in ===');
{
  // A short BB all-in from the blind, a deep seat raises big, everyone else folds, then the raiser
  // is the one folded to... reach it by fuzz instead and report the worst overpayment found.
  const worst: { over: number; seed: number; log: string[]; winners: unknown }[] = [];
  for (let seed = 1; seed <= 4000; seed++) {
    const stacks = [seed % 90 + 1, 25, 5000, 5000];
    let table = makeTable(stacks, 25, 50, seed);
    const rng = mulberry32(seed * 2654435761 % 4294967296);
    for (let hn = 0; hn < 8; hn++) {
      if (table.seats.filter((x) => x.stack > 0).length < 2) break;
      let s = startHand(table);
      let steps = 0;
      while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 300) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const kind = legal[Math.floor(rng() * legal.length)];
        s = applyAction(s, kind === 'bet' || kind === 'raise'
          ? { kind, amount: s.currentBet + s.minRaise }
          : { kind });
      }
      const pre = s;
      const done = settle(pre);
      for (const w of done.winners ?? []) {
        const over = w.amount - entitlement(pre, w.seatId);
        if (over > 0) worst.push({ over, seed, log: pre.log, winners: done.winners });
      }
      table = done;
    }
  }
  worst.sort((a, b) => b.over - a.over);
  console.log(`  overpayments found: ${worst.length}`);
  for (const w of worst.slice(0, 4)) {
    console.log(`\n  overpaid by ${w.over} (seed ${w.seed})`);
    console.log(`    log: ${w.log.join(' | ')}`);
    console.log(`    winners: ${JSON.stringify(w.winners)}`);
  }
}
