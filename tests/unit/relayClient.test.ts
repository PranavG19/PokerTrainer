import { describe, expect, it } from 'vitest';
import {
  applyServerMessage,
  clearError,
  initialClientState,
  markDisconnected,
} from '../../src/core/relayClient.js';
import type { RoomView, ServerMessage } from '../../src/core/multiplayer.js';

/**
 * RELAY CLIENT — the pure fold over the server's pushed messages that a multiplayer screen renders.
 * No socket, no IPC: just the state machine.
 */

const view = (handNumber: number): RoomView => ({
  roomId: 'r1',
  you: 'a',
  seats: [
    { id: 0, name: 'You', stack: 5000, committed: 0, folded: false, allIn: false, hole: ['As', 'Ks'], isYou: true },
    { id: 1, name: 'Bob', stack: 5000, committed: 0, folded: false, allIn: false, hole: null, isYou: false },
  ],
  board: [],
  street: 'preflop',
  pot: 75,
  currentBet: 50,
  toAct: 0,
  dealer: 0,
  handNumber,
  winners: null,
  legal: ['fold', 'call', 'raise'],
  yourTurn: true,
});

const stateMsg = (n: number): ServerMessage => ({ type: 'state', view: view(n) });
const errorMsg = (reason: string): ServerMessage => ({ type: 'error', reason });

describe('relay client reducer', () => {
  it('starts empty and disconnected', () => {
    expect(initialClientState()).toEqual({ connected: false, view: null, lastError: null });
  });

  it('a state message connects the client and stores the view', () => {
    const s = applyServerMessage(initialClientState(), stateMsg(1));
    expect(s.connected).toBe(true);
    expect(s.view?.handNumber).toBe(1);
    expect(s.lastError).toBeNull();
  });

  it('an error is recorded WITHOUT disturbing the current view', () => {
    const withView = applyServerMessage(initialClientState(), stateMsg(1));
    const withError = applyServerMessage(withView, errorMsg('not your turn'));
    expect(withError.lastError).toBe('not your turn');
    // The table did not move: an illegal action leaves the view exactly as it was.
    expect(withError.view).toBe(withView.view);
    expect(withError.connected).toBe(true);
  });

  it('a fresh state message clears a stale error', () => {
    let s = applyServerMessage(initialClientState(), stateMsg(1));
    s = applyServerMessage(s, errorMsg('illegal action: check'));
    expect(s.lastError).toBe('illegal action: check');
    s = applyServerMessage(s, stateMsg(2));
    expect(s.lastError, 'a new view means the table moved on, so the stale error is cleared').toBeNull();
    expect(s.view?.handNumber).toBe(2);
  });

  it('markDisconnected drops the connection but keeps the last view for display', () => {
    let s = applyServerMessage(initialClientState(), stateMsg(1));
    s = markDisconnected(s);
    expect(s.connected).toBe(false);
    expect(s.view?.handNumber, 'the last view stays so the screen is not blanked').toBe(1);
  });

  it('clearError removes a surfaced error once shown', () => {
    let s = applyServerMessage(initialClientState(), errorMsg('room is full'));
    expect(s.lastError).toBe('room is full');
    s = clearError(s);
    expect(s.lastError).toBeNull();
  });
});
