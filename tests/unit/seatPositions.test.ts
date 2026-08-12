import { describe, expect, it } from 'vitest';
import { seatPositions } from '../../src/core/seatPositions.js';

/**
 * SEAT POSITIONS — the pure label derivation. The load-bearing property is that BTN/SB/BB match where
 * the engine actually posts blinds, including the heads-up special case (button IS the small blind).
 */

const funded = (n: number): boolean[] => new Array(n).fill(true);

describe('seatPositions', () => {
  it('heads-up: the button is the small blind, the other seat the big blind', () => {
    // Two funded seats, button on 0 → SB=0 (the button), BB=1. This is the engine's isHeadsUp branch.
    expect(seatPositions(0, funded(2))).toEqual(['SB', 'BB']);
    expect(seatPositions(1, funded(2))).toEqual(['BB', 'SB']);
  });

  it('three-handed: BTN, then SB and BB to its left', () => {
    // Button on 0 → SB=1, BB=2. Everyone is a blind or the button; no UTG seat.
    expect(seatPositions(0, funded(3))).toEqual(['BTN', 'SB', 'BB']);
    // Button on 2 → SB=0, BB=1.
    expect(seatPositions(2, funded(3))).toEqual(['SB', 'BB', 'BTN']);
  });

  it('six-handed: UTG ordering runs from left of the BB around to the button', () => {
    // Button on 0 → SB=1, BB=2, then UTG=3, UTG+1=4, UTG+2=5 (the seat before the button).
    expect(seatPositions(0, funded(6))).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2']);
  });

  it('skips sitting-out (unfunded) seats for the button, blinds, and order', () => {
    // Seats 1 and 3 are busted. Funded: 0,2,4,5. Button on 0 → SB is next funded (2), BB next (4),
    // then UTG=5. The unfunded seats get no label.
    const f = [true, false, true, false, true, true];
    expect(seatPositions(0, f)).toEqual(['BTN', null, 'SB', null, 'BB', 'UTG']);
  });

  it('returns all-null when fewer than two seats are funded or the dealer is invalid', () => {
    expect(seatPositions(0, [true, false, false])).toEqual([null, null, null]);
    expect(seatPositions(0, [])).toEqual([]);
    // Dealer on an unfunded seat is not a real hand state; label nothing rather than guess.
    expect(seatPositions(1, [true, false, true])).toEqual([null, null, null]);
  });

  it('heads-up among many chairs: only the two funded seats are labelled, button as SB', () => {
    // Four chairs, only 0 and 2 funded — the engine treats this as heads-up. Button on 2 → SB=2, BB=0.
    const f = [true, false, true, false];
    expect(seatPositions(2, f)).toEqual(['BB', null, 'SB', null]);
  });
});
