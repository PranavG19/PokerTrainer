/**
 * ACR (Americas Cardroom / Winning Poker Network) hand histories. The header is
 *   Hand #2001234567 - Holdem(No Limit) - $0.01/$0.02 - 2021/03/03 11:31:56 UTC
 *   Game Hand #2001300001 - Tournament #23456789 - Holdem(No Limit) - Level 1 (10.00/20.00) - 2021/03/03 12:00:00 UTC
 * The body differs from Stars in small ways the shared grammar absorbs: no colon after the name
 * ("Hero raises $0.08 to $0.10"), "posts the small blind", seat lines without "in chips", padded hole
 * cards ("[  8s 8c ]"), and "** Dealing down cards **" standing in for "*** HOLE CARDS ***".
 */

import type { ParsedHand, SkipReason } from './handHistory.js';
import { parseHandLines, splitLines, stakesAndDate, type Dialect, type Skip } from './parseCommon.js';

const HEAD = /^(?:Game )?Hand #(\d{1,20}) - /;

function gameSkip(rest: string): SkipReason | null {
  if (rest.includes('Holdem(No Limit)')) return null;
  return rest.includes('Holdem(') ? 'not-no-limit' : 'not-holdem';
}

export const ACR: Dialect = {
  site: 'acr',
  sep: ' ',
  headerId: (line) => HEAD.exec(line)?.[1] ?? null,
  header(line, id) {
    const m = HEAD.exec(line);
    if (m === null) return 'malformed';
    // Keep the " - " before the stakes: the cash stakes are found between two of them.
    const rest = line.slice(m[0].length - 3);
    const skip = gameSkip(rest);
    if (skip !== null) return skip;
    const game = rest.startsWith(' - Tournament #') ? 'tournament' : 'cash';
    const s = stakesAndDate(rest, game === 'tournament' ? 'level' : 'dash');
    return s === null ? 'malformed' : { id, game, ...s };
  },
};

export function parseAcr(handText: string): ParsedHand | Skip {
  return parseHandLines(splitLines(handText), ACR);
}
