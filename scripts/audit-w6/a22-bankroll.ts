// Does the destroyed small blind show up in the session bankroll, or does it vanish silently?
// The renderer records net = hero.stack - heroStartStack, and heroStartStack is read as
// state.seats[0].stack + state.seats[0].committed right after startHand (renderer/screens/table.ts
// nextHand()) — the SAME expression that under-records the seat, so the two errors cancel and the
// loss becomes invisible to the session ledger.
import { settle, startHand, type TableState } from './lib.js';
import { createTable } from '../../src/core/table.js';
import { emptySession, recordHand } from '../../src/core/session.js';

const total = (s: TableState): number => s.seats.reduce((n, x) => n + x.stack, 0) + s.pot;

let t = createTable({
  seats: ['You', 'Ada', 'Bo', 'Cy'].map((name, i) => ({ name, stack: i === 0 ? 12000 : 0, isHero: i === 0 })),
  sb: 25, bb: 50, seed: 7,
});
let session = emptySession();
const trueStart = t.seats[0].stack;

console.log('  hand | heroStartStack | final stack | net recorded | TRUE chip delta | bankroll');
for (let i = 1; i <= 6; i++) {
  const before = t.seats[0].stack;
  const s = startHand(t);
  // Exactly what nextHand() does.
  const heroStartStack = s.seats[0].stack + s.seats[0].committed;
  const done = settle(s);
  const net = done.seats[0].stack - heroStartStack;
  session = recordHand(session, {
    handNumber: done.handNumber,
    hole: done.seats[0].hole,
    board: done.board,
    net,
    vpip: false,
    pfr: false,
    grades: [],
  });
  console.log(
    `  ${String(i).padStart(4)} | ${String(heroStartStack).padStart(14)} | ${String(done.seats[0].stack).padStart(11)} | ${String(net).padStart(12)} | ${String(done.seats[0].stack - before).padStart(15)} | ${session.bankroll}`,
  );
  t = done;
}

console.log(`\n  TRUE hero chips: ${trueStart} -> ${t.seats[0].stack} (lost ${trueStart - t.seats[0].stack})`);
console.log(`  session bankroll: 10000 -> ${session.bankroll} (net recorded 0 every hand)`);
console.log(`  chips on table: ${total(t)}`);
console.log('\n  >>> heroStartStack uses stack + committed, the same under-count as _startStacks, so');
console.log('      net comes out 0 and the bankroll never moves. The player loses 25 a hand off the');
console.log('      table with the Profile screen reporting break-even. The two bugs mask each other,');
console.log('      which is exactly why 758 green tests and a conservation oracle both missed it.');

console.log('\n=== does the DISPLAYED bankroll on the home screen disagree with the table? ===');
console.log(`  home bankroll numeral: ${session.bankroll}`);
console.log(`  hero stack shown on the table: ${t.seats[0].stack}`);
console.log('  session.ts documents bankroll as "total net worth — pocket plus the chips on the table"');
console.log(`  (src/core/session.ts, the rebuy comment). The invariant it states is bankroll ===`);
console.log('  DEFAULT_BANKROLL + sum(nets), which holds; but the chips actually on the table no');
console.log('  longer match, so net worth is overstated by the destroyed amount.');
