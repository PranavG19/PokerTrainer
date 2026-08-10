// Invariant 7: same seed => identical hand, on exact cards, across hands, busts and rebuys.
import { applyAction, legalActions, makeTable, settle, startHand, type TableState } from './lib.js';
import { mulberry32 } from '../../src/core/rng.js';

const fingerprint = (s: TableState): string =>
  `H${s.handNumber} D${s.dealer} deck${s.deck.length} board[${s.board.join(' ')}] holes[${s.seats.map((x) => x.hole.join('')).join('|')}]`;

function playSeries(seed: number, hands: number, rebuyAt = -1): string[] {
  let t = makeTable([5000, 5000, 5000, 5000], 25, 50, seed);
  const rng = mulberry32(seed + 12345);
  const prints: string[] = [];
  for (let i = 0; i < hands; i++) {
    let s = startHand(t);
    prints.push(fingerprint(s));
    let steps = 0;
    while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 200) {
      const legal = legalActions(s);
      if (legal.length === 0) break;
      const kind = legal[Math.floor(rng() * legal.length)];
      s = applyAction(s, kind === 'bet' || kind === 'raise' ? { kind, amount: s.currentBet + s.minRaise } : { kind });
    }
    const done = settle(s);
    prints.push(`  end ${fingerprint(done)} stacks[${done.seats.map((x) => x.stack).join(',')}]`);
    t = done;
    if (i === rebuyAt) t.seats[0].stack = 5000; // simulate rebuyAndContinue's in-place top-up
  }
  return prints;
}

console.log('=== A: same seed, same actions, twice — identical? ===');
for (const seed of [1, 7, 42, 999, 123456]) {
  const a = playSeries(seed, 25).join('\n');
  const b = playSeries(seed, 25).join('\n');
  console.log(`  seed ${seed}: ${a === b ? 'identical' : 'DIVERGED'}`);
  if (a !== b) {
    const la = a.split('\n');
    const lb = b.split('\n');
    for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) { console.log(`    first diff line ${i}:\n      A: ${la[i]}\n      B: ${lb[i]}`); break; }
  }
}

console.log('\n=== B: after a rebuy (in-place stack top-up) — still reproducible? ===');
for (const seed of [1, 7, 42]) {
  const a = playSeries(seed, 25, 5).join('\n');
  const b = playSeries(seed, 25, 5).join('\n');
  console.log(`  seed ${seed}: ${a === b ? 'identical' : 'DIVERGED'}`);
}

console.log('\n=== C: DOES THE DEAL DEPEND ON ANYTHING BUT seed + handNumber? ===');
{
  // A rebuy leaves handNumber alone, so the shuffle for hand N is mulberry32(seed + N) regardless
  // of the chips at the table. Two DIFFERENT games at the same seed must therefore deal the same
  // cards on hand N even after wildly different histories.
  const deal = (seed: number, handNumber: number, stacks: number[]): string => {
    const t = makeTable(stacks, 25, 50, seed);
    (t as unknown as { handNumber: number }).handNumber = handNumber - 1;
    const s = startHand(t);
    return `holes[${s.seats.map((x) => x.hole.join('')).join('|')}]`;
  };
  console.log(`  seed 42 hand 6, stacks 4x5000 : ${deal(42, 6, [5000, 5000, 5000, 5000])}`);
  console.log(`  seed 42 hand 6, stacks varied : ${deal(42, 6, [100, 9000, 4000, 6900])}`);
  console.log(`  >>> deals must match: the shuffle is seeded on seed+handNumber, stacks are irrelevant.`);
}

console.log('\n=== D: cross-seed collision — do seed s hand n and seed s+1 hand n-1 deal the SAME hand? ===');
{
  const deal = (seed: number, handNumber: number): string => {
    const t = makeTable([5000, 5000, 5000, 5000], 25, 50, seed);
    (t as unknown as { handNumber: number }).handNumber = handNumber - 1;
    return startHand(t).seats.map((x) => x.hole.join('')).join('|');
  };
  const a = deal(42, 6);
  const b = deal(43, 5);
  const c = deal(47, 1);
  console.log(`  seed 42 hand 6  = ${a}`);
  console.log(`  seed 43 hand 5  = ${b}   ${a === b ? '<<< COLLISION' : 'differs'}`);
  console.log(`  seed 47 hand 1  = ${c}   ${a === c ? '<<< COLLISION' : 'differs'}`);
  console.log(`  the shuffle key is seed + handNumber, so every (seed, hand) pair on the same diagonal`);
  console.log(`  is the same deal. Cosmetic for a single-seed app; it means "new seed" can replay a`);
  console.log(`  hand the learner already saw.`);
}

console.log('\n=== E: different seeds actually differ (sanity) ===');
{
  const set = new Set<string>();
  for (let seed = 1; seed <= 500; seed++) {
    const t = makeTable([5000, 5000, 5000, 5000], 25, 50, seed);
    set.add(startHand(t).seats.map((x) => x.hole.join('')).join('|'));
  }
  console.log(`  500 seeds -> ${set.size} distinct first deals`);
}
