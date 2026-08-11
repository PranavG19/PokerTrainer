/**
 * FROM A PLAYED HAND TO OBSERVED GIFTS — the bridge O5/story 34 needs between the live table and the
 * gift ledger. It is the seam that decides WHICH villain calls the learner actually got to observe,
 * which is the whole anti-inflation point: a gift is only real once the villain's cards are on the
 * table, and only the showdown reveals them (table.ts renders villain holes face-up exactly when the
 * hand reached showdown and the seat did not fold).
 *
 * The renderer captures every villain calling action as it happens (the pot before the chips went
 * in, the board they acted on, the price), because those betting facts are gone once the pot is
 * awarded. This function is handed that capture plus the SETTLED table and answers: for each captured
 * call, did the caller and the hero both reveal at this showdown? Only then is the villain's holding
 * an observed fact and the call scorable — everything else (the villain folded a later street, the
 * hand ended before showdown, the hero folded) leaves the holding unrevealed and yields no gift.
 *
 * The scoring itself — whether the revealed call was -EV — is giftLedger.observe's job, by exact
 * equity. This module only decides observability; it invents no verdict of its own.
 */

import type { Card } from './cards.js';
import type { ActionKind, Street, TableState } from './table.js';
import type { GiftLedger, GiftEntry } from './giftLedger.js';

/**
 * One villain calling action, captured at the moment it was played. The renderer records this from
 * the PRE-action state inside its advance loop, because the pot, board and price it names describe
 * the spot the villain faced and are overwritten as the hand continues. The villain's holding is NOT
 * captured here: it is read from the settled table at showdown, so a call by a seat that later folds
 * contributes no holding and cannot become a gift.
 */
export interface VillainCall {
  readonly handNumber: number;
  readonly villainSeatId: number;
  readonly villainName: string;
  /** Only 'call' and 'allin' are ever captured — the two calling actions giftLedger scores. */
  readonly action: 'call' | 'allin';
  /** The board in front of the villain when they called, not the final runout. */
  readonly board: readonly Card[];
  readonly street: Street;
  /** The pot before the villain's chips went in — it already holds the hero's bet. */
  readonly potBefore: number;
  /** The chips the villain put in on this call. */
  readonly cost: number;
}

/** True only for the two calling actions the ledger scores; a helper for the capturing renderer. */
export function isCallingAction(action: ActionKind): action is 'call' | 'allin' {
  return action === 'call' || action === 'allin';
}

const HERO_SEAT = 0;

/**
 * Resolve a played hand's captured villain calls into gifts, recording each observed -EV call on the
 * ledger. Returns the entries added (empty when the hand handed the learner nothing observable).
 *
 * A call is observable only when the SETTLED showdown revealed both hands: the hand reached showdown
 * (`winners !== null` is necessary but not sufficient — a fold-out also sets winners), the villain
 * did not fold, and the hero did not fold. `settle` leaves `folded` set on anyone who folded and
 * clears it for no one, so the settled seats are exactly the reveal state the table painted.
 */
export function recordHandGifts(
  ledger: GiftLedger,
  settled: TableState,
  calls: readonly VillainCall[],
): GiftEntry[] {
  const hero = settled.seats[HERO_SEAT];
  // The hero's own cards must be revealed for the gift to be a fact the learner saw. A hand the hero
  // folded shows the learner nothing about the villain's mistake against THEM.
  if (settled.winners === null || hero === undefined || hero.folded || hero.hole.length !== 2) {
    return [];
  }

  const added: GiftEntry[] = [];
  for (const call of calls) {
    const villain = settled.seats[call.villainSeatId];
    // Unrevealed: the caller folded a later street or never had cards shown. Not observable, so O5
    // says it is not a gift no matter how bad the call looks in hindsight.
    if (villain === undefined || villain.folded || villain.hole.length !== 2) continue;

    const entry = ledger.observe({
      handNumber: call.handNumber,
      villainSeatId: call.villainSeatId,
      villainName: call.villainName,
      villainHole: villain.hole,
      heroHole: hero.hole,
      board: call.board,
      street: call.street,
      action: call.action,
      potBefore: call.potBefore,
      cost: call.cost,
    });
    if (entry !== null) added.push(entry);
  }
  return added;
}
