import { describe, it, expect } from 'vitest';
import { RANKS } from '../../src/core/cards.js';
import {
  ALL_COMBOS,
  BOUNDARY_COMBOS,
  HAND_CLASSES,
  MAX_RULE_WORDS,
  POSITIONS,
  POSITION_RULES,
  RFI_POSITIONS,
  RFI_WIDTH_ORDER,
  TOTAL_COMBINATIONS,
  classOf,
  comboOf,
  comboWeight,
  combosInClass,
  isBoundaryCombo,
  isCombo,
  isInRfiRange,
  lookup,
  rfiCombos,
  rfiWidth,
  ruleWordCount,
  type HandClassId,
} from '../../src/core/preflop.js';

/**
 * PREFLOP BLUEPRINT — the assertions that protect B3's coarseness and N3's compressed form.
 *
 * The load-bearing ones are structural rather than pokery, because the failure modes here are
 * structural: a combo landing in two classes or none, a query returning undefined for some
 * (combo, position) pair the UI then renders as blank, a rule that grew into a paragraph, or the
 * width ordering coming out backwards — which would teach the exact opposite of correct play.
 */

const CLASS_IDS = HAND_CLASSES.map((c) => c.id);

describe('the 169 combos', () => {
  it('has exactly 169 of them and no duplicates', () => {
    expect(ALL_COMBOS).toHaveLength(169);
    expect(new Set(ALL_COMBOS).size).toBe(169);
  });

  it('is 13 pairs, 78 suited and 78 offsuit', () => {
    expect(ALL_COMBOS.filter((c) => c.length === 2)).toHaveLength(13);
    expect(ALL_COMBOS.filter((c) => c.endsWith('s'))).toHaveLength(78);
    expect(ALL_COMBOS.filter((c) => c.endsWith('o'))).toHaveLength(78);
  });

  it('covers every rank pairing exactly once, higher rank first', () => {
    for (let hi = 0; hi < RANKS.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        expect(ALL_COMBOS).toContain(`${RANKS[hi]}${RANKS[lo]}s`);
        expect(ALL_COMBOS).toContain(`${RANKS[hi]}${RANKS[lo]}o`);
        // The reversed spelling must not also exist, or the grid would have 338 cells.
        expect(ALL_COMBOS).not.toContain(`${RANKS[lo]}${RANKS[hi]}s`);
      }
      expect(ALL_COMBOS).toContain(`${RANKS[hi]}${RANKS[hi]}`);
    }
  });

  it('weights to all 1326 dealt combinations', () => {
    const total = ALL_COMBOS.reduce((sum, combo) => sum + comboWeight(combo), 0);
    expect(total).toBe(TOTAL_COMBINATIONS);
    expect(comboWeight('AA')).toBe(6);
    expect(comboWeight('AKs')).toBe(4);
    expect(comboWeight('AKo')).toBe(12);
  });

  it('rejects non-combos without claiming they are hands', () => {
    for (const bogus of ['', 'A', 'AK', 'KAs', 'AAs', 'AAo', 'XYs', 'AKx', 'aks', '22s']) {
      expect(isCombo(bogus)).toBe(false);
    }
    expect(isCombo('AKs')).toBe(true);
    expect(isCombo('22')).toBe(true);
  });
});

describe('comboOf collapses real cards', () => {
  it('orders by rank regardless of argument order', () => {
    expect(comboOf('Kd', 'Ah')).toBe('AKo');
    expect(comboOf('Ah', 'Kd')).toBe('AKo');
    expect(comboOf('As', 'Ks')).toBe('AKs');
    expect(comboOf('2c', '2d')).toBe('22');
  });

  it('maps every one of the 1326 dealt pairs into the 169, at the right multiplicity', () => {
    const deck: string[] = [];
    for (const rank of RANKS) for (const suit of ['s', 'h', 'd', 'c']) deck.push(rank + suit);
    const counts = new Map<string, number>();
    for (let i = 0; i < deck.length; i++) {
      for (let j = i + 1; j < deck.length; j++) {
        const combo = comboOf(deck[i], deck[j]);
        expect(isCombo(combo)).toBe(true);
        counts.set(combo, (counts.get(combo) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(169);
    for (const combo of ALL_COMBOS) expect(counts.get(combo)).toBe(comboWeight(combo));
  });
});

describe('the six hand classes', () => {
  it('is six, ordered, with unique ids', () => {
    expect(HAND_CLASSES).toHaveLength(6);
    expect(new Set(CLASS_IDS).size).toBe(6);
    expect(CLASS_IDS).toEqual([
      'premium',
      'strong',
      'broadway',
      'suited-ace',
      'speculative',
      'trash',
    ]);
  });

  it('assigns every combo to exactly one class — none in two, none in none', () => {
    const perClass = new Map<HandClassId, Set<string>>(CLASS_IDS.map((id) => [id, new Set()]));
    for (const combo of ALL_COMBOS) {
      const id = classOf(combo);
      expect(CLASS_IDS).toContain(id);
      perClass.get(id)!.add(combo);
    }
    // The partition, checked from both sides: the parts sum to 169 and are pairwise disjoint.
    const sizes = CLASS_IDS.map((id) => perClass.get(id)!.size);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(169);
    for (const [a, setA] of perClass) {
      for (const [b, setB] of perClass) {
        if (a === b) continue;
        for (const combo of setA) expect(setB.has(combo)).toBe(false);
      }
    }
    // No class is empty, or it would be a chunk name with nothing under it.
    for (const size of sizes) expect(size).toBeGreaterThan(0);
  });

  it('agrees with combosInClass, which also partitions the 169', () => {
    const collected = CLASS_IDS.flatMap((id) => combosInClass(id));
    expect(collected).toHaveLength(169);
    expect(new Set(collected).size).toBe(169);
    for (const id of CLASS_IDS) {
      for (const combo of combosInClass(id)) expect(classOf(combo)).toBe(id);
    }
  });

  it('places the named anchors where the class labels say', () => {
    expect(classOf('AA')).toBe('premium');
    expect(classOf('QQ')).toBe('premium');
    expect(classOf('AKs')).toBe('premium');
    expect(classOf('AKo')).toBe('premium');
    // JJ is the first pair below premium, 88 the last above speculative.
    expect(classOf('JJ')).toBe('strong');
    expect(classOf('88')).toBe('strong');
    expect(classOf('77')).toBe('speculative');
    expect(classOf('22')).toBe('speculative');
    expect(classOf('AQo')).toBe('strong');
    expect(classOf('AJs')).toBe('strong');
    expect(classOf('AJo')).toBe('broadway');
    expect(classOf('KQs')).toBe('strong');
    expect(classOf('KQo')).toBe('broadway');
    expect(classOf('JTo')).toBe('broadway');
    expect(classOf('A5s')).toBe('suited-ace');
    expect(classOf('A2s')).toBe('suited-ace');
    expect(classOf('A5o')).toBe('trash');
    expect(classOf('98s')).toBe('speculative');
    expect(classOf('97s')).toBe('speculative');
    // Two-gappers are not connectors, so 96s drops out of speculative.
    expect(classOf('96s')).toBe('trash');
    expect(classOf('72o')).toBe('trash');
  });

  it('never classifies a hand as broadway unless both cards are ten or better', () => {
    for (const combo of combosInClass('broadway')) {
      expect(RANKS.indexOf(combo[1] as never)).toBeGreaterThanOrEqual(RANKS.indexOf('T'));
      expect(combo).not.toHaveLength(2); // Pairs belong to the pair classes, not broadway.
    }
  });

  it('throws on off-domain input rather than inventing a class', () => {
    expect(() => classOf('KAs')).toThrow();
    expect(() => classOf('')).toThrow();
    expect(() => classOf('AAs')).toThrow();
  });
});

describe('RFI ranges', () => {
  it('opens a sane fraction from every seat with a first-in node', () => {
    for (const position of RFI_POSITIONS) {
      const width = rfiWidth(position);
      expect(width).toBeGreaterThan(0.1);
      expect(width).toBeLessThan(0.6);
      expect(rfiCombos(position).length).toBeGreaterThan(20);
    }
  });

  it('widens monotonically UTG < HJ < CO < SB < BTN', () => {
    const widths = RFI_WIDTH_ORDER.map((position) => rfiWidth(position));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    // The single easiest error in this whole file, asserted directly: the button is not tighter
    // than under the gun. Getting this backwards would teach the opposite of correct play.
    expect(rfiWidth('BTN')).toBeGreaterThan(rfiWidth('UTG'));
    expect(rfiWidth('BTN')).toBeGreaterThan(rfiWidth('CO'));
    expect(rfiWidth('SB')).toBeGreaterThan(rfiWidth('CO'));
    expect(rfiWidth('SB')).toBeLessThan(rfiWidth('BTN'));
  });

  it('nests: an earlier position opens nothing a later one folds', () => {
    for (let i = 1; i < RFI_WIDTH_ORDER.length; i++) {
      const tighter = RFI_WIDTH_ORDER[i - 1];
      const wider = RFI_WIDTH_ORDER[i];
      for (const combo of rfiCombos(tighter)) {
        expect(isInRfiRange(combo, wider)).toBe(true);
      }
    }
  });

  it('opens every pair and every suited ace from every seat, as all three rule sets claim', () => {
    for (const position of RFI_POSITIONS) {
      for (const rank of RANKS) {
        expect(isInRfiRange(`${rank}${rank}`, position)).toBe(true);
        if (rank !== 'A') expect(isInRfiRange(`A${rank}s`, position)).toBe(true);
      }
    }
  });

  it('folds the degenerate worst hands from the earliest seat', () => {
    for (const combo of ['72o', '32o', '82o', '92o']) {
      expect(isInRfiRange(combo, 'UTG')).toBe(false);
      expect(isInRfiRange(combo, 'BTN')).toBe(false);
    }
  });

  it('gives the big blind no first-in range at all', () => {
    expect(rfiCombos('BB')).toHaveLength(0);
    expect(rfiWidth('BB')).toBe(0);
    for (const combo of ALL_COMBOS) expect(isInRfiRange(combo, 'BB')).toBe(false);
  });

  it('is monotonic within a row: a better kicker never folds while a worse one opens', () => {
    for (const position of POSITIONS) {
      for (const suited of [true, false]) {
        for (let hi = 1; hi < RANKS.length; hi++) {
          let sawFold = false;
          for (let lo = hi - 1; lo >= 0; lo--) {
            const open = isInRfiRange(
              `${RANKS[hi]}${RANKS[lo]}${suited ? 's' : 'o'}`,
              position,
            );
            if (!open) sawFold = true;
            else expect(sawFold).toBe(false);
          }
        }
      }
    }
  });

  it('never opens an offsuit hand it folds suited', () => {
    for (const position of POSITIONS) {
      for (const combo of ALL_COMBOS) {
        if (!combo.endsWith('o')) continue;
        if (!isInRfiRange(combo, position)) continue;
        expect(isInRfiRange(`${combo.slice(0, 2)}s`, position)).toBe(true);
      }
    }
  });
});

describe('the verbal rules', () => {
  it('is exactly three per position, every position covered', () => {
    for (const position of POSITIONS) {
      expect(POSITION_RULES[position]).toHaveLength(3);
    }
    expect(Object.keys(POSITION_RULES).sort()).toEqual([...POSITIONS].sort());
  });

  it('holds every rule to the N3 twelve-word budget', () => {
    for (const position of POSITIONS) {
      for (const rule of POSITION_RULES[position]) {
        expect(ruleWordCount(rule)).toBeLessThanOrEqual(MAX_RULE_WORDS);
        expect(ruleWordCount(rule)).toBeGreaterThan(2);
      }
    }
  });

  it('counts words the way the budget means it', () => {
    expect(ruleWordCount('one two three')).toBe(3);
    expect(ruleWordCount('  padded   spacing  here ')).toBe(3);
    expect(ruleWordCount('single')).toBe(1);
  });

  it('gives each position three distinct rules, not one repeated', () => {
    for (const position of POSITIONS) {
      expect(new Set(POSITION_RULES[position]).size).toBe(3);
    }
  });
});

describe('the boundary combos', () => {
  it('is non-empty and about twelve for every position', () => {
    for (const position of POSITIONS) {
      const boundary = BOUNDARY_COMBOS[position];
      expect(boundary.length).toBeGreaterThan(0);
      expect(boundary.length).toBeGreaterThanOrEqual(10);
      expect(boundary.length).toBeLessThanOrEqual(14);
      expect(new Set(boundary).size).toBe(boundary.length);
    }
  });

  it('lists only real combos', () => {
    for (const position of POSITIONS) {
      for (const combo of BOUNDARY_COMBOS[position]) expect(isCombo(combo)).toBe(true);
    }
  });

  it('straddles the frontier: some in the range, some out', () => {
    for (const position of RFI_POSITIONS) {
      const inside = BOUNDARY_COMBOS[position].filter((c) => isInRfiRange(c, position));
      const outside = BOUNDARY_COMBOS[position].filter((c) => !isInRfiRange(c, position));
      // A boundary set entirely inside or entirely outside the range flips no decision, which is
      // the whole reason N3 highlights these cells.
      expect(inside.length).toBeGreaterThan(0);
      expect(outside.length).toBeGreaterThan(0);
    }
  });

  it('is all-defence for the big blind, which has no open to straddle', () => {
    expect(BOUNDARY_COMBOS.BB.length).toBeGreaterThan(0);
    for (const combo of BOUNDARY_COMBOS.BB) expect(isInRfiRange(combo, 'BB')).toBe(false);
  });

  it('answers isBoundaryCombo per position, not globally', () => {
    expect(isBoundaryCombo('76s', 'UTG')).toBe(true);
    expect(isBoundaryCombo('76s', 'BTN')).toBe(false);
    // A range interior cell is never a boundary anywhere.
    for (const position of POSITIONS) {
      expect(isBoundaryCombo('AA', position)).toBe(false);
      expect(isBoundaryCombo('72o', position)).toBe(false);
    }
  });

  it('throws on off-domain input, matching classOf', () => {
    expect(() => isBoundaryCombo('KAs', 'UTG')).toThrow();
    expect(() => isBoundaryCombo('nonsense', 'BTN')).toThrow();
  });
});

describe('the queries are total', () => {
  it('returns a defined verdict for all 169 x 6 legal pairs', () => {
    let pairs = 0;
    for (const combo of ALL_COMBOS) {
      for (const position of POSITIONS) {
        const verdict = lookup(combo, position);
        pairs++;
        expect(verdict.combo).toBe(combo);
        expect(verdict.position).toBe(position);
        expect(CLASS_IDS).toContain(verdict.handClass);
        expect(typeof verdict.open).toBe('boolean');
        expect(typeof verdict.boundary).toBe('boolean');
        // Nothing may come back undefined: the UI renders these directly.
        expect(verdict.handClass).toBeDefined();
        expect(verdict.open).not.toBeUndefined();
        expect(verdict.boundary).not.toBeUndefined();
      }
    }
    expect(pairs).toBe(169 * 6);
  });

  it('agrees with the individual queries on every pair', () => {
    for (const combo of ALL_COMBOS) {
      for (const position of POSITIONS) {
        const verdict = lookup(combo, position);
        expect(verdict.handClass).toBe(classOf(combo));
        expect(verdict.open).toBe(isInRfiRange(combo, position));
        expect(verdict.boundary).toBe(isBoundaryCombo(combo, position));
      }
    }
  });

  it('is deterministic — the same pair twice gives the same verdict', () => {
    expect(lookup('K9s', 'HJ')).toEqual(lookup('K9s', 'HJ'));
    expect(lookup('K9s', 'HJ')).not.toEqual(lookup('K9s', 'UTG'));
  });
});
