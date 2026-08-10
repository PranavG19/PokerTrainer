// Invariant 4 and 2 in the degenerate configurations the app can actually reach: exactly one
// funded seat (hero busted / villains busted), zero funded seats, and the rebuy path.
import { applyAction, isHandOver, legalActions, makeTable, settle, startHand, startStacksOf, chipsOnTable, type TableState } from './lib.js';

function dump(tag: string, s: TableState): void {
  console.log(`  ${tag}`);
  console.log(`    log: ${s.log.join(' | ') || '(none)'}`);
  console.log(`    street=${s.street} pot=${s.pot} currentBet=${s.currentBet} toAct=seat${s.toAct} dealer=${s.dealer}`);
  console.log(`    stacks=${JSON.stringify(s.seats.map((x) => x.stack))} committed=${JSON.stringify(s.seats.map((x) => x.committed))}`);
  console.log(`    folded=${JSON.stringify(s.seats.map((x) => x.folded))} holes=${JSON.stringify(s.seats.map((x) => x.hole.length))}`);
  console.log(`    isHandOver=${isHandOver(s)} legal=[${legalActions(s).join(',')}] board=${s.board.length}`);
}

console.log('=== A: ONE funded seat left (hero 5000, all three villains busted) ===');
{
  const s = startHand(makeTable([5000, 0, 0, 0], 25, 50, 7));
  dump('startHand', s);
  const done = settle(s);
  console.log(`    settle -> winners=${JSON.stringify(done.winners)}`);
  console.log(`    stacks -> ${JSON.stringify(done.seats.map((x) => x.stack))}, chips=${chipsOnTable(done)} of 5000`);
  console.log(`    seat0 staked ${startStacksOf(s)[0] - s.seats[0].stack}; it posted BOTH blinds against nobody.`);
}

console.log('\n=== B: ONE funded seat left (hero busted, one villain alive) ===');
{
  const s = startHand(makeTable([0, 4900, 0, 0], 25, 50, 7));
  dump('startHand', s);
  const done = settle(s);
  console.log(`    settle -> winners=${JSON.stringify(done.winners)} chips=${chipsOnTable(done)} of 4900`);
}

console.log('\n=== C: ZERO funded seats (every stack 0) ===');
{
  const s = startHand(makeTable([0, 0, 0, 0], 25, 50, 7));
  dump('startHand', s);
  console.log(`    every seat folded=true; activeSeatCount=0, so isHandOver's activeSeatCount===1 is FALSE.`);
  const done = settle(s);
  console.log(`    settle -> winners=${JSON.stringify(done.winners)} pot=${done.pot} chips=${chipsOnTable(done)}`);
}

console.log('\n=== D: hero busted; does startHand hand the hero a card or a blind? ===');
{
  let t = makeTable([5000, 5000, 5000, 5000], 25, 50, 7);
  t.seats[0].stack = 0;
  const s = startHand(t);
  dump('hero stack 0', s);
  console.log(`    hero holes=${s.seats[0].hole.length} folded=${s.seats[0].folded} — correctly sat out.`);
  // Now play it out and make sure the hero cannot be a winner.
  let cur = s;
  let steps = 0;
  while (!isHandOver(cur) && steps++ < 200) {
    const legal = legalActions(cur);
    if (legal.length === 0) break;
    cur = applyAction(cur, { kind: legal.includes('check') ? 'check' : 'call' });
  }
  const done = settle(cur);
  console.log(`    winners=${JSON.stringify(done.winners)}`);
  console.log(`    hero in winners? ${(done.winners ?? []).some((w) => w.seatId === 0)}`);
}

console.log('\n=== E: the rebuy path — an in-place mutation of a settled state, then startHand ===');
{
  let t = makeTable([5000, 5000, 5000, 5000], 25, 50, 7);
  t.seats[0].stack = 0;
  let s = startHand(t);
  let steps = 0;
  while (!isHandOver(s) && steps++ < 200) {
    const legal = legalActions(s);
    if (legal.length === 0) break;
    s = applyAction(s, { kind: legal.includes('check') ? 'check' : 'call' });
  }
  const settled = settle(s);
  console.log(`    settled stacks=${JSON.stringify(settled.seats.map((x) => x.stack))} chips=${chipsOnTable(settled)}`);
  // rebuyAndContinue: state.seats[0].stack = START_STACK, then nextHand() -> startHand(state)
  settled.seats[0].stack = 5000;
  console.log(`    after in-place rebuy: chips=${chipsOnTable(settled)} (5000 injected, expected)`);
  const next = startHand(settled);
  console.log(`    next hand: log=${next.log.join(' | ')}`);
  console.log(`    hero holes=${next.seats[0].hole.length} folded=${next.seats[0].folded} stack=${next.seats[0].stack}`);
  console.log(`    committed=${JSON.stringify(next.seats.map((x) => x.committed))} pot=${next.pot}`);
  console.log(`    NOTE: seat.committed from the fold-out path was left non-zero by settle; startHand resets it. chips=${chipsOnTable(next)}`);
}

console.log('\n=== F: does an all-zero table hang the fuzz loop? drive many hands from one funded seat ===');
{
  let t = makeTable([100, 0, 0, 0], 25, 50, 7);
  for (let i = 0; i < 6; i++) {
    const s = startHand(t);
    const done = settle(s);
    console.log(`  hand ${i + 1}: log=${s.log.join(' | ')} -> stacks ${JSON.stringify(done.seats.map((x) => x.stack))} winners=${JSON.stringify(done.winners)}`);
    t = done;
  }
  console.log(`  >>> the lone funded seat pays both blinds to itself every hand. Watch its stack.`);
}
