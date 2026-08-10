import { describe, expect, it } from 'vitest';
import {
  EMPTY_BANK_INDEX,
  UNGRADED_NOTICE,
  bankIndex,
  gradeNode,
  isLoggableDecision,
  isOnBank,
  lookupNode,
  nodeKeyOf,
  severityOf,
  type BankIndex,
  type BankNode,
  type NodeGrading,
} from '../../src/core/bank.js';
import { gradeDecision, type Grade, type Severity } from '../../src/core/coach.js';
import { mulberry32 } from '../../src/core/rng.js';

const PROVENANCE = {
  solverConfigId: 'cfg-a',
  tree: '33/75 pot, 2 bets + allin, depth 3',
  iterations: 2000,
  exploitability: 0.004,
  referencePopId: 'refpop-1',
} as const;

const SECOND_CONFIG = { ...PROVENANCE, solverConfigId: 'cfg-b', tree: '50 pot, 1 bet + allin, depth 3' };
/**
 * A THIRD config that solved the mixed node and AGREES, so the set of configs that disagree is a
 * strict subset of the configs that solved it. Without this the mixed fixture had exactly the two
 * configs that disagree, and 'the configs that disagree' was byte-identical to 'every config that
 * solved the node' — a mutation returning `provenance.map(id)` in place of the shipped
 * `disagreement.configIds` produced the same ['cfg-a','cfg-b'] and survived. B2 requires the app to
 * surface WHICH configs disagree; that guarantee is only testable where the two lists can diverge.
 */
const THIRD_CONFIG = { ...PROVENANCE, solverConfigId: 'cfg-c', tree: '75 pot, 2 bets + allin, depth 4' };

const BTN_SRP_KEY = nodeKeyOf({
  positions: 'BTN-vs-BB',
  actionHistory: 'r2.5-c',
  boardClass: 'dry-ace-high',
  sizeBucket: 'third-pot',
});

const MIXED_KEY = nodeKeyOf({
  positions: 'BB-vs-BTN',
  actionHistory: 'r2.5-c-x-b33',
  boardClass: 'monotone',
  sizeBucket: 'third-pot',
});

const OFF_BANK_KEY = nodeKeyOf({
  positions: 'CO-vs-SB-vs-BB',
  actionHistory: 'r2.5-c-c-x-x-b75-r200',
  boardClass: 'paired',
  sizeBucket: 'overbet',
});

const onBankNode: BankNode = {
  nodeKey: BTN_SRP_KEY,
  provenance: [PROVENANCE],
  disagreement: null,
};

const mixedNode: BankNode = {
  nodeKey: MIXED_KEY,
  provenance: [PROVENANCE, SECOND_CONFIG, THIRD_CONFIG],
  disagreement: {
    configIds: ['cfg-a', 'cfg-b'],
    detail: 'cfg-a bets 33% at 62%, cfg-b checks at 71%; EV gap 0.4 bb',
  },
};

const index: BankIndex = bankIndex('bank-2026.1', [onBankNode, mixedNode]);

/** A stand-in grader. Never called for an off-bank node, which several tests below assert. */
function fixedGrade(severity: Severity, evLossBb: number): Grade {
  return { severity, evLossBb, message: severity === 'free' ? null : 'a message', principle: 'pot odds' };
}

const gradeSerious = () => fixedGrade('serious', 3.2);

describe("B4's string is the spec's string", () => {
  it('is the exact quoted text, em dash and all', () => {
    expect(UNGRADED_NOTICE).toBe('ungraded — no solver data for this node.');
  });

  it('uses an em dash (U+2014), not a hyphen or an en dash', () => {
    expect(UNGRADED_NOTICE).toContain('—');
    expect(UNGRADED_NOTICE).not.toContain('–');
    expect(UNGRADED_NOTICE.split(' ')[1]).toBe('—');
  });

  it('is the same object every off-bank node gets, so no call site can paraphrase it', () => {
    const lookup = lookupNode(index, OFF_BANK_KEY);
    const outcome = gradeNode(index, OFF_BANK_KEY, gradeSerious);
    expect(lookup.status).toBe('off-bank');
    if (lookup.status !== 'off-bank' || outcome.kind !== 'ungraded') throw new Error('unreachable');
    expect(lookup.notice).toBe(UNGRADED_NOTICE);
    expect(outcome.notice).toBe(UNGRADED_NOTICE);
  });

  it("states a fact about the bank, never a judgement of the learner (B4's hunch-not-intuition)", () => {
    // The notice names the bank's gap. It must not address the learner at all: no second person, no
    // encouragement, no apology. A denylist alone would be weak, so the positive claim is pinned too.
    expect(UNGRADED_NOTICE).toContain('no solver data for this node');
    for (const word of [
      'you',
      'your',
      'sorry',
      'unfortunately',
      'keep',
      'try',
      'guess',
      'hunch',
      'intuition',
      'good',
      'nice',
      '!',
    ]) {
      expect(UNGRADED_NOTICE.toLowerCase()).not.toContain(word);
    }
  });
});

describe('story 27: an off-bank node is refused, not graded', () => {
  it('returns the ungraded arm for a node the bank does not contain', () => {
    const outcome = gradeNode(index, OFF_BANK_KEY, gradeSerious);
    expect(outcome.kind).toBe('ungraded');
  });

  it('never invokes the grader, so the fabricated number is not even computed', () => {
    let graderCalls = 0;
    const outcome = gradeNode(index, OFF_BANK_KEY, () => {
      graderCalls += 1;
      return gradeSerious();
    });
    expect(graderCalls).toBe(0);
    expect(outcome.kind).toBe('ungraded');
  });

  it('invokes the grader exactly once for an on-bank node', () => {
    let graderCalls = 0;
    const outcome = gradeNode(index, BTN_SRP_KEY, () => {
      graderCalls += 1;
      return gradeSerious();
    });
    expect(graderCalls).toBe(1);
    expect(outcome.kind).toBe('graded');
  });

  it('carries no numeric field at all — not 0 bb, not a severity, not equity', () => {
    const outcome = gradeNode(index, OFF_BANK_KEY, gradeSerious);
    if (outcome.kind !== 'ungraded') throw new Error('unreachable');
    // The runtime shape, since a caller may reach for a field the type does not declare.
    expect(Object.keys(outcome).sort()).toEqual(['kind', 'nodeKey', 'notice']);
    for (const value of Object.values(outcome)) {
      expect(typeof value).not.toBe('number');
    }
    const loose = outcome as Record<string, unknown>;
    for (const field of ['grade', 'severity', 'evLossBb', 'equity', 'principle', 'message']) {
      expect(loose[field]).toBeUndefined();
    }
  });

  /**
   * THE SAME GUARANTEE, APPLIED TO THE OTHER EXPORT. The test above pins `gradeNode`'s ungraded arm
   * to exactly three keys — and `lookupNode`'s off-bank arm had no shape assertion at all, so an
   * adversarial pass added `evLossBb: 0, equity: 0.62` to it and all 29 tests stayed green with tsc
   * clean. That is a T8 violation shipped through the half of the API nobody was watching: equity is
   * shown post-reveal in Spot mode and post-hand at the Table, NEVER pre-commit, and an off-bank
   * lookup is the most pre-commit moment there is.
   *
   * The lesson generalised: a guarantee is only as wide as the exports it is asserted on. Both
   * functions can return an off-bank result, so both must be pinned.
   */
  it('lookupNode leaks nothing numeric on the off-bank arm either', () => {
    const lookup = lookupNode(index, OFF_BANK_KEY);
    if (lookup.status !== 'off-bank') throw new Error('unreachable');
    expect(Object.keys(lookup).sort()).toEqual(['nodeKey', 'notice', 'status']);
    for (const value of Object.values(lookup)) {
      expect(typeof value).not.toBe('number');
    }
    const loose = lookup as Record<string, unknown>;
    for (const field of ['grade', 'severity', 'evLossBb', 'equity', 'node', 'principle']) {
      expect(loose[field], `off-bank lookup exposes ${field}`).toBeUndefined();
    }
    // And it is the node that was ASKED for, not some other key.
    expect(lookup.nodeKey).toBe(OFF_BANK_KEY);
    expect(lookup.notice).toBe(UNGRADED_NOTICE);
  });

  /**
   * THE KEY MUST BE THE KEY THAT WAS ASKED FOR, on every arm. Three separate mutations returned a
   * wrong or empty nodeKey and all survived: the suite asserted only that `nodeKey` was PRESENT.
   * A grading attributed to the wrong node is worse than no grading — it is a correct verdict filed
   * against a spot the learner never played.
   */
  it('attributes every outcome to the node that was asked for', () => {
    for (const key of [OFF_BANK_KEY, BTN_SRP_KEY, MIXED_KEY]) {
      const outcome = gradeNode(index, key, gradeSerious);
      expect(outcome.nodeKey, `${outcome.kind} arm lost the node key`).toBe(key);
    }
  });

  it('has no severity reachable, and null is not substitutable for a grade', () => {
    const outcome = gradeNode(index, OFF_BANK_KEY, gradeSerious);
    expect(severityOf(outcome)).toBeNull();
    // 'free' is a verdict meaning "this was fine" — the one value that would read as a pass.
    expect(severityOf(outcome)).not.toBe('free');
  });

  it("is not logged as a decision (edge-case table: 'Not logged as a decision')", () => {
    expect(isLoggableDecision(gradeNode(index, OFF_BANK_KEY, gradeSerious))).toBe(false);
    expect(isLoggableDecision(gradeNode(index, BTN_SRP_KEY, gradeSerious))).toBe(true);
    expect(isLoggableDecision(gradeNode(index, MIXED_KEY, gradeSerious))).toBe(true);
  });

  it('refuses regardless of how confident the grade would have been', () => {
    // The fabricated grade coach.ts would produce spans the whole severity range. None of them
    // survives the gate.
    for (const [severity, loss] of [
      ['free', 0],
      ['notable', 0.9],
      ['serious', 7.4],
    ] as const) {
      const outcome = gradeNode(index, OFF_BANK_KEY, () => fixedGrade(severity, loss));
      expect(outcome.kind).toBe('ungraded');
      expect(severityOf(outcome)).toBeNull();
    }
  });
});

describe('the grader really does fabricate, which is what this module refuses', () => {
  it('coach.gradeDecision returns a full severity and bb number for a node with no solver data', () => {
    // Read of coach.ts: it computes a Monte-Carlo pot share and derives evLossBb from pot odds. It
    // takes no bank and no node key, so it cannot decline. This is story 27's fabricated grade, and
    // pinning it here is what makes the gate above load-bearing rather than decorative.
    const fabricated = gradeDecision({
      hole: ['Ah', 'Kd'],
      board: ['7s', '2c', 'Td'],
      street: 'flop',
      pot: 6,
      toCall: 4,
      stack: 200,
      bb: 2,
      chosen: 'call',
      opponents: 2,
      seed: 7,
    });
    expect(['free', 'notable', 'serious']).toContain(fabricated.severity);
    expect(Number.isFinite(fabricated.evLossBb)).toBe(true);

    // Handed the same node through the gate, with the real grader as the callback, nothing of that
    // survives for an off-bank key.
    const refused = gradeNode(EMPTY_BANK_INDEX, OFF_BANK_KEY, () =>
      gradeDecision({
        hole: ['Ah', 'Kd'],
        board: ['7s', '2c', 'Td'],
        street: 'flop',
        pot: 6,
        toCall: 4,
        stack: 200,
        bb: 2,
        chosen: 'call',
        opponents: 2,
        seed: 7,
      }),
    );
    expect(refused.kind).toBe('ungraded');
    expect(severityOf(refused)).toBeNull();
  });
});

describe('B2 mixed is a graded outcome and is not off-bank', () => {
  it('grades a node whose configs disagree, and surfaces the disagreement', () => {
    const outcome = gradeNode(index, MIXED_KEY, gradeSerious);
    expect(outcome.kind).toBe('mixed');
    if (outcome.kind !== 'mixed') throw new Error('unreachable');
    expect(outcome.disagreement.configIds).toEqual(['cfg-a', 'cfg-b']);
    expect(outcome.grade.severity).toBe('serious');
    expect(severityOf(outcome)).toBe('serious');
  });

  /**
   * B2 says the app surfaces WHICH configs disagree — not "every config that solved the node". The
   * mixed fixture has three provenance records but a two-config disagreement, so those two lists
   * genuinely differ. Pinning the subset relation is what makes a mutation returning
   * `provenance.map(r => r.solverConfigId)` (which the old two-config fixture made byte-identical to
   * the disagreement, and so survived) fail here.
   */
  it('surfaces only the configs that disagree, a strict subset of the configs that solved it', () => {
    const outcome = gradeNode(index, MIXED_KEY, gradeSerious);
    if (outcome.kind !== 'mixed') throw new Error('unreachable');
    const allSolvers = mixedNode.provenance.map((record) => record.solverConfigId);
    expect(allSolvers).toEqual(['cfg-a', 'cfg-b', 'cfg-c']);
    // The disagreement names two of the three, so it cannot be the all-solvers list.
    expect(outcome.disagreement.configIds).toEqual(['cfg-a', 'cfg-b']);
    expect(outcome.disagreement.configIds).not.toEqual(allSolvers);
    for (const id of outcome.disagreement.configIds) {
      expect(allSolvers).toContain(id);
    }
    expect(outcome.disagreement.configIds.length).toBeLessThan(allSolvers.length);
  });

  it('a mixed node is on-bank, and never carries the ungraded notice', () => {
    expect(isOnBank(index, MIXED_KEY)).toBe(true);
    const outcome = gradeNode(index, MIXED_KEY, gradeSerious);
    expect(JSON.stringify(outcome)).not.toContain(UNGRADED_NOTICE);
    expect((outcome as Record<string, unknown>).notice).toBeUndefined();
  });

  it('an ungraded node carries no disagreement, so the two are not interchangeable', () => {
    const ungraded = gradeNode(index, OFF_BANK_KEY, gradeSerious);
    expect(ungraded.kind).toBe('ungraded');
    expect((ungraded as Record<string, unknown>).disagreement).toBeUndefined();
  });

  it('an agreeing on-bank node is plain graded, not mixed', () => {
    const outcome = gradeNode(index, BTN_SRP_KEY, gradeSerious);
    expect(outcome.kind).toBe('graded');
    if (outcome.kind !== 'graded') throw new Error('unreachable');
    expect(outcome.solverConfigIds).toEqual(['cfg-a']);
  });

  it("the three kinds are disjoint over the whole index plus a miss", () => {
    const kinds = [BTN_SRP_KEY, MIXED_KEY, OFF_BANK_KEY].map(
      (key) => gradeNode(index, key, gradeSerious).kind,
    );
    expect(kinds).toEqual(['graded', 'mixed', 'ungraded']);
    expect(new Set(kinds).size).toBe(3);
  });
});

describe('lookup and the index', () => {
  it('answers on-bank for a key it holds and off-bank for one it does not', () => {
    expect(isOnBank(index, BTN_SRP_KEY)).toBe(true);
    expect(isOnBank(index, OFF_BANK_KEY)).toBe(false);
    const hit = lookupNode(index, BTN_SRP_KEY);
    expect(hit.status).toBe('on-bank');
    if (hit.status !== 'on-bank') throw new Error('unreachable');
    expect(hit.node.provenance[0].solverConfigId).toBe('cfg-a');
    expect(lookupNode(index, OFF_BANK_KEY).status).toBe('off-bank');
  });

  it('reports the key that missed, so the miss is attributable', () => {
    const miss = lookupNode(index, OFF_BANK_KEY);
    if (miss.status !== 'off-bank') throw new Error('unreachable');
    expect(miss.nodeKey).toBe(OFF_BANK_KEY);
  });

  it('does not confuse a near-miss key with a hit', () => {
    const nearMiss = nodeKeyOf({
      positions: 'BTN-vs-BB',
      actionHistory: 'r2.5-c',
      boardClass: 'dry-ace-high',
      sizeBucket: 'two-thirds-pot', // only the size bucket moves
    });
    expect(nearMiss).not.toBe(BTN_SRP_KEY);
    expect(isOnBank(index, nearMiss)).toBe(false);
    expect(gradeNode(index, nearMiss, gradeSerious).kind).toBe('ungraded');
  });

  it('builds a key from all four parts the vocabulary table names', () => {
    const key = nodeKeyOf({
      positions: 'BTN-vs-BB',
      actionHistory: 'r2.5-c',
      boardClass: 'paired',
      sizeBucket: 'third-pot',
    });
    expect(key).toBe('BTN-vs-BB|r2.5-c|paired|third-pot');
    // Every part is load-bearing: change any one and the key changes.
    const base = { positions: 'a', actionHistory: 'b', boardClass: 'c', sizeBucket: 'd' } as const;
    const keys = new Set([
      nodeKeyOf(base),
      nodeKeyOf({ ...base, positions: 'z' }),
      nodeKeyOf({ ...base, actionHistory: 'z' }),
      nodeKeyOf({ ...base, boardClass: 'z' }),
      nodeKeyOf({ ...base, sizeBucket: 'z' }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('refuses a key part containing the separator, which would collide two nodes', () => {
    expect(() =>
      nodeKeyOf({ positions: 'BTN|BB', actionHistory: 'x', boardClass: 'y', sizeBucket: 'z' }),
    ).toThrow(/collide/);
    // Without the guard these two distinct nodes would share a key, and the second would be graded
    // against the first's solver data.
    const a = { positions: 'A', actionHistory: 'B|C', boardClass: 'D', sizeBucket: 'E' };
    const b = { positions: 'A|B', actionHistory: 'C', boardClass: 'D', sizeBucket: 'E' };
    expect(() => nodeKeyOf(a)).toThrow();
    expect(() => nodeKeyOf(b)).toThrow();
  });

  it('refuses a duplicate node key rather than letting one entry decide the grade', () => {
    expect(() => bankIndex('v', [onBankNode, { ...onBankNode, provenance: [SECOND_CONFIG] }])).toThrow(
      /two entries/,
    );
  });

  it('refuses an on-bank node with no provenance (B2), because that node has no solver data', () => {
    expect(() => bankIndex('v', [{ ...onBankNode, provenance: [] }])).toThrow(/no provenance/);
  });

  it('refuses a disagreement backed by fewer than two configs', () => {
    expect(() =>
      bankIndex('v', [{ ...mixedNode, provenance: [PROVENANCE] }]),
    ).toThrow(/only 1 config/);
  });

  it('records the bank version so a bank upgrade never re-tiers history', () => {
    expect(index.bankVersion).toBe('bank-2026.1');
    expect(EMPTY_BANK_INDEX.bankVersion).toBe('none');
  });
});

describe('the empty bank this build actually ships', () => {
  it('holds no nodes, so every node is off-bank and B4 is the only output', () => {
    expect(EMPTY_BANK_INDEX.nodes.size).toBe(0);
    for (const key of [BTN_SRP_KEY, MIXED_KEY, OFF_BANK_KEY]) {
      expect(isOnBank(EMPTY_BANK_INDEX, key)).toBe(false);
      const outcome = gradeNode(EMPTY_BANK_INDEX, key, gradeSerious);
      expect(outcome.kind).toBe('ungraded');
      expect(severityOf(outcome)).toBeNull();
      expect(isLoggableDecision(outcome)).toBe(false);
    }
  });

  it('a node on-bank in a real index is still off-bank against the empty one', () => {
    expect(gradeNode(index, BTN_SRP_KEY, gradeSerious).kind).toBe('graded');
    expect(gradeNode(EMPTY_BANK_INDEX, BTN_SRP_KEY, gradeSerious).kind).toBe('ungraded');
  });
});

describe('property: over randomly generated keys, off-bank never yields a number', () => {
  it('holds for 500 seeded keys against a seeded index', () => {
    const rng = mulberry32(20260810);
    const part = () => Math.floor(rng() * 6).toString();
    const banked: BankNode[] = [];
    const bankedKeys = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const key = nodeKeyOf({
        positions: `p${part()}`,
        actionHistory: `h${part()}`,
        boardClass: `b${part()}`,
        sizeBucket: `s${part()}`,
      });
      if (bankedKeys.has(key)) continue;
      bankedKeys.add(key);
      banked.push({
        nodeKey: key,
        provenance: [PROVENANCE, SECOND_CONFIG],
        disagreement: i % 3 === 0 ? { configIds: ['cfg-a', 'cfg-b'], detail: 'gap 0.3 bb' } : null,
      });
    }
    const generated = bankIndex('prop', banked);

    let ungradedSeen = 0;
    let gradedSeen = 0;
    for (let i = 0; i < 500; i++) {
      const key = nodeKeyOf({
        positions: `p${part()}`,
        actionHistory: `h${part()}`,
        boardClass: `b${part()}`,
        sizeBucket: `s${part()}`,
      });
      const outcome: NodeGrading = gradeNode(generated, key, gradeSerious);
      if (bankedKeys.has(key)) {
        gradedSeen += 1;
        expect(outcome.kind === 'graded' || outcome.kind === 'mixed').toBe(true);
        expect(severityOf(outcome)).toBe('serious');
      } else {
        ungradedSeen += 1;
        expect(outcome.kind).toBe('ungraded');
        expect(severityOf(outcome)).toBeNull();
        expect(isLoggableDecision(outcome)).toBe(false);
        expect(Object.keys(outcome).sort()).toEqual(['kind', 'nodeKey', 'notice']);
      }
    }
    // Both branches were actually exercised — otherwise the property is vacuous.
    expect(ungradedSeen).toBeGreaterThan(0);
    expect(gradedSeen).toBeGreaterThan(0);
  });
});
