/**
 * RELAY CLIENT — the pure client-side state a multiplayer player's UI renders from.
 *
 * The transport (main-process socket, reached over IPC) pushes ServerMessages to the renderer; this
 * reducer folds that stream into the small state a screen needs: the latest redacted view of the
 * table, the most recent error to surface, and whether a connection is live. It has NO socket and NO
 * IPC — it is a pure fold over messages, so the renderer's multiplayer logic is unit-testable without
 * standing up a server, exactly like the room and relay layers below it.
 *
 * The client NEVER computes game state itself. It only ever displays the RoomView the server sent,
 * which is already redacted (no opponent holes, no deck) — so a bug here cannot invent or leak a card,
 * because there is no card here that the server did not already decide to show this player.
 */

import type { RoomView, ServerMessage } from './multiplayer.js';

export interface ClientState {
  /** True once at least one state message has arrived and no disconnect has since been recorded. */
  readonly connected: boolean;
  /** The latest table view the server sent this player, or null before the first one. */
  readonly view: RoomView | null;
  /** The most recent error the server addressed to this player, or null once cleared/superseded. */
  readonly lastError: string | null;
}

/** The state before any message has arrived. */
export function initialClientState(): ClientState {
  return { connected: false, view: null, lastError: null };
}

/**
 * Fold one server message into the client state. A `state` message updates the view, marks the client
 * connected, and clears any stale error (a fresh view means the table moved on). An `error` message
 * records the reason WITHOUT touching the view — an out-of-turn or illegal action leaves the table
 * exactly as it was, and the error is what the UI shows transiently.
 */
export function applyServerMessage(state: ClientState, message: ServerMessage): ClientState {
  switch (message.type) {
    case 'state':
      return { connected: true, view: message.view, lastError: null };
    case 'error':
      return { ...state, lastError: message.reason };
  }
}

/** Record a transport-level disconnect: the connection is down and the last view is stale. */
export function markDisconnected(state: ClientState): ClientState {
  return { ...state, connected: false };
}

/** Clear a surfaced error once the UI has shown it (e.g. after a toast times out). */
export function clearError(state: ClientState): ClientState {
  return { ...state, lastError: null };
}

/** A parsed join target, or a reason the fields could not be turned into one. */
export type JoinAddress = { readonly host: string; readonly port: number } | { readonly error: string };

/**
 * Turn the join box's two fields into a { host, port } to connect to — accepting the whole `host:port`
 * string the host advertises pasted into the host field, so a guest can copy what the host screen shows
 * verbatim instead of splitting it by hand into the two inputs.
 *
 * The host advertises only IPv4 addresses (see relaySession.lanAddresses), so the address is always
 * `a.b.c.d` or `a.b.c.d:port` — a single embedded colon. A bracketed IPv6 literal is not something the
 * host ever hands out and the relay's plain host:port model does not take one, so it is rejected rather
 * than half-parsed. When the host field carries a port, it wins over the separate port field (the guest
 * pasted a complete address); otherwise the port field supplies it.
 */
export function parseJoinAddress(hostField: string, portField: string): JoinAddress {
  const trimmedHost = hostField.trim();
  if (trimmedHost === '') return { error: 'Enter the host address your friend shared.' };
  // A '[' means a bracketed IPv6 literal — not supported by the LAN relay, and left unsplit it would
  // mangle into a bogus host, so refuse it explicitly rather than connect somewhere unintended.
  if (trimmedHost.includes('[') || trimmedHost.includes(']')) {
    return { error: 'Use a plain IPv4 address like 192.168.1.5.' };
  }

  const colonCount = (trimmedHost.match(/:/g) ?? []).length;
  // More than one colon is a bare IPv6 address (no brackets) — same unsupported case, and splitting it
  // would treat a hextet as the port. Refuse.
  if (colonCount > 1) return { error: 'Use a plain IPv4 address like 192.168.1.5.' };

  let host = trimmedHost;
  let portText = portField.trim();
  if (colonCount === 1) {
    const [addr, embeddedPort] = trimmedHost.split(':');
    host = addr.trim();
    // A pasted complete address wins over the separate port field.
    portText = embeddedPort.trim();
    if (host === '') return { error: 'Enter the host address your friend shared.' };
  }

  if (portText === '') return { error: 'Enter the port your friend shared.' };
  // Only whole numbers — Number('50000abc') is NaN and Number('5.5') is a non-port; a port is 1..65535.
  if (!/^\d+$/.test(portText)) return { error: 'The port must be a number.' };
  const port = Number(portText);
  if (port < 1 || port > 65535) return { error: 'The port must be between 1 and 65535.' };

  return { host, port };
}
