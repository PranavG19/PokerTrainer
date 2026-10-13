import '../styles-online.css';
import type { Action } from '../../core/table.js';
import type { RoomView } from '../../core/multiplayer.js';
import { applyServerMessage, initialClientState, type ClientState } from '../../core/relayClient.js';
import { EMOTES, EMOTE_IDS, formatCode, type EmoteId, type RoomInfo } from '../../core/online/protocol.js';
import type { Board, BoardRow, Rating } from '../../core/online/ranked.js';
import { renderRoomTable } from '../components/roomTable.js';
import { attachThumb } from '../components/thumb.js';

/**
 * ONLINE screen — play at an Offsuit server the player chose: open or join a table, read the ladder,
 * the season and friends leagues.
 *
 * Main holds the socket and the device key (onlineMain.ts); this screen only calls the bridge and
 * renders what comes back. Requests answer `{ ok: true, data }` or `{ ok: false, error }`; table views
 * arrive already redacted on 'online:event', so an opponent's hole is null and cannot be shown.
 *
 * Sync for e2e: the root publishes data-online-phase ('setup' | 'connecting' | 'lobby' | 'table').
 */

type Result<T = unknown> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

/** What onlineStatus() returns (onlineMain.ts OnlineStatusView), as far as this screen reads it. */
export interface OnlineStatusLike {
  readonly enabled: boolean;
  readonly server: string;
  readonly pin: string;
  readonly name: string;
  readonly adultOn: string;
  readonly status: 'connecting' | 'online' | 'reconnecting' | 'offline';
  readonly keyId: string | null;
  readonly room: RoomInfo | null;
  readonly season: string | null;
  readonly rankedEntitled: boolean;
}

/** The subset of the preload bridge this screen needs; all optional (absent in a plain browser). */
export interface OnlineBridge {
  onlineStatus?: () => Promise<unknown>;
  onlineConfigure?: (patch: unknown) => Promise<unknown>;
  onlineConnect?: (request: unknown) => Promise<unknown>;
  onlineRequest?: (op: string, fields?: unknown) => Promise<unknown>;
  onlineAction?: (action: unknown) => Promise<void>;
  onlineEmote?: (emote: string) => Promise<void>;
  onlineLeave?: () => Promise<void>;
  onlineDisconnect?: () => Promise<void>;
  onlineExportIdentity?: () => Promise<string | null>;
  onOnlineEvent?: (handler: (event: unknown) => void) => () => void;
}

export interface OnlineOptions {
  readonly bridge: OnlineBridge;
  /** Leave the online screen (back to the LAN panel). A player at a table leaves it first. */
  readonly onExit?: () => void;
  /** Open the upgrade sheet on the ranked feature (the app's one Pro sheet, pro.ts). */
  readonly onOpenPro?: () => void;
}

type Phase = 'setup' | 'connecting' | 'lobby' | 'table';
type LobbyTab = 'play' | 'ladder' | 'season' | 'leagues';

interface SeasonViewLike {
  readonly season: string;
  readonly graderVersion: number;
  readonly start: string;
  readonly end: string;
  readonly ranked: boolean;
  readonly closed: string | null;
  readonly you: Rating & { readonly opponents: number; readonly needed: number; readonly minOpponents: number };
  readonly last: Rating | null;
}
interface LeagueLike {
  readonly code: string;
  readonly name: string;
  readonly members: number;
  readonly owner: boolean;
}
type LeagueBoard = Board & { readonly code: string; readonly name: string; readonly members: number };

type Load<T> = { readonly state: 'idle' } | { readonly state: 'loading' } | { readonly state: 'ok'; readonly data: T } | { readonly state: 'error'; readonly error: string };

const IDLE = { state: 'idle' } as const;
const LOADING = { state: 'loading' } as const;
const EMOTE_SHOW_MS = 4000;
const SCORE_CAPTION = 'bb lost / 100 decisions';
const FORGOTTEN = 'Your data on that server was deleted.';

const DEFAULT_STATUS: OnlineStatusLike = {
  enabled: false,
  server: '',
  pin: '',
  name: '',
  adultOn: '',
  status: 'offline',
  keyId: null,
  room: null,
  season: null,
  rankedEntitled: false,
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, testid: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.dataset.testid = testid;
  b.addEventListener('click', onClick);
  return b;
}

function asResult<T>(value: unknown): Result<T> {
  const r = value as Result<T> | undefined;
  if (r && r.ok === true) return r;
  if (r && r.ok === false && typeof r.error === 'string') return r;
  return { ok: false, error: 'The online service did not answer.' };
}

/** One decimal, the way the server rounds (rate() in ranked.ts), so a column of scores lines up. */
function fmt(n: number): string {
  return n.toFixed(1);
}

/** A file offered for download: a Blob URL where the platform has one (a data URL otherwise). */
function downloadLink(testid: string, filename: string, json: string, text: string): HTMLAnchorElement {
  const a = el('a', 'ol-download', text);
  a.dataset.testid = testid;
  a.download = filename;
  a.href =
    typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      : `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
  return a;
}

export function renderOnlineScreen(options: OnlineOptions): HTMLElement {
  const { bridge } = options;
  const root = el('div', 'ol-screen');
  root.dataset.testid = 'online-screen';

  let phase: Phase = 'setup';
  let status: OnlineStatusLike = DEFAULT_STATUS;
  let notice = '';
  let reconnecting = false;
  // Setup drafts, kept across repaints so a pushed event never wipes what the player typed.
  let draftServer = '';
  let draftPin = '';
  let draftName = '';
  let adult = false;
  let identityJson: string | null = null;
  let identityMissing = false;

  // Lobby.
  let tab: LobbyTab = 'play';
  let seats = 6;
  let ranked = false;
  let draftCode = '';
  let draftLeagueName = '';
  let draftLeagueCode = '';
  let ladder: Load<Board & { season?: string }> = IDLE;
  let season: Load<SeasonViewLike> = IDLE;
  let leagues: Load<readonly LeagueLike[]> = IDLE;
  let league: Load<LeagueBoard> = IDLE;
  let leagueCode: string | null = null;
  let exportData: Load<string> = IDLE;
  let confirmForget = false;
  let forgetting = false;

  // Table.
  let room: RoomInfo | null = null;
  let client: ClientState = initialClientState();
  let clock: { seat: number; deadline: number } | null = null;
  const emotesShown = new Map<number, { emote: EmoteId; timer: ReturnType<typeof setTimeout> }>();

  // ── lifecycle ───────────────────────────────────────────────────────────────

  let hasMounted = false;
  let cleaned = false;

  const unsubscribe = bridge.onOnlineEvent?.((event) => onEvent(event as Record<string, unknown>));

  /** Leaving the screen keeps the player signed in, but never seated at a table nobody is watching. */
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    unsubscribe?.();
    clearInterval(ticker);
    document.removeEventListener('keydown', onKey);
    for (const { timer } of emotesShown.values()) clearTimeout(timer);
    emotesShown.clear();
    if (phase === 'table') void bridge.onlineLeave?.();
  }

  /** The turn clock's tick, and the unmount watch: a removed screen tears itself down here. */
  const ticker = setInterval(() => {
    if (root.isConnected) hasMounted = true;
    else if (hasMounted) {
      cleanup();
      return;
    }
    const node = root.querySelector<HTMLElement>('[data-testid="online-clock"]');
    if (node) paintClock(node);
  }, 250);

  void bridge.onlineStatus?.().then(
    (value) => {
      const s = value as OnlineStatusLike | undefined;
      if (s && typeof s === 'object') {
        status = { ...DEFAULT_STATUS, ...s };
        draftServer = status.server;
        draftPin = status.pin;
        draftName = status.name;
        adult = status.adultOn !== '';
        identityMissing = status.keyId === null;
        if (status.status === 'online' || status.status === 'reconnecting') {
          reconnecting = status.status === 'reconnecting';
          if (status.room) enterTable(status.room);
          else enterLobby();
        }
      }
      paint();
    },
    () => paint(),
  );

  function onEvent(event: Record<string, unknown>): void {
    switch (event?.type) {
      case 'status': {
        const s = event.status as OnlineStatusLike['status'];
        status = { ...status, status: s };
        if (s === 'reconnecting') reconnecting = true;
        else if (s === 'online') reconnecting = false;
        else if (s === 'offline') {
          reconnecting = false;
          const wasIn = phase !== 'setup';
          leaveTableLocally();
          if (wasIn || typeof event.reason === 'string') phase = 'setup';
          if (typeof event.reason === 'string' && !forgetting) notice = event.reason;
        }
        break;
      }
      case 'welcome': {
        const w = event.welcome as { season?: string; room?: RoomInfo | null } | undefined;
        if (w?.season) status = { ...status, season: w.season };
        if (w?.room) enterTable(w.room);
        break;
      }
      case 'room': {
        const r = (event.room ?? null) as RoomInfo | null;
        if (r) enterTable(r);
        else if (phase === 'table') {
          leaveTableLocally();
          phase = 'lobby';
        }
        break;
      }
      case 'state':
      case 'warning':
        client = applyServerMessage(client, event as never);
        break;
      case 'error':
        if (phase === 'table') client = applyServerMessage(client, event as never);
        else if (typeof event.reason === 'string') notice = event.reason;
        break;
      case 'clock':
        if (typeof event.seat === 'number' && typeof event.ms === 'number') {
          clock = { seat: event.seat, deadline: Date.now() + event.ms };
        }
        break;
      case 'emote':
        if (typeof event.seat === 'number' && EMOTE_IDS.includes(event.emote as EmoteId)) {
          showEmote(event.seat, event.emote as EmoteId);
        }
        break;
      case 'removed':
        notice = typeof event.reason === 'string' ? event.reason : 'You left the table.';
        leaveTableLocally();
        if (phase === 'table') phase = 'lobby';
        break;
      default:
        return;
    }
    paint();
  }

  function enterTable(r: RoomInfo): void {
    if (room?.code !== r.code) {
      client = initialClientState();
      clock = null;
    }
    room = r;
    phase = 'table';
  }

  function leaveTableLocally(): void {
    room = null;
    client = initialClientState();
    clock = null;
    for (const { timer } of emotesShown.values()) clearTimeout(timer);
    emotesShown.clear();
  }

  function enterLobby(): void {
    phase = 'lobby';
    loadTab(tab);
  }

  function showEmote(seat: number, emote: EmoteId): void {
    const prior = emotesShown.get(seat);
    if (prior) clearTimeout(prior.timer);
    const timer = setTimeout(() => {
      emotesShown.delete(seat);
      if (!cleaned) paint();
    }, EMOTE_SHOW_MS);
    emotesShown.set(seat, { emote, timer });
  }

  async function request<T>(op: string, fields?: unknown): Promise<Result<T>> {
    if (!bridge.onlineRequest) return { ok: false, error: 'Online play is not available here.' };
    try {
      return asResult<T>(await bridge.onlineRequest(op, fields));
    } catch {
      return { ok: false, error: 'The online service did not answer.' };
    }
  }

  // ── setup actions ───────────────────────────────────────────────────────────

  async function configure(patch: Record<string, unknown>): Promise<void> {
    if (!bridge.onlineConfigure) return;
    let result: Result<OnlineStatusLike>;
    try {
      result = asResult<OnlineStatusLike>(await bridge.onlineConfigure(patch));
    } catch {
      result = { ok: false, error: 'Could not save that setting.' };
    }
    if (result.ok) {
      status = { ...status, ...result.data };
      notice = '';
      if (patch.server !== undefined) draftServer = status.server;
      if (patch.pin !== undefined) draftPin = status.pin;
    } else notice = result.error;
    paint();
  }

  async function connect(): Promise<void> {
    phase = 'connecting';
    notice = '';
    paint();
    let result: Result<OnlineStatusLike>;
    try {
      result = bridge.onlineConnect
        ? asResult<OnlineStatusLike>(await bridge.onlineConnect({ name: draftName, adult }))
        : { ok: false, error: 'Online play is not available here.' };
    } catch {
      result = { ok: false, error: 'Could not connect.' };
    }
    if (result.ok) {
      status = { ...status, ...result.data };
      identityMissing = status.keyId === null;
      reconnecting = false;
      if (status.room) enterTable(status.room);
      else enterLobby();
    } else {
      phase = 'setup';
      notice = result.error;
    }
    paint();
  }

  async function exportIdentity(): Promise<void> {
    let json: string | null = null;
    try {
      json = (await bridge.onlineExportIdentity?.()) ?? null;
    } catch {
      json = null;
    }
    identityJson = json;
    identityMissing = json === null;
    paint();
  }

  async function goOffline(): Promise<void> {
    try {
      await bridge.onlineDisconnect?.();
    } catch {
      // Main closes the session whatever happens; the screen goes back to setup either way.
    }
    leaveTableLocally();
    reconnecting = false;
    phase = 'setup';
    paint();
  }

  // ── lobby actions ───────────────────────────────────────────────────────────

  function loadTab(which: LobbyTab): void {
    if (which === 'ladder') {
      ladder = LOADING;
      void request<Board & { season?: string }>('ladder').then((r) => {
        ladder = r.ok ? { state: 'ok', data: r.data } : { state: 'error', error: r.error };
        paint();
      });
    } else if (which === 'season') {
      season = LOADING;
      void request<SeasonViewLike>('season').then((r) => {
        season = r.ok ? { state: 'ok', data: r.data } : { state: 'error', error: r.error };
        paint();
      });
    } else if (which === 'leagues') {
      loadLeagues();
      if (leagueCode !== null) openLeague(leagueCode);
    }
  }

  function loadLeagues(): void {
    leagues = LOADING;
    void request<readonly LeagueLike[]>('leagues').then((r) => {
      leagues = r.ok ? { state: 'ok', data: Array.isArray(r.data) ? r.data : [] } : { state: 'error', error: r.error };
      paint();
    });
  }

  function openLeague(code: string): void {
    leagueCode = code;
    league = LOADING;
    paint();
    void request<LeagueBoard>('league-board', { code }).then((r) => {
      if (leagueCode !== code) return;
      league = r.ok ? { state: 'ok', data: r.data } : { state: 'error', error: r.error };
      paint();
    });
  }

  async function openTable(op: 'room-create' | 'room-join', fields: unknown): Promise<void> {
    notice = '';
    const r = await request<RoomInfo>(op, fields);
    if (r.ok) enterTable(r.data);
    else notice = r.error;
    paint();
  }

  async function leagueJoinOrCreate(op: 'league-create' | 'league-join', fields: unknown): Promise<void> {
    notice = '';
    const r = await request<{ code: string; name: string }>(op, fields);
    if (r.ok) {
      draftLeagueName = '';
      draftLeagueCode = '';
      loadLeagues();
      openLeague(r.data.code);
    } else {
      notice = r.error;
      paint();
    }
  }

  async function leaveLeague(code: string): Promise<void> {
    const r = await request('league-leave', { code });
    if (r.ok) {
      leagueCode = null;
      league = IDLE;
      loadLeagues();
    } else notice = r.error;
    paint();
  }

  async function exportServerData(): Promise<void> {
    exportData = LOADING;
    paint();
    const r = await request('export');
    exportData = r.ok ? { state: 'ok', data: JSON.stringify(r.data, null, 2) } : { state: 'error', error: r.error };
    paint();
  }

  async function forget(): Promise<void> {
    forgetting = true;
    const r = await request('forget');
    forgetting = false;
    confirmForget = false;
    if (r.ok) {
      // Main signs out after a forget (an 'offline' status follows); the screen goes back to setup.
      leaveTableLocally();
      reconnecting = false;
      phase = 'setup';
      notice = FORGOTTEN;
    } else notice = r.error;
    paint();
  }

  // ── table actions ───────────────────────────────────────────────────────────

  function sendAction(action: Action): void {
    void bridge.onlineAction?.(action);
  }

  /** F/C/R at the live table, the same guard and self-removal as multiplayer.ts. */
  function onKey(event: KeyboardEvent): void {
    if (!root.isConnected) {
      if (hasMounted) cleanup();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const view = client.view;
    if (phase !== 'table' || view === null || !view.yourTurn || view.winners !== null) return;
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

  const announcer = el('div', 'visually-hidden');
  announcer.dataset.testid = 'online-announcer';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  let lastAnnounced = '';

  function announcement(): string {
    if (notice) return notice;
    if (phase === 'connecting') return 'Connecting';
    if (reconnecting) return 'Reconnecting';
    const view = client.view;
    if (phase === 'table' && view !== null) {
      if (view.winners !== null && view.winners.length > 0) {
        return view.winners
          .map((w) => `${view.seats[w.seatId]?.name ?? 'Seat'} wins ${w.amount} (${w.description})`)
          .join(' · ');
      }
      if (view.yourTurn) return 'Your turn to act';
    }
    return '';
  }

  function paint(): void {
    if (cleaned) return;
    root.dataset.onlinePhase = phase;
    if (root.isConnected) hasMounted = true;
    else if (hasMounted) {
      cleanup();
      return;
    }
    const body =
      phase === 'setup' ? setupPanel() : phase === 'connecting' ? connectingPanel() : phase === 'lobby' ? lobbyPanel() : tablePanel();
    const parts: HTMLElement[] = [announcer, header()];
    if (reconnecting && phase !== 'setup' && phase !== 'connecting') {
      const banner = el('div', 'ol-banner', 'Reconnecting… your seat is held for a minute');
      banner.dataset.testid = 'online-reconnecting';
      parts.push(banner);
    }
    if (notice) {
      const n = el('div', 'ol-notice', notice);
      n.dataset.testid = 'online-notice';
      parts.push(n);
    }
    parts.push(body);
    root.replaceChildren(...parts);
    const next = announcement();
    if (next !== lastAnnounced) {
      lastAnnounced = next;
      announcer.textContent = next;
    }
  }

  function header(): HTMLElement {
    const bar = el('div', 'ol-header');
    const titles = el('div', 'ol-titles');
    const online = phase === 'lobby' || phase === 'table';
    const title = el('h2', 'ol-title t-t2', online ? `Online · ${status.server}` : 'Play online');
    title.dataset.testid = 'online-title';
    titles.appendChild(title);
    if (online && status.season) {
      const s = el('span', 'g-caption ol-season-id', `Season ${status.season}`);
      s.dataset.testid = 'online-season-id';
      titles.appendChild(s);
    }
    bar.appendChild(titles);

    const actions = el('div', 'ol-header-actions');
    if (online) actions.appendChild(button('pill sm quiet', 'online-disconnect', 'Go offline', () => void goOffline()));
    actions.appendChild(
      button('pill sm', 'online-exit', 'Back', () => {
        cleanup();
        options.onExit?.();
      }),
    );
    bar.appendChild(actions);
    return bar;
  }

  // ── setup ──

  function setupPanel(): HTMLElement {
    const panel = el('div', 'ol-setup');
    panel.dataset.testid = 'online-setup';

    const about = el('div', 'ol-about');
    about.appendChild(
      el(
        'p',
        'g-sub',
        'Online play connects this computer to an Offsuit server you choose. It is off until you turn it on, and nothing is contacted until you press Go online.',
      ),
    );
    const sect = el('div', 'g-sect g-flat ol-leaves');
    const leaves = el('div', 'ol-leaves-row');
    leaves.appendChild(el('span', 'g-label', 'What leaves this computer'));
    leaves.appendChild(el('span', 'g-sub', 'Your display name, a device key, and your actions at the table.'));
    sect.appendChild(leaves);
    const stays = el('div', 'ol-leaves-row');
    stays.appendChild(el('span', 'g-label', 'What never does'));
    stays.appendChild(el('span', 'g-sub', 'Your profile, your decision log and anything the tutor wrote.'));
    sect.appendChild(stays);
    about.appendChild(sect);
    const details = el('p', 'g-caption', 'Details: docs/PRIVACY-ONLINE.md');
    details.dataset.testid = 'online-privacy-pointer';
    about.appendChild(details);
    about.appendChild(identityBlock());
    panel.appendChild(about);

    const form = el('div', 'g-group ol-form');

    const switchRow = el('div', 'ol-row');
    switchRow.appendChild(el('span', 'ol-row-label', 'Online play'));
    const sw = el('button', 'g-switch');
    sw.type = 'button';
    sw.dataset.testid = 'online-enable';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(status.enabled));
    sw.setAttribute('aria-label', `Online play: ${status.enabled ? 'on' : 'off'}`);
    sw.textContent = status.enabled ? 'On' : 'Off';
    const track = el('span', 'g-switch-track');
    track.setAttribute('aria-hidden', 'true');
    sw.appendChild(track);
    sw.addEventListener('click', () => void configure({ enabled: !status.enabled }));
    switchRow.appendChild(sw);
    form.appendChild(switchRow);

    form.appendChild(
      fieldRow('Server', 'online-server', 'play.example.com', draftServer, 253, (v) => (draftServer = v), (v) => {
        if (v.trim() !== status.server) void configure({ server: v.trim() });
      }),
    );
    form.appendChild(
      fieldRow('Pin', 'online-pin', 'Certificate pin (only for a self-signed server)', draftPin, 64, (v) => (draftPin = v), (v) => {
        if (v.trim() !== status.pin) void configure({ pin: v.trim() });
      }),
    );
    form.appendChild(fieldRow('Name', 'online-name', 'Display name', draftName, 16, (v) => (draftName = v)));

    const adultRow = el('label', 'ol-row ol-check');
    const box = el('input');
    box.type = 'checkbox';
    box.dataset.testid = 'online-adult';
    box.checked = adult;
    box.addEventListener('change', () => {
      adult = box.checked;
    });
    adultRow.appendChild(box);
    adultRow.appendChild(el('span', '', 'I am 18 or over. Online play is for adults; there are no prizes, ever.'));
    form.appendChild(adultRow);

    const goRow = el('div', 'ol-row ol-go');
    goRow.appendChild(button('pill primary', 'online-connect', 'Go online', () => void connect()));
    form.appendChild(goRow);

    panel.appendChild(form);
    return panel;
  }

  function fieldRow(
    label: string,
    testid: string,
    placeholder: string,
    value: string,
    maxLength: number,
    onInput: (v: string) => void,
    onChange?: (v: string) => void,
  ): HTMLElement {
    const row = el('label', 'ol-row');
    row.appendChild(el('span', 'ol-row-label', label));
    const input = el('input', 'mp-input ol-input');
    input.type = 'text';
    input.dataset.testid = testid;
    input.placeholder = placeholder;
    input.value = value;
    input.maxLength = maxLength;
    input.spellcheck = false;
    input.setAttribute('aria-label', label === 'Pin' ? 'Certificate pin' : label);
    input.addEventListener('input', () => onInput(input.value));
    if (onChange) input.addEventListener('change', () => onChange(input.value));
    row.appendChild(input);
    return row;
  }

  function identityBlock(): HTMLElement {
    const wrap = el('div', 'ol-identity');
    const b = button('pill sm quiet', 'online-export-identity', "Export this device's online identity", () => void exportIdentity());
    b.disabled = identityMissing;
    wrap.appendChild(b);
    if (identityJson !== null) {
      wrap.appendChild(downloadLink('online-export-link', 'offsuit-online-identity.json', identityJson, 'Save offsuit-online-identity.json'));
      const caution = el('p', 'g-caption ol-caution', 'Keep this file private: anyone with it can play as you.');
      caution.dataset.testid = 'online-export-caution';
      wrap.appendChild(caution);
    } else if (identityMissing) {
      wrap.appendChild(el('p', 'g-caption', 'This device has no online identity yet. One is made the first time you go online.'));
    }
    return wrap;
  }

  function connectingPanel(): HTMLElement {
    const panel = el('div', 'ol-connecting t-t3', 'Connecting…');
    panel.dataset.testid = 'online-connecting';
    return panel;
  }

  // ── lobby ──

  function lobbyPanel(): HTMLElement {
    const panel = el('div', 'ol-lobby');
    panel.dataset.testid = 'online-lobby';

    const seg = el('div', 'g-seg ol-tabs');
    seg.setAttribute('role', 'tablist');
    const tabs: [LobbyTab, string][] = [
      ['play', 'Play'],
      ['ladder', 'Ladder'],
      ['season', 'Season'],
      ['leagues', 'Leagues'],
    ];
    for (const [id, label] of tabs) {
      const b = button('', `online-tab-${id}`, label, () => {
        if (tab === id) return;
        tab = id;
        notice = '';
        loadTab(id);
        paint();
      });
      b.setAttribute('role', 'tab');
      b.dataset.active = String(tab === id);
      b.setAttribute('aria-selected', String(tab === id));
      seg.appendChild(b);
    }
    attachThumb(seg);
    panel.appendChild(seg);

    const body = tab === 'play' ? playTab() : tab === 'ladder' ? ladderTab() : tab === 'season' ? seasonTab() : leaguesTab();
    body.classList.add('ol-tab-body');
    panel.appendChild(body);
    return panel;
  }

  function playTab(): HTMLElement {
    const wrap = el('div', 'ol-play');
    const group = el('div', 'g-group');

    const open = el('div', 'ol-row ol-open');
    open.appendChild(el('span', 'ol-row-label', 'Open a table'));
    const seatSeg = el('div', 'g-seg g-seg-sm');
    seatSeg.dataset.testid = 'online-seats';
    seatSeg.setAttribute('aria-label', 'Players');
    seatSeg.dataset.seats = String(seats);
    for (const n of [2, 3, 4, 5, 6]) {
      const b = button('', `online-seats-${n}`, String(n), () => {
        seats = n;
        paint();
      });
      b.setAttribute('aria-pressed', String(seats === n));
      b.setAttribute('aria-label', `${n} players`);
      seatSeg.appendChild(b);
    }
    attachThumb(seatSeg);
    open.appendChild(seatSeg);

    const rk = el('button', 'g-switch');
    rk.type = 'button';
    rk.dataset.testid = 'online-ranked';
    rk.setAttribute('role', 'switch');
    const on = ranked && status.rankedEntitled;
    rk.setAttribute('aria-checked', String(on));
    rk.setAttribute('aria-label', `Ranked: ${on ? 'on' : 'off'}`);
    rk.textContent = 'Ranked';
    const track = el('span', 'g-switch-track');
    track.setAttribute('aria-hidden', 'true');
    rk.appendChild(track);
    rk.disabled = !status.rankedEntitled;
    rk.addEventListener('click', () => {
      ranked = !ranked;
      paint();
    });
    open.appendChild(rk);
    open.appendChild(button('pill primary', 'online-create', 'Open a table', () => void openTable('room-create', { seats, ranked: on })));
    group.appendChild(open);

    const join = el('div', 'ol-row');
    join.appendChild(el('span', 'ol-row-label', 'Join a table'));
    const code = el('input', 'mp-input ol-input ol-code');
    code.type = 'text';
    code.dataset.testid = 'online-code';
    code.placeholder = 'XXXXX-XXXXX';
    code.maxLength = 16;
    code.spellcheck = false;
    code.value = draftCode;
    code.setAttribute('aria-label', 'Table code');
    code.addEventListener('input', () => (draftCode = code.value));
    join.appendChild(code);
    join.appendChild(button('pill', 'online-join', 'Join', () => void openTable('room-join', { code: draftCode.trim() })));
    group.appendChild(join);
    wrap.appendChild(group);

    if (!status.rankedEntitled) {
      const pro = el('p', 'g-caption', 'Ranked play is part of Offsuit Pro. Unranked tables are free.');
      pro.dataset.testid = 'online-ranked-pro';
      if (options.onOpenPro !== undefined) {
        pro.appendChild(document.createTextNode(' '));
        pro.appendChild(button('pill sm quiet', 'pro-gate-open', 'What Pro adds', () => options.onOpenPro?.()));
      }
      wrap.appendChild(pro);
    }
    wrap.appendChild(
      el(
        'p',
        'g-caption',
        'A table holds 2 to 6 players. Share its code with the people you want at it. Ranked tables count toward the ladder; unranked tables are not scored.',
      ),
    );
    return wrap;
  }

  function loadState<T>(load: Load<T>, testid: string, render: (data: T) => HTMLElement): HTMLElement {
    if (load.state === 'ok') return render(load.data);
    const box = el('div', 'ol-loading g-caption', load.state === 'error' ? load.error : 'Loading…');
    box.dataset.testid = testid;
    box.dataset.state = load.state;
    return box;
  }

  function boardList(board: Board, rowTestid: string): HTMLElement {
    const list = el('div', 'g-flat ol-board');
    for (const row of board.rows) list.appendChild(boardRow(row, rowTestid));
    return list;
  }

  function boardRow(row: BoardRow, testid: string): HTMLElement {
    const r = el('div', 'ol-board-row');
    r.dataset.testid = testid;
    r.dataset.you = String(row.you);
    const place = el('span', 'ol-place g-num', `${row.tiedAbove ? '≈' : ''}${row.place}`);
    r.appendChild(place);
    r.appendChild(el('span', 'ol-name', row.you ? `${row.name} (you)` : row.name));
    const score = el('span', 'ol-score');
    score.appendChild(el('span', 'ol-score-num g-num', fmt(row.rating.bbPer100)));
    score.appendChild(el('span', 'g-caption', SCORE_CAPTION));
    r.appendChild(score);
    const meta = el('span', 'ol-meta');
    meta.appendChild(el('span', 'g-num', `${fmt(row.rating.low)}–${fmt(row.rating.high)}`));
    meta.appendChild(el('span', 'g-caption g-num', `${row.rating.decisions} decisions`));
    r.appendChild(meta);
    return r;
  }

  function ladderTab(): HTMLElement {
    const wrap = el('div', 'ol-ladder');
    wrap.dataset.testid = 'online-ladder';
    const scroller = el('div', 'ol-scroll g-sect');
    scroller.appendChild(
      loadState(ladder, 'online-ladder-loading', (board) => {
        if (board.rows.length === 0) {
          const empty = el(
            'p',
            'g-sub ol-empty',
            'Nobody is rated yet this season. A player is rated after 200 graded decisions against at least 3 different people.',
          );
          empty.dataset.testid = 'online-ladder-empty';
          return empty;
        }
        return boardList(board, 'online-ladder-row');
      }),
    );
    wrap.appendChild(scroller);
    const foot = el('div', 'ol-foot');
    foot.appendChild(
      el(
        'p',
        'g-caption',
        'Lower is better. Scored by the same grader the coach uses, recomputed on the server from its own record of each hand — never chips, never who won. Rows marked ≈ cannot be told apart by the data yet.',
      ),
    );
    if (ladder.state === 'ok') {
      const n = ladder.data.calibrating;
      const cal = el('p', 'g-caption g-num', `${n} ${n === 1 ? 'player' : 'players'} still calibrating`);
      cal.dataset.testid = 'online-calibrating';
      foot.appendChild(cal);
    }
    wrap.appendChild(foot);
    return wrap;
  }

  function seasonTab(): HTMLElement {
    const wrap = el('div', 'ol-season');
    wrap.dataset.testid = 'online-season';
    wrap.appendChild(
      loadState(season, 'online-season-loading', (s) => {
        const body = el('div', 'ol-season-body');
        const hero = el('div', 'ol-hero');
        const you = s.you;
        if (you.rated) {
          const num = el('span', 'ol-hero-num t-hero g-num', fmt(you.bbPer100));
          num.dataset.testid = 'online-season-score';
          hero.appendChild(num);
          const lbl = el('span', 'ol-hero-lbl');
          lbl.appendChild(el('b', '', SCORE_CAPTION));
          lbl.appendChild(el('span', 'g-caption g-num', `95% of the time between ${fmt(you.low)} and ${fmt(you.high)}`));
          hero.appendChild(lbl);
        } else {
          const num = el('span', 'ol-hero-num t-stat', 'Calibrating');
          num.dataset.testid = 'online-season-score';
          hero.appendChild(num);
          const lbl = el('span', 'ol-hero-lbl');
          lbl.appendChild(el('b', 'g-num', `${you.decisions} of ${you.needed} decisions`));
          lbl.appendChild(
            el('span', 'g-caption', you.decisions > 0 ? `So far ${fmt(you.bbPer100)} ${SCORE_CAPTION}, ${fmt(you.low)}–${fmt(you.high)}` : 'No graded decisions yet'),
          );
          hero.appendChild(lbl);
        }
        body.appendChild(hero);

        const facts = el('div', 'g-sect g-flat ol-facts');
        const fact = (label: string, value: string, testid?: string): void => {
          const row = el('div', 'ol-fact');
          row.appendChild(el('span', 'g-label', label));
          const v = el('span', 'ol-fact-v g-num', value);
          if (testid) v.dataset.testid = testid;
          row.appendChild(v);
          facts.appendChild(row);
        };
        fact('Different people played', `${you.opponents} of ${you.minOpponents}`, 'online-season-opponents');
        fact('Season', `${s.season} · ${s.start} to ${s.end}`);
        fact('Grader', `version ${s.graderVersion}`);
        fact(
          'Last season',
          s.last === null ? 'none' : s.last.rated ? `${fmt(s.last.bbPer100)} ${SCORE_CAPTION}` : `not rated (${s.last.decisions} decisions)`,
        );
        if (s.closed) fact('Ranked play', s.closed, 'online-season-closed');
        body.appendChild(facts);
        body.appendChild(el('p', 'g-caption', 'Seasons are calendar months (UTC). Each starts empty. No prizes, ever.'));
        return body;
      }),
    );
    wrap.appendChild(yourData());
    return wrap;
  }

  function yourData(): HTMLElement {
    const box = el('div', 'ol-data');
    box.dataset.testid = 'online-your-data';
    const row = el('div', 'ol-data-row');
    row.appendChild(el('span', 'g-label', 'Your data on this server'));
    row.appendChild(button('pill sm quiet', 'online-export-data', 'Export my server data', () => void exportServerData()));
    if (confirmForget) {
      row.appendChild(
        button('pill sm ol-danger', 'online-forget-confirm', 'Delete everything this server holds about me', () => void forget()),
      );
      row.appendChild(
        button('pill sm quiet', 'online-forget-cancel', 'Keep it', () => {
          confirmForget = false;
          paint();
        }),
      );
    } else {
      row.appendChild(
        button('pill sm quiet', 'online-forget', 'Delete my server data', () => {
          confirmForget = true;
          paint();
        }),
      );
    }
    box.appendChild(row);
    if (exportData.state === 'ok') {
      box.appendChild(downloadLink('online-export-data-link', 'offsuit-server-data.json', exportData.data, 'Save offsuit-server-data.json'));
    } else if (exportData.state === 'error' || exportData.state === 'loading') {
      box.appendChild(el('p', 'g-caption', exportData.state === 'error' ? exportData.error : 'Asking the server…'));
    }
    box.appendChild(el('p', 'g-caption', 'What this holds and how long: docs/PRIVACY-ONLINE.md'));
    return box;
  }

  function leaguesTab(): HTMLElement {
    const wrap = el('div', 'ol-leagues');
    wrap.dataset.testid = 'online-leagues';

    const side = el('div', 'ol-leagues-side');
    const listBox = el('div', 'ol-scroll');
    listBox.appendChild(
      loadState(leagues, 'online-leagues-loading', (list) => {
        if (list.length === 0) {
          const empty = el('p', 'g-sub ol-empty', 'You are in no leagues yet.');
          empty.dataset.testid = 'online-leagues-empty';
          return empty;
        }
        const group = el('div', 'g-group');
        for (const l of list) {
          const r = el('button', 'g-row ol-league-row');
          r.type = 'button';
          r.dataset.testid = 'online-league-row';
          r.dataset.code = l.code;
          r.dataset.selected = String(leagueCode === l.code);
          r.appendChild(el('span', 'ol-name', l.name));
          r.appendChild(el('span', 'g-caption g-num', `${l.members} ${l.members === 1 ? 'member' : 'members'}${l.owner ? ' · yours' : ''}`));
          r.addEventListener('click', () => openLeague(l.code));
          group.appendChild(r);
        }
        return group;
      }),
    );
    side.appendChild(listBox);

    const forms = el('div', 'g-group ol-league-forms');
    const create = el('div', 'ol-row');
    const name = el('input', 'mp-input ol-input');
    name.type = 'text';
    name.dataset.testid = 'online-league-name';
    name.placeholder = 'League name';
    name.maxLength = 32;
    name.value = draftLeagueName;
    name.setAttribute('aria-label', 'League name');
    name.addEventListener('input', () => (draftLeagueName = name.value));
    create.appendChild(name);
    create.appendChild(button('pill', 'online-league-create', 'Create', () => void leagueJoinOrCreate('league-create', { name: draftLeagueName.trim() })));
    forms.appendChild(create);
    const join = el('div', 'ol-row');
    const code = el('input', 'mp-input ol-input');
    code.type = 'text';
    code.dataset.testid = 'online-league-code';
    code.placeholder = 'XXXXX-XXXXX';
    code.maxLength = 16;
    code.spellcheck = false;
    code.value = draftLeagueCode;
    code.setAttribute('aria-label', 'League code');
    code.addEventListener('input', () => (draftLeagueCode = code.value));
    join.appendChild(code);
    join.appendChild(button('pill', 'online-league-join', 'Join', () => void leagueJoinOrCreate('league-join', { code: draftLeagueCode.trim() })));
    forms.appendChild(join);
    side.appendChild(forms);
    side.appendChild(
      el('p', 'g-caption', 'A friends league shows the same score, counting every ranked decision. Invite-only: share the code with people you know.'),
    );
    wrap.appendChild(side);

    const main = el('div', 'ol-league-main');
    if (leagueCode === null) {
      main.appendChild(el('p', 'g-sub ol-empty', 'Choose a league to see its board.'));
    } else {
      main.appendChild(
        loadState(league, 'online-league-loading', (b) => {
          const view = el('div', 'ol-league-board');
          view.dataset.testid = 'online-league-board';
          const head = el('div', 'ol-league-head');
          const t = el('div', 'ol-titles');
          t.appendChild(el('span', 't-t3', b.name));
          const c = el('span', 'g-caption g-num', `Code ${formatCode(b.code)} · ${b.members} ${b.members === 1 ? 'member' : 'members'}`);
          c.dataset.testid = 'online-league-code-shown';
          t.appendChild(c);
          head.appendChild(t);
          head.appendChild(button('pill sm quiet', 'online-league-leave', 'Leave league', () => void leaveLeague(b.code)));
          view.appendChild(head);
          const scroller = el('div', 'ol-scroll g-sect');
          if (b.rows.length === 0) {
            scroller.appendChild(el('p', 'g-sub ol-empty', 'Nobody here is rated yet. A player is rated after 200 graded decisions.'));
          } else scroller.appendChild(boardList(b, 'online-league-board-row'));
          view.appendChild(scroller);
          const cal = el('p', 'g-caption g-num', `Lower is better. ${b.calibrating} still calibrating.`);
          view.appendChild(cal);
          return view;
        }),
      );
    }
    wrap.appendChild(main);
    return wrap;
  }

  // ── table ──

  function tablePanel(): HTMLElement {
    const panel = el('div', 'ol-table');
    panel.dataset.testid = 'online-table';
    const view = client.view;

    const left = el('div', 'ol-table-main');
    const t = renderRoomTable(view, {
      lastError: client.lastError,
      warnings: client.warnings,
      onAction: sendAction,
      dealNote: 'Next hand in a few seconds',
    });
    // Emotes sit by the seat that sent them, for a few seconds.
    for (const [seat, { emote }] of emotesShown) {
      const row = t.querySelector<HTMLElement>(`[data-testid="mp-seat"][data-seat-id="${seat}"]`);
      if (!row) continue;
      const bubble = el('span', 'ol-emote', EMOTES[emote]);
      bubble.dataset.testid = 'online-emote-shown';
      bubble.dataset.seat = String(seat);
      row.querySelector('.mp-seat-name')?.after(bubble);
    }
    left.appendChild(t);
    panel.appendChild(left);

    const side = el('div', 'ol-table-side');
    const codeBox = el('div', 'ol-room');
    codeBox.appendChild(el('span', 'g-label', 'Table code'));
    const code = el('span', 'ol-room-code t-t2 g-num', room ? formatCode(room.code) : '');
    code.dataset.testid = 'online-room-code';
    codeBox.appendChild(code);
    const tag = el('span', 'ol-tag', room?.ranked ? 'Ranked' : 'Unranked');
    tag.dataset.testid = 'online-room-ranked';
    tag.dataset.ranked = String(room?.ranked ?? false);
    const tags = el('div', 'ol-tags');
    tags.appendChild(tag);
    if (room) tags.appendChild(el('span', 'g-caption g-num', `${room.seats} seats`));
    codeBox.appendChild(tags);
    side.appendChild(codeBox);

    const clockEl = el('div', 'ol-clock g-num');
    clockEl.dataset.testid = 'online-clock';
    paintClock(clockEl, view);
    side.appendChild(clockEl);

    const emotes = el('div', 'ol-emotes');
    emotes.setAttribute('aria-label', 'Emotes');
    for (const id of EMOTE_IDS) {
      emotes.appendChild(button('pill sm', `online-emote-${id}`, EMOTES[id], () => void bridge.onlineEmote?.(id)));
    }
    side.appendChild(emotes);
    side.appendChild(el('p', 'g-caption', 'Preset words only; nobody can type to you here.'));

    side.appendChild(
      button('pill quiet ol-leave', 'online-leave', 'Leave table', () => {
        void request('room-leave').then((r) => {
          if (r.ok) {
            leaveTableLocally();
            if (phase === 'table') enterLobby();
          } else notice = r.error;
          paint();
        });
      }),
    );
    panel.appendChild(side);
    return panel;
  }

  function paintClock(node: HTMLElement, view: RoomView | null = client.view): void {
    if (clock === null || view === null || view.winners !== null) {
      node.hidden = true;
      node.textContent = '';
      return;
    }
    const seconds = Math.max(0, Math.ceil((clock.deadline - Date.now()) / 1000));
    const seat = view.seats[clock.seat];
    const who = seat ? (seat.isYou ? 'You' : seat.name) : `Seat ${clock.seat + 1}`;
    node.hidden = false;
    node.dataset.seat = String(clock.seat);
    node.dataset.seconds = String(seconds);
    node.textContent = `${who} · ${seconds} s to act`;
  }

  paint();
  return root;
}
