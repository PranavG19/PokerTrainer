/**
 * VILLAIN TABLE-TALK — the other players "talk", in character, WITHOUT leaking anything.
 *
 * User wishlist: "have llms talk like the other players." This is the offline, deterministic core of
 * that: a fixed line of banter for a villain's action. The live-model version (task #20) can layer on
 * top through the same guarded IPC as the tutor rail, but the fixed lines here are what ship by
 * default and what every test runs against — no network, no clock, no RNG.
 *
 * THE ONE INVARIANT, load-bearing: banter DURING a hand must be information-free. It keys off the
 * ACTION KIND alone (a raise sounds like a raise), never off the villain's archetype, their hole
 * cards, the board, or the correct play. This is not a style choice — O3 HIDES each villain's
 * archetype label until showdown (visibleArchetypeLabel), and behaviour the learner classifies from.
 * Archetype-flavoured chatter mid-hand would hand over the exact label O3 withholds, turning the read
 * into a giveaway. So personality is unlocked ONLY once the archetype is already revealed (showdown),
 * and even then the line comments on the villain's own style, never on the hero's hand or the answer.
 *
 * `quipFor` is pure: same inputs, same line. The `variant` selects among a few lines for one action so
 * a table is not a chorus; the caller passes a stable per-seat number (e.g. seat id + street), never a
 * random one, so a replay says the same things.
 */

import type { ActionKind } from './table.js';
import type { ArchetypeName } from './archetypes.js';

/**
 * In-hand lines, by action kind. INFORMATION-FREE by construction: nothing here varies by archetype,
 * cards or board, so reading the line tells the learner only what the action already told them. Each
 * action has a few variants so a busy table does not repeat one phrase.
 */
const IN_HAND_LINES: Record<ActionKind, readonly string[]> = {
  fold: ['I’ll let this one go.', 'Not this time.', 'Too rich for me here.'],
  check: ['Check.', 'I’ll see a card.', 'Tap tap.'],
  call: ['I call.', 'I’ll come along.', 'Sure, I’ll pay to see it.'],
  bet: ['Let’s put some in.', 'I’ll bet.', 'Pressure’s on.'],
  raise: ['Raise it up.', 'I’ll make it more.', 'Let’s build it.'],
  allin: ['All in.', 'Everything.', 'Let’s gamble.'],
};

/**
 * Showdown personality, by archetype — unlocked only once the label is revealed. These comment on the
 * villain's OWN style (the read the learner just classified), never on the hero's cards or the play.
 * One line per archetype: at showdown there is no need to vary it, and a fixed line reads as a tell.
 */
const SHOWDOWN_LINES: Record<ArchetypeName, string> = {
  nit: 'I only play the good ones. You knew that.',
  station: 'I had to see it — I always do.',
  lag: 'I keep the pressure on. Keeps you guessing.',
  'tag-reg': 'Standard spot. Nothing fancy.',
  'over-folder': 'I fold when I’m beat. Maybe too much.',
  maniac: 'Gamble gamble! Who needs a hand?',
};

/**
 * A villain's line for one action.
 *
 * @param action   the action the villain just took
 * @param revealed the villain's archetype IF it is already revealed (showdown), else null — passing a
 *                 name before reveal would leak the label O3 hides, so callers pass null in-hand
 * @param variant  a stable index (not random) choosing among an action's in-hand variants
 */
export function quipFor(
  action: ActionKind,
  revealed: ArchetypeName | null,
  variant: number,
): string {
  if (revealed !== null) return SHOWDOWN_LINES[revealed];
  const lines = IN_HAND_LINES[action];
  // A non-negative stable index into the variants; `variant` may be any integer.
  const i = ((variant % lines.length) + lines.length) % lines.length;
  return lines[i];
}
