// Invariant 4 under NON-random policies: always-max-aggression, always-min-raise, always-call,
// alternating. Random play averages out; a fixed policy can sit in one corner of the state space.
import { applyAction, isHandOver, legalActions, makeTable, maxRaiseTo, minRaiseTo, settle, startStacksOf, startHand, chipsOnTable, type ActionKind, type TableState } from './lib.js';

type Policy = (s: TableState) => { kind: ActionKind; amount?: number } | null;

const POLICIES: Record<string, Policy> = {
  'always-min-raise': (s) => {
    const l = legalActions(s);
    if (l.includes('raise')) return { kind: 'raise', amount: minRaiseTo(s) };
    if (l.includes('bet')) return { kind: 'bet', amount: minRaiseTo(s) };
    if (l.includes('call')) return { kind: 'call' };
    if (l.includes('check')) return { kind: 'check' };
    return l.length ? { kind: l[0] } : null;
  },
  'always-max-raise': (s) => {
    const l = legalActions(s);
    if (l.includes('raise')) return { kind: 'raise', amount: maxRaiseTo(s) };
    if (l.includes('bet')) return { kind: 'bet', amount: maxRaiseTo(s) };
    if (l.includes('allin')) return { kind: 'allin' };
    if (l.includes('call')) return { kind: 'call' };
    if (l.includes('check')) return { kind: 'check' };
    return l.length ? { kind: l[0] } : null;
  },
  'always-allin': (s) => {
    const l = legalActions(s);
    if (l.includes('allin')) return { kind: 'allin' };
    if (l.includes('call')) return { kind: 'call' };
    if (l.includes('check')) return { kind: 'check' };
    return l.length ? { kind: l[0] } : null;
  },
  'always-call-never-fold': (s) => {
    const l = legalActions(s);
    if (l.includes('check')) return { kind: 'check' };
    if (l.includes('call')) return { kind: 'call' };
    if (l.includes('allin')) return { kind: 'allin' };
    return l.length ? { kind: l[0] } : null;
  },
  'always-check-or-fold': (s) => {
    const l = legalActions(s);
    if (l.includes('check')) return { kind: 'check' };
    if (l.includes('fold')) return { kind: 'fold' };
    return l.length ? { kind: l[0] } : null;
  },
};

const CONFIGS: { stacks: number[]; sb: number; bb: number }[] = [
  { stacks: [5000, 5000, 5000, 5000], sb: 25, bb: 50 },
  { stacks: [5000, 220, 900, 75], sb: 25, bb: 50 },
  { stacks: [51, 50, 49, 5000], sb: 25, bb: 50 },
  { stacks: [1000, 1000], sb: 25, bb: 50 },
  { stacks: [5000, 5000, 5000, 5000, 5000, 5000], sb: 25, bb: 50 },
];

const CAP = 500;
let worstSteps = 0;
const problems: string[] = [];
let hands = 0;

for (const [name, policy] of Object.entries(POLICIES)) {
  let maxSteps = 0;
  for (const cfg of CONFIGS) {
    for (let seed = 1; seed <= 120; seed++) {
      let table = makeTable(cfg.stacks, cfg.sb, cfg.bb, seed);
      const total = cfg.stacks.reduce((a, b) => a + b, 0);
      for (let hn = 0; hn < 30; hn++) {
        if (table.seats.filter((x) => x.stack > 0).length < 2) break;
        let s = startHand(table);
        hands++;
        let steps = 0;
        const seq: string[] = [];
        while (!isHandOver(s)) {
          if (steps++ > CAP) {
            problems.push(`HANG ${name} stacks=${JSON.stringify(cfg.stacks)} seed=${seed} hand#${s.handNumber}\n    log: ${s.log.join(' | ')}`);
            break;
          }
          const a = policy(s);
          if (a === null) {
            problems.push(`NO-ACTION ${name} seed=${seed}: street=${s.street} toAct=seat${s.toAct} folded=${s.seats[s.toAct].folded} allIn=${s.seats[s.toAct].allIn}\n    log: ${s.log.join(' | ')}`);
            break;
          }
          seq.push(`seat${s.toAct}:${a.kind}${a.amount !== undefined ? `@${a.amount}` : ''}`);
          try {
            s = applyAction(s, a);
          } catch (err) {
            problems.push(`THREW ${name} seed=${seed}: ${seq[seq.length - 1]} -> ${(err as Error).message}`);
            break;
          }
          if (chipsOnTable(s) !== total) {
            problems.push(`CONSERVATION ${name} seed=${seed}: ${chipsOnTable(s)} != ${total} after ${seq.join(' ')}`);
            break;
          }
        }
        maxSteps = Math.max(maxSteps, steps);
        const done = settle(s);
        if (chipsOnTable(done) !== total) problems.push(`CONSERVATION-SETTLE ${name} seed=${seed}: ${chipsOnTable(done)} != ${total}`);
        // Entitlement check on every winner.
        const start = startStacksOf(s);
        const paid = s.seats.map((x, i) => start[i] - x.stack);
        const got = new Map<number, number>();
        for (const w of done.winners ?? []) got.set(w.seatId, (got.get(w.seatId) ?? 0) + w.amount);
        for (const [id, amt] of got) {
          let capAmt = paid[id];
          for (let i = 0; i < paid.length; i++) if (i !== id) capAmt += Math.min(paid[id], paid[i]);
          if (amt > capAmt) problems.push(`OVER-ENTITLEMENT ${name} seed=${seed}: seat${id} got ${amt} > cap ${capAmt} (staked ${paid[id]})\n    log: ${done.log.join(' | ')}`);
          if (paid[id] <= 0) problems.push(`PAID-NOTHING ${name} seed=${seed}: seat${id} got ${amt} staking ${paid[id]}\n    log: ${done.log.join(' | ')}`);
        }
        table = done;
      }
    }
  }
  worstSteps = Math.max(worstSteps, maxSteps);
  console.log(`  ${name.padEnd(24)} max actions in one hand: ${maxSteps}`);
}

console.log(`\n=== ${hands} hands across ${Object.keys(POLICIES).length} fixed policies x ${CONFIGS.length} configs x 120 seeds ===`);
if (problems.length === 0) {
  console.log(`  CLEAN: no hang, no throw, no conservation break, no over-entitled or free winner.`);
  console.log(`  longest hand overall: ${worstSteps} actions (cap ${CAP}).`);
} else {
  const byKind = new Map<string, string[]>();
  for (const p of problems) {
    const k = p.split(' ')[0];
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(p);
  }
  for (const [k, list] of byKind) {
    console.log(`\n  ${k}: ${list.length}`);
    for (const p of list.slice(0, 2)) console.log(`    ${p}`);
  }
}
