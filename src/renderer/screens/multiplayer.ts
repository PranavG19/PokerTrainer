import '../styles-multiplayer.css';
import type { Action } from '../../core/table.js';
import type { RoomView, ServerMessage } from '../../core/multiplayer.js';
import {
  applyServerMessage,
  initialClientState,
  parseJoinAddress,
  type ClientState,
} from '../../core/relayClient.js';
import { renderCard, renderCardRow } from '../components/card.js';
import { seatPositions } from '../../core/seatPositions.js';

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
  mpHost?: (opts: { seatCount?: number }) => Promise<{ port?: number; addresses?: string[]; error?: string }>;
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
  let hostAddresses: string[] = [];
  let notice = '';
  let enabled = false;
  // How many seats a hosted table has (2–6). The whole point of multiplayer is multi-way play, so the
  // host picks the size; the main handler clamps it to 2..6 as a backstop.
  let seatCount = 2;

  // Subscribe to pushed relay events for this screen's lifetime; unsubscribe when it leaves the DOM.
  const unsubscribe = bridge.onMpEvent?.((event) => {
    const message = event as ServerMessage;
    if (message?.type !== 'state' && message?.type !== 'error') return;
    client = applyServerMessage(client, message);
    // Switch to the table only once a real hand has been DEALT. The first broadcast a host gets is the
    // empty waiting room (handNumber 0, table null) from seating itself — staying in 'connecting' then
    // keeps the shareable port on screen until a second player joins and the first hand is dealt.
    if (message.type === 'state' && message.view.handNumber >= 1) phase = 'playing';
    // An error that arrives WHILE CONNECTING (a joiner's host is unreachable/refused — mpJoin returns
    // immediately and the socket's async 'connect' failure comes back as this event) would otherwise
    // leave the screen stuck on "Connecting…" forever: the connecting branch renders no error, and
    // client.lastError only surfaces once the table view exists. So fall back to the setup panel and show
    // the reason as its notice. During play an error stays on the table (it shows via mp-error there).
    else if (message.type === 'error' && phase === 'connecting') {
      phase = 'setup';
      role = '';
      notice = message.reason;
    }
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
    const result = await bridge.mpHost?.({ seatCount });
    if (result?.error) {
      notice = result.error;
      phase = 'setup';
      role = '';
    } else {
      hostPort = result?.port ?? null;
      hostAddresses = result?.addresses ?? [];
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

  /**
   * Keyboard action shortcuts at the live table (F/C/R/A), matching the single-player table and the
   * charts drills — without them a keyboard-only player cannot act in multiplayer at all. Same self-
   * removing pattern as defenseDrill: bound on document, drops itself once the screen leaves the DOM, and
   * ignores keystrokes while a modifier is held or while an INPUT/TEXTAREA (the join box) has focus, so
   * typing an address is never read as an action. Only fires on the player's turn for a LEGAL action —
   * the same guard the on-screen buttons use (disabled unless yourTurn && legal.includes(kind)).
   */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const view = client.view;
    if (phase !== 'playing' || view === null || !view.yourTurn || view.winners !== null) return;
    const legal = view.legal;
    const key = event.key.toLowerCase();
    if (key === 'f' && legal.includes('fold')) sendAction({ kind: 'fold' });
    else if (key === 'c') {
      if (legal.includes('check')) sendAction({ kind: 'check' });
      else if (legal.includes('call')) sendAction({ kind: 'call' });
    } else if (key === 'r' && (legal.includes('raise') || legal.includes('bet'))) {
      sendAction({ kind: legal.includes('raise') ? 'raise' : 'bet' });
    }
  }
  document.addEventListener('keydown', onKey);

  // ── rendering ───────────────────────────────────────────────────────────────

  // True once the screen has been in the DOM at least once. The initial synchronous paint() runs
  // BEFORE the returned root is appended, so isConnected is false then — without this flag that first
  // paint would mistake "not yet mounted" for "removed" and tear down the event subscription instantly.
  let hasMounted = false;

  // A screen-reader announcement channel — the one dynamic surface that lacked one, unlike every other
  // screen (drill/charts/puzzle/anomaly/contrast/table all announce). A blind player hosting or joining
  // otherwise gets no cue when the connection state changes, when it becomes their turn, when a hand is
  // won, or when a join fails. Always in the DOM (first child of every repaint, so replaceChildren never
  // tears it from the a11y tree) and only its text changes — the pattern SRs announce dependably.
  // role=status = polite, non-interrupting; visually hidden since sighted users read the panel/table.
  const announcer = document.createElement('div');
  announcer.className = 'visually-hidden';
  announcer.dataset.testid = 'mp-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  // The last string written, so an unrelated repaint (a pot tick, an opponent acting) does NOT
  // re-announce "Your turn" and spam the reader — only a CHANGED message is spoken.
  let lastAnnounced = '';

  /**
   * The single most relevant thing to announce for the current state, mirroring wording already on
   * screen so the spoken and visual channels can never disagree. Priority: a notice (a join error the
   * setup panel shows) → the hand outcome (who won) → your-turn cue → connecting. Empty when there is
   * nothing new to say (e.g. waiting on an opponent), which clears the region.
   */
  function announcement(): string {
    if (notice) return notice;
    const view = client.view;
    if (phase === 'playing' && view !== null) {
      if (view.winners !== null && view.winners.length > 0) {
        return view.winners
          .map((w) => `${view.seats[w.seatId]?.name ?? 'Seat'} wins ${w.amount} (${w.description})`)
          .join(' · ');
      }
      if (view.yourTurn) return 'Your turn to act';
      return '';
    }
    if (phase === 'connecting') return role === 'host' ? 'Starting a table' : 'Connecting';
    return '';
  }

  function paint(): void {
    root.dataset.mpPhase = phase;
    root.dataset.mpRole = role;
    if (root.isConnected) hasMounted = true;
    else if (hasMounted && unsubscribe) {
      // The screen was mounted and is now gone (tab switch / exit); stop listening and drop the session.
      cleanup();
      return;
    }
    // Announcer stays the root's FIRST child so replaceChildren never pulls it from the a11y tree.
    root.replaceChildren(announcer, header(), phase === 'playing' ? table() : setupPanel());
    const next = announcement();
    if (next !== lastAnnounced) {
      lastAnnounced = next;
      announcer.textContent = next;
    }
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
        share.dataset.addresses = hostAddresses.join(',');
        // A guest needs host:port, not a bare port. Show the machine's LAN address(es) with the port so
        // the string can be typed straight into the join box. If no LAN address was found (unusual), fall
        // back to the port alone with a note — the host still listens, the address just isn't auto-known.
        if (hostAddresses.length > 0) {
          const primary = hostAddresses[0];
          share.textContent =
            hostAddresses.length === 1
              ? `Tell a friend on your network to join at ${primary}:${hostPort}`
              : `Tell a friend on your network to join at ${primary}:${hostPort} (also reachable at ${hostAddresses
                  .slice(1)
                  .map((a) => `${a}:${hostPort}`)
                  .join(', ')})`;
        } else {
          share.textContent = `Hosting on port ${hostPort} — share your machine's network address and this port with a friend.`;
        }
        el.appendChild(share);
      }
      return el;
    }

    // Host a table: pick the seat count (2–6) first, then host.
    const hostRow = document.createElement('div');
    hostRow.className = 'mp-join-row';

    const seatLabel = document.createElement('label');
    seatLabel.className = 'mp-seat-label';
    seatLabel.textContent = 'Players';
    const seatSelect = document.createElement('select');
    seatSelect.className = 'mp-input';
    seatSelect.dataset.testid = 'mp-seat-count';
    for (const n of [2, 3, 4, 5, 6]) {
      const option = document.createElement('option');
      option.value = String(n);
      option.textContent = String(n);
      option.selected = n === seatCount;
      seatSelect.appendChild(option);
    }
    seatSelect.addEventListener('change', () => {
      seatCount = Number(seatSelect.value);
    });
    seatLabel.appendChild(seatSelect);
    hostRow.appendChild(seatLabel);

    const hostBtn = document.createElement('button');
    hostBtn.type = 'button';
    hostBtn.className = 'pill';
    hostBtn.dataset.testid = 'mp-host';
    hostBtn.textContent = 'Host a table';
    hostBtn.addEventListener('click', () => void host());
    hostRow.appendChild(hostBtn);
    el.appendChild(hostRow);

    const joinRow = document.createElement('div');
    joinRow.className = 'mp-join-row';

    const hostInput = document.createElement('input');
    hostInput.type = 'text';
    hostInput.className = 'mp-input';
    hostInput.dataset.testid = 'mp-join-host';
    hostInput.placeholder = 'Host (e.g. 192.168.1.5 or 192.168.1.5:50000)';
    hostInput.value = '127.0.0.1';
    // Placeholders are not accessible names; label each field.
    hostInput.setAttribute('aria-label', 'Host address');
    joinRow.appendChild(hostInput);

    const portInput = document.createElement('input');
    portInput.type = 'number';
    portInput.className = 'mp-input';
    portInput.dataset.testid = 'mp-join-port';
    portInput.placeholder = 'Port';
    portInput.setAttribute('aria-label', 'Port');
    joinRow.appendChild(portInput);

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'pill';
    joinBtn.dataset.testid = 'mp-join';
    joinBtn.textContent = 'Join a table';
    joinBtn.addEventListener('click', () => {
      // Accept a whole `host:port` pasted into the host field (what the host screen advertises) as well
      // as the two fields filled separately — parseJoinAddress reconciles both and reports why not.
      const parsed = parseJoinAddress(hostInput.value, portInput.value);
      if ('error' in parsed) {
        notice = parsed.error;
        paint();
        return;
      }
      void join(parsed.host, parsed.port);
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
    // Position labels (BTN/SB/BB/UTG…) derived once from the same inputs the engine uses: the dealer
    // index and which seats were dealt in (stack + committed > 0; an empty or busted seat is 0). Pure,
    // so the labels always match where the blinds actually posted.
    const funded = view.seats.map((s) => s.stack + s.committed > 0);
    const positions = seatPositions(view.dealer, funded);
    for (const seat of view.seats) {
      seats.appendChild(seatRow(seat, view, positions[seat.id] ?? null));
    }
    el.appendChild(seats);

    el.appendChild(controls(view));
    return el;
  }

  function seatRow(
    seat: RoomView['seats'][number],
    view: RoomView,
    position: string | null,
  ): HTMLElement {
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

    // The poker position (BTN/SB/BB/UTG…), derived in core from the dealer + who was dealt in, so it
    // cannot drift from where the blinds posted. Position is the first thing this app teaches; showing
    // it on a live table is where a learner connects the name to the seat.
    if (position !== null) {
      const pos = document.createElement('span');
      pos.className = 'mp-seat-position';
      pos.dataset.testid = 'mp-seat-position';
      pos.dataset.position = position;
      pos.textContent = position;
      row.appendChild(pos);
    }

    // A distinct dealer-button marker from the view's dealer index. Heads-up the button seat is the SB
    // (no 'BTN' position label exists then), so the button is shown as its own chip, not folded into
    // the label — a learner must see "this seat has the button" even when its position reads SB.
    if (view.dealer === seat.id) {
      const btn = document.createElement('span');
      btn.className = 'mp-seat-button';
      btn.dataset.testid = 'mp-dealer-button';
      btn.textContent = 'D';
      row.appendChild(btn);
    }

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
