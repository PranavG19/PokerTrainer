// Does the fold-out branch differ from buildSidePots, or do BOTH overpay? a7 claimed the showdown
// path caps correctly, but its control had no folds in it, so it never tested dead money. a5 seed
// 1007 showed a showdown-path overpayment of 478, which contradicts that claim. Settle it here by
// running buildSidePots' own arithmetic against the fold-out states.
import { applyAction, legalActions, makeTable, settle, startHand, startStacksOf, type TableState } from './lib.js';
import { mulberry32 } from '../../src/core/rng.js';

function stakes(pre: TableState): number[] {
  const start = startStacksOf(pre);
  return pre.seats.map((s, i) => start[i] - s.stack);
}
function entitlement(pre: TableState, id: number): number {
  const paid = stakes(pre);
  const mine = paid[id];
  let cap = mine;
  for (let i = 0; i < pre.seats.length; i++) if (i !== id) cap += Math.min(mine, paid[i]);
  return cap;
}

/** Reimplementation of buildSidePots, so its output can be inspected on fold-out states. */
function sidePots(pre: TableState): { amount: number; eligible: number[] }[] {
  const paid = stakes(pre);
  const levels = [...new Set(paid.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    const contributors = pre.seats.filter((_, i) => paid[i] > prev);
    const amount = (level - prev) * contributors.length;
    const eligible = contributors.filter((s) => !s.folded).map((s) => s.id);
    if (amount > 0) {
      if (eligible.length > 0) pots.push({ amount, eligible });
      else if (pots.length > 0) pots[pots.length - 1].amount += amount;
    }
    prev = level;
  }
  return pots;
}

console.log('=== would buildSidePots have capped the a7 fold-out correctly? ===');
{
  let s = startHand(makeTable([5000, 25, 5000, 5000], 25, 50, 7));
  for (const step of [
    { seat: 3, action: { kind: 'raise' as const, amount: 1000 } },
    { seat: 0, action: { kind: 'call' as const } },
    { seat: 2, action: { kind: 'call' as const } },
  ]) {
    s = applyAction(s, step.action);
  }
  while (s.seats.filter((x) => !x.folded).length > 1) s = applyAction(s, { kind: 'fold' });

  console.log(`  stakes=${JSON.stringify(stakes(s))} folded=${JSON.stringify(s.seats.map((x) => x.folded))}`);
  console.log(`  pot=${s.pot}`);
  console.log(`  buildSidePots would give: ${JSON.stringify(sidePots(s))}`);
  console.log(`  seat1 entitlement=${entitlement(s, 1)}`);
  const viaSidePots = sidePots(s)
    .filter((p) => p.eligible.length === 1 && p.eligible[0] === 1)
    .reduce((a, b) => a + b.amount, 0);
  console.log(`  -> seat1 would collect ${viaSidePots} from side pots (fold-out branch pays ${settle(s).winners![0].amount})`);
  console.log(`  NOTE the dead-money rule folds the 2925 orphan slice back into the PREVIOUS pot,`);
  console.log(`  whose sole eligible claimant is seat1. So buildSidePots overpays here too.`);
}

console.log('\n=== how many overpayments come from each branch? (fuzz, both paths) ===');
{
  let foldout = 0;
  let showdown = 0;
  let foldoutWorst = 0;
  let showdownWorst = 0;
  let showdownExample = '';
  for (let seed = 1; seed <= 4000; seed++) {
    const stacks = [(seed % 90) + 1, 25, 5000, 5000];
    let table = makeTable(stacks, 25, 50, seed);
    const rng = mulberry32((seed * 2654435761) % 4294967296);
    for (let hn = 0; hn < 8; hn++) {
      if (table.seats.filter((x) => x.stack > 0).length < 2) break;
      let s = startHand(table);
      let steps = 0;
      while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 300) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        const kind = legal[Math.floor(rng() * legal.length)];
        s = applyAction(s, kind === 'bet' || kind === 'raise' ? { kind, amount: s.currentBet + s.minRaise } : { kind });
      }
      const pre = s;
      const isFoldout = pre.seats.filter((x) => !x.folded).length === 1;
      const done = settle(pre);
      for (const w of done.winners ?? []) {
        const over = w.amount - entitlement(pre, w.seatId);
        if (over > 0) {
          if (isFoldout) {
            foldout++;
            foldoutWorst = Math.max(foldoutWorst, over);
          } else {
            showdown++;
            showdownWorst = Math.max(showdownWorst, over);
            if (over === showdownWorst) {
              showdownExample = `seed ${seed}: ${pre.log.join(' | ')}\n      stakes=${JSON.stringify(stakes(pre))} folded=${JSON.stringify(pre.seats.map((x) => x.folded))}\n      winners=${JSON.stringify(done.winners)}`;
            }
          }
        }
      }
      table = done;
    }
  }
  console.log(`  fold-out branch overpayments: ${foldout} (worst ${foldoutWorst})`);
  console.log(`  showdown branch overpayments: ${showdown} (worst ${showdownWorst})`);
  if (showdownExample) console.log(`  worst showdown case:\n      ${showdownExample}`);
}
