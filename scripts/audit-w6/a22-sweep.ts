// Find a seed where a shoving hero sweeps every villain's chips fastest, so the e2e for the
// swept-table branch is bounded and deterministic rather than a long soak.
import { applyAction, legalActions, makeTable, settle, startHand, type TableState } from './lib.js';
import { decideAction } from '../../src/core/ai.js';
import { mulberry32 } from '../../src/core/rng.js';

/** Hero shoves whenever it can, exactly like the e2e's shoveOrKeepMoving. */
function heroShove(s: TableState): TableState {
  const legal = legalActions(s);
  if (legal.includes('allin')) return applyAction(s, { kind: 'allin' });
  for (const kind of ['call', 'check', 'fold'] as const) {
    if (legal.includes(kind)) return applyAction(s, { kind });
  }
  throw new Error('hero turn with no legal action');
}

const results: { seed: number; hands: number }[] = [];

// Mirror the renderer exactly: ONE aiRng for the whole session, seeded `seed ^ 0x5eed`
// (src/renderer/screens/table.ts:129). A per-hand or differently-seeded stream picks different
// villain actions, so a seed found that way does not reproduce in the app — which is what happened
// on the first pass of this probe.
for (let seed = 1; seed <= 200; seed++) {
  let table = makeTable([5000, 5000, 5000, 5000], 25, 50, seed);
  const rng = mulberry32(seed ^ 0x5eed);
  let hands = 0;
  let swept = false;

  for (; hands < 60; hands++) {
    if (table.seats.filter((x) => x.stack > 0).length < 2) {
      swept = table.seats[0].stack > 0;
      break;
    }
    let s = startHand(table);
    let steps = 0;
    while (s.street !== 'showdown' && s.seats.filter((x) => !x.folded).length > 1 && steps++ < 200) {
      if (legalActions(s).length === 0) break;
      s = s.toAct === 0 ? heroShove(s) : applyAction(s, decideAction(s, s.toAct, rng));
    }
    table = settle(s);
  }

  if (swept) results.push({ seed, hands });
}

results.sort((a, b) => a.hands - b.hands);
console.log(`seeds where the hero ends up holding every chip: ${results.length} of 200`);
for (const r of results.slice(0, 8)) console.log(`  seed ${r.seed}: swept the table after ${r.hands} hands`);
