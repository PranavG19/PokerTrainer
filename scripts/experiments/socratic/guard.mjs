// T4 guard, as specified: a pure function over tutor output plus the payload it was given.
// Checks 1-4 from PRODUCT-SPEC T4. Deliberately does NOT claim to bound truth (see T4's
// "what the guard cannot secure").

const BAN_PATTERNS = [
  // second-person trait attribution
  [/\byou(?:'re| are)\s+(?:too\s+)?(?:loose|tight|passive|aggressive|a\s+nit|a\s+station|improving|getting better)\b/i, 'trait-attribution'],
  [/\byour\s+(?:problem|weakness|leak|tendency)\b/i, 'trait-attribution'],
  // praise adjacent to a correction
  [/\b(?:nice|good|great|well done|excellent|smart)\b[^.?!]*\b(?:but|however|though)\b/i, 'praise-adjacent-correction'],
  [/^\s*(?:nice|good|great|well done|excellent)\b/i, 'praise-adjacent-correction'],
  // streak / rank / percentile
  [/\b(?:streak|percentile|rank(?:ed|ing)?|leaderboard|top\s+\d+%|\d+\s*in a row)\b/i, 'rank-language'],
  // per-hand fold reveal
  [/\bwould have (?:flopped|hit|made|won|rivered|turned)\b/i, 'fold-reveal'],
];

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Numerals in the output, normalised: "62%" -> "62", "1.4" -> "1.4". */
export function numeralsIn(text) {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []);
}

export function checkGuard(output, { payloadText, kind }) {
  const limit = kind === 'question' ? 20 : 60;
  const words = wordCount(output);
  const failures = [];

  if (words > limit) failures.push(`word-count ${words}>${limit}`);

  for (const [re, label] of BAN_PATTERNS) {
    if (re.test(output)) failures.push(`ban:${label}`);
  }

  const permitted = new Set(numeralsIn(payloadText));
  const invented = numeralsIn(output).filter((n) => !permitted.has(n));
  if (invented.length) failures.push(`invented-numerals:${invented.join(',')}`);

  if (/^\s*(?:you|your|you're)\b/i.test(output)) failures.push('leading-second-person');

  return { pass: failures.length === 0, failures, words };
}
