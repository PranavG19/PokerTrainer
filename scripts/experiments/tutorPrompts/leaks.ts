/**
 * EXPERIMENT 4 — measurement 4: does the Interrogator's question LEAK the answer?
 *
 * The guard cannot see this. A question can be 13 words, contain no banned construction, start
 * with "What", carry only permitted numerals — and still hand over the verdict. The mechanism the
 * product bets on is retrieval, and a question that carries its own answer is not a retrieval
 * demand.
 *
 * Three leak classes, each decidable against the payload:
 *
 *  L1 ACTION NAMED — the question names or contrasts the cheaper action from the payload
 *     ("...instead of checking behind", "...all-in over check"). The learner now knows what the
 *     grader preferred.
 *  L2 VERDICT ASSERTED — the question's premise states the outcome the learner was supposed to
 *     retrieve ("when you're behind to every pair and every queen", "with a hand that wins this
 *     often", "with 65% equity and no card coming"). The premise is the answer.
 *  L3 EQUITY DISCLOSED — the question states the learner's OWN pot share. T8 makes equity
 *     unreachable pre-commit precisely because it is a strong proxy for the correct action, and the
 *     Interrogator fires at G5a state 4, which is pre-reveal. The REQUIRED share is deliberately
 *     NOT counted as a leak: it is pot/to-call arithmetic over two numbers already visible on the
 *     table, so a question may legitimately hand it back. Required-share disclosures are counted
 *     separately as L3r and reported, not charged as leaks.
 *
 * Mechanical detection, then every hit is quoted in the report for a human to confirm.
 */
import { readFileSync } from 'node:fs';
import type { ExplainerPayload } from './spots.js';

interface Row {
  spotId: string; tier: string; variant: string; output: string;
  guard: { pass: boolean }; payload: ExplainerPayload; learnerReason?: string;
}

const variant = process.argv[2] ?? 'banlist';
const file = process.argv[3] ?? 'interrogator';
const data = JSON.parse(readFileSync(`scripts/experiments/tutorPrompts/out/${file}.json`, 'utf8')) as { rows: Row[] };
const rows = data.rows.filter((r) => r.variant === variant && r.guard.pass);

const ACTION_WORDS: Record<string, string[]> = {
  check: ['check', 'checking', 'check behind', 'checking behind'],
  call: ['call', 'calling'],
  fold: ['fold', 'folding'],
  bet: ['bet', 'betting'],
  raise: ['raise', 'raising'],
  allin: ['shove', 'shoving', 'jam', 'jamming', 'all-in', 'allin'],
};

type Klass = 'L1' | 'L2' | 'L3' | 'L3r';
interface Leak { spotId: string; tier: string; klass: Klass; why: string; output: string }
const leaks: Leak[] = [];

for (const r of rows) {
  const p = r.payload;
  const t = r.output.replace(/\s+/g, ' ');
  const low = t.toLowerCase();

  // L1 — the cheaper action is named in a contrastive frame.
  // "would call your raise" is the VILLAIN calling, not a recommendation to the learner, so a
  // cheapest-action of "call" only counts when the verb has the learner as its subject.
  const cheaper = ACTION_WORDS[p.cheapestAction] ?? [];
  const taken = ACTION_WORDS[p.yourAction] ?? [];
  const villainSubject = /\b(?:hands|villain|opponent|he|she|they|worse hands|better hands)\s+(?:worse than yours\s+)?would\s+(?:call|fold|raise)\b/.test(low);
  const mentionsCheaper = !villainSubject && cheaper.some((w) => new RegExp(`\\b${w}\\b`).test(low));
  const contrastive = /\b(instead of|rather than|over|versus|vs\.?|compared to|as opposed to|when you could)\b/.test(low);
  if (mentionsCheaper && p.cheapestAction !== p.yourAction) {
    const bothNamed = taken.some((w) => new RegExp(`\\b${w}\\b`).test(low));
    if (contrastive || bothNamed) {
      leaks.push({
        spotId: r.spotId, tier: r.tier, klass: 'L1', output: t,
        why: `names the payload's cheapest action "${p.cheapestAction}" against the taken action "${p.yourAction}"`,
      });
    }
  }

  // L2 — the premise asserts the outcome.
  const verdictPremises: [RegExp, string][] = [
    [/\bwhen you(?:'re| are) (?:behind|ahead|drawing dead|way behind|beat|crushed|dominat\w+)\b/, 'premise states whether the hand is ahead or behind'],
    [/\bwith a hand that wins this often\b|\bthat wins this often\b/, 'premise states the hand wins often'],
    [/\bwhen you (?:hold|held|have) (?:top pair|the nuts|a straight|trips|the best hand)\b/, 'premise names made-hand strength as fact'],
    [/\bwhen you could see all five cards\b|\bno card coming\b|\bno more cards\b/, 'premise supplies the reasoning the learner was to retrieve'],
    [/\bwhat happens to your (?:flush|straight|trips|pair|value)\b/, 'premise asserts the hand has that value'],
    [/\byou (?:were|are) (?:priced in|getting better than|getting a price)\b/, 'premise states the price was favourable'],
    [/\bwhen you(?:'re| are) bluffing\b/, 'premise classifies the bet as a bluff'],
    [/\bwhen you need \d+ ?% to continue profitably\b/, 'premise supplies the required share and calls it the profit threshold'],
  ];
  for (const [re, why] of verdictPremises) {
    if (re.test(low)) { leaks.push({ spotId: r.spotId, tier: r.tier, klass: 'L2', output: t, why }); break; }
  }

  // L3 — the learner's own pot share disclosed. L3r — the required share only.
  const own: string[] = [];
  const reqOnly: string[] = [];
  for (const m of t.matchAll(/([\d.]+)\s*%/g)) {
    const v = parseFloat(m[1]);
    if (Math.abs(v - p.potSharePct) < 0.01) own.push(`${v}% = the learner's own pot share`);
    else if (p.boundarySharePct !== null && Math.abs(v - p.boundarySharePct) < 0.01) own.push(`${v}% = the boundary hand's share`);
    else if (Math.abs(v - p.requiredSharePct) < 0.01 && p.requiredSharePct > 0) reqOnly.push(`${v}% = the required share (derivable from pot/to-call)`);
  }
  if (/\b\d+ percent equity\b/.test(low)) own.push('equity stated in words');
  if (own.length) leaks.push({ spotId: r.spotId, tier: r.tier, klass: 'L3', output: t, why: own.join('; ') });
  else if (reqOnly.length) leaks.push({ spotId: r.spotId, tier: r.tier, klass: 'L3r', output: t, why: reqOnly.join('; ') });
}

const CHARGED: Klass[] = ['L1', 'L2', 'L3'];
const spots = new Set(leaks.filter((l) => CHARGED.includes(l.klass)).map((l) => l.spotId));
console.log(`${file}/${variant}: ${rows.length} guard-PASSING questions`);
for (const k of ['L1', 'L2', 'L3', 'L3r'] as const) {
  const s = new Set(leaks.filter((l) => l.klass === k).map((l) => l.spotId));
  console.log(`  ${k}: ${s.size} questions${k === 'L3r' ? ' (reported, NOT charged as a leak)' : ''}`);
}
console.log(`  LEAK RATE (L1+L2+L3): ${spots.size}/${rows.length} = ${((spots.size / rows.length) * 100).toFixed(1)}%`);
for (const k of ['L1', 'L2', 'L3', 'L3r'] as const) {
  console.log(`\n--- ${k} ---`);
  for (const l of leaks.filter((x) => x.klass === k)) {
    console.log(`  ${l.spotId} ${l.tier} — ${l.why}\n    "${l.output}"`);
  }
}
