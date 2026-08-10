import { freshDeck } from '../../src/core/cards.js';
import { evaluate } from '../../src/core/evaluate.js';
// Find a flop (need===2) spot where ties are common: identical-strength hands.
// Same pair, different suits, on a board that cannot give either a flush.
const hole = ['9c','9d'], opp = ['9h','9s'], board = ['Kd','7c','2h'];
const dead = new Set([...hole,...opp,...board]);
const live = freshDeck().filter(c => !dead.has(c));
let ties=0,tot=0;
for (let i=0;i<live.length-1;i++) for (let j=i+1;j<live.length;j++) {
  const fb=[...board,live[i],live[j]];
  const h=evaluate([...hole,...fb]).score, o=evaluate([...opp,...fb]).score;
  tot++; if (h===o) ties++;
}
console.log(`99 vs 99 on Kd7c2h: ties ${ties}/${tot} = ${(100*ties/tot).toFixed(1)}%`);
