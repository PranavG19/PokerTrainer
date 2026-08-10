// Is a mirrored pair (9c9d vs 9h9s) really always a tie? Find the runouts where it is not.
import { freshDeck } from '../../src/core/cards.js';
import { evaluate } from '../../src/core/evaluate.js';

const hero = ['9c','9d'], opp = ['9h','9s'];
for (const board of [[], ['Kd'], ['Kd','7c'], ['Kd','7c','2h'], ['Kd','7c','2h','4s']]) {
  const dead = new Set([...hero,...opp,...board]);
  const live = freshDeck().filter(c => !dead.has(c));
  const need = 5 - board.length;
  let tot=0, ties=0; const examples: string[] = [];
  const combos: string[][] = [];
  const rec = (start: number, acc: string[]) => {
    if (acc.length === need) { combos.push([...acc]); return; }
    for (let i=start;i<live.length;i++) { acc.push(live[i]); rec(i+1, acc); acc.pop(); }
  };
  rec(0, []);
  for (const extra of combos) {
    const fb = [...board, ...extra];
    const h = evaluate([...hero,...fb]), o = evaluate([...opp,...fb]);
    tot++;
    if (h.score === o.score) ties++;
    else if (examples.length < 3) examples.push(`${fb.join(' ')} -> hero ${h.score} vs opp ${o.score}`);
  }
  console.log(`board=${board.join('')||'preflop'} need=${need}: ties ${ties}/${tot} (${(100*ties/tot).toFixed(2)}%)`);
  for (const e of examples) console.log(`    NOT a tie: ${e}`);
}
