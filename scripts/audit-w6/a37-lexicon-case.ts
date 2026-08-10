/** Does the case fix reject L2's canonical bad sentence in any case, without eating good sentences? */
import { classifySentence } from '../../src/core/lexicon.js';

const cases: [string, string][] = [
  ['K7s is a CO open', 'cached-cell'],
  ['k7s is a co open', 'cached-cell'],
  ['K7S IS A CO OPEN', 'cached-cell'],
  ['AJo is a fold from UTG', 'cached-cell'],
  ['ajo is a fold from utg', 'cached-cell'],
  ['K7s is dominated by the better sevens in a CO calling range', 'ACCEPT'],
  ['k7s is dominated by the better sevens in a co calling range', 'ACCEPT'],
  ['worse at realising equity out of position', 'ACCEPT'],
  ['the button holds the range advantage', 'ACCEPT'],
  ['I am not sure at all', 'no-mechanism-frame'],
];
let bad = 0;
for (const [sentence, want] of cases) {
  const v = classifySentence(sentence);
  const got = v.frame === null ? v.reason : 'ACCEPT';
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} want=${want.padEnd(18)} got=${String(got).padEnd(18)} "${sentence}"`);
}
console.log(bad === 0 ? 'ALL OK' : `${bad} MISMATCHES`);
