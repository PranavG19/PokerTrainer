// Invariant 9c, characterised: the fold message at toCall === 0 reuses the "pot odds" sentence
// built for a fold FACING A BET, and the two branches compute completely different quantities.
import { gradeDecision } from '../../src/core/coach.js';

const spot = {
  hole: ['9c', '4d'],
  board: ['As', 'Kh', '7s', '2d'],
  street: 'turn',
  pot: 2060,
  stack: 5000,
  bb: 50,
  opponents: 1,
  seed: 3,
};

console.log('=== the two fold branches and the ONE sentence they share ===');
for (const toCall of [0, 200, 900]) {
  const g = gradeDecision({ ...spot, toCall, chosen: 'fold' });
  const required = toCall / (spot.pot + toCall);
  console.log(`\n  toCall=${String(toCall).padStart(4)}  required=${(required * 100).toFixed(1)}%  sev=${g.severity} ΔEV=${g.evLossBb.toFixed(3)}bb`);
  console.log(`    msg: ${g.message ?? '(silent)'}`);
  if (toCall === 0) {
    console.log(`    ΔEV formula used: equity*0.5*pot/bb  (a CHECK comparison, coach.ts:64)`);
    console.log(`    the sentence claims a pot-odds shortfall: "when only 0% was needed".`);
    console.log(`    Nothing WAS needed — the fold was free. The number 7.3bb is the value of a free`);
    console.log(`    continuation, not a pot-odds error, so the sentence explains the wrong thing.`);
  } else {
    console.log(`    ΔEV formula used: (equity-required)*(pot+toCall)/bb  (coach.ts:67) — sentence fits.`);
  }
}

console.log('\n=== how often does the toCall=0 fold branch fire with a message? ===');
{
  const { mulberry32 } = await import('../../src/core/rng.js');
  const { freshDeck } = await import('../../src/core/cards.js');
  const rng = mulberry32(11);
  let fired = 0;
  let total = 0;
  const bands = { free: 0, notable: 0, serious: 0 };
  for (let i = 0; i < 400; i++) {
    const deck = freshDeck();
    for (let k = deck.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [deck[k], deck[j]] = [deck[j], deck[k]];
    }
    const pot = 50 + Math.floor(rng() * 3000);
    const g = gradeDecision({ hole: deck.slice(0, 2), board: deck.slice(2, 6), street: 'turn', pot, toCall: 0, stack: 5000, bb: 50, chosen: 'fold', opponents: 1, seed: i });
    total++;
    bands[g.severity]++;
    if (g.message !== null) fired++;
  }
  console.log(`  ${total} free-fold spots: ${fired} produced the mismatched sentence`);
  console.log(`  severity split: free=${bands.free} notable=${bands.notable} serious=${bands.serious}`);
  console.log(`  reachable from the UI on every street: 'fold' is in legalActions at toCall 0 (table.ts:273),`);
  console.log(`  and btn-fold is enabled whenever legal.includes('fold').`);
}

console.log('\n=== is the coach sensitive to the pot it is handed being partly unwinnable? ===');
{
  // A hero facing an all-in from a seat that cannot cover the pot: the chips above the shove are
  // refunded by settle(), so the true pot odds are better than the coach's.
  const g = gradeDecision({ hole: ['9c', '4d'], board: ['As', 'Kh', '7s'], street: 'flop', pot: 1000, toCall: 800, stack: 5000, bb: 50, chosen: 'fold', opponents: 1, seed: 3 });
  console.log(`  pot=1000 toCall=800: required ${(800 / 1800 * 100).toFixed(1)}%, sev=${g.severity} ΔEV=${g.evLossBb.toFixed(3)}`);
  console.log(`  gradeDecision has no view of stacks per opponent, so it cannot know part of that 1000`);
  console.log(`  will be refunded. Only 'stack' (the hero's own) is passed, and it is unread.`);
  console.log(`  This is a design limit, not a wrong number — the pot it was given is the pot it graded.`);
}
