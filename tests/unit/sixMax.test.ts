import { describe, expect, it } from 'vitest';
import { applyAction, createTable, startHand, type TableState } from '../../src/core/table.js';
import { chartSeats, chartSpotFor } from '../../src/core/gradeSpot.js';
import { ARCHETYPE_NAMES } from '../../src/core/archetypes.js';
import { seatNamesFor, villainArchetypes } from '../../src/core/tableSize.js';

/**
 * 6-MAX (BUILD-PLAN 2.12). The load-bearing properties: the button and blinds rotate one seat a hand over six
 * seats; every seat reads its real 6-max chart (UTG, HJ, CO, BTN, SB, BB) with no mapping; the seated archetypes
 * are five distinct ones whose first three are exactly the 4-max table's, so a seed seats the same regulars.
 */

function sixHanded(seed = 11): TableState {
  const table = createTable({
    seats: seatNamesFor(6).map((name, i) => ({ name, stack: 5000, isHero: i === 0, avatar: name[0] })),
    sb: 25,
    bb: 50,
    seed,
  });
  return startHand(table);
}

/** Fold round to the big blind, so the hand ends and the next one deals. */
function foldToBigBlind(s: TableState): TableState {
  let state = s;
  while (state.winners === null && state.street === 'preflop' && state.seats.filter((x) => !x.folded).length > 1) {
    state = applyAction(state, { kind: 'fold' });
  }
  return state;
}

describe('the 6-max seats', () => {
  it('six distinct names with distinct initials, the 4-max four first', () => {
    const six = seatNamesFor(6);
    expect(six).toHaveLength(6);
    expect(six.slice(0, 4)).toEqual(seatNamesFor(4));
    expect(seatNamesFor(4)).toEqual(['You', 'Ada', 'Bo', 'Cy']);
    expect(new Set(six).size).toBe(6);
    expect(new Set(six.map((n) => n[0])).size).toBe(6);
  });

  it('five distinct archetypes, the first three the 4-max draw for the same seed, all six seen over seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const six = villainArchetypes(seed, 6);
      expect(six).toHaveLength(5);
      expect(new Set(six).size).toBe(5);
      expect(six.slice(0, 3)).toEqual(villainArchetypes(seed, 4));
      six.forEach((a) => seen.add(a));
    }
    expect([...seen].sort()).toEqual([...ARCHETYPE_NAMES].sort());
  });
});

describe('6-max blinds and button rotation', () => {
  it('the button moves one seat a hand, the blinds post left of it, and UTG acts first', () => {
    let s = sixHanded();
    for (let hand = 0; hand < 7; hand++) {
      const btn = hand % 6;
      expect(s.dealer, `hand ${hand + 1} button`).toBe(btn);
      expect(s.log[0]).toBe(`${s.seats[(btn + 1) % 6].name} posts SB 25`);
      expect(s.log[1]).toBe(`${s.seats[(btn + 2) % 6].name} posts BB 50`);
      expect(s.toAct, `hand ${hand + 1} first to act`).toBe((btn + 3) % 6);
      s = startHand(foldToBigBlind(s));
    }
  });

  it('each seat wears UTG, HJ, CO, BTN, SB, BB in turn as the button moves', () => {
    let s = sixHanded();
    const order = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    for (let hand = 0; hand < 6; hand++) {
      const labels = chartSeats(s);
      for (let seat = 0; seat < 6; seat++) expect(labels[seat]).toBe(order[(seat - hand + 6) % 6]);
      s = startHand(foldToBigBlind(s));
    }
  });

  it('a busted seat sits out: five funded seats read HJ, CO, BTN, SB, BB', () => {
    let s = createTable({
      seats: seatNamesFor(6).map((name, i) => ({ name, stack: i === 4 ? 0 : 5000, isHero: i === 0 })),
      sb: 25,
      bb: 50,
      seed: 3,
    });
    s = startHand(s);
    expect(chartSeats(s)).toEqual(['BTN', 'SB', 'BB', 'HJ', null, 'CO']);
  });
});

describe('6-max preflop grading reads the 6-max charts', () => {
  it('first in: UTG, then HJ, CO, BTN and SB each open their own chart', () => {
    let s = sixHanded();
    expect(s.toAct).toBe(3);
    for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      expect(chartSpotFor(s)).toEqual({ kind: 'rfi', position });
      s = applyAction(s, { kind: 'fold' });
    }
  });

  it('the big blind defends against the opener it faces, from UTG to the small blind', () => {
    const cases = [
      { opener: 3, spot: 'bb-vs-utg' },
      { opener: 4, spot: 'bb-vs-hj' },
      { opener: 5, spot: 'bb-vs-co' },
      { opener: 0, spot: 'bb-vs-btn' },
      { opener: 1, spot: 'bb-vs-sb' },
    ] as const;
    for (const { opener, spot } of cases) {
      let s = sixHanded();
      while (s.toAct !== opener) s = applyAction(s, { kind: 'fold' });
      s = applyAction(s, { kind: 'raise', amount: 125 });
      while (s.toAct !== 2) s = applyAction(s, { kind: 'fold' });
      expect(chartSpotFor(s), `vs seat ${opener}`).toEqual({ kind: 'defend', spot });
    }
  });

  it('the small blind against a button open reads sb-vs-btn; a HJ opener facing a 3-bet reads its response chart', () => {
    let s = sixHanded();
    s = applyAction(s, { kind: 'fold' }); // UTG
    s = applyAction(s, { kind: 'fold' }); // HJ
    s = applyAction(s, { kind: 'fold' }); // CO
    s = applyAction(s, { kind: 'raise', amount: 125 }); // BTN opens
    expect(chartSpotFor(s)).toEqual({ kind: 'defend', spot: 'sb-vs-btn' });

    let t = sixHanded();
    t = applyAction(t, { kind: 'fold' }); // UTG
    t = applyAction(t, { kind: 'raise', amount: 125 }); // HJ opens
    t = applyAction(t, { kind: 'raise', amount: 400 }); // CO 3-bets
    while (t.toAct !== 4) t = applyAction(t, { kind: 'fold' });
    expect(chartSpotFor(t)).toEqual({ kind: '3bet', opener: 'HJ' });
  });
});
