import '../styles-multiplayer.css';
import type { Action } from '../../core/table.js';
import type { RoomView, ServerMessage } from '../../core/multiplayer.js';
import { applyServerMessage, initialClientState, type ClientState } from '../../core/relayClient.js';
import { renderCard, renderCardRow } from '../components/card.js';

/**
 * MULTIPLAYER screen — host or join a local-relay table and play it.
 *
 * The socket lives in the main process behind an opt-in; this screen only ever calls the bridge
 * (mpHost/mpJoin/mpAction/mpDeal) and renders the REDACTED RoomView that main pushes on 'mp:event'.
 * Because a view already hides opponents' holes (they arrive as null), rendering is trivial and cannot
 * leak: an opponent seat shows a face-down card because there is no card here to show.
 *
 * Sync for e2e: the root publishes data-mp-phase ('setup' | 'connecting' | 'playing') and
 * data-mp-role ('host' | 'join' | '') so a test never sleeps.
 */

/** The subset of the preload bridge this screen needs; all optional (absent in a plain browser). */
export interface MultiplayerBridge {
  mpStatus?: () => Promise<{ enabled: boolean; active: boolean }>;
  mpSetEnabled?: (enabled: boolean) => Promise<boolean>;
  mpHost?: (opts: { seatCount?: number }) => Promise<{ port?: number; error?: string }>;
  mpJoin?: (address: { host: string; port: number; name?: string }) => Promise<{ joined?: boolean; error?: string }>;
  mpAction?: (action: unknown) => Promise<void>;
  mpDeal?: () => Promise<void>;
  mpStop?: () => Promise<void>;
  onMpEvent?: (handler: (event: unknown) => void) => () => void;
}

export interface MultiplayerOptions {
  readonly bridge: MultiplayerBridge;
  /** Leave multiplayer and return home; the screen stops its session first. */
  readonly onExit?: () => void;
}

export function renderMultiplayerScreen(options: MultiplayerOptions): HTMLElement {
  const { bridge } = options;
  const root = document.createElement('div');
  root.className = 'mp-screen';
  root.dataset.testid = 'mp-screen';

  let client: ClientState = initialClientState();
  let role: '' | 'host' | 'join' = '';
  let phase: 'setup' | 'connecting' | 'playing' = 'setup';
  let hostPort: number | null = null;
  let notice = '';
  let enabled = false;

  // Subscribe to pushed relay events for this screen's lifetime; unsubscribe when it leaves the DOM.
  const unsubscribe = bridge.onMpEvent?.((event) => {
    const message = event as ServerMessage;
    if (message?.type !== 'state' && message?.type !== 'error') return;
    client = applyServerMessage(client, message);
    // Switch to the table only once a real hand has been DEALT. The first broadcast a host gets is the
    // empty waiting room (handNumber 0, table null) from seating itself — staying in 'connecting' then
    // keeps the shareable port on screen until a second player joins and the first hand is dealt.
    if (message.type === 'state' && message.view.handNumber >= 1) phase = 'playing';
    paint();
  });

  function cleanup(): void {
    unsubscribe?.();
    void bridge.mpStop?.();
  }

  /** Poll the opt-in status once at mount so the panel shows whether MP is enabled. */
  void bridge.mpStatus?.().then((status) => {
    enabled = status.enabled;
    paint();
  });

  async function enable(): Promise<void> {
    enabled = (await bridge.mpSetEnabled?.(true)) ?? false;
    paint();
  }

  async function host(): Promise<void> {
    role = 'host';
    phase = 'connecting';
    notice = '';
    paint();
    const result = await bridge.mpHost?.({ seatCount: 2 });
    if (result?.error) {
      notice = result.error;
      phase = 'setup';
      role = '';
    } else {
      hostPort = result?.port ?? null;
    }
    paint();
  }

  async function join(hostAddr: string, port: number): Promise<void> {
    role = 'join';
    phase = 'connecting';
    notice = '';
    paint();
    const result = await bridge.mpJoin?.({ host: hostAddr, port, name: 'Guest' });
    if (result?.error) {
      notice = result.error;
      phase = 'setup';
      role = '';
    }
    paint();
  }

  function sendAction(action: Action): void {
    void bridge.mpAction?.(action);
  }

  // ── rendering ───────────────────────────────────────────────────────────────

  // True once the screen has been in the DOM at least once. The initial synchronous paint() runs
  // BEFORE the returned root is appended, so isConnected is false then — without this flag that first
  // paint would mistake "not yet mounted" for "removed" and tear down the event subscription instantly.
  let hasMounted = false;

  function paint(): void {
    root.dataset.mpPhase = phase;
    root.dataset.mpRole = role;
    if (root.isConnected) hasMounted = true;
    else if (hasMounted && unsubscribe) {
      // The screen was mounted and is now gone (tab switch / exit); stop listening and drop the session.
      cleanup();
      return;
    }
    root.replaceChildren(header(), phase === 'playing' ? table() : setupPanel());
  }

  function header(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mp-header';
    const title = document.createElement('h2');
    title.className = 'mp-title';
    title.dataset.testid = 'mp-title';
    title.textContent = 'Play with friends';
    el.appendChild(title);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pill';
    back.dataset.testid = 'mp-exit';
    back.textContent = 'Leave';
    back.addEventListener('click', () => {
      cleanup();
      options.onExit?.();
    });
    el.appendChild(back);
    return el;
  }

  function setupPanel(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mp-setup';
    el.dataset.testid = 'mp-setup';

    if (notice) {
      const n = document.createElement('div');
      n.className = 'mp-notice';
      n.dataset.testid = 'mp-notice';
      n.textContent = notice;
      el.appendChild(n);
    }

    if (!enabled) {
      // The opt-in gate: multiplayer opens a network socket, so it is off until the learner turns it on.
      const explain = document.createElement('p');
      explain.className = 'mp-explain';
      explain.dataset.testid = 'mp-disabled';
      explain.textContent =
        'Multiplayer connects over your local network, so it is off by default. Turn it on to host or join a table.';
      el.appendChild(explain);

      const enableBtn = document.createElement('button');
      enableBtn.type = 'button';
      enableBtn.className = 'pill';
      enableBtn.dataset.testid = 'mp-enable';
      enableBtn.textContent = 'Enable multiplayer';
      enableBtn.addEventListener('click', () => void enable());
      el.appendChild(enableBtn);
      return el;
    }

    if (phase === 'connecting') {
      const status = document.createElement('div');
      status.className = 'mp-connecting';
      status.dataset.testid = 'mp-connecting';
      status.textContent = role === 'host' ? 'Starting a table…' : 'Connecting…';
      el.appendChild(status);
      if (role === 'host' && hostPort !== null) {
        const share = document.createElement('div');
        share.className = 'mp-share';
        share.dataset.testid = 'mp-host-port';
        share.dataset.port = String(hostPort);
        share.textContent = `Share this port with a friend on your network: ${hostPort}`;
        el.appendChild(share);
      }
      return el;
    }

    // Host / join choice.
    const hostBtn = document.createElement('button');
    hostBtn.type = 'button';
    hostBtn.className = 'pill';
    hostBtn.dataset.testid = 'mp-host';
    hostBtn.textContent = 'Host a table';
    hostBtn.addEventListener('click', () => void host());
    el.appendChild(hostBtn);

    const joinRow = document.createElement('div');
    joinRow.className = 'mp-join-row';

    const hostInput = document.createElement('input');
    hostInput.type = 'text';
    hostInput.className = 'mp-input';
    hostInput.dataset.testid = 'mp-join-host';
    hostInput.placeholder = 'Host (e.g. 127.0.0.1)';
    hostInput.value = '127.0.0.1';
    joinRow.appendChild(hostInput);

    const portInput = document.createElement('input');
    portInput.type = 'number';
    portInput.className = 'mp-input';
    portInput.dataset.testid = 'mp-join-port';
    portInput.placeholder = 'Port';
    joinRow.appendChild(portInput);

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'pill';
    joinBtn.dataset.testid = 'mp-join';
    joinBtn.textContent = 'Join a table';
    joinBtn.addEventListener('click', () => {
      const port = Number(portInput.value);
      if (!Number.isFinite(port) || port <= 0) {
        notice = 'Enter the port your host shared.';
        paint();
        return;
      }
      void join(hostInput.value.trim() || '127.0.0.1', port);
    });
    joinRow.appendChild(joinBtn);
    el.appendChild(joinRow);
    return el;
  }

  function table(): HTMLElement {
    const view = client.view;
    const el = document.createElement('div');
    el.className = 'mp-table';
    el.dataset.testid = 'mp-table';
    if (view === null) {
      el.textContent = 'Waiting for the table…';
      return el;
    }

    if (client.lastError) {
      const err = document.createElement('div');
      err.className = 'mp-notice';
      err.dataset.testid = 'mp-error';
      err.textContent = client.lastError;
      el.appendChild(err);
    }

    const potLine = document.createElement('div');
    potLine.className = 'mp-pot';
    potLine.dataset.testid = 'mp-pot';
    potLine.textContent = `Pot ${view.pot}`;
    el.appendChild(potLine);

    const board = renderCardRow(view.board.length ? [...view.board] : [], { small: true });
    board.dataset.testid = 'mp-board';
    el.appendChild(board);

    const seats = document.createElement('div');
    seats.className = 'mp-seats';
    for (const seat of view.seats) {
      seats.appendChild(seatRow(seat, view));
    }
    el.appendChild(seats);

    el.appendChild(controls(view));
    return el;
  }

  function seatRow(seat: RoomView['seats'][number], view: RoomView): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mp-seat';
    row.dataset.testid = 'mp-seat';
    row.dataset.seatId = String(seat.id);
    row.dataset.you = String(seat.isYou);
    row.dataset.folded = String(seat.folded);
    if (view.toAct === seat.id && view.winners === null) row.dataset.toAct = 'true';

    const name = document.createElement('span');
    name.className = 'mp-seat-name';
    name.textContent = seat.isYou ? `${seat.name} (you)` : seat.name;
    row.appendChild(name);

    // The redaction made visible: the player's own cards face up, everyone else face down (hole===null).
    const cards = document.createElement('span');
    cards.className = 'mp-seat-cards';
    if (seat.hole !== null) {
      for (const card of seat.hole) cards.appendChild(renderCard(card, { small: true }));
    } else if (!seat.folded) {
      cards.appendChild(renderCard(null, { faceDown: true, small: true }));
      cards.appendChild(renderCard(null, { faceDown: true, small: true }));
    }
    row.appendChild(cards);

    const stack = document.createElement('span');
    stack.className = 'mp-seat-stack';
    stack.textContent = `${seat.stack}`;
    row.appendChild(stack);
    return row;
  }

  function controls(view: RoomView): HTMLElement {
    const el = document.createElement('div');
    el.className = 'mp-controls';
    el.dataset.testid = 'mp-controls';

    if (view.winners !== null) {
      // Hand over: only the host can deal the next one (a joined client's deal is a no-op in main).
      const deal = document.createElement('button');
      deal.type = 'button';
      deal.className = 'pill';
      deal.dataset.testid = 'mp-deal';
      deal.textContent = 'Next hand';
      deal.addEventListener('click', () => void bridge.mpDeal?.());
      el.appendChild(deal);
      return el;
    }

    for (const kind of ['fold', 'check', 'call', 'bet', 'raise'] as Action['kind'][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.dataset.testid = `mp-${kind}`;
      b.textContent = kind.charAt(0).toUpperCase() + kind.slice(1);
      b.disabled = !view.yourTurn || !view.legal.includes(kind);
      b.addEventListener('click', () => sendAction({ kind }));
      el.appendChild(b);
    }
    return el;
  }

  paint();
  return root;
}
