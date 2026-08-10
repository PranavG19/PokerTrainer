/**
 * EXPERIMENT 4 — the T4 guard, implemented locally.
 *
 * src/main/tutor/guard.ts did not exist when this harness was written (checked: src/main/ held
 * only main.ts, preload.ts, store.ts), so the four mechanically-decidable checks from
 * PRODUCT-SPEC T4 are implemented here. If guard.ts lands later, this file is the reference the
 * measurement was taken against and should be reconciled with it, not duplicated.
 *
 * T4 checks:
 *  1. Word count      — <=60 (corrections), <=20 (questions).
 *  2. Ban-list lint   — second-person trait attribution, praise adjacent to a correction,
 *                       streak/rank/percentile language, per-hand fold reveal.
 *  3. Number provenance — every numeral in the output must appear in the input payload.
 *  4. No leading second-person pronoun — the checkable proxy for task-as-subject.
 */

export type GuardKind = 'correction' | 'question';

export interface GuardResult {
  pass: boolean;
  failures: { check: string; detail: string }[];
  wordCount: number;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

/** Trait attribution: "you are/you're/you tend to/you always" + a disposition, and any
 *  "you are <adjective>" shape.
 *
 *  Two exclusions were forced by real outputs and are documented rather than silently dropped:
 *  "you're getting better than 3:1" is a PRICE, not a trajectory ("getting" here means receiving
 *  odds), and the bare-adverb rule `you're (being) <x>ly` fired on "you're nearly drawing dead",
 *  which describes the hand. Both were over-fires; the strings are quoted in the report. */
const TRAIT_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'second-person trait attribution', re: /\byou(?:'re| are|r)\s+(?:too\s+|a bit\s+|slightly\s+|very\s+)?(?:loose|tight|passive|aggressive|nitty|a nit|a station|timid|impatient|overconfident|improving|good at|bad at|prone to|the kind of player)\b/i },
  { name: 'second-person trait attribution', re: /\byou(?:'re| are)\s+(?:getting|becoming)\s+(?:better|worse|sharper|looser|tighter)\b(?!\s+than\b)/i },
  { name: 'second-person trait attribution', re: /\byou\s+(?:tend to|always|never|habitually|keep|consistently|usually|often)\b/i },
  { name: 'second-person trait attribution', re: /\byour (?:problem|weakness|leak|tendency|habit|instinct|style|game|discipline|patience)\b/i },
];

/**
 * Praise adjacent to a correction. Commendation must be aimed at the LEARNER or their play; poker
 * describes prices and hands with the same adjectives ("price too good to fold", "a good kicker"),
 * and a first pass that banned the bare token scored 10 "price too good to fold" corrections as
 * praise. Every one of those ten is quoted in research/EXPERIMENT-4-tutor-prompts.md.
 */
const PRAISE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'praise adjacent to a correction', re: /\b(nice|good|great|well[- ]done|solid|smart|excellent|strong|sharp|decent)\s+(read|call|fold|raise|bet|play|thinking|instinct|instincts|start|try|attempt|effort|job|line|reasoning|logic|process)\b/i },
  { name: 'praise adjacent to a correction', re: /\b(right|correct|sound)\s+(idea|instinct|instincts|thinking|track)\b/i },
  { name: 'praise adjacent to a correction', re: /\b(well played|keep it up|keep going|nice work|good work|on the right track|not a bad|fair enough)\b/i },
  { name: 'praise adjacent to a correction', re: /\b(?:that|this|it)(?:'s| is| was)\s+(?:a\s+)?(?:very\s+|quite\s+)?(?:reasonable|understandable|defensible|close|fine|okay|ok|almost right|nearly right)\b/i },
  { name: 'praise adjacent to a correction', re: /^\s*(?:nice|good|great|solid|well done|close|almost)\b/i },
];

/**
 * Streak/rank/percentile language. "rank" is excluded as a bare token because a card's rank is core
 * poker vocabulary — 30 of the first pass's 31 "rank" hits were "one rank higher" / "the kicker
 * rank" and one was "ranking your pairs". Likewise "percentage points" is a units phrase, not a
 * score, so only "points" used as a tally is banned.
 */
const STREAK_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'streak/rank/percentile language', re: /\b(streak|in a row|consecutive (?:correct|errors|hands|mistakes)|percentile|leaderboard|level(?:ed)? up|badge|XP)\b/i },
  { name: 'streak/rank/percentile language', re: /\b(?:you(?:'re| are)?\s+)?(?:ranked|ranking|rank)\s+(?:\d|top|bottom|in the|among|above|below average)/i },
  { name: 'streak/rank/percentile language', re: /\btop \d+ ?%|\bbottom \d+ ?%/i },
  // "points" only as a tally. "priced out by 15 points" is percentage points — a unit, not a score.
  { name: 'streak/rank/percentile language', re: /\b(?:score|grade|rating) (?:of|is|was)\b|\b(?:scored|earned|awarded)\s+\d+\b|\b\d+ points\s+(?:this|so far|total|overall|today)\b/i },
  { name: 'streak/rank/percentile language', re: /\b(\d+ (?:of|out of) \d+ correct|accuracy (?:is|of) \d+ ?%)\b/i },
];

/** Per-hand fold reveal (G10): "you folded X and would have ...", or any counterfactual runout. */
const FOLD_REVEAL_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'per-hand fold reveal', re: /\bwould have (?:flopped|hit|made|won|rivered|turned|improved|been)\b/i },
  { name: 'per-hand fold reveal', re: /\b(?:the|that) (?:turn|river|board) (?:would have|came|brought)\b/i },
  { name: 'per-hand fold reveal', re: /\byou folded the (?:best|winning) hand\b/i },
];

const LEADING_SECOND_PERSON = /^\s*(?:you|your|you're|yours|yourself)\b/i;

/**
 * Numerals in the output must all appear in the payload's permitted set. Sub-string membership is
 * used deliberately: it is what the spec specifies, and measuring its weakness is the point of
 * measurement 2. Ordinal-free spelled numbers ("three") are not numerals and are not checked —
 * also faithful to the spec, and also a hole.
 */
export function numberProvenanceFailures(text: string, permitted: string[]): string[] {
  const found = text.match(/\d+(?:\.\d+)?/g) ?? [];
  const set = new Set(permitted);
  const bad: string[] = [];
  for (const n of found) {
    if (set.has(n)) continue;
    // A numeral is also permitted if it appears as a substring of a permitted numeral, which is
    // what "every numeral in the output must appear in the input payload" literally says.
    if (permitted.some((p) => p.includes(n))) continue;
    bad.push(n);
  }
  return [...new Set(bad)];
}

export function runGuard(text: string, kind: GuardKind, permittedNumerals: string[]): GuardResult {
  const failures: GuardResult['failures'] = [];
  const wc = wordCount(text);
  const limit = kind === 'question' ? 20 : 60;
  if (wc > limit) failures.push({ check: 'word-count', detail: `${wc} words > ${limit}` });

  const banLists = kind === 'correction'
    ? [...TRAIT_PATTERNS, ...PRAISE_PATTERNS, ...STREAK_PATTERNS, ...FOLD_REVEAL_PATTERNS]
    : [...TRAIT_PATTERNS, ...STREAK_PATTERNS, ...FOLD_REVEAL_PATTERNS];
  for (const { name, re } of banLists) {
    const m = text.match(re);
    if (m) failures.push({ check: 'ban-list', detail: `${name}: "${m[0]}"` });
  }

  const badNums = numberProvenanceFailures(text, permittedNumerals);
  if (badNums.length) {
    failures.push({ check: 'number-provenance', detail: `unpermitted numerals: ${badNums.join(', ')}` });
  }

  if (LEADING_SECOND_PERSON.test(text)) {
    failures.push({ check: 'leading-second-person', detail: `starts with "${text.trim().split(/\s+/)[0]}"` });
  }

  return { pass: failures.length === 0, failures, wordCount: wc };
}

/** De-duplicate the ban-list findings for reporting: one line per distinct rule name. */
export function failureKeys(r: GuardResult): string[] {
  return [...new Set(r.failures.map((f) => (f.check === 'ban-list' ? `ban-list:${f.detail.split(':')[0]}` : f.check)))];
}
