// The fold-out path of settle() ships the WHOLE pot to the last standing seat with no side-pot
// split. When that seat is a short all-in and the deep seats built a pot behind it, it is paid
// money it could never cover. Minimal repro with nothing but legalActions() moves.
import { applyAction, legalActions, makeTable, settle, startHand, startStacksOf, chipsOnTable, type Action, type TableState } from './lib.js';

function stake(pre: TableState, id: number): number {
  return startStacksOf(pre)[id] - pre.seats[id].stack;
}
function entitlement(pre: TableState, id: number): number {
  const mine = stake(pre, id);
  let cap = mine;
  for (let i = 0; i < pre.seats.length; i++) if (i !== id) cap += Math.min(mine, stake(pre, i));
  return cap;
}

function drive(s: TableState, script: { seat: number; action: Action }[]): TableState {
  for (const step of script) {
    if (s.toAct !== step.seat) throw new Error(`desync: want seat${step.seat}, got seat${s.toAct} street=${s.street}`);
    const legal = legalActions(s);
    if (!legal.includes(step.action.kind)) throw new Error(`seat${step.seat} ${step.action.kind} illegal; legal=[${legal.join(',')}]`);
    s = applyAction(s, step.action);
  }
  return s;
}

console.log('=== MINIMAL REPRO: short all-in wins a pot it never covered, via a fold-out ===');
console.log('  createTable seats [5000, 25, 5000, 5000] sb 25 bb 50 seed 7');
console.log('  seed 7 -> dealer 0, SB seat1, BB seat2, first to act seat3');
{
  let s = startHand(makeTable([5000, 25, 5000, 5000], 25, 50, 7));
  console.log(`  after startHand: ${s.log.join(' | ')}`);
  console.log(`  seat1 is all-in for its 25-chip SB: allIn=${s.seats[1].allIn} stack=${s.seats[1].stack}`);
  console.log(`  startStacks=${JSON.stringify(startStacksOf(s))}`);

  s = drive(s, [
    { seat: 3, action: { kind: 'raise', amount: 1000 } },
    { seat: 0, action: { kind: 'call' } },
    { seat: 2, action: { kind: 'call' } },
  ]);
  console.log(`\n  preflop done: pot=${s.pot} street=${s.street} toAct=seat${s.toAct}`);
  console.log(`  stakes so far: ${JSON.stringify(s.seats.map((_, i) => stake(s, i)))}`);

  // Flop: every deep seat folds. fold is in legalActions at toCall 0 (table.ts:273).
  const order: number[] = [];
  while (s.seats.filter((x) => !x.folded).length > 1) {
    order.push(s.toAct);
    s = drive(s, [{ seat: s.toAct, action: { kind: 'fold' } }]);
  }
  console.log(`  flop folds in order: ${order.map((i) => `seat${i}`).join(', ')}`);
  console.log(`  log: ${s.log.join(' | ')}`);

  const pre = s;
  const done = settle(pre);
  console.log(`\n  survivors: ${pre.seats.filter((x) => !x.folded).map((x) => `seat${x.id}`).join(',')}`);
  console.log(`  winners=${JSON.stringify(done.winners)}`);
  const w = done.winners![0];
  console.log(`  seat${w.seatId} staked ${stake(pre, w.seatId)} chips of its own.`);
  console.log(`  entitled to at most ${entitlement(pre, w.seatId)} (its stake, matched once by each rival).`);
  console.log(`  ACTUALLY PAID ${w.amount}  -> OVERPAID BY ${w.amount - entitlement(pre, w.seatId)}`);
  console.log(`  stacks ${JSON.stringify(startStacksOf(pre))} -> ${JSON.stringify(done.seats.map((x) => x.stack))}`);
  console.log(`  chips=${chipsOnTable(done)} — conservation HOLDS. The money just went to the wrong seat.`);
  console.log(`\n  Correct distribution: main pot 4x25=100 to seat1; the 2925 side pot has no eligible`);
  console.log(`  claimant among seat0/2/3 so its last live contributor should get it back — never seat1.`);
}

console.log('\n=== the same defect via a partial blind, no post-blind action at all ===');
{
  const s = startHand(makeTable([5000, 10], 25, 50, 4));
  console.log(`  log: ${s.log.join(' | ')}  currentBet=${s.currentBet} pot=${s.pot}`);
  const pre = applyAction(s, { kind: 'fold' });
  const done = settle(pre);
  console.log(`  seat0 folds -> winners=${JSON.stringify(done.winners)}`);
  console.log(`  seat1 staked ${stake(pre, 1)}, entitled to ${entitlement(pre, 1)}, PAID ${done.winners![0].amount} (overpaid ${done.winners![0].amount - entitlement(pre, 1)})`);
  console.log(`  the 15 chips of seat0's SB that seat1 could not cover were never returned.`);
}

console.log('\n=== control: the SHOWDOWN path returns the excess correctly ===');
{
  let s = startHand(makeTable([5000, 25, 5000, 5000], 25, 50, 7));
  s = drive(s, [
    { seat: 3, action: { kind: 'raise', amount: 1000 } },
    { seat: 0, action: { kind: 'call' } },
    { seat: 2, action: { kind: 'call' } },
  ]);
  let steps = 0;
  while (s.street !== 'showdown' && steps++ < 40) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    s = applyAction(s, { kind: 'check' });
  }
  const done = settle(s);
  console.log(`  pots: ${JSON.stringify(done.winners)}`);
  console.log(`  seat1 collected ${(done.winners ?? []).filter((x) => x.seatId === 1).reduce((a, b) => a + b.amount, 0)}, entitled to ${entitlement(s, 1)} — capped correctly by buildSidePots.`);
}
