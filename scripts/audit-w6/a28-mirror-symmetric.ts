// The symmetry only holds if the KNOWN board cards do not favour one of the mirrored suits.
// hero 9c9d vs opp 9h9s: the board must not make a flush reachable in c/d but not h/s (or vice versa).
// A board using ONE card of each of the four suits keeps it balanced.
import { exactEquityHeadsUp } from '../../src/core/equity.js';

const hero = ['9c','9d'], opp = ['9h','9s'];
// One suit each, so no suit is over-represented among the known cards.
for (const board of [[], ['Kc','Kd','Kh'], ['Kc','Kd','Kh','Ts'], ['Kc','Kd','Kh','Ts','2c']]) {
  const e = exactEquityHeadsUp(hero, board, opp);
  console.log(`board=${board.join('')||'preflop'} need=${5-board.length}: equity=${e}`);
}
console.log('--- and the asymmetric one for contrast ---');
console.log('board=Kd need=4:', exactEquityHeadsUp(hero, ['Kd'], opp));
console.log('board=Ks need=4:', exactEquityHeadsUp(hero, ['Ks'], opp));
