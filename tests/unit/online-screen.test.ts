// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderOnlineScreen, type OnlineBridge } from '../../src/renderer/screens/online.js';
import { renderMultiplayerScreen } from '../../src/renderer/screens/multiplayer.js';
import type { RoomView } from '../../src/core/multiplayer.js';

/**
 * The online screen over a fake bridge: the setup gate, the lobby tabs and their requests, the table
 * entered and left by pushed events, and the unmount rule (leave a table, never disconnect).
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const q = (root: HTMLElement, id: string): HTMLElement | null => root.querySelector(`[data-testid="${id}"]`);
const qa = (root: HTMLElement, id: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

function status(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    enabled: true,
    server: 'play.example.com',
    pin: '',
    name: 'Ada',
    adultOn: '2026-10-01',
    status: 'offline',
    keyId: 'abcdefghij',
    room: null,
    season: null,
    rankedEntitled: false,
    ...over,
  };
}

const rating = (bb: number, n = 250) => ({ decisions: n, bbPer100: bb, low: bb - 1, high: bb + 1, rated: true });

const LADDER = {
  season: '2026-10',
  calibrating: 4,
  rows: [
    { keyId: 'k1', name: 'Bo', rating: rating(3.2), place: 1, tiedAbove: false, you: false },
    { keyId: 'k2', name: 'Ada', rating: rating(3.9), place: 2, tiedAbove: true, you: true },
  ],
};

const SEASON = {
  season: '2026-10',
  graderVersion: 1,
  start: '2026-10-01',
  end: '2026-10-31',
  ranked: true,
  closed: null,
  you: { decisions: 120, bbPer100: 5.1, low: 3, high: 7.2, rated: false, opponents: 2, needed: 200, minOpponents: 3 },
  last: null,
};

const VIEW: RoomView = {
  roomId: 'r',
  you: 0 as never,
  seats: [
    { id: 0, name: 'Ada', stack: 990, committed: 10, folded: false, allIn: false, hole: ['As', 'Kh'], isYou: true },
    { id: 1, name: 'Bo', stack: 980, committed: 20, folded: false, allIn: false, hole: null, isYou: false },
  ] as never,
  board: [],
  street: 'preflop',
  pot: 30,
  currentBet: 20,
  toAct: 0,
  dealer: 0,
  handNumber: 1,
  winners: null,
  legal: ['fold', 'call', 'raise'],
  yourTurn: true,
};

interface Fake {
  bridge: OnlineBridge;
  emit: (event: unknown) => void;
  calls: { op: string; fields?: unknown }[];
  spies: Record<string, ReturnType<typeof vi.fn>>;
}

function fakeBridge(initial: Record<string, unknown> = status()): Fake {
  let handler: ((e: unknown) => void) | null = null;
  const calls: { op: string; fields?: unknown }[] = [];
  const replies: Record<string, unknown> = {
    ladder: { ok: true, data: LADDER },
    season: { ok: true, data: SEASON },
    leagues: { ok: true, data: [{ code: 'ABCDE12345', name: 'Friday', members: 4, owner: true }] },
    'league-board': { ok: true, data: { code: 'ABCDE12345', name: 'Friday', members: 4, ...LADDER } },
    'room-create': { ok: true, data: { code: 'QRSTV67890', ranked: false, seats: 6, creator: true } },
    'room-leave': { ok: true, data: undefined },
    export: { ok: true, data: { name: 'Ada' } },
    forget: { ok: true, data: undefined },
  };
  const spies = {
    onlineStatus: vi.fn(async () => initial),
    onlineConfigure: vi.fn(async (patch: Record<string, unknown>) => ({ ok: true, data: { ...initial, ...patch } })),
    onlineConnect: vi.fn(async () => ({ ok: true, data: { ...initial, status: 'online', season: '2026-10' } })),
    onlineRequest: vi.fn(async (op: string, fields?: unknown) => {
      calls.push({ op, fields });
      return replies[op] ?? { ok: false, error: 'no' };
    }),
    onlineAction: vi.fn(async () => undefined),
    onlineEmote: vi.fn(async () => undefined),
    onlineLeave: vi.fn(async () => undefined),
    onlineDisconnect: vi.fn(async () => undefined),
    onlineExportIdentity: vi.fn(async () => '{"identity":"x"}'),
  };
  const bridge: OnlineBridge = {
    ...spies,
    onOnlineEvent: (h) => {
      handler = h;
      return () => {
        handler = null;
      };
    },
  } as OnlineBridge;
  return { bridge, emit: (e) => handler?.(e), calls, spies };
}

describe('online screen', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    root?.remove();
  });

  it('opens on setup, prefilled from onlineStatus, with every control and the honest copy', async () => {
    const fake = fakeBridge(status({ enabled: false }));
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    expect(root.dataset.onlinePhase).toBe('setup');
    expect(q(root, 'online-setup')).not.toBeNull();
    expect(q(root, 'online-announcer')?.getAttribute('role')).toBe('status');
    expect((q(root, 'online-server') as HTMLInputElement).value).toBe('play.example.com');
    expect((q(root, 'online-server') as HTMLInputElement).placeholder).toBe('play.example.com');
    expect((q(root, 'online-pin') as HTMLInputElement).placeholder).toBe('Certificate pin (only for a self-signed server)');
    expect((q(root, 'online-name') as HTMLInputElement).maxLength).toBe(16);
    expect((q(root, 'online-name') as HTMLInputElement).value).toBe('Ada');
    expect(q(root, 'online-adult')).not.toBeNull();
    expect(root.textContent).toContain('I am 18 or over. Online play is for adults; there are no prizes, ever.');
    expect(root.textContent).toContain('Details: docs/PRIVACY-ONLINE.md');
    const sw = q(root, 'online-enable')!;
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(q(root, 'online-connect')?.classList.contains('primary')).toBe(true);
    expect(root.querySelectorAll('.pill.primary').length).toBe(1);

    sw.click();
    await flush();
    expect(fake.spies.onlineConfigure).toHaveBeenCalledWith({ enabled: true });
    expect(q(root, 'online-enable')?.getAttribute('aria-checked')).toBe('true');
    for (const word of ['percentile', 'XP', 'streak', 'badge', 'trophy']) expect(root.textContent).not.toContain(word);
  });

  it('shows configure and connect errors in the notice', async () => {
    const fake = fakeBridge();
    fake.spies.onlineConfigure.mockResolvedValueOnce({ ok: false, error: 'That is not a server address.' });
    fake.spies.onlineConnect.mockResolvedValueOnce({ ok: false, error: 'Online play is for people 18 or over.' });
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    const server = q(root, 'online-server') as HTMLInputElement;
    server.value = 'not a host!';
    server.dispatchEvent(new Event('input'));
    server.dispatchEvent(new Event('change'));
    await flush();
    expect(q(root, 'online-notice')?.textContent).toBe('That is not a server address.');
    q(root, 'online-connect')!.click();
    expect(root.dataset.onlinePhase).toBe('connecting');
    expect(q(root, 'online-connecting')?.textContent).toBe('Connecting…');
    await flush();
    expect(root.dataset.onlinePhase).toBe('setup');
    expect(q(root, 'online-notice')?.textContent).toBe('Online play is for people 18 or over.');
  });

  it('exports the device identity as a download link with a caution', async () => {
    const fake = fakeBridge();
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    q(root, 'online-export-identity')!.click();
    await flush();
    const link = q(root, 'online-export-link') as HTMLAnchorElement;
    expect(link.download).toBe('offsuit-online-identity.json');
    expect(root.textContent).toContain('anyone with it can play as you');
    fake.spies.onlineExportIdentity.mockResolvedValueOnce(null);
    q(root, 'online-export-identity')!.click();
    await flush();
    expect(q(root, 'online-export-link')).toBeNull();
    expect((q(root, 'online-export-identity') as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks setup → lobby → table → lobby by events, and reads the ladder, season and leagues', async () => {
    const fake = fakeBridge();
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    (q(root, 'online-adult') as HTMLInputElement).click();
    (q(root, 'online-adult') as HTMLInputElement).click();
    q(root, 'online-connect')!.click();
    await flush();
    expect(fake.spies.onlineConnect).toHaveBeenCalledWith({ name: 'Ada', adult: true });
    expect(root.dataset.onlinePhase).toBe('lobby');
    expect(q(root, 'online-title')?.textContent).toBe('Online · play.example.com');
    expect(q(root, 'online-season-id')?.textContent).toContain('2026-10');
    for (const t of ['play', 'ladder', 'season', 'leagues']) expect(q(root, `online-tab-${t}`)).not.toBeNull();
    expect(q(root, 'online-disconnect')).not.toBeNull();

    // Play tab: ranked is Pro-only here.
    expect((q(root, 'online-ranked') as HTMLButtonElement).disabled).toBe(true);
    expect(root.textContent).toContain('Ranked play is part of Offsuit Pro.');
    expect(q(root, 'online-seats')).not.toBeNull();
    expect(q(root, 'online-code')?.getAttribute('placeholder')).toBe('XXXXX-XXXXX');
    expect(root.querySelectorAll('.pill.primary').length).toBe(1);

    // Ladder.
    q(root, 'online-tab-ladder')!.click();
    await flush();
    const rows = qa(root, 'online-ladder-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].dataset.you).toBe('true');
    expect(rows[1].textContent).toContain('≈2');
    expect(rows[0].textContent).toContain('bb lost / 100 decisions');
    expect(rows[0].textContent).toContain('2.2–4.2');
    expect(q(root, 'online-calibrating')?.textContent).toBe('4 players still calibrating');
    expect(root.textContent).toContain('Lower is better.');

    // Season.
    q(root, 'online-tab-season')!.click();
    await flush();
    expect(q(root, 'online-season')?.textContent).toContain('Calibrating');
    expect(q(root, 'online-season')?.textContent).toContain('120 of 200 decisions');
    expect(q(root, 'online-season-opponents')?.textContent).toBe('2 of 3');
    expect(root.textContent).toContain('No prizes, ever.');
    q(root, 'online-export-data')!.click();
    await flush();
    expect((q(root, 'online-export-data-link') as HTMLAnchorElement).download).toBe('offsuit-server-data.json');

    // Leagues.
    q(root, 'online-tab-leagues')!.click();
    await flush();
    expect(qa(root, 'online-league-row')).toHaveLength(1);
    qa(root, 'online-league-row')[0].click();
    await flush();
    expect(q(root, 'online-league-board')).not.toBeNull();
    expect(q(root, 'online-league-board')?.textContent).toContain('ABCDE-12345');
    expect(q(root, 'online-league-leave')).not.toBeNull();

    // Open a table → the table phase.
    q(root, 'online-tab-play')!.click();
    await flush();
    q(root, 'online-create')!.click();
    await flush();
    expect(fake.calls.find((c) => c.op === 'room-create')?.fields).toEqual({ seats: 6, ranked: false });
    expect(root.dataset.onlinePhase).toBe('table');
    expect(q(root, 'online-room-code')?.textContent).toBe('QRSTV-67890');
    expect(q(root, 'online-room-ranked')?.textContent).toBe('Unranked');

    fake.emit({ type: 'state', view: VIEW });
    fake.emit({ type: 'clock', seat: 0, ms: 15_000 });
    fake.emit({ type: 'emote', seat: 1, emote: 'gg' });
    expect(qa(root, 'mp-seat')).toHaveLength(2);
    expect(q(root, 'online-clock')?.textContent).toContain('15 s');
    expect(q(root, 'online-emote-shown')?.textContent).toBe('Good game');
    expect(q(root, 'online-emote-shown')?.dataset.seat).toBe('1');
    expect(q(root, 'online-emote-hello')).not.toBeNull();
    q(root, 'online-emote-thanks')!.click();
    expect(fake.spies.onlineEmote).toHaveBeenCalledWith('thanks');

    // Keyboard and buttons go to onlineAction.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(fake.spies.onlineAction).toHaveBeenCalledWith({ kind: 'call' });
    q(root, 'mp-fold')!.click();
    expect(fake.spies.onlineAction).toHaveBeenCalledWith({ kind: 'fold' });

    // Hand over: no Next hand button, the server deals.
    fake.emit({ type: 'state', view: { ...VIEW, winners: [{ seatId: 1, amount: 30, description: 'pair' }], legal: [], yourTurn: false } });
    expect(q(root, 'mp-deal')).toBeNull();
    expect(root.textContent).toContain('Next hand in a few seconds');

    // Reconnecting banner, then back.
    fake.emit({ type: 'status', status: 'reconnecting' });
    expect(q(root, 'online-reconnecting')?.textContent).toBe('Reconnecting… your seat is held for a minute');
    fake.emit({ type: 'status', status: 'online' });
    expect(q(root, 'online-reconnecting')).toBeNull();

    // Removed → lobby with the reason.
    fake.emit({ type: 'removed', reason: 'The table closed.' });
    expect(root.dataset.onlinePhase).toBe('lobby');
    expect(q(root, 'online-notice')?.textContent).toBe('The table closed.');

    // A room event re-enters the table; room null returns to the lobby.
    fake.emit({ type: 'room', room: { code: 'QRSTV67890', ranked: true, seats: 6, creator: false } });
    expect(root.dataset.onlinePhase).toBe('table');
    expect(q(root, 'online-room-ranked')?.textContent).toBe('Ranked');
    fake.emit({ type: 'room', room: null });
    expect(root.dataset.onlinePhase).toBe('lobby');

    // Offline with a reason → setup with the reason.
    fake.emit({ type: 'status', status: 'offline', reason: 'Could not reach the server.' });
    expect(root.dataset.onlinePhase).toBe('setup');
    expect(q(root, 'online-notice')?.textContent).toBe('Could not reach the server.');
  });

  it('a Leave table pill asks the server, and leaving the screen at a table leaves it (no disconnect)', async () => {
    const fake = fakeBridge(status({ status: 'online', season: '2026-10', room: { code: 'QRSTV67890', ranked: false, seats: 2, creator: true } }));
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    expect(root.dataset.onlinePhase).toBe('table');
    q(root, 'online-leave')!.click();
    await flush();
    expect(fake.calls.some((c) => c.op === 'room-leave')).toBe(true);
    expect(root.dataset.onlinePhase).toBe('lobby');

    fake.emit({ type: 'room', room: { code: 'QRSTV67890', ranked: false, seats: 2, creator: true } });
    const onExit = vi.fn();
    root.remove();
    const again = renderOnlineScreen({ bridge: fake.bridge, onExit });
    // The first screen tore down on removal; the second one exits through its Back pill.
    document.body.appendChild(again);
    await flush();
    fake.emit({ type: 'room', room: { code: 'QRSTV67890', ranked: false, seats: 2, creator: true } });
    q(again, 'online-exit')!.click();
    expect(onExit).toHaveBeenCalled();
    expect(fake.spies.onlineLeave).toHaveBeenCalled();
    expect(fake.spies.onlineDisconnect).not.toHaveBeenCalled();
    again.remove();
  });

  it('deleting server data asks first, then returns to setup with the notice', async () => {
    const fake = fakeBridge(status({ status: 'online', season: '2026-10' }));
    root = renderOnlineScreen({ bridge: fake.bridge });
    document.body.appendChild(root);
    await flush();
    q(root, 'online-tab-season')!.click();
    await flush();
    q(root, 'online-forget')!.click();
    expect(fake.calls.some((c) => c.op === 'forget')).toBe(false);
    expect(q(root, 'online-forget-confirm')?.textContent).toBe('Delete everything this server holds about me');
    q(root, 'online-forget-confirm')!.click();
    // Main signs out after a forget: the offline status arrives before the reply.
    fake.emit({ type: 'status', status: 'offline' });
    await flush();
    expect(root.dataset.onlinePhase).toBe('setup');
    expect(q(root, 'online-notice')?.textContent).toBe('Your data on that server was deleted.');
  });
});

describe('multiplayer panel: the way to online play', () => {
  it('offers Play online in both the disabled and enabled panels', async () => {
    for (const enabled of [false, true]) {
      const onPlayOnline = vi.fn();
      const root = renderMultiplayerScreen({
        bridge: { mpStatus: async () => ({ enabled, active: false }), mpStop: async () => undefined },
        onPlayOnline,
      });
      document.body.appendChild(root);
      await flush();
      const go = q(root, 'mp-play-online');
      expect(go, `enabled=${enabled}`).not.toBeNull();
      expect(root.textContent).toContain('Play online — an Offsuit server, ranked ladder and leagues');
      go!.click();
      expect(onPlayOnline).toHaveBeenCalled();
      root.remove();
    }
  });
});
