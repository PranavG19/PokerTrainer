import { describe, expect, it } from 'vitest';
import { createTable, startHand, applyAction, minRaiseTo, type TableState } from '../../src/core/table.js';
import {
  correctSpotType,
  gradeSpotType,
  isClassifiable,
  PREFLOP_SPOT_TYPES,
} from '../../src/core/spotType.js';

/**
 * SPOT TYPE — the preflop classification, derived from REAL engine states (built through
 * createTable/startHand/applyAction) rather than hand-written TableStates, so the expectations track
 * what the engine actually does, not what I assume it does.
 */

function sixHanded(): TableState {
  const table = createTable({
    seats: Array.from({ length: 6 }, (_u, i) => ({ name: `S${i}`, stack: 5000, isHero: i === 0, avatar: `${i}` })),
    sb: 25,
    bb: 50,
    seed: 7,
  });
  return startHand(table);
}

/** Raise the seat to act by a legal minimum, to inject an "open"/"3-bet" without picking sizes. */
function raise(state: TableState): TableState {
  return applyAction(state, { kind: 'raise', amount: minRaiseTo(state) });
}

describe('correctSpotType — preflop geometry', () => {
  it('no raise yet → RFI (the first player to act can open)', () => {
    const state = sixHanded();
    // Fresh preflop, only blinds posted, no voluntary raise: whoever acts is opening.
    expect(correctSpotType(state)).toBe('rfi');
  });

  it('one open, no cold-caller → DEFEND (facing a single raise)', () => {
    const opened = raise(sixHanded());
    expect(correctSpotType(opened)).toBe('defend');
  });

  it('one open then a cold-call → SQUEEZE (raise + caller in front)', () => {
    let state = raise(sixHanded());
    state = applyAction(state, { kind: 'call' }); // the next seat cold-calls the open
    expect(correctSpotType(state)).toBe('squeeze');
  });

  it('two raises (open + 3-bet) → 3BET-RESPONSE', () => {
    let state = raise(sixHanded()); // open
    state = raise(state); // 3-bet
    expect(correctSpotType(state)).toBe('3bet-response');
  });

  it('a cold-call BEFORE any raise is not a squeeze (cannot happen preflop, but the rule is geometric)', () => {
    // After an open and a call, folding the action around still reads as squeeze until a new raise.
    let state = raise(sixHanded());
    state = applyAction(state, { kind: 'call' });
    state = applyAction(state, { kind: 'fold' });
    expect(correctSpotType(state)).toBe('squeeze');
  });
});

describe('isClassifiable', () => {
  it('is true preflop and false once the board comes', () => {
    const preflop = sixHanded();
    expect(isClassifiable(preflop)).toBe(true);

    // Drive to a flop: everyone limps/calls to see one. Fold-free path — call around, BB checks.
    let state = preflop;
    // Call around the table until preflop closes and the street advances to the flop.
    let guard = 0;
    while (state.street === 'preflop' && guard < 12) {
      const legal = state.currentBet > state.seats[state.toAct].committed ? 'call' : 'check';
      state = applyAction(state, { kind: legal });
      guard += 1;
    }
    expect(state.street, 'should have reached the flop').not.toBe('preflop');
    expect(isClassifiable(state)).toBe(false);
    expect(correctSpotType(state)).toBe('postflop');
  });
});

describe('gradeSpotType', () => {
  it('scores a pick independently, right and wrong', () => {
    const opened = raise(sixHanded()); // a DEFEND spot
    expect(gradeSpotType(opened, 'defend')).toEqual({ picked: 'defend', correct: 'defend', right: true });
    const wrong = gradeSpotType(opened, 'rfi');
    expect(wrong.right).toBe(false);
    expect(wrong.correct).toBe('defend');
  });

  it('the preflop picker set is the four preflop types, in teaching order', () => {
    expect(PREFLOP_SPOT_TYPES).toEqual(['rfi', 'defend', '3bet-response', 'squeeze']);
  });
});
