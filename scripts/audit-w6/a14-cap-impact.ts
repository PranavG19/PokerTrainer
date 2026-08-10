// What does the raise-cap defect COST? A capped hero cannot 3-bet a spot where 3-betting is the
// only winning line, and the coach then grades the call it was forced into.
import { applyAction, legalActions, makeTable, minRaiseTo, raiseCappedOf, startHand, type Action, type TableState } from './lib.js';
import { gradeDecision } from '../../src/core/coach.js';

function drive(s: TableState, script: { seat: number; action: Action }[]): TableState {
  for (const step of script) {
    if (s.toAct !== step.seat) throw new Error(`desync: want seat${step.seat} got seat${s.toAct} street=${s.street}`);
    const legal = legalActions(s);
    if (!legal.includes(step.action.kind)) throw new Error(`seat${step.seat} ${step.action.kind} illegal; legal=[${legal.join(',')}]`);
    s = applyAction(s, step.action);
  }
  return s;
}
const seatLegal = (s: TableState, id: number): string[] => {
  const f = JSON.parse(JSON.stringify(s)) as TableState;
  f.toAct = id;
  return legalActions(f);
};

console.log('=== the HERO is the capped seat: seat0 is the hero in this repo ===');
console.log('  Need the hero to bet, get short-all-in-ed, then face a full raise from behind.');
console.log('  Flop order 4-handed with dealer 0 is seat1, seat2, seat3, seat0 — the hero acts LAST.');
console.log('  So put the hero on the button and let it bet the flop last, then... it has no seat behind.');
console.log('  Instead: hero bets the TURN first-to-act. Postflop order is always left of the dealer,');
console.log('  and the dealer rotates, so on the hand where the dealer is seat3 the hero acts FIRST.');
{
  // seed 7 hand 1: dealer 0. Hand 2 -> dealer 1, hand 3 -> dealer 2, hand 4 -> dealer 3.
  // With dealer 3, postflop order is seat0 (hero), seat1, seat2, seat3.
  let t = makeTable([5000, 5000, 200, 5000], 25, 50, 7);
  (t as unknown as { handNumber: number }).handNumber = 3;
  (t as unknown as { dealer: number }).dealer = 2;
  let s = startHand(t);
  console.log(`\n  dealer=${s.dealer} log=${s.log.join(' | ')} toAct=seat${s.toAct}`);
  // Limp round to the flop.
  const limps: { seat: number; action: Action }[] = [];
  let cur = s;
  while (cur.street === 'preflop') {
    const legal = legalActions(cur);
    limps.push({ seat: cur.toAct, action: { kind: legal.includes('call') ? 'call' : 'check' } });
    cur = applyAction(cur, limps[limps.length - 1].action);
  }
  s = cur;
  console.log(`  flop: toAct=seat${s.toAct} pot=${s.pot} stacks=${JSON.stringify(s.seats.map((x) => x.stack))}`);

  if (s.toAct !== 0) {
    console.log(`  (postflop first actor is seat${s.toAct}, not the hero — using that seat as the victim instead)`);
  }
  const victim = s.toAct;
  const shortSeat = s.seats.findIndex((x) => x.stack > 0 && x.stack < 200);
  console.log(`  victim=seat${victim}  short seat=seat${shortSeat} with ${s.seats[shortSeat]?.stack} behind`);

  s = drive(s, [{ seat: victim, action: { kind: 'bet', amount: 100 } }]);
  // Walk round to the short seat.
  while (s.toAct !== shortSeat && s.street === 'flop') {
    const legal = legalActions(s);
    s = applyAction(s, { kind: legal.includes('call') ? 'call' : legal.includes('check') ? 'check' : 'allin' });
  }
  console.log(`  short seat${s.toAct} facing 100 with ${s.seats[s.toAct].stack}: legal=[${legalActions(s).join(',')}]`);
  s = applyAction(s, { kind: 'allin' });
  console.log(`  after short all-in: currentBet=${s.currentBet} minRaise=${s.minRaise} capped=${JSON.stringify(raiseCappedOf(s))}`);
  console.log(`  victim seat${victim} capped=${raiseCappedOf(s)[victim]} legal=[${seatLegal(s, victim).join(',')}]`);

  // A remaining deep seat makes a FULL raise.
  const raiser = s.toAct;
  const target = minRaiseTo(s);
  if (seatLegal(s, raiser).includes('raise')) {
    s = drive(s, [{ seat: raiser, action: { kind: 'raise', amount: target } }]);
    console.log(`  seat${raiser} raised FULL to ${target}: currentBet=${s.currentBet} lastAggressor=${s.lastAggressor}`);
    const l = seatLegal(s, victim);
    console.log(`  victim seat${victim} now: committed=${s.seats[victim].committed} stack=${s.seats[victim].stack}`);
    console.log(`  victim legal=[${l.join(',')}]  capped flag=${raiseCappedOf(s)[victim]}`);
    console.log(`  ${l.includes('raise') ? 'raise available' : `>>> DEFECT: seat${victim} owes ${s.currentBet - s.seats[victim].committed} on a FULL raise and cannot re-raise`}`);

    // What does the coach say about the only move left?
    const v = s.seats[victim];
    const toCall = s.currentBet - v.committed;
    const g = gradeDecision({
      hole: v.hole, board: s.board, street: s.street, pot: s.pot, toCall,
      stack: v.stack, bb: s.bb, chosen: 'call', opponents: 2, seed: 7 + s.handNumber,
    });
    console.log(`\n  the coach on the forced call: sev=${g.severity} ΔEV=${g.evLossBb.toFixed(2)}bb principle=${g.principle}`);
    console.log(`  msg: ${g.message ?? '(silent)'}`);
    console.log(`  >>> if calling grades badly here, the learner is told off for a spot where the engine`);
    console.log(`      removed the better option.`);
  } else {
    console.log(`  (seat${raiser} cannot raise; scenario not reached on this line)`);
  }
}

console.log('\n=== how often does the cap survive a full raise in random play? ===');
{
  const { mulberry32 } = await import('../../src/core/rng.js');
  let occurrences = 0;
  let hands = 0;
  const examples: string[] = [];
  for (let seed = 1; seed <= 3000; seed++) {
    let table = makeTable([5000, 5000, 220, 900], 25, 50, seed);
    const rng = mulberry32(seed * 48271 % 2147483647);
    for (let hn = 0; hn < 12; hn++) {
      if (table.seats.filter((x) => x.stack > 0).length < 2) break;
      let s = startHand(table);
      hands++;
      let steps = 0;
      while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 200) {
        const legal = legalActions(s);
        if (legal.length === 0) break;
        // Detect: this seat is capped, faces a full raise made AFTER the cap was set, and could
        // afford a min-raise. lastAggressor made the last full raise; if it is not the short all-in
        // seat and the capped seat has not matched it, the cap is stale.
        const me = s.seats[s.toAct];
        const capped = raiseCappedOf(s)[me.id];
        const owes = s.currentBet - me.committed;
        if (capped && owes > 0 && s.lastAggressor !== null && s.lastAggressor !== me.id
            && !s.seats[s.lastAggressor].allIn && me.stack >= minRaiseTo(s) - me.committed) {
          occurrences++;
          if (examples.length < 3) {
            examples.push(`seed=${seed} hand#${s.handNumber} street=${s.street} seat${me.id} capped but faces a full raise from live seat${s.lastAggressor}\n      log: ${s.log.join(' | ')}\n      legal=[${legal.join(',')}]  (raise ${legal.includes('raise') ? 'PRESENT' : 'MISSING'})`);
          }
        }
        const kind = legal[Math.floor(rng() * legal.length)];
        s = applyAction(s, kind === 'bet' || kind === 'raise' ? { kind, amount: minRaiseTo(s) } : { kind });
      }
      const { settle } = await import('../../src/core/table.js');
      table = settle(s);
    }
  }
  console.log(`  ${hands} hands; ${occurrences} states where a stale cap suppressed a legal re-raise`);
  for (const e of examples) console.log(`\n    ${e}`);
}
