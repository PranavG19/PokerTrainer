/**
 * A whole hand-history file to parsed hands and skips. The file is cut into hands at blank lines AND at
 * header lines (some exports put no blank line between hands), each hand's site is read from its own
 * header, so a file mixing sites still parses, and a block no site claims is skipped 'unknown-site'.
 *
 * A block is never held past MAX_HAND_LINES + 1 lines: that is enough to know it is 'too-long', and it
 * keeps a hostile file with no blank lines from being buffered whole a second time.
 */

import { MAX_HAND_LINES, MAX_SKIP_RECORDS, type ParseResult, type Site, type SkipReason } from './handHistory.js';
import { ACR } from './parseAcr.js';
import { isBlank, isSkip, parseHandLines, splitLines, stripBom, type Dialect } from './parseCommon.js';
import { GGPOKER } from './parseGGPoker.js';
import { POKERSTARS } from './parsePokerStars.js';

const DIALECTS: Readonly<Record<Site, Dialect>> = { pokerstars: POKERSTARS, ggpoker: GGPOKER, acr: ACR };

const GG_PREFIX = /^Poker Hand #[A-Z]{2}\d/;
const ACR_PREFIX = /^Hand #\d{1,20} - /;

/** The site whose header this line is, or null. Reads only the first 40 characters, whatever the length. */
function siteOfLine(line: string): Site | null {
  const head = stripBom(line).trimStart().slice(0, 40);
  if (head.startsWith('PokerStars Hand #') || head.startsWith('PokerStars Zoom Hand #')) return 'pokerstars';
  if (GG_PREFIX.test(head)) return 'ggpoker';
  if (head.startsWith('Game Hand #') || ACR_PREFIX.test(head)) return 'acr';
  return null;
}

/** The site of the first hand in `text` (its first non-blank line), or null. */
export function detectSite(text: string): Site | null {
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl);
    if (!isBlank(line)) return siteOfLine(line);
    pos = nl + 1;
  }
  return null;
}

export function parseHandHistories(text: string): ParseResult {
  const result: ParseResult = { hands: [], skipped: [], skipCounts: {} };
  const skip = (id: string | null, reason: SkipReason): void => {
    result.skipCounts[reason] = (result.skipCounts[reason] ?? 0) + 1;
    if (result.skipped.length < MAX_SKIP_RECORDS) result.skipped.push({ id, reason });
  };
  let block: string[] = [];

  const flush = (): void => {
    if (block.length === 0) return;
    const site = siteOfLine(block[0]);
    if (site === null) {
      skip(null, 'unknown-site');
    } else {
      const r = parseHandLines(block, DIALECTS[site]);
      if (isSkip(r)) skip(r.id, r.skip);
      else result.hands.push(r);
    }
    block = [];
  };

  for (const line of splitLines(text)) {
    if (isBlank(line)) {
      flush();
      continue;
    }
    if (block.length > 0 && siteOfLine(line) !== null) flush();
    if (block.length <= MAX_HAND_LINES) block.push(line);
  }
  flush();
  return result;
}
