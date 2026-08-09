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
import {
  decideAction,
  decideActionAs,
  archetypeForSeat,
  ARCHETYPES,
  type Archetype,
} from '../../src/core/ai.js';

const ARCHETYPE_LIST: Archetype[] = ['nit', 'tag', 'station'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTable(n: number, stack = 1000, seed = 7): TableState {
  const seats = Array.from({ length: n }, (_, i) => ({
    name: `P${i}`,
    stack,
    isHero: i === 0,
  }));
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

/** Plays a whole hand with every seat driven by the AI, asserting legality at each step. */
function playHandWithAi(state: TableState, decisionSeed: number, archetype?: Archetype): TableState {
  const rng = mulberry32(decisionSeed);
  let s = state;
  let guard = 0;
  while (!isHandOver(s) && guard < 200) {
    if (legalActions(s).length === 0) break;
    const action = archetype
      ? decideActionAs(archetype, s, s.toAct, rng)
      : decideAction(s, s.toAct, rng);
    assertLegal(s, action);
    s = applyAction(s, action);
    guard++;
  }
  expect(guard).toBeLessThan(200);
  return s;
}

/** Heads-up spot where the villain (seat 1) faces a 3x preflop raise from the hero. */
function preflopRaisedSpot(tableSeed: number): TableState {
  const s = makeTable(2, 1000, tableSeed);
  return applyAction(s, { kind: 'raise', amount: 30 });
}

/** 3-handed flop spot where seat 1 faces a pot-sized bet from the hero. */
function flopBetSpot(tableSeed: number): TableState {
  let s = makeTable(3, 1000, tableSeed);
  s = applyAction(s, { kind: 'call' }); // seat 0 (UTG/dealer)
  s = applyAction(s, { kind: 'call' }); // seat 1 (SB)
  s = applyAction(s, { kind: 'check' }); // seat 2 (BB)
  expect(s.street).toBe('flop');
  s = applyAction(s, { kind: 'check' }); // seat 1
  s = applyAction(s, { kind: 'check' }); // seat 2
  s = applyAction(s, { kind: 'bet', amount: 30 }); // hero bets pot
  expect(s.toAct).toBe(1);
  return s;
}

/** Trash hand facing a huge bet — the classic fold spot. */
function trashVsBigBet(): TableState {
  const s = flopBetSpot(11);
  const spot = JSON.parse(JSON.stringify(s)) as TableState;
  spot.seats[1].hole = ['2c', '7d'];
  spot.board = ['As', 'Kd', 'Qh'];
  return spot;
}

function countKinds(actions: Action[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  return counts;
}

/** Decisions for one archetype across many distinct spots. */
function sampleSpot(archetype: Archetype, spot: (seed: number) => TableState, n: number): Action[] {
  const actions: Action[] = [];
  for (let i = 0; i < n; i++) {
    const state = spot(100 + i);
    actions.push(decideActionAs(archetype, state, state.toAct, mulberry32(500 + i)));
  }
  return actions;
}

// ── Legality (the crash-the-engine bug class) ───────────────────────────────

describe('legality', () => {
  it('returns only legal actions for full AI-vs-AI hands across many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const n = 2 + (seed % 5); // 2..6 seats
      playHandWithAi(makeTable(n, 1000, seed), seed * 31);
    }
  });

  for (const archetype of ARCHETYPE_LIST) {
    it(`${archetype} returns only legal actions when it fills every seat`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        playHandWithAi(makeTable(2 + (seed % 5), 1000, seed), seed * 17, archetype);
      }
    });
  }

  it('returns only legal actions with short stacks (all-in paths)', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const stack = 12 + (seed % 6) * 9; // 1.2bb .. 6.7bb — forces all-in-only spots
      playHandWithAi(makeTable(3, stack, seed), seed * 13);
    }
  });

  it('returns only legal actions with mixed stack depths', () => {
    const seats = [
      { name: 'Hero', stack: 1000, isHero: true },
      { name: 'Short', stack: 14 },
      { name: 'Mid', stack: 120 },
      { name: 'Deep', stack: 3000 },
    ];
    for (let seed = 1; seed <= 20; seed++) {
      playHandWithAi(startHand(createTable({ seats, sb: 5, bb: 10, seed })), seed * 7);
    }
  });

  it('never returns an action absent from legalActions in a preflop raised spot', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (let seed = 1; seed <= 30; seed++) {
        const state = preflopRaisedSpot(seed);
        assertLegal(state, decideActionAs(archetype, state, state.toAct, mulberry32(seed)));
      }
    }
  });

  it('never returns an action absent from legalActions in a flop bet spot', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (let seed = 1; seed <= 20; seed++) {
        const state = flopBetSpot(seed);
        assertLegal(state, decideActionAs(archetype, state, state.toAct, mulberry32(seed)));
      }
    }
  });

  it('throws when asked to act out of turn', () => {
    const s = makeTable(3);
    const notToAct = (s.toAct + 1) % 3;
    expect(() => decideAction(s, notToAct, mulberry32(1))).toThrow();
  });
});

// ── Raise sizing ────────────────────────────────────────────────────────────

describe('raise sizing', () => {
  it('clamps every bet/raise between minRaiseTo and maxRaiseTo', () => {
    let sized = 0;
    for (const archetype of ARCHETYPE_LIST) {
      for (let seed = 1; seed <= 60; seed++) {
        const state = seed % 2 === 0 ? preflopRaisedSpot(seed) : flopBetSpot(seed);
        const action = decideActionAs(archetype, state, state.toAct, mulberry32(seed * 3));
        if (action.kind === 'bet' || action.kind === 'raise') {
          expect(action.amount!).toBeGreaterThanOrEqual(minRaiseTo(state));
          expect(action.amount!).toBeLessThanOrEqual(maxRaiseTo(state));
          sized++;
        }
      }
    }
    expect(sized).toBeGreaterThan(0); // the assertions above must actually have run
  });

  it('raises to at least the minimum when the pot-fraction target is too small', () => {
    // Pot is tiny relative to the current bet, so pot * fraction under-shoots the min raise.
    const state = preflopRaisedSpot(3);
    const spot = JSON.parse(JSON.stringify(state)) as TableState;
    spot.pot = 1;
    spot.seats[1].hole = ['As', 'Ad'];
    let raises = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const action = decideActionAs('tag', spot, spot.toAct, mulberry32(seed));
      if (action.kind !== 'raise') continue;
      expect(action.amount!).toBe(minRaiseTo(spot));
      raises++;
    }
    expect(raises).toBeGreaterThan(0);
  });

  it('caps the raise at the stack when the pot-fraction target exceeds it', () => {
    const state = flopBetSpot(5);
    const spot = JSON.parse(JSON.stringify(state)) as TableState;
    spot.pot = 100000;
    spot.seats[1].hole = ['As', 'Ad'];
    spot.board = ['Ah', 'Kd', '7c'];
    let raises = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const action = decideActionAs('nit', spot, spot.toAct, mulberry32(seed));
      if (action.kind !== 'raise') continue;
      expect(action.amount!).toBe(maxRaiseTo(spot));
      raises++;
    }
    expect(raises).toBeGreaterThan(0);
  });
});

// ── Determinism ─────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('same seed and state produce the same action', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (let seed = 1; seed <= 15; seed++) {
        const state = flopBetSpot(seed);
        const first = decideActionAs(archetype, state, state.toAct, mulberry32(77));
        const second = decideActionAs(archetype, state, state.toAct, mulberry32(77));
        expect(second).toEqual(first);
      }
    }
  });

  it('whole AI-vs-AI hands replay identically under the same seed', () => {
    const a = playHandWithAi(makeTable(4, 1000, 21), 999);
    const b = playHandWithAi(makeTable(4, 1000, 21), 999);
    expect(b.log).toEqual(a.log);
    expect(b.seats.map((s) => s.stack)).toEqual(a.seats.map((s) => s.stack));
  });

  it('never calls Math.random (different rng seeds are the only source of variation)', () => {
    const state = flopBetSpot(4);
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random must never be called');
    };
    try {
      for (const archetype of ARCHETYPE_LIST) {
        expect(() => decideActionAs(archetype, state, state.toAct, mulberry32(5))).not.toThrow();
      }
    } finally {
      Math.random = original;
    }
  });
});

// ── Distinct, observable frequencies ────────────────────────────────────────

describe('archetype frequencies', () => {
  const N = 60;

  it('nit folds to a preflop raise more often than tag, and tag more than station', () => {
    const folds = ARCHETYPE_LIST.map(
      (a) => countKinds(sampleSpot(a, preflopRaisedSpot, N)).fold ?? 0,
    );
    const [nit, tag, station] = folds;
    expect(nit).toBeGreaterThan(tag);
    expect(tag).toBeGreaterThan(station);
  });

  it('station calls a flop bet strictly more often than nit does', () => {
    const nitCalls = countKinds(sampleSpot('nit', flopBetSpot, N)).call ?? 0;
    const stationCalls = countKinds(sampleSpot('station', flopBetSpot, N)).call ?? 0;
    expect(stationCalls).toBeGreaterThan(nitCalls);
  });

  it('station almost never folds to a bet', () => {
    const folds = countKinds(sampleSpot('station', flopBetSpot, N)).fold ?? 0;
    expect(folds / N).toBeLessThan(0.3);
  });

  it('nit folds to a bet far more often than it continues', () => {
    const counts = countKinds(sampleSpot('nit', flopBetSpot, N));
    expect((counts.fold ?? 0) / N).toBeGreaterThan(0.6);
  });

  it('tag is the most aggressive facing a bet; station the least', () => {
    const aggression = ARCHETYPE_LIST.map((a) => {
      const counts = countKinds(sampleSpot(a, flopBetSpot, N));
      return (counts.raise ?? 0) + (counts.bet ?? 0) + (counts.allin ?? 0);
    });
    const [nit, tag, station] = aggression;
    expect(tag).toBeGreaterThan(nit);
    expect(tag).toBeGreaterThan(station);
  });

  it('the three archetypes do not produce identical action mixes', () => {
    const mixes = ARCHETYPE_LIST.map((a) =>
      JSON.stringify(countKinds(sampleSpot(a, flopBetSpot, N))),
    );
    expect(new Set(mixes).size).toBe(3);
  });
});

// ── Named behaviours the teaching layer promises ─────────────────────────────

describe('signature behaviours', () => {
  it('a nit folds trash to a big bet, every time', () => {
    const spot = trashVsBigBet();
    for (let seed = 1; seed <= 20; seed++) {
      const action = decideActionAs('nit', spot, spot.toAct, mulberry32(seed));
      expect(action.kind).toBe('fold');
    }
  });

  it('a station calls trash it should fold, most of the time', () => {
    const spot = trashVsBigBet();
    let calls = 0;
    for (let seed = 1; seed <= 20; seed++) {
      if (decideActionAs('station', spot, spot.toAct, mulberry32(seed)).kind === 'call') calls++;
    }
    expect(calls).toBeGreaterThan(12);
  });

  it('every archetype checks back rather than folding when nothing is owed', () => {
    let s = makeTable(3, 1000, 8);
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'call' });
    s = applyAction(s, { kind: 'check' });
    expect(s.street).toBe('flop');
    const spot = JSON.parse(JSON.stringify(s)) as TableState;
    spot.seats[spot.toAct].hole = ['2c', '7d'];
    spot.board = ['As', 'Kd', 'Qh'];
    for (const archetype of ARCHETYPE_LIST) {
      for (let seed = 1; seed <= 10; seed++) {
        const action = decideActionAs(archetype, spot, spot.toAct, mulberry32(seed));
        expect(action.kind).not.toBe('fold');
      }
    }
  });

  it('a nit with the nuts puts money in', () => {
    const state = flopBetSpot(6);
    const spot = JSON.parse(JSON.stringify(state)) as TableState;
    spot.seats[1].hole = ['As', 'Ad'];
    spot.board = ['Ac', 'Ah', 'Kd'];
    let passive = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const action = decideActionAs('nit', spot, spot.toAct, mulberry32(seed));
      expect(action.kind).not.toBe('fold');
      if (action.kind === 'call') passive++;
    }
    expect(passive).toBeLessThan(6); // mostly raising, not just calling
  });
});

// ── Renderer-facing metadata ────────────────────────────────────────────────

describe('archetype metadata', () => {
  it('exposes a label and description for each archetype', () => {
    for (const archetype of ARCHETYPE_LIST) {
      expect(ARCHETYPES[archetype].label.length).toBeGreaterThan(0);
      expect(ARCHETYPES[archetype].description.length).toBeGreaterThan(10);
    }
  });

  it('assigns archetypes cyclically so a 4-seat table shows all three', () => {
    const villains = [1, 2, 3].map(archetypeForSeat);
    expect(new Set(villains).size).toBe(3);
    expect(archetypeForSeat(4)).toBe(archetypeForSeat(1));
  });

  it('decideAction uses the seat archetype', () => {
    const state = flopBetSpot(9);
    const viaSeat = decideAction(state, state.toAct, mulberry32(3));
    const viaArchetype = decideActionAs(
      archetypeForSeat(state.toAct),
      state,
      state.toAct,
      mulberry32(3),
    );
    expect(viaSeat).toEqual(viaArchetype);
  });
});
