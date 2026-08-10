// a14 flags 15 states in 23364 hands after the cap fix. Its heuristic asks "is lastAggressor a live
// seat other than me?", which also matches a raise made BEFORE the cap and already answered — the
// exact shape of seed 472, where seat0 had matched 200 before the short all-in arrived. The precise
// question is whether ANY full raise happened after the cap was set that this seat has not matched.
// Track the cap's provenance directly instead of inferring it.
import { applyAction, legalActions, makeTable, minRaiseTo, raiseCappedOf, startHand, type TableState } from './lib.js';
import { mulberry32 } from '../../src/core/rng.js';

/** currentBet at the moment each seat was capped. undefined = not capped. */
type CapContext = (number | undefined)[];

let scanned = 0;
let trulyStale = 0;
const examples: string[] = [];

for (let seed = 1; seed <= 3000; seed++) {
  let table = makeTable([5000, 5000, 245, 5000], 25, 50, seed);
  const rng = mulberry32(seed ^ 0x1234);

  for (let hn = 0; hn < 8; hn++) {
    if (table.seats.filter((x) => x.stack > 0).length < 2) break;
    let s = startHand(table);
    let capBet: CapContext = s.seats.map(() => undefined);
    // Per seat: has a full raise landed since this seat was capped? Set by observing the raise, not
    // by comparing states afterwards.
    let fullRaiseSince: boolean[] = s.seats.map(() => false);
    let steps = 0;

    while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 200) {
      const legal = legalActions(s);
      if (legal.length === 0) break;

      const me = s.seats[s.toAct];
      const capped = raiseCappedOf(s)[me.id];
      const owes = s.currentBet - me.committed;

      if (capped && owes > 0 && me.stack >= minRaiseTo(s) - me.committed) {
        scanned++;
        const betWhenCapped = capBet[me.id];
        // Neither "currentBet rose" nor "a live seat owns the bet" is the test, and both were tried
        // here first. A short all-in ALWAYS lifts currentBet — that is what makes it short — so the
        // first flagged all 190 correct caps. The second flagged 4 more where the top seat had merely
        // CALLED the all-in rather than raised over it, which reopens nothing.
        //
        // The right test is the rule itself: a cap is stale iff a FULL RAISE happened after it was
        // set. Nothing else reopens the action — calls, checks and short all-ins all leave it closed.
        // So track the raise events rather than inferring them from the resulting state.
        if (betWhenCapped !== undefined && fullRaiseSince[me.id] && !legal.includes('raise')) {
          trulyStale++;
          if (examples.length < 4) {
            examples.push(
              `seed=${seed} hand#${s.handNumber} seat${me.id}: capped at currentBet=${betWhenCapped}, now ${s.currentBet}\n      log: ${s.log.join(' | ')}\n      legal=[${legal.join(',')}]`,
            );
          }
        }
      }

      const before = raiseCappedOf(s).slice();
      const beforeBet = s.currentBet;
      const beforeMinRaise = s.minRaise;
      const actorId = s.toAct;
      const kind = legal[Math.floor(rng() * legal.length)];
      s = applyAction(s, kind === 'bet' || kind === 'raise' ? { kind, amount: s.currentBet + s.minRaise } : { kind });

      // Did that action reopen the betting? Only a raise whose increment met minRaise does.
      const increment = s.currentBet - beforeBet;
      const reopened = (kind === 'raise' || kind === 'bet' || kind === 'allin') && increment >= beforeMinRaise;
      if (reopened) fullRaiseSince = s.seats.map((_, i) => (i === actorId ? false : true));

      // Record provenance for newly-set caps; clear it for cleared ones.
      const after = raiseCappedOf(s);
      capBet = s.seats.map((seat, i) => {
        if (!after[i]) return undefined;
        if (!before[i]) return beforeBet; // freshly capped, against the bet standing at the time
        return capBet[i];
      });
      // A fresh cap starts its own clock: raises before it are already accounted for by the cap.
      fullRaiseSince = s.seats.map((_, i) => (after[i] && !before[i] ? false : fullRaiseSince[i]));
      if (s.street !== 'preflop' && s.currentBet === 0) {
        capBet = s.seats.map(() => undefined);
        fullRaiseSince = s.seats.map(() => false);
      }
    }
    table = s;
  }
}

console.log(`=== capped seats examined: ${scanned} ===`);
console.log(`  truly stale caps (a FULL RAISE landed after the cap, yet raise is still refused): ${trulyStale}`);
for (const e of examples) console.log(`\n  ${e}`);
if (trulyStale === 0) {
  console.log('\n  CLEAN. a14\'s 15 remaining hits are its heuristic matching a full raise that');
  console.log('  happened BEFORE the cap and was already answered — a correct cap, not a stale one.');
}
