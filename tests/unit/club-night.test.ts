// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createNightController, renderClubSpot, renderNightRecap, spotChoices } from '../../src/renderer/screens/club.js';
import { renderMultiplayerScreen, type MultiplayerBridge } from '../../src/renderer/screens/multiplayer.js';
import { defaultProgression, parseProgression } from '../../src/core/progression/persist.js';
import { startNight } from '../../src/core/club/gameNight.js';
import { encodeClubCode, nightIdOf } from '../../src/core/club/codes.js';
import { formatInvite } from '../../src/core/relayClient.js';
import type { ClubState } from '../../src/core/progression/types.js';
import type { RoomView } from '../../src/core/multiplayer.js';
import type { DayKey } from '../../src/core/localDay.js';

/**
 * The Game Night's lifecycle over the LAN table screen (review round 1): leaving a night tears its table screen
 * down for good, a night left or ended and then rejoined carries on instead of starting empty, a deleted profile
 * gets nothing written back, and a night joined from the fallback panel is still recorded.
 */

const DAY = 20_000 as DayKey;
const FP = 'A'.repeat(43);
const INVITE = formatInvite({ host: '127.0.0.1', port: 4000, fingerprint: FP, token: 'B'.repeat(22) });

function fakeBridge() {
  const handlers = new Set<(e: unknown) => void>();
  const calls = { stop: 0, host: 0, join: [] as string[] };
  const bridge: MultiplayerBridge = {
    mpStatus: async () => ({ enabled: true, active: false }),
    mpHost: async () => {
      calls.host += 1;
      return { port: 4000, addresses: [], invites: [], fingerprint: FP, token: 'B'.repeat(22) };
    },
    mpJoin: async (r) => {
      calls.join.push(r.invite);
      return { joined: true };
    },
    mpStop: async () => {
      calls.stop += 1;
    },
    onMpEvent: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
  return { bridge, calls, handlers, emit: (e: unknown) => [...handlers].forEach((h) => h(e)) };
}

function dealtView(hand = 1, winners: RoomView['winners'] = null): RoomView {
  return {
    roomId: 'local',
    you: 'local',
    seats: [
      { id: 0, name: 'Sam', stack: 4950, committed: 50, folded: false, allIn: false, hole: ['Ah', 'Kd'], isYou: true, inHand: true },
      { id: 1, name: 'Ada', stack: 4975, committed: 25, folded: false, allIn: false, hole: null, isYou: false, inHand: true },
    ],
    board: [],
    street: 'preflop',
    pot: 75,
    currentBet: 50,
    toAct: 1,
    dealer: 1,
    handNumber: hand,
    winners,
    legal: [],
    yourTurn: false,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(start: { role: 'host'; seatCount: number } | { role: 'join'; invite: string }, club0: ClubState = defaultProgression().club) {
  let club = club0;
  const saves: ClubState[] = [];
  const ended: string[] = [];
  const controller = createNightController({
    role: start.role,
    start,
    name: 'Sam',
    clubName: 'Thursday table',
    today: DAY,
    now: () => 1_000,
    dee: false,
    club: () => club,
    save: (c) => {
      club = c;
      saves.push(c);
    },
    onEnded: (n) => ended.push(n),
  });
  return { controller, saves, ended, club: () => club };
}

describe('a Game Night over the LAN table', () => {
  it('leaving the night stops its table for good: a later session is never stopped by the old screen', async () => {
    const b = fakeBridge();
    const h = harness({ role: 'host', seatCount: 2 });
    const root = renderMultiplayerScreen({ bridge: b.bridge, night: h.controller });
    document.body.appendChild(root);
    await flush();
    b.emit({ type: 'state', view: dealtView() });
    expect(h.club().nights).toHaveLength(1);
    root.remove();
    const id = h.controller.leave();
    expect(id).toBe(nightIdOf(FP));
    const stops = b.calls.stop;
    expect(b.handlers.size, 'the old screen still listens').toBe(0);
    b.emit({ type: 'state', view: dealtView(1) });
    expect(b.calls.stop, 'the old screen stopped a newer session').toBe(stops);
    expect(h.club().nights[0].endedAt).toBe(1_000);
  });

  it('a night ended and then rejoined at the same table carries on with what it had', async () => {
    const b = fakeBridge();
    const h = harness({ role: 'join', invite: INVITE });
    const root = renderMultiplayerScreen({ bridge: b.bridge, night: h.controller });
    document.body.appendChild(root);
    await flush();
    b.emit({ type: 'state', view: dealtView(1) });
    b.emit({ type: 'state', view: dealtView(1, []) });
    expect(h.club().nights[0].hands).toBe(1);
    h.controller.leave();
    root.remove();

    const again = harness({ role: 'join', invite: INVITE }, h.club());
    const b2 = fakeBridge();
    const root2 = renderMultiplayerScreen({ bridge: b2.bridge, night: again.controller });
    document.body.appendChild(root2);
    await flush();
    b2.emit({ type: 'state', view: dealtView(2) });
    expect(again.club().nights).toHaveLength(1);
    expect(again.club().nights[0].hands, 'the rejoin wiped the night').toBe(1);
    expect(again.club().nights[0].endedAt).toBeNull();
    root2.remove();
    again.controller.abandon();
  });

  it('abandoning a night (the profile was deleted) stops the table and saves nothing', async () => {
    const b = fakeBridge();
    const h = harness({ role: 'host', seatCount: 2 });
    const root = renderMultiplayerScreen({ bridge: b.bridge, night: h.controller });
    document.body.appendChild(root);
    await flush();
    b.emit({ type: 'state', view: dealtView() });
    const saved = h.saves.length;
    h.controller.abandon();
    expect(h.saves.length).toBe(saved);
    expect(b.handlers.size).toBe(0);
    expect(b.calls.stop).toBeGreaterThan(0);
    root.remove();
  });

  it('a night joined from the fallback panel is still recorded, as a join, under that table', async () => {
    const b = fakeBridge();
    const h = harness({ role: 'join', invite: 'not an invite' });
    const root = renderMultiplayerScreen({ bridge: b.bridge, night: h.controller });
    document.body.appendChild(root);
    await flush();
    const input = root.querySelector<HTMLInputElement>('[data-testid="mp-join-invite"]')!;
    input.value = INVITE;
    root.querySelector<HTMLButtonElement>('[data-testid="mp-join"]')!.click();
    await flush();
    b.emit({ type: 'state', view: dealtView(1) });
    expect(h.club().nights.map((n) => [n.night, n.role])).toEqual([[nightIdOf(FP), 'join']]);
    h.controller.abandon();
    root.remove();
  });
});

describe('saved values the club cannot show are dropped or read as unknown, never thrown on', () => {
  it('a night or recap whose day no code can carry is dropped on read', () => {
    const night = { ...startNight('0a1b2c3d', -5 as DayKey, 'host', 1) };
    expect(parseProgression({ club: { nights: [night] } }).club.nights).toEqual([]);
  });

  it('the recap renders for any night the parser keeps', () => {
    const night = { ...startNight('0a1b2c3d', DAY, 'host', 1), hands: 2_000_000, decisions: 5, clean: 9 };
    const club = parseProgression({ club: { name: 'T', nights: [night] } }).club;
    expect(() => renderNightRecap({ night: club.nights[0], club, displayName: null, now: () => 1, save: () => undefined, onReviewSpot: () => undefined, onDone: () => undefined })).not.toThrow();
  });

  it('a notebook answer from a newer build reads as not answered', () => {
    const spot = { hole: ['Ah', 'Kd'] as [string, string], board: [], bb: 50, pot: 75, toCall: 25, stack: 4975, opponents: 1, chosen: null };
    const entry = { at: 1, code: encodeClubCode({ kind: 'spot', spot }), from: 'Ada', note: '', answer: 'jam' };
    const root = renderClubSpot({ entry, spot, onAnswer: () => undefined, onBack: () => undefined });
    expect(root.dataset.answered).toBe('false');
  });

  it('a price the stack cannot cover offers fold or call, not a raise', () => {
    const spot = { hole: ['Ah', 'Kd'] as [string, string], board: [], bb: 50, pot: 600, toCall: 400, stack: 400, opponents: 1, chosen: null };
    expect(spotChoices(spot)).toEqual(['fold', 'call']);
  });
});
