import '../styles-multiplayer.css';
import type { Action } from '../../core/table.js';
import type { RoomView } from '../../core/multiplayer.js';
import {
  applyServerMessage,
  initialClientState,
  parseInvite,
  type ClientEvent,
  type ClientState,
} from '../../core/relayClient.js';
import { renderRoomTable } from '../components/roomTable.js';

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
  mpHost?: (opts: { seatCount?: number; name?: string }) => Promise<{
    port?: number;
    addresses?: string[];
    invites?: string[];
    fingerprint?: string;
    token?: string;
    error?: string;
  }>;
  mpJoin?: (request: { invite: string; name?: string }) => Promise<{ joined?: boolean; error?: string }>;
  mpAction?: (action: unknown) => Promise<void>;
  mpDeal?: () => Promise<void>;
  mpStop?: () => Promise<void>;
  onMpEvent?: (handler: (event: unknown) => void) => () => void;
}

export interface MultiplayerOptions {
  readonly bridge: MultiplayerBridge;
  /** Leave multiplayer and return home; the screen stops its session first. */
  readonly onExit?: () => void;
  /** Open online play (an Offsuit server) instead; the screen stops its LAN session first. */
  readonly onPlayOnline?: () => void;
  /** A Home Game Night (screens/club.ts): the same table, started straight away and watched for the recap. */
  readonly night?: NightHooks;
}

/**
 * What a Game Night adds to the LAN table. The relay and its messages are the same; the night only names the
 * local seat, starts the host or join at once (after the opt-in, if it is still off), and watches the views
 * and this player's own actions so the night can grade them (core/club/gameNight.ts).
 */
export interface NightHooks {
  /** The name this player sits down under. */
  readonly name: string;
  readonly start: { readonly role: 'host'; readonly seatCount: number } | { readonly role: 'join'; readonly invite: string };
  /** The first hand was dealt at this table: its certificate fingerprint names the night; `role` is how it was reached. */
  readonly onTable: (fingerprint: string, role: 'host' | 'join') => void;
  /** The screen's own teardown (unsubscribe, then stop the session), so the night can leave its table for good. */
  readonly bindStop: (stop: () => void) => void;
  readonly onView: (view: RoomView) => void;
  /** This player acted, with the view they acted on (only ever their own turn). */
  readonly onAction: (view: RoomView, action: Action) => void;
  /** The table was left (Leave, End the night, or the screen was taken down): the session is stopped. */
  readonly onStopped: () => void;
  /** The night's bar above the table: its counts and the way to end it. `end` leaves the table first. */
  readonly bar: (end: () => void) => HTMLElement;
}

/**
 * The LAN screen that owns the pushed events right now. Only one can: a newer screen retires the one before it as
 * it is built, so a screen replaced without its Leave can never stop a session a later screen started (it used to
 * clean up only when the next event reached it, which was the later session's first event).
 */
let retireCurrent: (() => void) | null = null;

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
  let hostInvites: string[] = [];
  let hostFingerprint = '';
  let hostToken = '';
  let notice = '';
  let enabled = false;
  // The table's certificate fingerprint (a Game Night's name for it), and whether the night has been told.
  let tableFingerprint = '';
  let tableAnnounced = false;
  // How many seats a hosted table has (2–6). The whole point of multiplayer is multi-way play, so the
  // host picks the size; the main handler clamps it to 2..6 as a backstop.
  let seatCount = 2;

  // Subscribe to pushed relay events for this screen's lifetime; unsubscribe when it leaves the DOM.
  const unsubscribe = bridge.onMpEvent?.((event) => {
    if (cleanedUp) return;
    const message = event as ClientEvent;
    if (message?.type !== 'state' && message?.type !== 'error' && message?.type !== 'warning') return;
    client = applyServerMessage(client, message);
    // Switch to the table only once a real hand has been DEALT. The first broadcast a host gets is the
    // empty waiting room (handNumber 0, table null) from seating itself — staying in 'connecting' then
    // keeps the shareable port on screen until a second player joins and the first hand is dealt.
    if (message.type === 'state' && options.night && message.view.handNumber >= 1) {
      // A night starts with its first hand, so a table nobody joined (or a join that failed) leaves no record.
      if (!tableAnnounced && tableFingerprint) {
        tableAnnounced = true;
        options.night.onTable(tableFingerprint, role === 'host' ? 'host' : 'join');
      }
      options.night.onView(message.view);
    }
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

  let cleanedUp = false;
  function cleanup(): void {
    if (cleanedUp) return;
    cleanedUp = true;
    if (retireCurrent === cleanup) retireCurrent = null;
    unsubscribe?.();
    void bridge.mpStop?.();
    options.night?.onStopped();
  }
  // A newer screen retires this one at once, before it starts anything of its own: its stop is sent ahead of
  // the newer screen's host or join, so it can only ever stop its own session.
  retireCurrent?.();
  retireCurrent = cleanup;
  options.night?.bindStop(cleanup);

  /** Poll the opt-in status once at mount so the panel shows whether MP is enabled. A rejected status
   *  call (a real IPC failure, not the modeled resolve) must not become an unhandled rejection — leave
   *  the panel in its default disabled state so the Enable button is still offered. */
  void bridge.mpStatus?.().then(
    (status) => {
      enabled = status.enabled;
      paint();
      startNight();
    },
    () => {
      enabled = false;
      paint();
    },
  );

  async function enable(): Promise<void> {
    try {
      enabled = (await bridge.mpSetEnabled?.(true)) ?? false;
    } catch {
      // The opt-in toggle rejected in main; keep multiplayer off and say so rather than silently no-op.
      enabled = false;
      notice = 'Could not enable multiplayer';
    }
    paint();
    startNight();
  }

  /** A Game Night starts its table as soon as multiplayer is on, once: a failed start falls back to the panel. */
  let nightStarted = false;
  function startNight(): void {
    const night = options.night;
    if (night === undefined || nightStarted || cleanedUp || !enabled || phase !== 'setup') return;
    nightStarted = true;
    if (night.start.role === 'host') {
      seatCount = night.start.seatCount;
      void host();
      return;
    }
    const parsed = parseInvite(night.start.invite);
    if ('error' in parsed) {
      notice = parsed.error;
      paint();
      return;
    }
    void join(night.start.invite);
  }

  async function host(): Promise<void> {
    role = 'host';
    phase = 'connecting';
    notice = '';
    paint();
    try {
      const result = await bridge.mpHost?.({ seatCount, ...(options.night ? { name: options.night.name } : {}) });
      // Left while the table was starting: it is nobody's, so it stops now.
      if (cleanedUp) {
        void bridge.mpStop?.();
        return;
      }
      if (result?.error) {
        notice = result.error;
        phase = 'setup';
        role = '';
      } else {
        hostPort = result?.port ?? null;
        hostAddresses = result?.addresses ?? [];
        hostInvites = result?.invites ?? [];
        hostFingerprint = result?.fingerprint ?? '';
        hostToken = result?.token ?? '';
        tableFingerprint = hostFingerprint;
        tableAnnounced = false;
      }
    } catch {
      // A rejected mpHost (vs the modeled { error } resolve) would otherwise strand the screen on
      // "Starting a table…" forever. Fall back to setup with a notice so the user can retry.
      notice = 'Could not start the table';
      phase = 'setup';
      role = '';
    }
    paint();
  }

  async function join(invite: string): Promise<void> {
    // Whichever way the join was asked for, the table it reaches names the night.
    const parsed = parseInvite(invite);
    tableFingerprint = 'error' in parsed ? '' : parsed.fingerprint;
    tableAnnounced = false;
    role = 'join';
    phase = 'connecting';
    notice = '';
    paint();
    try {
      const result = await bridge.mpJoin?.({ invite, name: options.night?.name ?? 'Guest' });
      if (result?.error) {
        notice = result.error;
        phase = 'setup';
        role = '';
      }
    } catch {
      // A rejected mpJoin (vs the modeled { error } resolve) would otherwise strand the screen on
      // "Connecting…" forever. Fall back to setup with a notice so the user can retry.
      notice = 'Could not connect';
      phase = 'setup';
      role = '';
    }
    paint();
  }

  function sendAction(action: Action): void {
    const view = client.view;
    if (view !== null && view.yourTurn && view.winners === null && view.legal.includes(action.kind)) options.night?.onAction(view, action);
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
    const body = phase === 'playing' ? table() : setupPanel();
    if (options.night) root.replaceChildren(announcer, header(), options.night.bar(cleanup), body);
    else root.replaceChildren(announcer, header(), body);
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
    title.className = 'mp-title t-t2';
    title.dataset.testid = 'mp-title';
    title.textContent = options.night ? 'Game Night' : 'Play with friends';
    el.appendChild(title);

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'pill sm';
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
      enableBtn.className = 'pill primary';
      enableBtn.dataset.testid = 'mp-enable';
      enableBtn.textContent = 'Enable multiplayer';
      enableBtn.addEventListener('click', () => void enable());
      el.appendChild(enableBtn);
      if (!options.night) el.appendChild(playOnlineRow());
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
        share.dataset.fingerprint = hostFingerprint;
        share.dataset.token = hostToken;
        // A guest needs the whole invite link: the address and port, the certificate fingerprint it pins
        // and the room token it presents. Show one per LAN address, selectable as one piece of text.
        if (hostInvites.length > 0) {
          const lead = document.createElement('p');
          lead.className = 'mp-share-lead';
          lead.textContent =
            hostInvites.length === 1
              ? `Send a friend on your network this invite link (${hostAddresses[0]}:${hostPort}):`
              : `Send a friend on your network one of these invite links (${hostAddresses
                  .map((a) => `${a}:${hostPort}`)
                  .join(', ')}):`;
          share.appendChild(lead);
          for (const invite of hostInvites) {
            const code = document.createElement('code');
            code.className = 'mp-invite';
            code.dataset.testid = 'mp-invite';
            code.textContent = invite;
            share.appendChild(code);
          }
        } else {
          share.textContent = `Hosting on port ${hostPort}, but no network address was found to put in an invite link.`;
        }
        el.appendChild(share);
      }
      return el;
    }

    // The two ways in are rows that act, so the panel becomes one inset group of two rows.
    el.classList.add('g-group', 'mp-setup-rows');

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
    hostBtn.className = 'pill primary';
    hostBtn.dataset.testid = 'mp-host';
    hostBtn.textContent = 'Host a table';
    hostBtn.addEventListener('click', () => void host());
    hostRow.appendChild(hostBtn);
    el.appendChild(hostRow);

    const joinRow = document.createElement('div');
    joinRow.className = 'mp-join-row';

    const inviteInput = document.createElement('input');
    inviteInput.type = 'text';
    inviteInput.className = 'mp-input';
    inviteInput.dataset.testid = 'mp-join-invite';
    inviteInput.placeholder = 'Invite link (offsuit://join?…)';
    inviteInput.spellcheck = false;
    // Placeholders are not accessible names; label the field.
    inviteInput.setAttribute('aria-label', 'Invite link');
    joinRow.appendChild(inviteInput);

    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'pill';
    joinBtn.dataset.testid = 'mp-join';
    joinBtn.textContent = 'Join a table';
    joinBtn.addEventListener('click', () => {
      // The invite carries the address, the certificate to pin and the room token; a bare host:port
      // cannot join a v2 table, so the parser says what is missing before main is asked.
      const parsed = parseInvite(inviteInput.value);
      if ('error' in parsed) {
        notice = parsed.error;
        paint();
        return;
      }
      void join(inviteInput.value.trim());
    });
    joinRow.appendChild(joinBtn);
    el.appendChild(joinRow);
    if (!options.night) el.appendChild(playOnlineRow());
    return el;
  }

  /** The way to online play: a row under the LAN choices, in both the enabled and disabled panels. */
  function playOnlineRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mp-join-row mp-online-row';
    const text = document.createElement('span');
    text.className = 'mp-online-text';
    text.textContent = 'Play online — an Offsuit server, ranked ladder and leagues';
    row.appendChild(text);
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'pill';
    go.dataset.testid = 'mp-play-online';
    go.textContent = 'Play online';
    go.addEventListener('click', () => {
      cleanup();
      options.onPlayOnline?.();
    });
    row.appendChild(go);
    return row;
  }

  function table(): HTMLElement {
    return renderRoomTable(client.view, {
      lastError: client.lastError,
      warnings: client.warnings,
      onAction: sendAction,
      onDeal: () => void bridge.mpDeal?.(),
    });
  }

  paint();
  return root;
}
