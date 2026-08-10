import { describe, it, expect } from 'vitest';
import {
  createTable,
  startHand,
  legalActions,
  minRaiseTo,
  maxRaiseTo,
  applyAction,
  isHandOver,
  type Action,
  type TableState,
} from '../../src/core/table.js';
import { mulberry32 } from '../../src/core/rng.js';
import { jitterParameters, bandFor } from '../../src/core/jitter.js';
import {
  ARCHETYPE_NAMES,
  ARCHETYPE_PROFILES,
  ARCHETYPE_EXPLOITS,
  sessionProfile,
  decideArchetypeAction,
  type ArchetypeName,
  type ArchetypeProfile,
} from '../../src/core/archetypes.js';

/**
 * THE SIX ARCHETYPES — O1, O2, O3.
 *
 * O1 names six distinct rule-based bots and forbids a dialled-down solver. The tests pin (a) that
 * exactly those six exist and are behaviourally DISTINCT, (b) that each carries a real exploit the
 * learner can name, (c) O2's baseline (tag-reg has no exploit), and (d) O3 composition — the
 * decision function reads the (jittered) profile, not a name, and jitter is reproducible.
 *
 * Every assertion is derived from the spec text or from a probe of equityVsRandom, never guessed:
 * the medium-strength separator 9s9d on 2c7dKs measures ~0.74, between nit's 0.68 callStrength and
 * over-folder's 0.75, which is why those two split on it.
 */

const NAMES = ARCHETYPE_NAMES as readonly ArchetypeName[];

// ── Helpers (modelled on ai.test.ts) ─────────────────────────────────────────

function makeTable(n: number, stack = 1000, seed = 7): TableState {
  const seats = Array.from({ length: n }, (_, i) => ({ name: `P${i}`, stack, isHero: i === 0 }));
  return startHand(createTable({ seats, sb: 5, bb: 10, seed }));
}

function assertLegal(state: TableState, action: Action): void {
  const legal = legalActions(state);
  expect(legal).toContain(action.kind);
  if (action.kind === 'raise' || action.kind === 'bet') {
    expect(action.amount).toBeDefined();
    expect(action.amount!).toBeGreaterThanOrEqual(minRaiseTo(state));
    expect(action.amount!).toBeLessThanOrEqual(maxRaiseTo(state));
  }
}

function playHandWithAi(state: TableState, decisionSeed: number, profile: ArchetypeProfile): TableState {
  const rng = mulberry32(decisionSeed);
  let s = state;
  let guard = 0;
  while (!isHandOver(s) && guard < 200) {
    if (legalActions(s).length === 0) break;
    const action = decideArchetypeAction(profile, s, s.toAct, rng);
    assertLegal(s, action);
    s = applyAction(s, action);
    guard++;
  }
  expect(guard).toBeLessThan(200);
  return s;
}

/** Heads-up: villain (seat 1) faces a 3x preflop raise from the hero. */
function preflopRaisedSpot(tableSeed: number): TableState {
  const s = makeTable(2, 1000, tableSeed);
  return applyAction(s, { kind: 'raise', amount: 30 });
}

/** 3-handed flop spot where the villain (seat 1) faces a pot-sized bet from the hero. */
function flopBetSpot(tableSeed: number): TableState {
  let s = makeTable(3, 1000, tableSeed);
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'check' });
  expect(s.street).toBe('flop');
  s = applyAction(s, { kind: 'check' }); // seat 1
  s = applyAction(s, { kind: 'check' }); // seat 2
  s = applyAction(s, { kind: 'bet', amount: 30 }); // hero
  expect(s.toAct).toBe(1);
  return s;
}

/** 3-handed flop with nothing owed: seat 1 is first to act and may check or open. */
function unopenedFlopSpot(tableSeed: number): TableState {
  let s = makeTable(3, 1000, tableSeed);
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'call' });
  s = applyAction(s, { kind: 'check' });
  expect(s.street).toBe('flop');
  expect(s.toAct).toBe(1);
  expect(s.currentBet).toBe(0);
  return s;
}

/** Overwrite the actor's hand and board to a fixed shape, so the spot is not seed-dependent. */
function withHand(state: TableState, hole: [string, string], board: string[]): TableState {
  const spot = JSON.parse(JSON.stringify(state)) as TableState;
  spot.seats[spot.toAct].hole = hole;
  spot.board = board;
  return spot;
}

function countKinds(actions: Action[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  return counts;
}

/** Nominal-profile decisions for one archetype across many distinct spots. */
function sampleSpot(archetype: ArchetypeName, spot: (seed: number) => TableState, n: number): Action[] {
  const profile = ARCHETYPE_PROFILES[archetype];
  const actions: Action[] = [];
  for (let i = 0; i < n; i++) {
    const state = spot(100 + i);
    actions.push(decideArchetypeAction(profile, state, state.toAct, mulberry32(500 + i)));
  }
  return actions;
}

/** Decisions for a FIXED spot (same hand/board) across many decision seeds. */
function sampleFixed(profile: ArchetypeProfile, spot: TableState, n: number): Action[] {
  return Array.from({ length: n }, (_, i) =>
    decideArchetypeAction(profile, spot, spot.toAct, mulberry32(seedForFixed(i))),
  );
}

const seedForFixed = (i: number): number => 900 + i * 7;

// ── O1: exactly the six named archetypes ─────────────────────────────────────

describe('O1: six named rule-based archetypes', () => {
  it('names exactly nit, station, lag, tag-reg, over-folder, maniac', () => {
    expect([...ARCHETYPE_NAMES]).toEqual(['nit', 'station', 'lag', 'tag-reg', 'over-folder', 'maniac']);
    expect(ARCHETYPE_NAMES.length).toBe(6);
  });

  it('carries a profile for every named archetype', () => {
    for (const name of NAMES) {
      expect(ARCHETYPE_PROFILES[name]).toBeDefined();
      expect(Object.keys(ARCHETYPE_PROFILES[name]).sort()).toEqual([
        'betPotFraction',
        'bluffBetFreq',
        'bluffRaiseFreq',
        'callStrength',
        'loosecallFreq',
        'raiseFreq',
        'raiseStrength',
      ]);
    }
  });
});

// ── O1/O2: each label is a real exploit the learner can name ─────────────────

describe('O1: each archetype exposes a nameable exploit', () => {
  it('exposes a label, description and exploit for each archetype', () => {
    for (const name of NAMES) {
      const meta = ARCHETYPE_EXPLOITS[name];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(10);
      expect(meta.exploit.length).toBeGreaterThan(10);
    }
  });

  it('O2: tag-reg is the baseline whose exploit is to NOT deviate', () => {
    const exploit = ARCHETYPE_EXPLOITS['tag-reg'].exploit.toLowerCase();
    expect(exploit).toMatch(/baseline|standard|no reliable leak/);
    expect(exploit).toMatch(/deviat/);
  });

  it('each exploit names THAT archetype\'s read, so swapping any two fails', () => {
    // A distinctive phrase from each exploit that only fits that archetype's read. Length checks
    // alone let nit's and station's exploit strings be swapped silently; these pin the content, so
    // any exploit string sitting in the wrong slot no longer matches.
    const signature: Record<ArchetypeName, RegExp> = {
      nit: /when a nit bets, it has it/, // fold to its aggression, steal its blinds
      station: /value bet thin and never bluff/, // it pays off good hands, folds to nothing
      lag: /out-bluff a bluffer/, // widen calls, don't fight its bluffs
      'tag-reg': /no reliable leak/, // O2 baseline: play standard, don't deviate
      'over-folder': /gives up too easily/, // bet/raise relentlessly as a bluff
      maniac: /call down light/, // trap and let its constant aggression pay you off
    };
    for (const name of NAMES) {
      const exploit = ARCHETYPE_EXPLOITS[name].exploit.toLowerCase();
      expect(exploit).toMatch(signature[name]);
      // No OTHER archetype's exploit matches this one's signature — so a swap cannot pass.
      for (const other of NAMES) {
        if (other === name) continue;
        expect(ARCHETYPE_EXPLOITS[other].exploit.toLowerCase()).not.toMatch(signature[name]);
      }
    }
  });
});

// ── O2: the frequency orderings the archetypes' reads are built on ───────────

describe('O2: nominal frequencies obey the documented orderings', () => {
  const bluffBet = (name: ArchetypeName): number => ARCHETYPE_PROFILES[name].bluffBetFreq;
  const callStrength = (name: ArchetypeName): number => ARCHETYPE_PROFILES[name].callStrength;

  it('stab ordering: maniac > lag > tag-reg > over-folder', () => {
    // The source's own read: "bluffBetFreq (stabbing an unopened pot): maniac > lag > tag-reg >
    // over-folder ≳ nit ≈ station." A strict chain, so no one link can be inflated undetected.
    expect(bluffBet('maniac')).toBeGreaterThan(bluffBet('lag'));
    expect(bluffBet('lag')).toBeGreaterThan(bluffBet('tag-reg'));
    expect(bluffBet('tag-reg')).toBeGreaterThan(bluffBet('over-folder'));
  });

  it('over-folder is among the lowest stabbers, never a frequent one', () => {
    // over-folder.bluffBetFreq -> 0.9 would make it stab like a maniac; pin it below the aggressors
    // and no higher than the passive floor (nit/station).
    expect(bluffBet('over-folder')).toBeLessThan(bluffBet('tag-reg'));
    expect(bluffBet('over-folder')).toBeLessThan(bluffBet('lag'));
    expect(bluffBet('over-folder')).toBeLessThan(bluffBet('maniac'));
    expect(bluffBet('over-folder')).toBeLessThanOrEqual(Math.max(bluffBet('nit'), bluffBet('station')) + 0.05);
  });

  it('O2: tag-reg sits strictly between the extremes on bluffBetFreq', () => {
    // O2: tag-reg "sits behaviourally BETWEEN the two extremes rather than leaning toward either."
    // over-folder (a passive floor) < tag-reg < lag < maniac (the aggressors): tag-reg is neither
    // the tightest stabber nor an aggressor. bluffBetFreq 0.3 -> 0.95 breaks the upper bounds.
    expect(bluffBet('tag-reg')).toBeGreaterThan(bluffBet('over-folder'));
    expect(bluffBet('tag-reg')).toBeLessThan(bluffBet('lag'));
    expect(bluffBet('tag-reg')).toBeLessThan(bluffBet('maniac'));
  });

  it('O2: tag-reg callStrength is neither the loosest nor the tightest', () => {
    // callStrength ordering: over-folder > nit > tag-reg > lag > station > maniac. tag-reg must be
    // strictly looser than the tightest (over-folder/nit) and strictly tighter than the loosest
    // (station/maniac). callStrength 0.55 -> 0.95 would make it the tightest of all.
    const strengths = NAMES.map(callStrength);
    const loosest = Math.min(...strengths);
    const tightest = Math.max(...strengths);
    expect(callStrength('tag-reg')).toBeGreaterThan(loosest);
    expect(callStrength('tag-reg')).toBeLessThan(tightest);
    // The specific neighbours the read names, so "between" is pinned, not just "not an endpoint".
    expect(callStrength('tag-reg')).toBeGreaterThan(callStrength('station'));
    expect(callStrength('tag-reg')).toBeGreaterThan(callStrength('maniac'));
    expect(callStrength('tag-reg')).toBeLessThan(callStrength('over-folder'));
    expect(callStrength('tag-reg')).toBeLessThan(callStrength('nit'));
  });
});

// ── Legality (the crash-the-engine bug class) ────────────────────────────────

describe('legality', () => {
  it('returns only legal actions when each archetype fills every seat', () => {
    for (const name of NAMES) {
      const profile = ARCHETYPE_PROFILES[name];
      for (let seed = 1; seed <= 25; seed++) {
        playHandWithAi(makeTable(2 + (seed % 5), 1000, seed), seed * 17, profile);
      }
    }
  });

  it('returns only legal actions with short stacks (all-in paths)', () => {
    for (const name of NAMES) {
      const profile = ARCHETYPE_PROFILES[name];
      for (let seed = 1; seed <= 15; seed++) {
        const stack = 12 + (seed % 6) * 9;
        playHandWithAi(makeTable(3, stack, seed), seed * 13, profile);
      }
    }
  });

  it('never returns an action absent from legalActions facing a bet or a raise', () => {
    for (const name of NAMES) {
      const profile = ARCHETYPE_PROFILES[name];
      for (let seed = 1; seed <= 25; seed++) {
        const pre = preflopRaisedSpot(seed);
        assertLegal(pre, decideArchetypeAction(profile, pre, pre.toAct, mulberry32(seed)));
        const flop = flopBetSpot(seed);
        assertLegal(flop, decideArchetypeAction(profile, flop, flop.toAct, mulberry32(seed)));
      }
    }
  });

  it('throws when asked to act out of turn', () => {
    const s = makeTable(3);
    const notToAct = (s.toAct + 1) % 3;
    expect(() => decideArchetypeAction(ARCHETYPE_PROFILES.nit, s, notToAct, mulberry32(1))).toThrow();
  });
});

// ── Determinism (pure core) ──────────────────────────────────────────────────

describe('determinism', () => {
  it('same profile, seed and state produce the same action', () => {
    for (const name of NAMES) {
      const profile = ARCHETYPE_PROFILES[name];
      for (let seed = 1; seed <= 12; seed++) {
        const state = flopBetSpot(seed);
        const first = decideArchetypeAction(profile, state, state.toAct, mulberry32(77));
        const second = decideArchetypeAction(profile, state, state.toAct, mulberry32(77));
        expect(second).toEqual(first);
      }
    }
  });

  it('never calls Math.random', () => {
    const state = flopBetSpot(4);
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random must never be called');
    };
    try {
      for (const name of NAMES) {
        expect(() =>
          decideArchetypeAction(ARCHETYPE_PROFILES[name], state, state.toAct, mulberry32(5)),
        ).not.toThrow();
      }
    } finally {
      Math.random = original;
    }
  });
});

// ── Behaviourally distinct, each ordering a real read ────────────────────────

describe('O1: the six are behaviourally distinct', () => {
  const N = 60;

  it('produces six different action mixes facing the same bet', () => {
    const mixes = NAMES.map((name) => JSON.stringify(countKinds(sampleSpot(name, flopBetSpot, N))));
    expect(new Set(mixes).size).toBe(6);
  });

  it('maniac is the most aggressive facing a bet; over-folder among the least', () => {
    const aggression = (name: ArchetypeName): number => {
      const c = countKinds(sampleSpot(name, flopBetSpot, N));
      return (c.raise ?? 0) + (c.bet ?? 0) + (c.allin ?? 0);
    };
    const maniac = aggression('maniac');
    for (const name of NAMES) {
      if (name === 'maniac') continue;
      expect(maniac).toBeGreaterThan(aggression(name));
    }
    expect(aggression('over-folder')).toBeLessThan(aggression('lag'));
  });

  it('the station calls a bet far more often than the over-folder does', () => {
    const spot = withHand(flopBetSpot(11), ['2c', '7d'], ['As', 'Kd', 'Qh']); // trash vs a big bet
    const stationCalls = countKinds(sampleFixed(ARCHETYPE_PROFILES.station, spot, 40)).call ?? 0;
    const overFolderCalls = countKinds(sampleFixed(ARCHETYPE_PROFILES['over-folder'], spot, 40)).call ?? 0;
    expect(stationCalls).toBeGreaterThan(20);
    expect(overFolderCalls).toBeLessThan(5);
    expect(stationCalls).toBeGreaterThan(overFolderCalls);
  });

  it('the over-folder folds a medium hand the nit continues with', () => {
    // 9s9d on 2c7dKs ≈ 0.74 equity: above the nit's 0.68 callStrength, below the over-folder's 0.75.
    const spot = withHand(flopBetSpot(3), ['9s', '9d'], ['2c', '7d', 'Ks']);
    const nitFolds = countKinds(sampleFixed(ARCHETYPE_PROFILES.nit, spot, 40)).fold ?? 0;
    const overFolderFolds = countKinds(sampleFixed(ARCHETYPE_PROFILES['over-folder'], spot, 40)).fold ?? 0;
    expect(overFolderFolds).toBeGreaterThan(nitFolds);
  });

  it('the maniac and lag stab an unopened pot with trash far more than the nit', () => {
    const spot = withHand(unopenedFlopSpot(5), ['2c', '7d'], ['As', 'Kd', 'Qh']);
    const stabs = (profile: ArchetypeProfile): number => {
      const c = countKinds(sampleFixed(profile, spot, 40));
      return (c.bet ?? 0) + (c.allin ?? 0);
    };
    const maniac = stabs(ARCHETYPE_PROFILES.maniac);
    const lag = stabs(ARCHETYPE_PROFILES.lag);
    const nit = stabs(ARCHETYPE_PROFILES.nit);
    expect(maniac).toBeGreaterThan(nit);
    expect(lag).toBeGreaterThan(nit);
    expect(nit).toBeLessThan(6); // a nit almost never bluffs
  });

  it('a nit with trash facing a big bet folds every time', () => {
    const spot = withHand(flopBetSpot(6), ['2c', '7d'], ['As', 'Kd', 'Qh']);
    for (const action of sampleFixed(ARCHETYPE_PROFILES.nit, spot, 20)) {
      expect(action.kind).toBe('fold');
    }
  });

  it('maniac sizes its bets larger than a smaller-sizing archetype (betPotFraction)', () => {
    // aggressiveAction sizes to currentBet + round(pot * betPotFraction), so a bigger betPotFraction
    // is a strictly bigger bet in the SAME spot. maniac (1.0) bets the full 30-chip pot; tag-reg
    // (0.66) bets less. betPotFraction 1.0 -> 0.5 would drop maniac below tag-reg. Value hand so
    // both actually bet: top set 9s9d on 2c7d9h in an unopened pot.
    const spot = withHand(unopenedFlopSpot(5), ['9s', '9d'], ['2c', '7d', '9h']);
    const firstBetAmount = (profile: ArchetypeProfile): number => {
      for (const action of sampleFixed(profile, spot, 60)) {
        if (action.kind === 'bet' || action.kind === 'raise' || action.kind === 'allin') {
          expect(action.amount).toBeDefined();
          return action.amount!;
        }
      }
      throw new Error('archetype never bet the value hand — spot is wrong');
    };
    const maniacBet = firstBetAmount(ARCHETYPE_PROFILES.maniac);
    const tagRegBet = firstBetAmount(ARCHETYPE_PROFILES['tag-reg']);
    const stationBet = firstBetAmount(ARCHETYPE_PROFILES.station);
    expect(maniacBet).toBeGreaterThan(tagRegBet);
    expect(maniacBet).toBeGreaterThan(stationBet);
    // Pinned absolutely too: maniac bets the full pot (currentBet 0 + pot 30), the largest sizing.
    expect(maniacBet).toBe(spot.pot);
  });

  it('checks back rather than folding when nothing is owed', () => {
    const spot = withHand(unopenedFlopSpot(8), ['2c', '7d'], ['As', 'Kd', 'Qh']);
    for (const name of NAMES) {
      for (const action of sampleFixed(ARCHETYPE_PROFILES[name], spot, 12)) {
        expect(action.kind).not.toBe('fold');
      }
    }
  });
});

// ── The decision function reads the PROFILE, not a name (O3 seam) ────────────

describe('O3: decideArchetypeAction is keyed on the profile, not an archetype name', () => {
  const NEVER_CONTINUE: ArchetypeProfile = {
    callStrength: 1,
    raiseStrength: 1,
    raiseFreq: 0,
    bluffBetFreq: 0,
    bluffRaiseFreq: 0,
    loosecallFreq: 0,
    betPotFraction: 0.5,
  };
  const ALWAYS_STAB: ArchetypeProfile = {
    callStrength: 1,
    raiseStrength: 1,
    raiseFreq: 0,
    bluffBetFreq: 1,
    bluffRaiseFreq: 0,
    loosecallFreq: 0,
    betPotFraction: 0.5,
  };

  it('a never-continue profile always folds to a bet', () => {
    const spot = withHand(flopBetSpot(2), ['8s', '8d'], ['2c', '7d', '9s']); // a real hand, not trash
    for (const action of sampleFixed(NEVER_CONTINUE, spot, 20)) {
      expect(action.kind).toBe('fold');
    }
  });

  it('an always-stab profile always bets an unopened pot', () => {
    const spot = withHand(unopenedFlopSpot(4), ['2c', '7d'], ['As', 'Kd', 'Qh']);
    for (const action of sampleFixed(ALWAYS_STAB, spot, 20)) {
      expect(action.kind).toBe('bet');
    }
  });
});

// ── O3: composition with the seeded per-session jitter ───────────────────────

describe('O3: sessionProfile composes the seeded per-session jitter', () => {
  it('returns exactly jitterParameters applied to the nominal profile', () => {
    for (const name of NAMES) {
      for (const seed of [1, 7, 42, 1000]) {
        expect(sessionProfile(name, seed)).toEqual(
          jitterParameters(seed, name, ARCHETYPE_PROFILES[name]),
        );
      }
    }
  });

  it('is reproducible for the same session seed and varies with it', () => {
    for (const name of NAMES) {
      expect(sessionProfile(name, 55)).toEqual(sessionProfile(name, 55));
      const differs = Object.keys(ARCHETYPE_PROFILES[name]).some(
        (p) =>
          sessionProfile(name, 55)[p as keyof ArchetypeProfile] !==
          sessionProfile(name, 56)[p as keyof ArchetypeProfile],
      );
      expect(differs).toBe(true);
    }
  });

  it('keeps every jittered parameter inside its band across many seeds', () => {
    for (const name of NAMES) {
      const nominal = ARCHETYPE_PROFILES[name];
      for (let seed = 1; seed <= 500; seed++) {
        const jittered = sessionProfile(name, seed);
        for (const p of Object.keys(nominal) as (keyof ArchetypeProfile)[]) {
          const band = bandFor(nominal[p]);
          expect(jittered[p]).toBeGreaterThanOrEqual(band.min - 1e-12);
          expect(jittered[p]).toBeLessThanOrEqual(band.max + 1e-12);
        }
      }
    }
  });

  it('leaves a structurally-zero parameter at exactly zero every session', () => {
    // "A nit never bluff-raises and never loose-calls"; "an over-folder never fights back": these are
    // structural facts, so jitter must not move them off zero.
    expect(ARCHETYPE_PROFILES.nit.bluffRaiseFreq).toBe(0);
    expect(ARCHETYPE_PROFILES.nit.loosecallFreq).toBe(0);
    expect(ARCHETYPE_PROFILES['over-folder'].bluffRaiseFreq).toBe(0);
    expect(ARCHETYPE_PROFILES['over-folder'].loosecallFreq).toBe(0);
    for (let seed = 1; seed <= 300; seed++) {
      const nit = sessionProfile('nit', seed);
      const overFolder = sessionProfile('over-folder', seed);
      expect(nit.bluffRaiseFreq).toBe(0);
      expect(nit.loosecallFreq).toBe(0);
      expect(overFolder.bluffRaiseFreq).toBe(0);
      expect(overFolder.loosecallFreq).toBe(0);
    }
  });
});
