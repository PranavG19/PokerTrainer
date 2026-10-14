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

/** The personality bible's "never says" (one definition, in src/core/dee/bans.ts: the chat runtime check reads it too). */
export { DEE_BANS } from '../../src/core/dee/bans.js';
export { TEMPLATE_NUMBER_WORDS as NUMBER_WORDS } from '../../src/core/dee/bans.js';

