/**
 * The no-key fallback classifier (T1: with no API key the app makes zero network calls, so the
 * reason grader must be a pure function). Keyword/regex only — this is the honest ceiling of what
 * a local grader can do, and the comparison against the model says what the model is buying.
 *
 * Order matters and encodes the tie-breaks: an empty/evasive line can never be anything but `none`,
 * and a line whose operative claim is the learner's own two cards is hand-strength even when it
 * borrows range or price words (that inversion is the whole point of G4).
 */

const EMPTY_OR_EVASIVE = /^\s*$|^[\s.?!,\-]*$|^(idk|asdf|vibes|n\/a|na|because|dunno|no idea|\?+)$/i;

const HUNCH = /\b(felt? right|feeling|gut|hunch|vibes?|guess(ing|ed)?|not sure|i don'?t know|dont know|idk|looks? weak|looks? strong|seeing what happens|worked last time|always play|instinct)\b/i;

// "my cards" claims: rank talk, made-hand nouns, and the self-referential strength adjectives.
const OWN_HAND = /\b(my (hand|cards|kicker|draw)|i have|i hold|i flopped|i'?ve got|top pair|top kicker|second pair|middle pair|bottom pair|overpair|top set|trip|trips|set|two pair|quads|full house|boat|nut(s|ted)?|monster|garbage|trash|rubbish|showdown value|ace high|king high|\d+ high|pocket \w+|best (possible )?hand|too good to fold|too pretty|plays itself|live|strong enough)\b/i;

const RANGE = /\b(range|ranges|dominat\w*|capped|uncapped|polari\w+|the hands? (that|he|she|they|which)|hands? (that )?(call|continue|fold|beat)|his hands?|her hands?|their hands?|villain'?s hands?|combos?|value hands?|bluffs?|opens? \d+%|defend|folds? out|only (get )?call(ed)? by better|worse (hands?)? (call|fold)|board hits?|hits? my range|broadway|position)\b/i;

const PRICE = /\b(pot odds?|odds|price|cheap|expensive|equity|%|percent|break ?even|implied odds|to win|risking|risk \d+|\d+ ?(bb|into)|call \d+|bet \d+|min-?raise|overbet|half pot|pot-?sized?|two-?thirds|one-?third|\d+ ?outs?|outs|needs? to be right|need(ed|s)? \d|\bworth it\b|worth a shot|laying (him|her|them)|to see one more card|not enough in the middle|chase)\b/i;

/**
 * Decides whether the price/range vocabulary is decoration over a hand-strength claim.
 * The signal: the sentence names the learner's own holding AND the range/price token appears
 * only in a clause subordinate to it ("...because my cards are weak", "...so the price doesn't
 * matter"). Approximated by the connective, which is what a pure function can actually see.
 */
const HS_SUBORDINATES_OTHER = /\b(because|since|so)\b[^.]*\b(i have|my (hand|cards|two cards)|pocket|a (big|strong) pair|is strong|is weak|are weak|the nuts|best hand)\b/i;
const OTHER_IS_IRRELEVANT = /\b(price|pot odds?|odds)\b[^.]*\b(irrelevant|does ?n'?t matter|no matter)\b|\b(my (hand|draw|range))\b[^.]*\b(so the price|price does ?n'?t)\b/i;

export function keywordGrade(text) {
  const t = (text ?? '').trim();
  if (EMPTY_OR_EVASIVE.test(t)) return 'none';
  if (HUNCH.test(t) && !RANGE.test(t) && !PRICE.test(t)) return 'none';

  const own = OWN_HAND.test(t);
  const hsWins = own && (HS_SUBORDINATES_OTHER.test(t) || OTHER_IS_IRRELEVANT.test(t));
  if (hsWins) return 'hand-strength';

  const price = PRICE.test(t);
  const range = RANGE.test(t);
  // Spec's tie-break (G5/T3 grader): price beats range when a size or share is the comparison.
  if (price && !own) return 'price';
  if (range && !own) return 'range';
  if (own && !price && !range) return 'hand-strength';
  if (own && (price || range)) {
    // Both present and not clearly subordinated: keep the mechanism if it carries a real number,
    // otherwise the holding is doing the work.
    return /\d/.test(t) && price ? 'price' : range && /\b(range|dominat|capped|the hands? (that|he)|calls?)\b/i.test(t) ? 'range' : 'hand-strength';
  }
  return 'none';
}
