import { describe, it, expect } from 'vitest';
import { RANKS } from '../../src/core/cards.js';
import {
  ALL_COMBOS,
  threeBetResponseAction,
  threeBetResponseWidth,
  THREEBET_RESPONSE_WIDTH_ORDER,
  type ThreeBetResponsePosition,
} from '../../src/core/preflop.js';

/** cards.ts RANKS is low-to-high ('2'..'A'), so a HIGHER index = stronger rank — the same rankIndex
 *  preflop.ts uses internally. A valid hi-lo combo has rankIndex(lo) < rankIndex(hi). */
const rankIndex = (rank: string): number => (RANKS as readonly string[]).indexOf(rank);

/**
 * FACING-A-3-BET RESPONSE RANGES — the opener, having raised, now faces a 3-bet and must 4-bet / call /
 * fold. Same honesty discipline as the defense ranges (offsuit-defense-range-model): a PURE (no mixed
 * frequency) beginner simplification, value-only 4-bets, validated by STRUCTURAL INVARIANTS plus pinned
 * sample boundaries rather than trusting a self-referential grid snapshot. The invariants are what a
 * silent edit to THREEBET_RESPONSE_SPECS cannot satisfy by accident.
 */

const POSITIONS = THREEBET_RESPONSE_WIDTH_ORDER;

describe('threeBetResponseAction — structural invariants', () => {
  it('every combo grades to exactly one of the three actions', () => {
    for (const pos of POSITIONS) {
      for (const combo of ALL_COMBOS) {
        expect(['threebet', 'call', 'fold'], `${combo} @ ${pos}`).toContain(
          threeBetResponseAction(combo, pos),
        );
      }
    }
  });

  it('4-bet takes precedence: the top value is never mis-graded as a flat', () => {
    // AA and AK are a value 4-bet from every opening position; if precedence (fourBet-first) were wrong
    // they would read as 'call', because the floor-only model makes every 4-bet combo also satisfy the
    // wider call thresholds.
    for (const pos of POSITIONS) {
      expect(threeBetResponseAction('AA', pos), `AA @ ${pos}`).toBe('threebet');
      expect(threeBetResponseAction('AKs', pos), `AKs @ ${pos}`).toBe('threebet');
      expect(threeBetResponseAction('AKo', pos), `AKo @ ${pos}`).toBe('threebet');
    }
  });

  it('continue width strictly increases UTG < HJ < CO < BTN', () => {
    // A tight opener (UTG) faces a tighter, more credible 3-bet and continues narrowly; a wide opener
    // (BTN) faces a wider, bluff-heavier 3-bet and both 4-bets and flats more. Backwards teaches the
    // opposite of play, so this ordering is load-bearing.
    const w = (p: ThreeBetResponsePosition) => threeBetResponseWidth(p);
    expect(w('UTG')).toBeLessThan(w('HJ'));
    expect(w('HJ')).toBeLessThan(w('CO'));
    expect(w('CO')).toBeLessThan(w('BTN'));
  });

  it('is monotonic within a suited/offsuit row — a stronger kicker never folds while a weaker one continues', () => {
    // For each ace-x row, walk kickers from high to low: once the action drops to fold it must stay
    // fold (the threshold model is a single floor per row, so a "gap" would be an authoring error).
    const kickers = ['K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
    for (const pos of POSITIONS) {
      for (const hi of ['A', 'K', 'Q'] as const) {
        for (const suit of ['s', 'o'] as const) {
          let foldedYet = false;
          for (const lo of kickers) {
            if (rankIndex(lo) >= rankIndex(hi)) continue; // not a valid hi-lo combo in this row
            const combo = `${hi}${lo}${suit}`;
            const continues = threeBetResponseAction(combo, pos) !== 'fold';
            if (foldedYet) {
              expect(continues, `${combo} @ ${pos} continues after a weaker kicker already folded`).toBe(
                false,
              );
            }
            if (!continues) foldedYet = true;
          }
        }
      }
    }
  });
});

describe('threeBetResponseAction — pinned sample boundaries (the authored thresholds)', () => {
  // UTG opened: continue tightest. 4-bet QQ+/AK; flat TT-JJ, AQs, KQs; fold the rest.
  it('UTG: QQ+ and AK 4-bet, TT/JJ/AQs/KQs flat, weaker folds', () => {
    expect(threeBetResponseAction('QQ', 'UTG')).toBe('threebet');
    expect(threeBetResponseAction('JJ', 'UTG')).toBe('call');
    expect(threeBetResponseAction('TT', 'UTG')).toBe('call');
    expect(threeBetResponseAction('99', 'UTG')).toBe('fold');
    expect(threeBetResponseAction('AQs', 'UTG')).toBe('call');
    expect(threeBetResponseAction('KQs', 'UTG')).toBe('call');
    expect(threeBetResponseAction('AJs', 'UTG')).toBe('fold');
    expect(threeBetResponseAction('AQo', 'UTG')).toBe('fold');
  });

  // BTN opened widest: continue widest. 4-bet TT+/AQs+/AK; flat 77+, suited broadways, KQo.
  it('BTN: TT+ 4-bet, 77-99 and suited broadways flat, offsuit-broadway boundary at KQo', () => {
    expect(threeBetResponseAction('TT', 'BTN')).toBe('threebet');
    expect(threeBetResponseAction('99', 'BTN')).toBe('call');
    expect(threeBetResponseAction('77', 'BTN')).toBe('call');
    expect(threeBetResponseAction('66', 'BTN')).toBe('fold');
    expect(threeBetResponseAction('AQs', 'BTN')).toBe('threebet');
    expect(threeBetResponseAction('AJs', 'BTN')).toBe('call');
    expect(threeBetResponseAction('KQo', 'BTN')).toBe('call');
    expect(threeBetResponseAction('KJo', 'BTN')).toBe('fold');
  });

  it('a wide opener flats hands a tight opener folds (the width ordering, made concrete)', () => {
    // 88 is a fold facing a 3-bet as a UTG opener but a flat as a BTN opener.
    expect(threeBetResponseAction('88', 'UTG')).toBe('fold');
    expect(threeBetResponseAction('88', 'BTN')).toBe('call');
  });

  it('CO flats no offsuit hands — AQo is 4-bet-or-fold OOP, not a pure flat', () => {
    // An adversarial range audit flagged CO AQo as the worst inclusion: CO is frequently out of
    // position vs a button 3-bettor and AQo is reverse-dominated, so it folds rather than pure-flats.
    // The ace-blocker offsuit flat survives only on the button, where the opener is always in position.
    expect(threeBetResponseAction('AQo', 'CO')).toBe('fold');
    expect(threeBetResponseAction('AQo', 'BTN')).toBe('call');
  });
});
