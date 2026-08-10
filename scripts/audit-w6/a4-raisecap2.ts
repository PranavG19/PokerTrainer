// Invariant 8, precisely scripted. Two hypotheses:
//   H1: the cap set by a short all-in is never CLEARED by a subsequent FULL raise on the same
//       street, so a seat that legitimately regained the right to raise is refused it.
//   H2: a seat that has acted but has NOT matched the last full raise is capped anyway, which
//       removes a re-raise it is entitled to.
import { applyAction, legalActions, makeTable, minRaiseTo, raiseCappedOf, startHand, type Action, type TableState } from './lib.js';

function drive(s: TableState, script: { seat: number; action: Action }[]): TableState {
  for (const step of script) {
    if (s.toAct !== step.seat) {
      throw new Error(`script desync: expected seat${step.seat} to act, got seat${s.toAct} (street=${s.street})`);
    }
    const legal = legalActions(s);
    if (!legal.includes(step.action.kind)) {
      throw new Error(`seat${step.seat} ${step.action.kind} not legal; legal=[${legal.join(',')}] street=${s.street}`);
    }
    s = applyAction(s, step.action);
  }
  return s;
}

function seatLegal(s: TableState, id: number): string[] {
  const forced = JSON.parse(JSON.stringify(s)) as TableState;
  forced.toAct = id;
  return legalActions(forced);
}

function dump(tag: string, s: TableState): void {
  console.log(`  ${tag}`);
  console.log(`    street=${s.street} toAct=seat${s.toAct} currentBet=${s.currentBet} minRaise=${s.minRaise} minRaiseTo=${minRaiseTo(s)} pot=${s.pot} lastAggressor=${s.lastAggressor}`);
  console.log(`    committed=${JSON.stringify(s.seats.map((x) => x.committed))} stacks=${JSON.stringify(s.seats.map((x) => x.stack))} allIn=${JSON.stringify(s.seats.map((x) => x.allIn))}`);
  console.log(`    _raiseCapped=${JSON.stringify(raiseCappedOf(s))}`);
  console.log(`    log: ${s.log.join(' | ')}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('=== H1: a full raise AFTER a short all-in does not clear the cap ===');
console.log('    stacks [5000, 5000, 150, 5000] sb25 bb50 seed 7; dealer 0, SB=1, BB=2? no: seat2 has 150');
{
  // seed 7, 4 seats: dealer=0, SB=seat1, BB=seat2, UTG=seat3.
  // Preflop: everyone limps to 50. seat2 (150) posts BB 50, has 100 left.
  let s = startHand(makeTable([5000, 5000, 150, 5000], 25, 50, 7));
  dump('after startHand', s);
  s = drive(s, [
    { seat: 3, action: { kind: 'call' } },
    { seat: 0, action: { kind: 'call' } },
    { seat: 1, action: { kind: 'call' } },
    { seat: 2, action: { kind: 'check' } },
  ]);
  dump('flop, 4 live, pot 200, seat2 has 100 behind', s);

  // Flop: seat1 bets 50. seat2 all-in 100 -> increment 50 == minRaise 50 -> FULL raise. Need it
  // SHORT, so bet 60: minRaise becomes 60, seat2 all-in 100 -> increment 40 < 60 -> short.
  s = drive(s, [{ seat: 1, action: { kind: 'bet', amount: 60 } }]);
  s = drive(s, [{ seat: 2, action: { kind: 'allin' } }]);
  dump('seat2 all-in 100 (short raise over 60): seat1 should be capped', s);
  console.log(`    seat1 capped? ${raiseCappedOf(s)[1]}  seat1 legal=[${seatLegal(s, 1).join(',')}]  <- correct: call/fold only`);

  // seat3 (never acted this street) makes a FULL raise. That reopens the action for seat1.
  const target = minRaiseTo(s);
  console.log(`\n    seat3 raises FULL to ${target} (increment ${target - s.currentBet} >= minRaise ${s.minRaise})`);
  s = drive(s, [{ seat: 3, action: { kind: 'raise', amount: target } }]);
  dump('after seat3 full raise', s);
  console.log(`    seat0 legal=[${seatLegal(s, 0).join(',')}]`);
  console.log(`    seat1 legal=[${seatLegal(s, 1).join(',')}]   <<< seat1 faces a FULL raise and MUST be able to re-raise`);
  console.log(`    seat1 capped flag = ${raiseCappedOf(s)[1]}  (stack ${s.seats[1].stack}, committed ${s.seats[1].committed}, needs ${s.currentBet - s.seats[1].committed} to call)`);
  const l = seatLegal(s, 1);
  console.log(`    VERDICT: ${l.includes('raise') ? 'OK — raise offered' : 'BUG — raise WITHHELD from a seat facing a full raise'}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('\n=== H2: a seat capped despite never having matched the last full raise ===');
{
  // stacks [5000, 5000, 400, 5000]; preflop limp round; flop: seat1 bets 100, seat2... need seat2
  // to be the SHORT ALL-IN and a deep seat to have raised full in between. Order on the flop is
  // seat1, seat2, seat3, seat0. So: seat1 bets 100, seat2 raises full to 300, seat3 all-in short.
  // seat3 needs a stack that is 300 < x < 500 after preflop. 400 -> 350 after limping 50.
  let s = startHand(makeTable([5000, 5000, 5000, 400], 25, 50, 7));
  s = drive(s, [
    { seat: 3, action: { kind: 'call' } },
    { seat: 0, action: { kind: 'call' } },
    { seat: 1, action: { kind: 'call' } },
    { seat: 2, action: { kind: 'check' } },
  ]);
  dump('flop, seat3 has 350 behind', s);
  s = drive(s, [
    { seat: 1, action: { kind: 'bet', amount: 100 } },
    { seat: 2, action: { kind: 'raise', amount: 300 } },
  ]);
  dump('seat1 bet 100 then seat2 raised full to 300; seat1 has NOT answered the raise', s);
  s = drive(s, [{ seat: 3, action: { kind: 'allin' } }]);
  dump('seat3 all-in 350 (increment 50 < minRaise 200 -> short)', s);
  console.log(`    seat1 committed=${s.seats[1].committed} currentBet=${s.currentBet}: it owes ${s.currentBet - s.seats[1].committed}`);
  console.log(`    seat1 capped flag = ${raiseCappedOf(s)[1]}`);
  console.log(`    seat1 legal=[${seatLegal(s, 1).join(',')}]`);
  console.log(`    seat2 capped flag = ${raiseCappedOf(s)[2]} legal=[${seatLegal(s, 2).join(',')}]  <- seat2 DID match 300, capping it is correct`);
  const l1 = seatLegal(s, 1);
  console.log(
    `    VERDICT: ${l1.includes('raise') ? 'OK — raise offered' : "BUG — seat1 never matched seat2's full raise to 300 yet is refused a re-raise"}`,
  );
}
