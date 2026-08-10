/**
 * EXPERIMENT 1 — minimal reproductions of the grader defects the win-rate measurement surfaced.
 * Every case calls the shipped gradeDecision with hand-written inputs so the report can quote the
 * exact numbers rather than describe them. Read-only: nothing here changes src/.
 *
 *   ./node_modules/.bin/vite-node scripts/experiments/adherence/grader-bugs.ts
 */
import { gradeDecision } from '../../../src/core/coach.js';
import type { Card } from '../../../src/core/cards.js';

type ActionArg = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

const grade = (o: {
  hole: Card[];
  board: Card[];
  street: string;
  pot: number;
  toCall: number;
  chosen: ActionArg;
  stack?: number;
}) =>
  gradeDecision({
    hole: o.hole,
    board: o.board,
    street: o.street,
    pot: o.pot,
    toCall: o.toCall,
    stack: o.stack ?? 5000,
    bb: 50,
    chosen: o.chosen,
    opponents: 1,
    seed: 7,
  });

const show = (label: string, g: ReturnType<typeof grade>): void => {
  process.stdout.write(`${label.padEnd(52)} evLoss=${g.evLossBb.toFixed(3)}bb  ${g.severity.padEnd(8)} ${g.message ?? ''}\n`);
};

process.stdout.write('\n### B1 — the grader is blind to bet size and to stack depth\n');
process.stdout.write('Same spot, same verdict at every size. 72o on AKQ rainbow, pot 100, nobody has bet.\n');
for (const stack of [100, 1000, 5000]) {
  show(`bet, stack ${stack}`, grade({ hole: ['7c', '2d'], board: ['As', 'Kh', 'Qd'], street: 'flop', pot: 100, toCall: 0, chosen: 'bet', stack }));
}
show('allin, stack 5000', grade({ hole: ['7c', '2d'], board: ['As', 'Kh', 'Qd'], street: 'flop', pot: 100, toCall: 0, chosen: 'allin', stack: 5000 }));

process.stdout.write('\n### B2 — betting the second nuts is free, and so is checking it\n');
process.stdout.write('The grader has no way to say "bet this". Value is only ever charged to CHECK, and only\n');
process.stdout.write('on turn/river, and only above 55% pot share.\n');
for (const street of ['flop', 'turn', 'river']) {
  const hole: Card[] = ['As', 'Ah'];
  const board: Card[] = ['Ad', 'Ac', '7h'];
  show(`quad aces, ${street}, check`, grade({ hole, board, street, pot: 100, toCall: 0, chosen: 'check' }));
  show(`quad aces, ${street}, bet`, grade({ hole, board, street, pot: 100, toCall: 0, chosen: 'bet' }));
}

process.stdout.write('\n### B3 — folding is free whenever calling is -EV, so fold ties call/check at the minimum\n');
process.stdout.write('A pot-share-below-price spot: every continuation is charged, folding is charged nothing.\n');
{
  const hole: Card[] = ['7c', '2d'];
  const board: Card[] = ['As', 'Kh', 'Qd'];
  for (const chosen of ['fold', 'call', 'bet', 'raise'] as ActionArg[]) {
    show(`72o on AKQ facing 100 into 100, ${chosen}`, grade({ hole, board, street: 'flop', pot: 100, toCall: 100, chosen }));
  }
}

process.stdout.write('\n### B4 — checking a monster preflop/flop is always free, so the grader never builds a pot\n');
{
  const hole: Card[] = ['As', 'Ks'];
  show('AKs preflop, fold (limped pot, toCall 0)', grade({ hole, board: [], street: 'preflop', pot: 150, toCall: 0, chosen: 'fold' }));
  show('AKs preflop, check', grade({ hole, board: [], street: 'preflop', pot: 150, toCall: 0, chosen: 'check' }));
  show('AKs preflop, raise', grade({ hole, board: [], street: 'preflop', pot: 150, toCall: 0, chosen: 'raise' }));
}

process.stdout.write('\n### B4b — [FIXED at c66c40e, kept as a regression probe] folding the nuts for free\n');
process.stdout.write('Before the fix the fold branch returned 0 unconditionally at toCall === 0, so the grader\n');
process.stdout.write('graded FOLDING quad aces on the river 0.00bb "free" and CHECKING them 2.70bb "serious".\n');
process.stdout.write('The correct ordering is bet < check < fold; assert that below.\n');
{
  const hole: Card[] = ['As', 'Ah'];
  const board: Card[] = ['Ad', 'Ac', '7h', '3d', '8s'];
  const f = grade({ hole, board, street: 'river', pot: 600, toCall: 0, chosen: 'fold' });
  const c = grade({ hole, board, street: 'river', pot: 600, toCall: 0, chosen: 'check' });
  const b = grade({ hole, board, street: 'river', pot: 600, toCall: 0, chosen: 'bet' });
  show('quad aces, river, pot 600, nobody bet — fold', f);
  show('quad aces, river, pot 600, nobody bet — check', c);
  show('quad aces, river, pot 600, nobody bet — bet', b);
  process.stdout.write(
    `ordering bet < check < fold: ${b.evLossBb < c.evLossBb && c.evLossBb < f.evLossBb ? 'HOLDS' : 'VIOLATED'}\n`,
  );
}

process.stdout.write('\n### B5 — equity is measured vs RANDOM hands, so the grader charges correct folds\n');
process.stdout.write('A villain who bets the river does not hold a random hand, but equityVsRandom assumes it does.\n');
process.stdout.write('Second pair on a board with an obvious better hand available still shows >50% vs random, so\n');
process.stdout.write('the grader marks folding to a pot-size bet as a SERIOUS error and calling as free.\n');
{
  const hole: Card[] = ['9c', '9d'];
  const board: Card[] = ['Ks', 'Qh', '9s', '4c', '3h'];
  show('99 on KQ943 river, facing pot bet, fold', grade({ hole, board, street: 'river', pot: 200, toCall: 200, chosen: 'fold' }));
  show('99 on KQ943 river, facing pot bet, call', grade({ hole, board, street: 'river', pot: 200, toCall: 200, chosen: 'call' }));
  const weak: Card[] = ['5c', '5d'];
  show('55 on KQ943 river, facing pot bet, fold', grade({ hole: weak, board, street: 'river', pot: 200, toCall: 200, chosen: 'fold' }));
  show('55 on KQ943 river, facing pot bet, call', grade({ hole: weak, board, street: 'river', pot: 200, toCall: 200, chosen: 'call' }));
}

process.stdout.write('\n### B6 — the missed-value charge is too small to fire at the pot sizes the game produces\n');
process.stdout.write('It is (equity - 0.55) * pot * 0.5 / bb, so even checking the ABSOLUTE NUTS is graded free\n');
process.stdout.write('until the pot passes ~2.2bb, and 0.5bb of the 0.5bb silence threshold is spent on a hand\n');
process.stdout.write('with 100% pot share. Sweeping the pot with quad aces on the river:\n');
{
  const hole: Card[] = ['As', 'Ah'];
  const board: Card[] = ['Ad', 'Ac', '7h', '3d', '8s'];
  for (const pot of [50, 100, 111, 150, 300, 600, 1200]) {
    show(`quad aces, river, check, pot=${pot} (${(pot / 50).toFixed(1)}bb)`, grade({ hole, board, street: 'river', pot, toCall: 0, chosen: 'check' }));
  }
  process.stdout.write('And the same charge on a merely-good hand, which is where a real value bet lives:\n');
  for (const pot of [300, 600, 1200]) {
    show(`AK on AQ742 river, check, pot=${pot}`, grade({ hole: ['As', 'Ks'], board: ['Ad', 'Qc', '7h', '4d', '2s'], street: 'river', pot, toCall: 0, chosen: 'check' }));
  }
}

process.stdout.write('\n### B7 — STRUCTURAL: the grader can never strictly prefer betting or raising\n');
process.stdout.write('Read the branches in coach.ts. When toCall === 0 the bet/raise charge is 0 for any equity\n');
process.stdout.write('>= 0.35, and check is charged only on turn/river above 0.55 — so on preflop and flop the\n');
process.stdout.write('best aggression can ever do is TIE check at zero. When toCall > 0, raise is charged exactly\n');
process.stdout.write('like call below 0.35 equity and zero above 0.55, while fold is zero whenever the call is\n');
process.stdout.write('-EV. Exhaustive sweep of (street, toCall, equity band) confirming no strict aggression win:\n');
{
  // Hands chosen to land in low / middle / high pot-share bands against one random opponent.
  const probes: { label: string; hole: Card[]; board: Card[] }[] = [
    { label: 'low  (72o, AKQ)', hole: ['7c', '2d'], board: ['As', 'Kh', 'Qd'] },
    { label: 'mid  (T9s, AKQ)', hole: ['Tc', '9c'], board: ['As', 'Kh', 'Qd'] },
    { label: 'high (quads)   ', hole: ['As', 'Ah'], board: ['Ad', 'Ac', '7h'] },
  ];
  let strictAggressionWins = 0;
  let cases = 0;
  for (const street of ['preflop', 'flop', 'turn', 'river']) {
    for (const toCall of [0, 100]) {
      for (const p of probes) {
        const board = street === 'preflop' ? [] : p.board;
        const kinds: ActionArg[] = toCall === 0 ? ['check', 'bet', 'fold'] : ['fold', 'call', 'raise'];
        const losses = kinds.map((k) => ({ k, loss: grade({ hole: p.hole, board, street, pot: 400, toCall, chosen: k }).evLossBb }));
        const min = Math.min(...losses.map((x) => x.loss));
        const argmin = losses.filter((x) => x.loss <= min + 1e-9).map((x) => x.k);
        const aggressionOnly = argmin.length === 1 && (argmin[0] === 'bet' || argmin[0] === 'raise');
        if (aggressionOnly) strictAggressionWins++;
        cases++;
        process.stdout.write(
          `${street.padEnd(8)} toCall=${String(toCall).padEnd(4)} ${p.label}  ` +
            losses.map((x) => `${x.k}=${x.loss.toFixed(2)}`).join('  ').padEnd(46) +
            `argmin={${argmin.join(',')}}${aggressionOnly ? '  <-- STRICT AGGRESSION' : ''}\n`,
        );
      }
    }
  }
  process.stdout.write(`\ncases swept: ${cases}   cases where bet/raise was the STRICT argmin: ${strictAggressionWins}\n`);
}
