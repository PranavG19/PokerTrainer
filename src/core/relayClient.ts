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
