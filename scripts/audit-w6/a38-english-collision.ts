/**
 * a38 — does the ENGLISH_RANK_COLLISIONS exclusion change any verdict?
 *
 * M2 (replacing the exclusion with `matches.length > 0`) survived the whole lexicon suite. The reason
 * is `classifySentence`'s ORDER: the framing loop runs first and returns, so a good sentence containing
 * "at" never reaches `namesAHand`. The exclusion only decides anything for a sentence with NO framing,
 * an English rank-word, AND a chart verdict — that is the fixture the suite was missing.
 */
import { classifySentence } from '../../src/core/lexicon.js';

const HAND = /\b[AKQJT2-9]{2}[so]?\b/gi;
const CANDIDATES = [
  'it felt at best like a standard fold',
  'I was not sure at all so I went with the fold',
  'ta da, that has to be a fold',
  'aa well, I just call there',
  'worse at realising equity out of position',
];
for (const sentence of CANDIDATES) {
  console.log(
    JSON.stringify(sentence),
    '| tokens', JSON.stringify(sentence.match(HAND)),
    '|', JSON.stringify(classifySentence(sentence)),
  );
}
