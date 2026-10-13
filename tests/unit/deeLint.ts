import type { StrategyRequest } from '../../src/main/tutor/types.js';
import type { Facts } from '../../src/core/dee/types.js';

/**
 * The bank lint's shared pieces, used by Dee's bank (dee-bank.test.ts) and the story lines
 * (story-lines.test.ts), so both are held to one definition.
 */

export function request(facts: Facts): StrategyRequest {
  return {
    kind: 'strategy',
    prompt: JSON.stringify(facts),
    table: { positions: [], stacksBb: [], potBb: 0, board: [], heroCards: [], toAct: '', street: 'river' },
  } as unknown as StrategyRequest;
}

/** The personality bible's "never says", beyond what the guard already bans. */
export const DEE_BANS: readonly [string, RegExp][] = [
  ['luck', /\b(?:luck|lucky|unlucky|fortunate|variance gods|run (?:good|bad|hot|cold)|hot run|cold run|due)\b/i],
  // "to win" is price arithmetic ("risks 100 to win 200"); every other win/lose word is an outcome.
  ['outcome', /\b(?:won|winning|lost|lose|loses|losing|scoop(?:ed)?|ship it)\b|(?<!\bto )\bwins?\b/i],
  ['one-more', /\bone more hand\b/i],
  ['comparison', /\b(?:other players|most players|everyone|percentile|than most|better than you|ranked)\b/i],
  ['absence-guilt', /\b(?:miss(?:ed)? you|where were you|been a while|come back|sorry|streak|days?)\b/i],
  ['trait', /\b(?:natural|talent(?:ed)?|gifted|genius|smart|clever|stupid|idiot|bad at|good at|a (?:tight|loose|passive|aggressive) player)\b/i],
  ['praise', /\b(?:brilliant|amazing|fantastic|superb|lovely|nicely|bravo|wonderful|proud|terrific|outstanding)\b/i],
  ['you-subject', /\byou(?:'ll|’ll| will| should| need| must| did| made)\b/i],
  ['you-are', /\byou(?:'re|’re| are| were)\b/i],
  ['gambling', /\b(?:jackpot|cash|money|dollars?|\$|bankroll|casino)\b/i],
];

export const NUMBER_WORDS = /\b(?:zero|half|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|thirty|forty|fifty|hundred|thousand|once|twice|half a dozen|dozen)\b/i;

