import { describe, expect, it } from 'vitest';
import {
  applyServerMessage,
  clearError,
  initialClientState,
  markDisconnected,
  parseJoinAddress,
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

describe('parseJoinAddress — the join box accepts a pasted host:port', () => {
  it('combines the two separate fields when the host carries no port', () => {
    expect(parseJoinAddress('192.168.1.5', '50000')).toEqual({ host: '192.168.1.5', port: 50000 });
  });

  it('accepts a whole host:port pasted into the host field (what the host advertises)', () => {
    // The guest copies "192.168.1.5:50000" from the host screen straight into the host box; the separate
    // port field is left empty and must not be required.
    expect(parseJoinAddress('192.168.1.5:50000', '')).toEqual({ host: '192.168.1.5', port: 50000 });
  });

  it('lets an embedded port win over the separate port field', () => {
    // A pasted complete address is the guest's clear intent; a leftover value in the port field must not
    // override it (else pasting over a stale port connects to the wrong place).
    expect(parseJoinAddress('192.168.1.5:50000', '25')).toEqual({ host: '192.168.1.5', port: 50000 });
  });

  it('trims surrounding whitespace on both fields', () => {
    expect(parseJoinAddress('  10.0.0.9  ', '  6000 ')).toEqual({ host: '10.0.0.9', port: 6000 });
  });

  it('rejects an empty host', () => {
    expect(parseJoinAddress('   ', '50000')).toEqual({ error: expect.stringContaining('host') });
  });

  it('rejects a missing port when neither field supplies one', () => {
    expect(parseJoinAddress('192.168.1.5', '')).toEqual({ error: expect.stringContaining('port') });
  });

  it('rejects a non-numeric port', () => {
    expect(parseJoinAddress('192.168.1.5', '50000abc')).toEqual({ error: expect.stringContaining('number') });
    // A decimal is not a port either — /^\d+$/ rejects it rather than Math.floor-ing silently.
    expect('error' in parseJoinAddress('192.168.1.5', '5.5')).toBe(true);
  });

  it('rejects a port out of the 1..65535 range', () => {
    expect('error' in parseJoinAddress('192.168.1.5', '0')).toBe(true);
    expect('error' in parseJoinAddress('192.168.1.5', '70000')).toBe(true);
    // The boundaries themselves are valid.
    expect(parseJoinAddress('192.168.1.5', '65535')).toEqual({ host: '192.168.1.5', port: 65535 });
    expect(parseJoinAddress('192.168.1.5', '1')).toEqual({ host: '192.168.1.5', port: 1 });
  });

  it('refuses an IPv6 literal rather than mangling it (the LAN relay is IPv4 host:port only)', () => {
    // A bare IPv6 address has multiple colons; splitting on the first would treat a hextet as the port.
    expect('error' in parseJoinAddress('fe80::1', '50000')).toBe(true);
    // A bracketed IPv6 literal is likewise unsupported and refused explicitly.
    expect('error' in parseJoinAddress('[fe80::1]:50000', '')).toBe(true);
  });
});
