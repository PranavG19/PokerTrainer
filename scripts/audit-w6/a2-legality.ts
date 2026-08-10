// Invariant 5, direction two: an action legalActions() does NOT return must be rejected.
import { applyAction, legalActions, makeTable, startHand, minRaiseTo, maxRaiseTo, chipsOnTable, type ActionKind, type TableState } from './lib.js';

const ALL: ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

function report(label: string, s: TableState, kind: ActionKind, amount?: number): void {
  const legal = legalActions(s);
  const before = chipsOnTable(s);
  let out: string;
  try {
    const n = applyAction(s, { kind, amount });
    const after = chipsOnTable(n);
    const seat = n.seats[s.toAct];
    out = `ACCEPTED  chips ${before}->${after} (delta ${after - before})  seat${s.toAct} stack=${seat.stack} committed=${seat.committed} pot=${n.pot} currentBet=${n.currentBet}`;
  } catch (err) {
    out = `rejected: ${(err as Error).message}`;
  }
  console.log(`  ${label} illegal=${kind}${amount !== undefined ? `@${amount}` : ''} (legal=${legal.join(',')})\n      ${out}`);
}

console.log('=== A: 4-handed preflop, UTG to act facing BB 50 ===');
{
  const s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  console.log(`  toAct=${s.toAct} pot=${s.pot} currentBet=${s.currentBet} minRaiseTo=${minRaiseTo(s)} maxRaiseTo=${maxRaiseTo(s)}`);
  for (const k of ALL) {
    if (legalActions(s).includes(k)) continue;
    report('A', s, k, k === 'bet' || k === 'raise' ? minRaiseTo(s) : undefined);
  }
  console.log('  --- legal kind, ILLEGAL amounts ---');
  report('A', s, 'raise', 999999);      // more than the seat owns
  report('A', s, 'raise', 60);          // below min raise (100)
  report('A', s, 'raise', 10);          // below currentBet
  report('A', s, 'raise', 0);
  report('A', s, 'raise', -500);
}

console.log('\n=== B: postflop, first actor, currentBet 0 ===');
{
  let s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'check' });
  console.log(`  street=${s.street} toAct=${s.toAct} pot=${s.pot} currentBet=${s.currentBet}`);
  for (const k of ALL) {
    if (legalActions(s).includes(k)) continue;
    report('B', s, k, k === 'bet' || k === 'raise' ? 100 : undefined);
  }
  console.log('  --- legal kind, ILLEGAL amounts ---');
  report('B', s, 'bet', 999999);
  report('B', s, 'bet', 1);   // below one big blind
  report('B', s, 'bet', 0);
  report('B', s, 'bet', -100);
}

console.log('\n=== C: a folded / all-in seat forced to act (legalActions returns []) ===');
{
  let s = startHand(makeTable([5000, 5000, 5000, 5000], 25, 50, 7));
  s = applyAction(s, { kind: 'fold' });
  const folded = s.toAct;
  // Rewind toAct onto the seat that just folded.
  const forced = JSON.parse(JSON.stringify(s)) as TableState;
  forced.toAct = (folded + 3) % 4;
  console.log(`  toAct forced onto seat${forced.toAct} folded=${forced.seats[forced.toAct].folded} legal=[${legalActions(forced).join(',')}]`);
  for (const k of ALL) report('C', forced, k, k === 'bet' || k === 'raise' ? 200 : undefined);
}

console.log('\n=== D: acting after the hand is over (street=showdown) ===');
{
  let s = startHand(makeTable([5000, 5000], 25, 50, 11));
  s = applyAction(s, { kind: 'fold' });
  console.log(`  street=${s.street} legal=[${legalActions(s).join(',')}] pot=${s.pot}`);
  for (const k of ALL) report('D', s, k, k === 'bet' || k === 'raise' ? 200 : undefined);
}
