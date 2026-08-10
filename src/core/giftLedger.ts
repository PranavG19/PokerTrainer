/**
 * THE GIFT LEDGER — PRODUCT-SPEC O5, user story 34.
 *
 * O5: "The gift ledger auto-populates from observed showdowns, in action-with-a-holding form. This
 * removes the method's own worry that a motivated learner inflates a hand-kept ledger." Story 34:
 * "I want the gift ledger auto-populated from observed showdowns so I can't inflate it."
 *
 * A "gift" is a spot where an opponent's REVEALED showdown holding shows they made a clearly -EV
 * play that handed the hero value. Every entry is in action-with-a-holding form: the villain's
 * concrete action (a call) is recorded together with the concrete cards they turned over, the board
 * they acted on, and the price they were getting. That pairing is the format O5 asks for and the
 * thing a hand-kept ledger cannot fake — "he spewed a lot" is not observable, "he called 100 with
 * Qh Qd on 2s 7d Kc 9h 3c against your Aces" is.
 *
 * ANTI-INFLATION IS STRUCTURAL HERE, NOT MERELY TESTED — the way lexicon.ts makes L3 structural.
 * There is no exported function that adds, edits, re-scores or deletes a gift: the only writer is
 * `observe`, and `observe` does not take the learner's word for whether a spot was a gift. It is
 * handed a real showdown (revealed cards, the action, the pot the villain called into) and decides
 * for itself, by exact equity, whether the call was -EV. A learner cannot flag a break-even call as
 * a gift, cannot inflate the magnitude, and cannot append a spot that never happened — the numbers
 * are derived from the revealed cards, not carried in. Every entry handed out is frozen and every
 * returned list is a frozen copy, so a caller holding an entry holds no handle into this module's
 * state. This mirrors lexicon.ts, whose only writer is `record`.
 *
 * WHY EXACT EQUITY, NOT MONTE CARLO. The gift test is "was this call -EV given what the cards now
 * show?", and the answer must be reproducible and free of estimator noise — a Monte-Carlo run could
 * flip a marginal call across the break-even line from one seed to the next, which would make the
 * anti-inflation guarantee depend on a dice roll. `exactEquityHeadsUp` enumerates the runout, so the
 * verdict is deterministic and needs no Rng. "Clearly -EV" is read as "verifiably -EV" — a genuine
 * negative expectation, not a large one — because exactness is what removes the doubt, and a
 * magnitude threshold would be an invented number O5 does not give.
 *
 * WHY ONLY CALLS. A call's expectation is decided by equity against the price: chips in versus the
 * pot, with no hidden variable. A bet or raise also needs the fold equity it generated, which a
 * revealed showdown does not record, so judging one as -EV would require guessing the reason the
 * villain was folded to — exactly the kind of unobservable a hand-kept ledger smuggles in. So a
 * non-calling action, or a call that closed the action for free (nothing to call), yields no gift.
 */

import type { Card } from './cards.js';
import type { ActionKind, Street } from './table.js';
import { exactEquityHeadsUp } from './equity.js';

/** A hold'em holding is exactly two cards; anything else is a malformed observation, not a hand. */
const HOLE_SIZE = 2;

/**
 * One villain decision at a real showdown, as observed from the revealed cards. The caller is the
 * showdown itself (the Table's reveal), never the learner: this is the "observation of a real
 * showdown" that O5 makes the sole writer. Every field is a fact the revealed cards and the betting
 * record fix — none is the learner's opinion about the spot.
 */
export interface ShowdownObservation {
  /** Ties the gift to the hand it came from, so a caller can dedupe or cross-reference. */
  readonly handNumber: number;
  readonly villainSeatId: number;
  readonly villainName: string;
  /** The villain's REVEALED holding — the two cards that turn a hunch into an observed fact. */
  readonly villainHole: readonly Card[];
  /** The beneficiary's revealed holding. The gift is measured as the villain's equity against it. */
  readonly heroHole: readonly Card[];
  /**
   * The board in front of the villain WHEN THEY ACTED, not the final runout. On a river call the
   * two coincide (the board is already complete), which is the cleanest gift; on an earlier street
   * the equity is over the cards still to come, so the -EV verdict is the one the villain faced, not
   * hindsight.
   */
  readonly board: readonly Card[];
  readonly street: Street;
  /** The villain's action. Only a `call` or `allin` (a call for the stack) can be scored — see header. */
  readonly action: ActionKind;
  /** The pot the villain was calling into, BEFORE their own chips went in (it already holds the hero's bet). */
  readonly potBefore: number;
  /** The chips the villain put in on this action. */
  readonly cost: number;
}

/**
 * A recorded gift, in action-with-a-holding form. It carries the action and the holding as
 * first-class fields, plus the arithmetic that made it a gift, so a stored ledger explains itself
 * without recomputation and a renderer never has to reconstruct the price.
 */
export interface GiftEntry {
  /** Monotonic within one ledger. Makes append order inspectable rather than positional. */
  readonly seq: number;
  readonly handNumber: number;
  readonly villainSeatId: number;
  readonly villainName: string;
  readonly villainHole: readonly Card[];
  readonly heroHole: readonly Card[];
  readonly board: readonly Card[];
  readonly street: Street;
  /** Narrowed to the calling actions, since those are the only ones `observe` scores. */
  readonly action: 'call' | 'allin';
  /** Villain's exact equity against the hero at the decision board, ties counted as half. */
  readonly villainEquity: number;
  /** The pot-odds break-even equity the call needed: cost / (potBefore + cost). */
  readonly breakEven: number;
  /** Villain's expectation in chips: equity·potBefore − (1−equity)·cost. Negative, by construction. */
  readonly evChips: number;
  /** The value handed to the hero in expectation: −evChips. Positive, by construction. */
  readonly giftChips: number;
}

/**
 * Append-only. There is no editing, re-scoring or deleting member, by construction (O5): the only
 * writer is `observe`, which derives every entry from the revealed cards.
 */
export interface GiftLedger {
  /**
   * Score one observed showdown decision. Returns the recorded entry when the call was -EV, or null
   * when it was not a gift (break-even-or-better, a non-calling action, or nothing to call). Null is
   * a verdict, not a failure — most observed calls are fine, and only the gifts are logged.
   */
  observe(observation: ShowdownObservation): GiftEntry | null;
  /** The whole log in append order. This is what a caller persists. */
  entries(): readonly GiftEntry[];
  /** Gifts from one villain, in append order. */
  forVillain(seatId: number): readonly GiftEntry[];
  /** Villain seat ids in first-gift order. */
  villains(): readonly number[];
}

/** Villain's call expectation in chips. Negative means the call was -EV — a gift to the hero. */
function callEvChips(equity: number, potBefore: number, cost: number): number {
  return equity * potBefore - (1 - equity) * cost;
}

function assertHolding(cards: readonly Card[], label: string): void {
  if (cards.length !== HOLE_SIZE) {
    throw new TypeError(`giftLedger: ${label} must be ${HOLE_SIZE} cards, got ${cards.length}`);
  }
}

/**
 * A card cannot be in two hands at once. A collision across the villain's holding, the hero's
 * holding and the board is an impossible showdown, and equity computed over it would be garbage —
 * so it is a caller bug that throws, not a spot that silently scores wrong.
 */
function assertDistinctCards(observation: ShowdownObservation): void {
  const all = [...observation.villainHole, ...observation.heroHole, ...observation.board];
  const seen = new Set<Card>();
  for (const card of all) {
    if (seen.has(card)) throw new TypeError(`giftLedger: card ${card} appears twice in one showdown`);
    seen.add(card);
  }
}

const isCallingAction = (action: ActionKind): action is 'call' | 'allin' =>
  action === 'call' || action === 'allin';

/**
 * `prior` rehydrates a persisted log. It builds a NEW ledger and cannot reach an existing one, so it
 * is not an editing path: rewriting history still means rewriting the file on disk by hand. Mirrors
 * lexicon.ts's `createLexicon(prior)`.
 */
export function createGiftLedger(prior: readonly GiftEntry[] = []): GiftLedger {
  const log: GiftEntry[] = prior.map((entry) => Object.freeze({ ...entry }));
  let nextSeq = log.reduce((max, entry) => Math.max(max, entry.seq + 1), 0);

  const forSeat = (seatId: number): GiftEntry[] => log.filter((entry) => entry.villainSeatId === seatId);

  return {
    observe(observation) {
      assertHolding(observation.villainHole, 'villainHole');
      assertHolding(observation.heroHole, 'heroHole');
      if (observation.board.length > 5) {
        throw new TypeError(`giftLedger: board has ${observation.board.length} cards, at most 5`);
      }
      assertDistinctCards(observation);

      // Not a gift: only chips put in as a call against a live bet can be scored -EV (see header).
      if (!isCallingAction(observation.action) || observation.cost <= 0) return null;

      const equity = exactEquityHeadsUp(
        [...observation.villainHole],
        [...observation.board],
        [...observation.heroHole],
      );
      const evChips = callEvChips(equity, observation.potBefore, observation.cost);
      // Break-even-or-better is not a gift: a call that at least paid for itself gave nothing away.
      if (evChips >= 0) return null;

      const entry: GiftEntry = Object.freeze({
        seq: nextSeq++,
        handNumber: observation.handNumber,
        villainSeatId: observation.villainSeatId,
        villainName: observation.villainName,
        villainHole: Object.freeze([...observation.villainHole]),
        heroHole: Object.freeze([...observation.heroHole]),
        board: Object.freeze([...observation.board]),
        street: observation.street,
        action: observation.action,
        villainEquity: equity,
        breakEven: observation.cost / (observation.potBefore + observation.cost),
        evChips,
        giftChips: -evChips,
      });
      log.push(entry);
      return entry;
    },

    entries() {
      return Object.freeze([...log]);
    },

    forVillain(seatId) {
      return Object.freeze(forSeat(seatId));
    },

    villains() {
      return Object.freeze([...new Set(log.map((entry) => entry.villainSeatId))]);
    },
  };
}

/**
 * Renders an entry in the action-with-a-holding sentence O5 asks for, so a screen quotes the ledger
 * rather than reassembling the price from its parts. Percentages are rounded for reading only; the
 * exact numbers stay on the entry.
 */
export function describeGift(entry: GiftEntry): string {
  const holding = entry.villainHole.join('');
  const board = entry.board.length === 0 ? 'preflop' : entry.board.join('');
  const hero = entry.heroHole.join('');
  const equityPct = Math.round(entry.villainEquity * 100);
  const neededPct = Math.round(entry.breakEven * 100);
  return `${entry.villainName} called with ${holding} on ${board} vs ${hero} — ${equityPct}% equity, needed ${neededPct}% (gift ${entry.giftChips} chips)`;
}
