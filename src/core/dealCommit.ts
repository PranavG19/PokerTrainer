/**
 * DEAL COMMITMENT — commit-before-reveal dealing for a hosted multiplayer room.
 *
 * WHY. A hosted room used to shuffle with `mulberry32(seed + handNumber)` from a public default seed,
 * so any guest could replay the engine and read every hole card and the future board. The deal now
 * has two independent properties, each with its own mechanism (research TECH-MULTIPLAYER §3.1, the
 * construction revised after review R6):
 *
 *   SECRECY — the host shuffles a 52-card ORDER with an injected CSPRNG and keeps it to itself. No seed
 *   exists to leak, and nothing on the wire describes an unseen card.
 *
 *   NO MID-HAND CHANGE, NO STACKING — before any card is dealt the host publishes one salted hash per
 *   committed position (`leaves`). Then every guest commits to fresh entropy, and only once all
 *   commitments are in does anyone reveal. The revealed entropy picks a public permutation `sigma`
 *   that maps the k-th card dealt to committed position sigma[k]. The host fixed the order before
 *   sigma existed, so it cannot arrange which card lands where; and every card a guest is shown
 *   arrives with an opening (card + salt) that must hash to the leaf at sigma[k]. A host that swaps
 *   the turn card mid-hand cannot open it.
 *
 * WHAT A GUEST CHECKS. Every card it sees (its own hole, the board, showdown hands) against the leaf
 * the canonical deal order assigns it, that no card is opened twice, and that its own entropy was
 * used. It cannot check positions it is never shown: opening those at hand end would hand every guest
 * the mucked hands (review R6.3), so they stay sealed.
 *
 * WHAT IT CANNOT DO. The host's process still holds every card during the hand (a host-dealer sees
 * all cards; only a server dealer fixes that), and a host can still abort a deal after learning sigma
 * and redeal. Aborts are surfaced to the guest as warnings, never silent.
 *
 * Pure: no crypto import. The caller injects SHA-256 and a CSPRNG, so this runs under vitest with
 * node:crypto exactly as main runs it.
 */

import { freshDeck, type Card } from './cards.js';
import { shuffleWith, wordsFrom, type RandomBytes } from './rng.js';

/** SHA-256, injected. */
export type Sha256 = (data: Uint8Array) => Uint8Array;

export interface DealCrypto {
  readonly random: RandomBytes;
  readonly sha256: Sha256;
}

export const DECK_SIZE = 52;
const DOMAIN = 'offsuit-deal-v2';
const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;

// ── Encoding ─────────────────────────────────────────────────────────────────

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hashText(sha256: Sha256, text: string): string {
  return toHex(sha256(new TextEncoder().encode(text)));
}

// ── Messages (server → client unless noted) ──────────────────────────────────

/** Published at hand start, before any entropy: the hash of every committed position. */
export interface CommitMessage {
  readonly type: 'commit';
  readonly hand: number;
  /** Fresh per deal attempt; binds every hash below to this attempt so nothing replays. */
  readonly nonce: string;
  readonly dealer: number;
  /** Seats dealt in, in deal order (left of the dealer first). Fixed before sigma exists. */
  readonly dealOrder: readonly number[];
  readonly leaves: readonly string[];
}

/** Client → server: a guest's commitment to its entropy. */
export interface EntropyCommitMessage {
  readonly type: 'entropy-commit';
  readonly hand: number;
  readonly nonce: string;
  readonly commitment: string;
}

/** Sent once every participant has committed: the full set, so each guest sees its own is in it. */
export interface EntropySetMessage {
  readonly type: 'entropy-set';
  readonly hand: number;
  readonly nonce: string;
  readonly commitments: readonly { readonly seat: number; readonly commitment: string }[];
}

/** Client → server: the entropy behind the commitment. */
export interface EntropyRevealMessage {
  readonly type: 'entropy-reveal';
  readonly hand: number;
  readonly nonce: string;
  readonly entropy: string;
}

/** The hand is dealt: every participant's entropy, from which anyone can recompute sigma. */
export interface DealtMessage {
  readonly type: 'dealt';
  readonly hand: number;
  readonly nonce: string;
  readonly reveals: readonly { readonly seat: number; readonly entropy: string }[];
}

/** The proof for one shown card: it is the k-th card dealt, and this salt opens its leaf. */
export interface CardOpening {
  readonly k: number;
  readonly card: Card;
  readonly salt: string;
}

// ── Hashes ───────────────────────────────────────────────────────────────────

export function leafHash(sha256: Sha256, nonce: string, hand: number, position: number, card: Card, salt: string): string {
  return hashText(sha256, `${DOMAIN}|leaf|${nonce}|${hand}|${position}|${card}|${salt}`);
}

export function entropyCommitment(sha256: Sha256, nonce: string, hand: number, entropy: string): string {
  return hashText(sha256, `${DOMAIN}|entropy|${nonce}|${hand}|${entropy}`);
}

/**
 * The public permutation: sigma[k] is the committed position of the k-th card dealt. Derived from the
 * leaves, the dealer and deal order, and every revealed entropy, sorted by seat so the order of arrival
 * changes nothing.
 */
export function deriveSigma(
  sha256: Sha256,
  commit: Pick<CommitMessage, 'nonce' | 'hand' | 'leaves' | 'dealer' | 'dealOrder'>,
  reveals: readonly { readonly seat: number; readonly entropy: string }[],
): number[] {
  const sorted = [...reveals].sort((a, b) => a.seat - b.seat).map((r) => `${r.seat}:${r.entropy}`);
  // The dealer and deal order are bound too, so guests shown different tables derive different sigmas.
  const table = `${commit.dealer}|${commit.dealOrder.join(',')}`;
  const seedText = `${DOMAIN}|sigma|${commit.nonce}|${commit.hand}|${table}|${commit.leaves.join(',')}|${sorted.join(',')}`;
  const seed = sha256(new TextEncoder().encode(seedText));
  // A counter-mode stream over the seed: block i = SHA-256(seed ‖ i).
  let counter = 0;
  const stream: RandomBytes = (length) => {
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const block = new Uint8Array(seed.length + 4);
      block.set(seed);
      new DataView(block.buffer).setUint32(seed.length, counter++);
      const digest = sha256(block);
      const take = Math.min(digest.length, length - filled);
      out.set(digest.subarray(0, take), filled);
      filled += take;
    }
    return out;
  };
  return shuffleWith(Array.from({ length: DECK_SIZE }, (_u, i) => i), wordsFrom(stream));
}

// ── Canonical deal order ─────────────────────────────────────────────────────

/**
 * Which k (0-based, in the order the engine pops cards) a visible card was dealt as. Holes go round by
 * round from `dealOrder`; then burn, flop ×3, burn, turn, burn, river — table.ts's order. Both the host
 * (to open) and the guest (to check) compute it; the guest never takes k from the host.
 */
export function holeIndex(dealOrder: readonly number[], seat: number, round: 0 | 1): number {
  const i = dealOrder.indexOf(seat);
  if (i < 0) throw new RangeError(`seat ${seat} was not dealt in`);
  return round * dealOrder.length + i;
}

export function boardIndex(dealOrder: readonly number[], position: number): number {
  const base = 2 * dealOrder.length;
  const offsets = [1, 2, 3, 5, 7];
  if (position < 0 || position > 4) throw new RangeError(`board position ${position}`);
  return base + offsets[position];
}

/** The deal order the engine uses: seats dealt in, starting left of the dealer. */
export function expectedDealOrder(seatCount: number, dealer: number, inHand: (seat: number) => boolean): number[] {
  const order: number[] = [];
  for (let step = 1; step <= seatCount; step += 1) {
    const seat = (dealer + step) % seatCount;
    if (inHand(seat)) order.push(seat);
  }
  return order;
}

// ── Host side ────────────────────────────────────────────────────────────────

/** The host's secret for one deal attempt. Never serialised. */
export interface SealedDeck {
  readonly commit: CommitMessage;
  readonly cards: readonly Card[];
  readonly salts: readonly string[];
}

/** Shuffle a fresh order with the CSPRNG, salt every position, and publish only the hashes. */
export function sealDeck(crypto: DealCrypto, hand: number, dealer: number, dealOrder: readonly number[]): SealedDeck {
  const cards = shuffleWith(freshDeck(), wordsFrom(crypto.random));
  const salts = cards.map(() => toHex(crypto.random(16)));
  const nonce = toHex(crypto.random(16));
  const leaves = cards.map((card, j) => leafHash(crypto.sha256, nonce, hand, j, card, salts[j]));
  return { commit: { type: 'commit', hand, nonce, dealer, dealOrder: [...dealOrder], leaves }, cards, salts };
}

/** The engine deck for a sealed order and sigma: the k-th pop is cards[sigma[k]]. */
export function engineDeck(sealed: SealedDeck, sigma: readonly number[]): Card[] {
  const deck = new Array<Card>(DECK_SIZE);
  for (let k = 0; k < DECK_SIZE; k += 1) deck[DECK_SIZE - 1 - k] = sealed.cards[sigma[k]];
  return deck;
}

export function openCard(sealed: SealedDeck, sigma: readonly number[], k: number): CardOpening {
  const j = sigma[k];
  return { k, card: sealed.cards[j], salt: sealed.salts[j] };
}

/** Fresh entropy for a guest, and its commitment. */
export function freshEntropy(crypto: DealCrypto, nonce: string, hand: number): { entropy: string; commitment: string } {
  const entropy = toHex(crypto.random(32));
  return { entropy, commitment: entropyCommitment(crypto.sha256, nonce, hand, entropy) };
}

// ── Shape checks (both sides parse what the other sent) ──────────────────────

export const isHex64 = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);
export const isNonce = (v: unknown): v is string => typeof v === 'string' && HEX32.test(v);

/** A commit message's shape: 52 distinct 64-hex leaves, a nonce, a deal order of distinct seats. */
export function wellFormedCommit(msg: CommitMessage, seatCount: number): boolean {
  return (
    Number.isInteger(msg.hand) &&
    msg.hand >= 1 &&
    isNonce(msg.nonce) &&
    Number.isInteger(msg.dealer) &&
    msg.dealer >= 0 &&
    msg.dealer < seatCount &&
    Array.isArray(msg.dealOrder) &&
    msg.dealOrder.length >= 2 &&
    msg.dealOrder.every((s) => Number.isInteger(s) && s >= 0 && s < seatCount) &&
    new Set(msg.dealOrder).size === msg.dealOrder.length &&
    Array.isArray(msg.leaves) &&
    msg.leaves.length === DECK_SIZE &&
    msg.leaves.every(isHex64) &&
    new Set(msg.leaves).size === DECK_SIZE
  );
}
