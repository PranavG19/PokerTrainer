/**
 * PokerStars hand histories (ring, Zoom and tournament). The header is
 *   PokerStars Hand #243516247135:  Hold'em No Limit ($0.05/$0.10 USD) - 2023/03/14 19:42:11 ET [2023/03/14 23:42:11 CET]
 *   PokerStars Zoom Hand #243517000001:  Hold'em No Limit (€0.02/€0.05 EUR) - …
 *   PokerStars Hand #243520000001: Tournament #3456789012, $1.40+$0.10 USD Hold'em No Limit - Level III (25/50) - …
 * and the body is the shared grammar in parseCommon.ts with "NAME: verb" action lines.
 */

import type { ParsedHand } from './handHistory.js';
import {
  holdemGameSkip,
  parseHandLines,
  splitLines,
  stakesAndDate,
  type Dialect,
  type Skip,
} from './parseCommon.js';

const HEAD = /^PokerStars (?:Zoom )?Hand #(\d{1,20}): {1,2}/;

export const POKERSTARS: Dialect = {
  site: 'pokerstars',
  sep: ': ',
  headerId: (line) => HEAD.exec(line)?.[1] ?? null,
  header(line, id) {
    const m = HEAD.exec(line);
    if (m === null) return 'malformed';
    const rest = line.slice(m[0].length);
    const skip = holdemGameSkip(rest);
    if (skip !== null) return skip;
    const game = rest.startsWith('Tournament #') ? 'tournament' : 'cash';
    // The first date is the site's (ET); the bracketed one after it is the player's local zone.
    const s = stakesAndDate(rest, game === 'tournament' ? 'level' : 'cash');
    return s === null ? 'malformed' : { id, game, ...s };
  },
};

export function parsePokerStars(handText: string): ParsedHand | Skip {
  return parseHandLines(splitLines(handText), POKERSTARS);
}
