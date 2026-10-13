/**
 * The STRICT checks from the local-model research PoC (vision-tech-research, research/tech-poc/llm/score.ts),
 * ported so the shipped bank and any later rephrasing channel share one definition.
 *
 * The PoC wrote them for a model that rephrases a scripted line. Bag-of-words containment let a meaning
 * inversion through ("The price was NOT low enough"), so STRICT=2 added two rules: the negators, limiters,
 * quantifiers and comparatives must match the script exactly, and the script's content words and numerals
 * must appear in the output in their original order (deletions allowed, reordering not). `rephraseProblems`
 * is that check, verbatim in behaviour; tests/unit/dee-strict.test.ts replays the PoC's ten probes.
 *
 * The authored bank uses `variantProblems`: a tone variant (Dry, Blunt) is a rewording of the canonical
 * line by the same author, so it may use its own words, but it may not flip polarity, drop or reorder a
 * slot or a numeral, add an action verb or a spelled-out number, or drop a question.
 */

const HOUSE = new Set(
  (
    'a an the and but or so of to in on at for with by from as is was were be been it its this that ' +
    'these those here there now then just only still too very not no one two price pot share range seat hand hands ' +
    'asked brought needed had held said gave first close short noted spot table'
  ).split(' '),
);

const NUMBER_WORDS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b/gi;
const ACTIONS = /\b(?:fold|folds|folding|call|calls|calling|raise|raises|raising|bet|bets|betting|check|checks|checking|shove|jam|all-?in)\b/gi;
const POLARITY =
  /\b(?:not|no|never|nothing|none|nobody|without|only|just|most|all|every|some|any|more|less|better|worse|best|worst|free|enough|too|already|still|again|first|last)\b|n't/gi;

const stem = (w: string): string => w.replace(/(?:'s|s|ed|ing)$/, '');
const matches = (t: string, re: RegExp): string[] => (t.toLowerCase().match(re) ?? []) as string[];
const bag = (t: string, re: RegExp): string => matches(t, re).sort().join(',');
const words = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length;

/** Polarity words must be the same multiset. */
export function polarityProblem(text: string, script: string): string | null {
  return bag(text, POLARITY) !== bag(script, POLARITY) ? `polarity:${bag(script, POLARITY)}=>${bag(text, POLARITY)}` : null;
}

/** The PoC's order rule: every non-house token of the output appears in the script, in order. */
export function orderProblem(text: string, script: string): string | null {
  const toks = (t: string): string[] =>
    ((t.toLowerCase().match(/[a-z']+|\d+(?:\.\d+)?/g) ?? []) as string[]).map(stem).filter((w) => !HOUSE.has(w) || /\d/.test(w));
  const sc = toks(script);
  let i = 0;
  for (const w of toks(text)) {
    const j = sc.indexOf(w, i);
    if (j < 0) return `order:${w}`;
    i = j + 1;
  }
  return null;
}

/** STRICT=1 extras plus STRICT=2, for a rephrase of `script` (the PoC's `strictProblems` with STRICT=2). */
export function rephraseProblems(text: string, script: string): string[] {
  const out: string[] = [];
  if (bag(text, NUMBER_WORDS) !== bag(script, NUMBER_WORDS)) out.push(`number-words:${bag(text, NUMBER_WORDS)}`);
  const extraActs = matches(text, ACTIONS).filter((a) => !script.toLowerCase().includes(a));
  if (extraActs.length) out.push(`new-action:${extraActs.join('|')}`);
  if (script.trim().endsWith('?') && !text.includes('?')) out.push('question-dropped');
  if (words(text) < Math.ceil(words(script) / 2)) out.push('too-short');
  const p = polarityProblem(text, script);
  if (p) out.push(p);
  const o = orderProblem(text, script);
  if (o) out.push(o);
  return out;
}

/** Slots and numerals, in order of appearance. */
function anchors(t: string): string[] {
  return (t.match(/\{[a-zA-Z]+\}|\d+(?:\.\d+)?/g) ?? []) as string[];
}

/** For an authored tone variant of `canonical`: same polarity, same slots in the same order, no new claim. */
export function variantProblems(variant: string, canonical: string): string[] {
  const out: string[] = [];
  const p = polarityProblem(variant, canonical);
  if (p) out.push(p);
  if (anchors(variant).join(' ') !== anchors(canonical).join(' ')) {
    out.push(`slot-order:${anchors(canonical).join(' ')}=>${anchors(variant).join(' ')}`);
  }
  if (bag(variant, NUMBER_WORDS) !== bag(canonical, NUMBER_WORDS)) out.push(`number-words:${bag(variant, NUMBER_WORDS)}`);
  const extraActs = matches(variant, ACTIONS).filter((a) => !matches(canonical, ACTIONS).map(stem).includes(stem(a)));
  if (extraActs.length) out.push(`new-action:${extraActs.join('|')}`);
  if (canonical.trim().endsWith('?') !== variant.trim().endsWith('?')) out.push('question-changed');
  return out;
}
