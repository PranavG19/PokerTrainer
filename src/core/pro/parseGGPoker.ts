/**
 * GGPoker hand histories (as the client's hand-history export writes them). The header is
 *   Poker Hand #RC1234567890: Hold'em No Limit ($0.02/$0.05) - 2023/03/14 19:42:11
 *   Poker Hand #TM1450633581: Tournament #93453581, Bounty Hunters $10.80 Hold'em No Limit - Level15(1,500/3,000(400)) - …
 * The id keeps its two-letter prefix (RC Rush & Cash, HD ring, TM tournament), because the digits alone
 * are not unique across GG's hand types. The body is the Stars grammar with GG's quirks: a "Dealt to"
 * line with no cards for every other player, "*** SHOWDOWN ***" (printed even when nobody shows), and
 * run-it-twice "*** FIRST FLOP ***" / "*** SECOND FLOP ***" boards.
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

const HEAD = /^Poker Hand #([A-Z]{2}\d{1,20}): /;

export const GGPOKER: Dialect = {
  site: 'ggpoker',
  sep: ': ',
  headerId: (line) => HEAD.exec(line)?.[1] ?? null,
  header(line, id) {
    const m = HEAD.exec(line);
    if (m === null) return 'malformed';
    const rest = line.slice(m[0].length);
    const skip = holdemGameSkip(rest);
    if (skip !== null) return skip;
    const game = rest.startsWith('Tournament #') ? 'tournament' : 'cash';
    const s = stakesAndDate(rest, game === 'tournament' ? 'level' : 'cash');
    return s === null ? 'malformed' : { id, game, ...s };
  },
};

export function parseGGPoker(handText: string): ParsedHand | Skip {
  return parseHandLines(splitLines(handText), GGPOKER);
}
