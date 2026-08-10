// Invariant 3 (the pot is real) + invariant 2 (nobody is paid more than was matched), in the one
// shape where NO odd action is needed: a partial big blind. startHand sets currentBet = s.bb
// unconditionally, even when the BB could only post part of it.
import { applyAction, legalActions, makeTable, settle, startHand, startStacksOf, chipsOnTable, type TableState } from './lib.js';

function stake(pre: TableState, id: number): number {
  return startStacksOf(pre)[id] - pre.seats[id].stack;
}
function entitlement(pre: TableState, id: number): number {
  const mine = stake(pre, id);
  let cap = mine;
  for (let i = 0; i < pre.seats.length; i++) if (i !== id) cap += Math.min(mine, stake(pre, i));
  return cap;
}

console.log('=== A: heads-up, BB can only post 10 of the 50 big blind ===');
{
  const s = startHand(makeTable([5000, 10], 25, 50, 4));
  console.log(`  log: ${s.log.join(' | ')}`);
  console.log(`  pot=${s.pot}  currentBet=${s.currentBet}  committed=${JSON.stringify(s.seats.map((x) => x.committed))}`);
  console.log(`  max committed by anyone = ${Math.max(...s.seats.map((x) => x.committed))}`);
  console.log(`  >>> INVARIANT 3: currentBet ${s.currentBet} exceeds every commitment on the table (${Math.max(...s.seats.map((x) => x.committed))}).`);
  console.log(`  toAct=seat${s.toAct} legal=[${legalActions(s).join(',')}]`);
  const toCall = s.currentBet - s.seats[s.toAct].committed;
  console.log(`  seat${s.toAct} is asked for ${toCall} more; the opponent's ENTIRE stack was ${startStacksOf(s)[1]}.`);
  console.log(`  Calling can win at most ${2 * 10} = 20, yet the call costs 25 to reach a total of 50.`);

  console.log('\n  --- line 1: seat0 folds (a normal fold facing a 25 bet) ---');
  {
    const pre = applyAction(s, { kind: 'fold' });
    const done = settle(pre);
    console.log(`  winners=${JSON.stringify(done.winners)}`);
    console.log(`  seat1 staked ${stake(pre, 1)}, entitled to at most ${entitlement(pre, 1)}, PAID ${done.winners?.[0].amount}`);
    console.log(`  stacks ${JSON.stringify(startStacksOf(pre))} -> ${JSON.stringify(done.seats.map((x) => x.stack))}`);
    console.log(`  seat0 lost ${startStacksOf(pre)[0] - done.seats[0].stack} chips against an opponent who could only cover 10.`);
    console.log(`  chips=${chipsOnTable(done)} — conserved.`);
  }

  console.log('\n  --- line 2: seat0 calls (over-calls a bet nobody backed) ---');
  {
    let pre = applyAction(s, { kind: 'call' });
    console.log(`  after call: committed=${JSON.stringify(pre.seats.map((x) => x.committed))} pot=${pre.pot} street=${pre.street}`);
    console.log(`  seat0 put in ${stake(pre, 0)} against a 10-chip opponent; 40 of it can never be won by anyone else.`);
    let steps = 0;
    while (pre.street !== 'showdown' && steps++ < 50) {
      const legal = legalActions(pre);
      if (legal.length === 0) break;
      pre = applyAction(pre, { kind: legal.includes('check') ? 'check' : 'call' });
    }
    const done = settle(pre);
    console.log(`  winners=${JSON.stringify(done.winners)}`);
    console.log(`  stacks -> ${JSON.stringify(done.seats.map((x) => x.stack))}; chips=${chipsOnTable(done)}`);
    const w = (done.winners ?? []).filter((x) => x.seatId === 1).reduce((a, b) => a + b.amount, 0);
    if (w > 0) console.log(`  seat1 collected ${w}, entitled to at most ${entitlement(pre, 1)}  -> excess ${w - entitlement(pre, 1)}`);
    else console.log(`  seat1 lost; side pots returned seat0's excess correctly on the SHOWDOWN path.`);
  }
}

console.log('\n=== B: 4-handed, BB posts a partial blind, everyone folds to it ===');
{
  const s = startHand(makeTable([5000, 5000, 5000, 12], 25, 50, 7));
  console.log(`  log: ${s.log.join(' | ')}`);
  console.log(`  pot=${s.pot} currentBet=${s.currentBet} committed=${JSON.stringify(s.seats.map((x) => x.committed))} toAct=seat${s.toAct}`);
  let pre = s;
  const seq: string[] = [];
  while (pre.seats.filter((x) => !x.folded).length > 1 && pre.street === 'preflop') {
    if (!legalActions(pre).includes('fold')) break;
    seq.push(`seat${pre.toAct}:fold`);
    pre = applyAction(pre, { kind: 'fold' });
  }
  console.log(`  sequence: ${seq.join(' ')}`);
  const done = settle(pre);
  console.log(`  winners=${JSON.stringify(done.winners)}`);
  for (const w of done.winners ?? []) {
    console.log(`  seat${w.seatId} staked ${stake(pre, w.seatId)}, entitled to at most ${entitlement(pre, w.seatId)}, PAID ${w.amount}`);
  }
  console.log(`  stacks ${JSON.stringify(startStacksOf(pre))} -> ${JSON.stringify(done.seats.map((x) => x.stack))}`);
}

console.log('\n=== C: how far can the unbacked currentBet be pushed? sb 25 bb 5000, BB stack 1 ===');
{
  const s = startHand(makeTable([100000, 1], 25, 5000, 3));
  console.log(`  log: ${s.log.join(' | ')}`);
  console.log(`  pot=${s.pot} currentBet=${s.currentBet} max committed=${Math.max(...s.seats.map((x) => x.committed))}`);
  console.log(`  seat0 legal=[${legalActions(s).join(',')}] toCall=${s.currentBet - s.seats[0].committed}`);
  console.log(`  >>> the engine demands 4975 to call a 1-chip all-in.`);
  const pre = applyAction(s, { kind: 'call' });
  console.log(`  after call: pot=${pre.pot} street=${pre.street}; seat0 staked ${stake(pre, 0)} vs a 1-chip opponent`);
  const done = settle(pre);
  console.log(`  winners=${JSON.stringify(done.winners)}  stacks -> ${JSON.stringify(done.seats.map((x) => x.stack))}`);
  console.log(`  chips=${chipsOnTable(done)} of 100001`);
}
