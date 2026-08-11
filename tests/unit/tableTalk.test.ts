import { describe, expect, it } from 'vitest';
import { quipFor } from '../../src/core/tableTalk.js';
import { ARCHETYPE_NAMES, ARCHETYPE_EXPLOITS } from '../../src/core/archetypes.js';
import type { ActionKind } from '../../src/core/table.js';

const ACTIONS: ActionKind[] = ['fold', 'check', 'call', 'bet', 'raise', 'allin'];

describe('villain table-talk', () => {
  it('gives a non-empty line for every action, in-hand and at showdown', () => {
    for (const action of ACTIONS) {
      expect(quipFor(action, null, 0).length).toBeGreaterThan(0);
      for (const name of ARCHETYPE_NAMES) {
        expect(quipFor(action, name, 0).length).toBeGreaterThan(0);
      }
    }
  });

  it('is pure: same inputs give the same line', () => {
    expect(quipFor('raise', null, 3)).toBe(quipFor('raise', null, 3));
    expect(quipFor('call', 'nit', 0)).toBe(quipFor('call', 'nit', 0));
  });

  it('varies in-hand lines by the stable variant index, and wraps safely for any integer', () => {
    const lines = new Set([quipFor('bet', null, 0), quipFor('bet', null, 1), quipFor('bet', null, 2)]);
    // The three variants are distinct, so a table of villains does not chant one phrase.
    expect(lines.size).toBeGreaterThan(1);
    // Negative and huge indices must not throw or return undefined — the seat id could be anything.
    expect(quipFor('bet', null, -7).length).toBeGreaterThan(0);
    expect(quipFor('bet', null, 999999).length).toBeGreaterThan(0);
  });

  /**
   * THE LOAD-BEARING INVARIANT. O3 hides the archetype label mid-hand and the learner classifies the
   * villain from behaviour. So an IN-HAND line (revealed === null) must not contain any archetype
   * label or descriptor word — otherwise the banter narrates the very read the learner is being
   * tested on. This sweeps every action and asserts no in-hand line leaks a label.
   */
  it('never leaks the archetype label or its descriptor while the hand is live', () => {
    // Every label ('Nit', 'LAG', …) and the distinctive words from each archetype's description.
    const forbidden = new Set<string>();
    for (const name of ARCHETYPE_NAMES) {
      forbidden.add(ARCHETYPE_EXPLOITS[name].label.toLowerCase());
      for (const word of ['nit', 'station', 'calling', 'loose', 'aggressive', 'tight', 'fold', 'maniac', 'bluff']) {
        forbidden.add(word);
      }
    }
    for (const action of ACTIONS) {
      for (let variant = 0; variant < 6; variant++) {
        const line = quipFor(action, null, variant).toLowerCase();
        for (const word of forbidden) {
          expect(
            line.includes(word),
            `in-hand line "${line}" for ${action} leaks the label/descriptor "${word}"`,
          ).toBe(false);
        }
      }
    }
  });

  it('unlocks archetype personality only once revealed, and never repeats an in-hand line there', () => {
    // A revealed line is chosen by archetype, not by action — the action is irrelevant post-reveal.
    expect(quipFor('fold', 'maniac', 0)).toBe(quipFor('raise', 'maniac', 5));
    // And it differs from the generic in-hand line for the same action.
    expect(quipFor('call', 'station', 0)).not.toBe(quipFor('call', null, 0));
  });
});
