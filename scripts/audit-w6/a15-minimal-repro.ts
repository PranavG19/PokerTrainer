// THE minimal repro for the stale raise-cap, on the hero seat, with nothing but legalActions moves.
import { applyAction, legalActions, makeTable, minRaiseTo, raiseCappedOf, startHand, type Action, type TableState } from './lib.js';

const step = (s: TableState, action: Action): TableState => {
  const legal = legalActions(s);
  if (!legal.includes(action.kind)) throw new Error(`seat${s.toAct} ${action.kind} ILLEGAL; legal=[${legal.join(',')}]`);
  const label = `seat${s.toAct} ${action.kind}${action.amount !== undefined ? ` to ${action.amount}` : ''}`;
  const next = applyAction(s, action);
  console.log(`  ${label.padEnd(24)} -> currentBet=${String(next.currentBet).padStart(4)} minRaise=${String(next.minRaise).padStart(4)} capped=${JSON.stringify(raiseCappedOf(next))}`);
  return next;
};
const seatLegal = (s: TableState, id: number): string[] => {
  const f = JSON.parse(JSON.stringify(s)) as TableState;
  f.toAct = id;
  return legalActions(f);
};

console.log('REPRO: createTable({ seats: 4x[5000,5000,220,900], sb: 25, bb: 50, seed: 4 }); startHand()');
console.log('       seat0 is the HERO. seat2 has 220 (the short stack).\n');

let s = startHand(makeTable([5000, 5000, 220, 900], 25, 50, 4));
console.log(`  blinds: ${s.log.join(' | ')}`);
console.log(`  first to act: seat${s.toAct}\n`);

s = step(s, { kind: 'raise', amount: 100 });  // seat3
s = step(s, { kind: 'raise', amount: 150 });  // seat0 (hero)
s = step(s, { kind: 'raise', amount: 200 });  // seat1 — a FULL raise (increment 50 >= minRaise 50)
s = step(s, { kind: 'allin' });               // seat2 all-in 220 — increment 20 < minRaise 50, SHORT

console.log(`\n  state now: currentBet=${s.currentBet} minRaise=${s.minRaise} lastAggressor=seat${s.lastAggressor} (still live, stack ${s.seats[s.lastAggressor!].stack})`);
console.log(`  committed = ${JSON.stringify(s.seats.map((x) => x.committed))}`);
console.log(`  _raiseCapped = ${JSON.stringify(raiseCappedOf(s))}`);

for (const id of [0, 3]) {
  const seat = s.seats[id];
  const owes = s.currentBet - seat.committed;
  const l = seatLegal(s, id);
  console.log(`\n  seat${id}${id === 0 ? ' (HERO)' : ''}: committed ${seat.committed}, stack ${seat.stack}, owes ${owes} to call ${s.currentBet}`);
  console.log(`    it never answered seat1's FULL raise to 200 (it was at ${seat.committed} when seat1 raised).`);
  console.log(`    a min re-raise would cost ${minRaiseTo(s) - seat.committed}, which it can afford (${seat.stack} behind).`);
  console.log(`    legalActions = [${l.join(',')}]`);
  console.log(`    _raiseCapped[${id}] = ${raiseCappedOf(s)[id]}`);
  console.log(`    MEASURED WRONG VALUE: 'raise' is ${l.includes('raise') ? 'present' : 'ABSENT'} — expected present.`);
}

console.log('\n  ROOT CAUSE (src/core/table.ts:405-409): the short all-in caps every seat whose');
console.log('  _streetActed flag is set, regardless of whether that seat had MATCHED the previous');
console.log('  currentBet. seat0 and seat3 had acted, but at 150 and 100 against a currentBet of 200 —');
console.log('  the action was already reopened for them by seat1\'s full raise and was never theirs to lose.');

console.log('\n\n--- SECOND DEFECT: a cap set by a short all-in is never CLEARED by a later FULL raise ---');
console.log('REPRO: createTable({ seats: [5000,5000,150,5000], sb: 25, bb: 50, seed: 7 }); startHand()\n');
{
  let t = startHand(makeTable([5000, 5000, 150, 5000], 25, 50, 7));
  console.log(`  blinds: ${t.log.join(' | ')}; first to act seat${t.toAct}`);
  for (const a of [3, 0, 1] as const) {
    if (t.toAct !== a) throw new Error(`desync at seat${a}`);
    t = step(t, { kind: 'call' });
  }
  t = step(t, { kind: 'check' });  // seat2 closes preflop
  console.log(`  -> ${t.street}, pot ${t.pot}, seat2 has ${t.seats[2].stack} behind, order starts seat${t.toAct}`);
  t = step(t, { kind: 'bet', amount: 60 });   // seat1 bets 60, minRaise becomes 60
  t = step(t, { kind: 'allin' });             // seat2 all-in 100: increment 40 < 60 -> SHORT, caps seat1
  console.log(`  seat1 correctly capped: legal=[${seatLegal(t, 1).join(',')}]`);
  const target = minRaiseTo(t);
  t = step(t, { kind: 'raise', amount: target }); // seat3 raises FULL to 160
  console.log(`\n  seat3 raised FULL to ${target} (increment ${target - 100} >= minRaise 60): lastAggressor=seat${t.lastAggressor}`);
  const l = seatLegal(t, 1);
  console.log(`  seat1: committed ${t.seats[1].committed}, stack ${t.seats[1].stack}, owes ${t.currentBet - t.seats[1].committed}`);
  console.log(`  seat0 (never capped) legal = [${seatLegal(t, 0).join(',')}]`);
  console.log(`  seat1 (stale cap)    legal = [${l.join(',')}]`);
  console.log(`  MEASURED WRONG VALUE: 'raise' is ${l.includes('raise') ? 'present' : 'ABSENT'} for seat1 — expected present.`);
  console.log('  A full raise reopens the betting for EVERY seat. _raiseCapped is reset only in');
  console.log('  advanceStreet (table.ts:466), never on a full raise within the street.');
}
