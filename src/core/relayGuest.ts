/**
 * RELAY GUEST — the joining player's half of the deal handshake, and its check of every card shown.
 *
 * A pure fold over ServerMessages (no socket, no crypto import: SHA-256 and the CSPRNG are injected),
 * so the exact code main runs for a guest is driven directly against RelayServer in unit tests. For
 * each message it returns what to send back and what to tell the UI:
 *
 *   state     a view that passed verification (or one for a hand this guest only watches)
 *   error     the host's error for this guest
 *   warning   a deal event that is visible, not proof of cheating: the host restarted a deal after
 *             this guest had revealed (honest when a player leaves mid-deal; repeated, it is a host
 *             choosing deals)
 *   violation the host showed a card that does not open its commitment, reused a card, changed the
 *             published commitments, left this guest's entropy out, dealt this guest cards with no
 *             commitment, or sent a malformed view. The session must end.
 *   verified  a hand ended and every card this guest saw opened its commitment
 *
 * After a violation the protocol is broken for good and ignores everything, so a cheating host cannot
 * talk its way back in.
 */

import type { Card } from './cards.js';
import {
  boardIndex,
  deriveSigma,
  entropyCommitment,
  expectedDealOrder,
  freshEntropy,
  holeIndex,
  isHex64,
  leafHash,
  wellFormedCommit,
  type CardOpening,
  type CommitMessage,
  type DealCrypto,
  type DealtMessage,
  type EntropySetMessage,
} from './dealCommit.js';
import type { ClientMessage, ResyncMessage, RoomView, SeatView, ServerMessage } from './multiplayer.js';

/**
 * What a guest remembers across connections to one server: the entropy it revealed per deal. An online
 * client reconnects with a fresh protocol, and a `resync` for a deal it revealed into must carry that
 * entropy, or the server dealt that hand without it.
 */
export interface GuestMemory {
  readonly revealed: (nonce: string) => string | undefined;
  readonly remember: (nonce: string, entropy: string) => void;
}

export type GuestEvent =
  | { readonly type: 'welcome'; readonly v: number }
  | { readonly type: 'state'; readonly view: RoomView }
  | { readonly type: 'error'; readonly reason: string }
  | { readonly type: 'warning'; readonly reason: string }
  | { readonly type: 'violation'; readonly reason: string }
  | { readonly type: 'verified'; readonly hand: number; readonly cards: number };

export interface GuestStep {
  readonly send: ClientMessage[];
  readonly events: GuestEvent[];
}

/** The most seats a room can have (multiplayer.createRoom); a commit is checked against it before any view. */
const MAX_SEATS = 6;

interface Pending {
  readonly commit: CommitMessage;
  readonly entropy: string;
  readonly commitment: string;
  set: EntropySetMessage | null;
  revealed: boolean;
}

interface Live {
  readonly commit: CommitMessage;
  readonly sigma: readonly number[];
  /** k → card for every card opened this hand, to catch one card opened twice. */
  readonly opened: Map<number, Card>;
  audited: boolean;
}

export class GuestProtocol {
  private pending: Pending | null = null;
  /** This guest's seat, learned from the first view that marks one and held from then on. */
  private mySeat: number | null = null;
  private live: Live | null = null;
  private readonly usedNonces = new Set<string>();
  private broken = false;

  constructor(
    private readonly crypto: DealCrypto,
    private readonly memory?: GuestMemory,
  ) {}

  /** True once a violation was found; every later message is ignored. */
  isBroken(): boolean {
    return this.broken;
  }

  receive(message: ServerMessage): GuestStep {
    if (this.broken) return { send: [], events: [] };
    let step: GuestStep;
    try {
      step = this.route(message);
    } catch {
      // Every shape is checked before use; this is the backstop, so a frame no check foresaw still ends
      // the session instead of throwing into main's socket handler.
      step = events(violation('the host sent a message this app cannot read'));
    }
    if (step.events.some((e) => e.type === 'violation')) this.broken = true;
    return step;
  }

  private route(message: ServerMessage): GuestStep {
    switch (message.type) {
      case 'welcome':
        return events({ type: 'welcome', v: message.v });
      case 'error':
        return events({ type: 'error', reason: message.reason });
      case 'state':
        return this.onState(message.view, message.openings);
      case 'commit':
        return this.onCommit(message);
      case 'entropy-set':
        return this.onSet(message);
      case 'dealt':
        return this.onDealt(message);
      case 'resync':
        return this.onResync(message);
    }
  }

  /**
   * A reconnect into a hand already dealt. Taken only by a fresh protocol: a server that resyncs a guest
   * mid-session is trying to replace a deal the guest already holds.
   */
  private onResync(resync: ResyncMessage): GuestStep {
    if (this.pending !== null || this.live !== null || this.usedNonces.size > 0) {
      return events(violation('the server replayed a deal into a live session'));
    }
    const { commit, set, dealt } = resync;
    if (!isObject(commit) || !isObject(dealt) || !wellFormedCommit(commit, MAX_SEATS)) {
      return events(violation('the server sent a malformed deal replay'));
    }
    if (dealt.nonce !== commit.nonce || dealt.hand !== commit.hand || (set !== null && (!isObject(set) || set.nonce !== commit.nonce))) {
      return events(violation('the deal replay does not belong to one deal'));
    }
    const problem = openingProblem(this.crypto, set, dealt);
    if (problem !== null) return events(violation(problem));
    const mine = this.memory?.revealed(commit.nonce);
    if (mine !== undefined && !dealt.reveals.some((r) => r.entropy === mine)) {
      return events(violation('the host dealt without the entropy you revealed'));
    }
    this.usedNonces.add(commit.nonce);
    this.live = { commit, sigma: deriveSigma(this.crypto.sha256, commit, dealt.reveals), opened: new Map(), audited: false };
    return events();
  }

  private onCommit(commit: CommitMessage): GuestStep {
    const out: GuestEvent[] = [];
    if (this.pending?.revealed) {
      // The host knew the final order and dealt nothing. Honest when a guest left mid-deal; a host that
      // does it repeatedly is choosing deals. Either way the player is told, every time.
      out.push({ type: 'warning', reason: 'The host restarted a deal after the shuffle was fixed.' });
    }
    if (!wellFormedCommit(commit, MAX_SEATS) || this.usedNonces.has(commit.nonce)) {
      return events(...out, violation('the host sent a malformed or replayed deal commitment'));
    }
    if (this.live !== null && commit.hand <= this.live.commit.hand) {
      return events(...out, violation('the host committed to a hand that was already dealt'));
    }
    this.usedNonces.add(commit.nonce);
    const { entropy, commitment } = freshEntropy(this.crypto, commit.nonce, commit.hand);
    this.pending = { commit, entropy, commitment, set: null, revealed: false };
    return { send: [{ type: 'entropy-commit', hand: commit.hand, nonce: commit.nonce, commitment }], events: out };
  }

  private onSet(set: EntropySetMessage): GuestStep {
    const pending = this.pending;
    // Not this guest's deal attempt (it joined after the commit): nothing to check or send.
    if (pending === null || set.nonce !== pending.commit.nonce || set.hand !== pending.commit.hand) return events();
    if (pending.set !== null) return events(violation('the host published the deal commitments twice'));
    if (!Array.isArray(set.commitments) || !set.commitments.every((c) => isObject(c) && isHex64(c.commitment) && Number.isInteger(c.seat))) {
      return events(violation('the host published malformed commitments'));
    }
    pending.set = set;
    const mine = set.commitments.filter((c) => c.commitment === pending.commitment);
    if (mine.length !== 1) {
      // Leaving out a guest that committed lets the host pick sigma with entropy of its own, and so
      // place this guest's cards. An honest host never does it: a guest that fails the handshake is
      // removed from the table, not dealt around.
      return events(violation('the host left your shuffle entropy out of the deal'));
    }
    pending.revealed = true;
    this.memory?.remember(set.nonce, pending.entropy);
    const reveal: ClientMessage = { type: 'entropy-reveal', hand: set.hand, nonce: set.nonce, entropy: pending.entropy };
    return { send: [reveal], events: [] };
  }

  private onDealt(dealt: DealtMessage): GuestStep {
    const pending = this.pending;
    if (pending === null || dealt.nonce !== pending.commit.nonce || dealt.hand !== pending.commit.hand) return events();
    this.pending = null;
    const set = pending.set;
    if (set === null) return events(violation('the host dealt without publishing the entropy commitments'));
    const problem = openingProblem(this.crypto, set, dealt);
    if (problem !== null) return events(violation(problem));
    const reveals = dealt.reveals;
    if (pending.revealed && !reveals.some((r) => r.entropy === pending.entropy)) {
      return events(violation('the host dealt without the entropy you revealed'));
    }
    this.live = { commit: pending.commit, sigma: deriveSigma(this.crypto.sha256, pending.commit, reveals), opened: new Map(), audited: false };
    return events();
  }

  private onState(view: RoomView, openings: readonly CardOpening[] | undefined): GuestStep {
    // Shape first: a malformed frame must become a violation here, never an exception in main.
    const malformed = malformedView(view) ?? (Array.isArray(openings) && openings.every(isObject) ? null : 'openings');
    if (malformed !== null) return events(violation(`the host sent a malformed view (${malformed})`));
    // The guest's seat is learned once and then held: the host-supplied `isYou` cannot move it, hide it,
    // or (by leaving it off) switch verification off.
    const flagged = view.seats.filter((s) => s.isYou);
    if (flagged.length > 1) return events(violation('the view marks more than one seat as yours'));
    if (this.mySeat === null && flagged.length === 1) this.mySeat = flagged[0].id;
    if (this.mySeat !== null && flagged[0]?.id !== this.mySeat) return events(violation('the host moved or hid your seat'));
    const showsCards = view.board.length > 0 || view.seats.some((s) => s.hole !== null);
    const live = this.live;
    if (view.handNumber === 0 || !showsCards) return events({ type: 'state', view });
    if (live === null || view.handNumber > live.commit.hand) {
      // A hand with no completed handshake: only watching is allowed. No hole is shown before showdown
      // (showdown hands are public, even one on the seat this guest has since taken), and it is never
      // this guest's turn.
      const early = view.street !== 'showdown' && view.seats.some((s) => s.hole !== null);
      if (flagged.length === 0 || early || view.yourTurn) {
        return events(violation('you were shown cards for a hand the host never committed to'));
      }
      return events({ type: 'state', view });
    }
    if (view.handNumber < live.commit.hand) return events(violation('the host sent a view of an earlier hand'));
    const problem = this.verify(live, view, openings as readonly CardOpening[]);
    if (problem !== null) return events(violation(problem));
    const out: GuestEvent[] = [{ type: 'state', view }];
    if (view.winners !== null && !live.audited) {
      live.audited = true;
      out.push({ type: 'verified', hand: view.handNumber, cards: live.opened.size });
    }
    return events(...out);
  }

  /** Every card the view shows must open the leaf the canonical deal order assigns it. */
  private verify(live: Live, view: RoomView, openings: readonly CardOpening[]): string | null {
    const { commit, sigma } = live;
    const order = expectedDealOrder(view.seats.length, view.dealer, (s) => view.seats[s]?.inHand === true);
    if (view.dealer !== commit.dealer || order.join(',') !== commit.dealOrder.join(',')) {
      return 'the dealt seats do not match the deal the host committed to';
    }
    const byK = new Map<number, CardOpening>();
    for (const o of openings) {
      if (!Number.isInteger(o.k) || o.k < 0 || o.k >= sigma.length || typeof o.card !== 'string' || typeof o.salt !== 'string') {
        return 'the host sent a malformed card opening';
      }
      const j = sigma[o.k];
      if (leafHash(this.crypto.sha256, commit.nonce, commit.hand, j, o.card, o.salt) !== commit.leaves[j]) {
        return `the card ${o.card} does not match the deck the host committed to`;
      }
      byK.set(o.k, o);
    }
    const shown: { k: number; card: Card }[] = [];
    for (const seat of view.seats) {
      if (seat.hole === null) continue;
      if (!commit.dealOrder.includes(seat.id)) return 'a seat that was not dealt in shows cards';
      seat.hole.forEach((card, r) => shown.push({ k: holeIndex(commit.dealOrder, seat.id, r as 0 | 1), card }));
    }
    view.board.forEach((card, b) => shown.push({ k: boardIndex(commit.dealOrder, b), card }));
    for (const { k, card } of shown) {
      const opening = byK.get(k);
      if (opening === undefined) return `the card ${card} arrived without proof it was in the committed deck`;
      if (opening.card !== card) return `the card ${card} is not the card the deck committed to there`;
      const before = live.opened.get(k);
      if (before !== undefined && before !== card) return 'a dealt card changed during the hand';
      for (const [otherK, otherCard] of live.opened) {
        if (otherK !== k && otherCard === card) return `the card ${card} was dealt twice`;
      }
      live.opened.set(k, card);
    }
    return null;
  }
}

/** The reveals must open exactly the published commitments, seat for seat (none when nobody committed). */
function openingProblem(crypto: DealCrypto, set: EntropySetMessage | null, dealt: DealtMessage): string | null {
  const reveals = Array.isArray(dealt.reveals) ? dealt.reveals.filter(isObject) : null;
  if (reveals === null || reveals.length !== (Array.isArray(dealt.reveals) ? dealt.reveals.length : -1)) {
    return 'the revealed entropy does not match the published commitments';
  }
  if (set !== null && (!Array.isArray(set.commitments) || !set.commitments.every((c) => isObject(c) && isHex64(c.commitment)))) {
    return 'the host published malformed commitments';
  }
  const bySeat = new Map((set?.commitments ?? []).map((c) => [c.seat, c.commitment]));
  const opensAll =
    reveals.length === bySeat.size &&
    new Set(reveals.map((r) => r.seat)).size === reveals.length &&
    reveals.every(
      (r) => isHex64(r.entropy) && bySeat.get(r.seat) === entropyCommitment(crypto.sha256, dealt.nonce, dealt.hand, r.entropy),
    );
  return opensAll ? null : 'the revealed entropy does not match the published commitments';
}

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null;
const isCardList = (v: unknown, max: number): boolean =>
  Array.isArray(v) && v.length <= max && v.every((c) => typeof c === 'string');

/** What is wrong with a view's shape, or null. Seats must be indexed by id, holes two cards, a board ≤ 5. */
function malformedView(view: RoomView): string | null {
  if (!isObject(view) || !Array.isArray(view.seats) || view.seats.length > 6) return 'seats';
  // Once a hand is dealt the view lists every table seat, so seat i must have id i; the waiting room
  // lists only the seated players.
  const indexed = !Number.isInteger(view.handNumber) || view.handNumber > 0;
  const seatOk = (s: SeatView, i: number): boolean =>
    isObject(s) && Number.isInteger(s.id) && (!indexed || s.id === i) && (s.hole === null || (isCardList(s.hole, 2) && s.hole.length === 2));
  if (!view.seats.every(seatOk)) {
    return 'seat';
  }
  if (!isCardList(view.board, 5)) return 'board';
  if (!Number.isInteger(view.handNumber) || !Number.isInteger(view.dealer)) return 'hand';
  return null;
}

function events(...list: GuestEvent[]): GuestStep {
  return { send: [], events: list };
}

function violation(reason: string): GuestEvent {
  return { type: 'violation', reason: `Deal check failed: ${reason}.` };
}
