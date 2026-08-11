import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createTable,
  isHandOver,
  legalActions,
  startHand,
  type TableState,
} from '../../src/core/table.js';
import type { Rng } from '../../src/core/rng.js';
import { mulberry32, shuffle } from '../../src/core/rng.js';
import { decideActionAs, type Archetype } from '../../src/core/ai.js';
import {
  ARCHETYPE_NAMES,
  ARCHETYPE_PROFILES,
  decideArchetypeAction,
  sessionProfile,
} from '../../src/core/archetypes.js';

/**
 * WIRING DETERMINISM — the invariant table.ts relies on when it swaps ai.ts's `decideAction` for
 * archetypes.ts's `decideArchetypeAction` on the shared long-lived aiRng stream.
 *
 * The renderer keeps ONE aiRng for the whole session. The design's determinism argument is that
 * `decideArchetypeAction` consumes that stream in the same COUNT and ORDER as ai.ts's `decideActionAs`
 * — exactly three draws per decision (hand-strength seed, aggression roll, call roll) — so the stream
 * advances identically regardless of which decision function or profile is used. If archetypes.ts ever
 * drew a different number of times (an extra bluff roll, a re-seed), every seed-pinned e2e in the app
 * would silently drift. These tests pin the draw count directly instead of hoping the e2e notices.
 */

/** An Rng that counts how many times it was called, so a decision's stream consumption is observable. */
function countingRng(seed: number): { rng: Rng; calls: () => number } {
  const inner = mulberry32(seed);
  let n = 0;
  return {
    rng: () => {
      n += 1;
      return inner();
    },
    calls: () => n,
  };
}

function villainSpot(tableSeed: number): TableState {
  const seats = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, stack: 5000, isHero: i === 0 }));
  // Right after the deal the first to act preflop is a villain facing the big blind — a live spot
  // where every archetype has a real fold/call/raise decision, and toAct is never the hero.
  return startHand(createTable({ seats, sb: 25, bb: 50, seed: tableSeed }));
}

describe('archetype wiring determinism', () => {
  it('decideArchetypeAction consumes exactly three rng draws per decision', () => {
    const spot = villainSpot(11);
    expect(spot.toAct).not.toBe(0); // a villain is to act
    for (const name of ARCHETYPE_NAMES) {
      const { rng, calls } = countingRng(99);
      decideArchetypeAction(sessionProfile(name, 3), spot, spot.toAct, rng);
      expect(calls(), `${name} draw count`).toBe(3);
    }
  });

  it('advances the shared stream identically to ai.ts decideActionAs (same count, same order)', () => {
    // The three ai.ts archetypes share the exact NOMINAL profiles of three of the six, so on the same
    // spot and the same rng they not only consume the stream identically but return the same action.
    const equivalents: [Archetype, keyof typeof ARCHETYPE_PROFILES][] = [
      ['nit', 'nit'],
      ['station', 'station'],
    ];
    const spot = villainSpot(23);
    for (const [aiName, archName] of equivalents) {
      const a = countingRng(77);
      const legacy = decideActionAs(aiName, spot, spot.toAct, a.rng);
      const b = countingRng(77);
      const wired = decideArchetypeAction(ARCHETYPE_PROFILES[archName], spot, spot.toAct, b.rng);
      expect(a.calls(), `${aiName} stream draws`).toBe(b.calls());
      // Same rng, same profile => byte-identical decision, so the shared stream is at the same
      // position after either call. (jitter is not applied here — nominal profiles on both sides.)
      expect(wired).toEqual(legacy);
    }
  });

  it('replays the same villain actions across a whole hand for the same seed', () => {
    // Mirrors the renderer: one selectRng picks 3-of-6, one aiRng drives every villain decision.
    const playHand = (seed: number): string[] => {
      const selectRng = mulberry32(seed ^ 0x5e1ec7);
      const chosen = shuffle([...ARCHETYPE_NAMES], selectRng).slice(0, 3);
      const profiles = new Map(chosen.map((name, i) => [i + 1, sessionProfile(name, seed)]));
      const aiRng = mulberry32(seed ^ 0x5eed);

      const seats = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, stack: 5000, isHero: i === 0 }));
      let s = startHand(createTable({ seats, sb: 25, bb: 50, seed }));
      const actions: string[] = [];
      let guard = 0;
      while (!isHandOver(s) && guard++ < 300) {
        if (legalActions(s).length === 0) break;
        if (s.toAct === 0) {
          s = applyAction(s, { kind: 'fold' }); // hero folds out; villains play each other
          continue;
        }
        const action = decideArchetypeAction(profiles.get(s.toAct)!, s, s.toAct, aiRng);
        actions.push(`${s.toAct}:${action.kind}${action.amount ?? ''}`);
        s = applyAction(s, action);
      }
      return actions;
    };

    expect(playHand(42)).toEqual(playHand(42));
    // A different seed changes both the selection and the stream, so the action trace must differ.
    expect(playHand(42)).not.toEqual(playHand(1337));
  });
});
