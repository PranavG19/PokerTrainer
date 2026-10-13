/**
 * Dee's own ban list: the personality bible's "never says" (VISION §2.2), beyond what the tutor guard
 * (src/main/tutor/guard.ts) already bans. One definition for every channel: the line bank lint, the chat bank
 * lint and the runtime check on a local model's rewording (src/main/dee/phrasing.ts) all read it.
 */

export const DEE_BANS: readonly (readonly [string, RegExp])[] = [
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

/** The first ban a text trips, as `name: match`, or null. */
export function deeBanIn(text: string): string | null {
  for (const [name, re] of DEE_BANS) {
    const m = re.exec(text);
    if (m) return `${name}: ${m[0]}`;
  }
  return null;
}

/** Spelled-out numbers a template may not write itself (the engine owns every number). */
export const TEMPLATE_NUMBER_WORDS =
  /\b(?:zero|half|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|thirty|forty|fifty|hundred|thousand|once|twice|half a dozen|dozen)\b/i;
