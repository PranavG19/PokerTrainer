// Invariant 8: the raise cap. Two directions — wrongly capped, and wrongly uncapped.
import { applyAction, legalActions, makeTable, minRaiseTo, raiseCappedOf, startHand, type TableState } from './lib.js';

function show(tag: string, s: TableState): void {
  console.log(
    `  ${tag}: street=${s.street} toAct=seat${s.toAct} currentBet=${s.currentBet} minRaise=${s.minRaise} minRaiseTo=${minRaiseTo(s)} pot=${s.pot}`,
  );
  console.log(`     committed=${JSON.stringify(s.seats.map((x) => x.committed))} stacks=${JSON.stringify(s.seats.map((x) => x.stack))}`);
  console.log(`     _raiseCapped=${JSON.stringify(raiseCappedOf(s))}`);
  console.log(`     legal for seat${s.toAct} = [${legalActions(s).join(',')}]`);
}

function seatLegal(s: TableState, id: number): string[] {
  const forced = JSON.parse(JSON.stringify(s)) as TableState;
  forced.toAct = id;
  return legalActions(forced);
}

console.log('=== CASE 1: a FULL raise after a short all-in must reopen the betting ===');
console.log('    seats A=5000 B=5000 C=120 D=5000, sb 25 bb 50');
{
  // Get to the flop 4-handed with everyone in.
  let s = startHand(makeTable([5000, 5000, 120, 5000], 25, 50, 7));
  console.log(`  preflop log so far: ${s.log.join(' | ')}  toAct=seat${s.toAct}`);
  while (s.street === 'preflop') {
    const legal = legalActions(s);
    s = applyAction(s, { kind: legal.includes('call') ? 'call' : 'check' });
  }
  console.log(`  reached ${s.street}; log: ${s.log.join(' | ')}`);
  show('flop start', s);

  const bettor = s.toAct;
  s = applyAction(s, { kind: 'bet', amount: 100 });
  // Walk to seat 2 (the 120-stack) calling/checking as needed, so it faces the 100 bet.
  while (s.toAct !== 2 && s.street === 'flop') {
    const legal = legalActions(s);
    s = applyAction(s, { kind: legal.includes('call') ? 'call' : 'check' });
  }
  show('seat2 (120 chips) to act facing 100', s);
  s = applyAction(s, { kind: 'allin' }); // 120 total: increment 20, minRaise is 100 -> NOT a full raise
  console.log(`  after seat2 all-in: currentBet=${s.currentBet} minRaise=${s.minRaise} _raiseCapped=${JSON.stringify(raiseCappedOf(s))}`);
  show('next actor', s);

  const fullRaiser = s.toAct;
  const target = minRaiseTo(s);
  console.log(`  seat${fullRaiser} makes a FULL raise to ${target} (increment ${target - s.currentBet} >= minRaise ${s.minRaise})`);
  s = applyAction(s, { kind: 'raise', amount: target });
  console.log(`  after full raise: currentBet=${s.currentBet} minRaise=${s.minRaise} lastAggressor=${s.lastAggressor}`);
  console.log(`  _raiseCapped=${JSON.stringify(raiseCappedOf(s))}`);
  show('seat facing the full raise', s);
  console.log(`  seat${bettor} (the original bettor, deep, facing a full raise) legal = [${seatLegal(s, bettor).join(',')}]`);
  console.log(`  >>> a full raise reopens the action for everyone. If 'raise' is missing here, the cap was never cleared.`);
}

console.log('\n=== CASE 2: a seat that had NOT matched the last full raise must keep the right to re-raise ===');
console.log('    A bets 100, B raises to 300 (full), C all-in 350 (short raise), A has not acted since B raised');
{
  let s = startHand(makeTable([5000, 5000, 350, 5000], 25, 50, 7));
  while (s.street === 'preflop') {
    const legal = legalActions(s);
    s = applyAction(s, { kind: legal.includes('call') ? 'call' : 'check' });
  }
  show('flop start', s);
  const a = s.toAct;
  s = applyAction(s, { kind: 'bet', amount: 100 });
  const b = s.toAct;
  console.log(`  seat${a} bet 100; seat${b} raises to 300`);
  s = applyAction(s, { kind: 'raise', amount: 300 });
  console.log(`  currentBet=${s.currentBet} minRaise=${s.minRaise}; toAct=seat${s.toAct}`);
  while (s.toAct !== 2 && s.street === 'flop') {
    const legal = legalActions(s);
    s = applyAction(s, { kind: legal.includes('call') ? 'call' : legal.includes('check') ? 'check' : 'allin' });
  }
  show('seat2 (350) facing 300', s);
  s = applyAction(s, { kind: 'allin' }); // 350: increment 50 < minRaise 200 -> short
  console.log(`  after seat2 all-in 350: currentBet=${s.currentBet} minRaise=${s.minRaise}`);
  console.log(`  _raiseCapped=${JSON.stringify(raiseCappedOf(s))}`);
  console.log(`  seat${a} committed=${s.seats[a].committed} (never matched B's 300) legal=[${seatLegal(s, a).join(',')}]`);
  console.log(`  >>> seat${a} still owes 250 on a full raise it never answered; capping it removes a legal re-raise.`);
}
