/**
 * EXPERIMENT 4 — measurement 2, part A: the objectively-decidable relationship classes.
 *
 * Two families of false claim are decidable without judgement, and both slip through T4's
 * string-membership provenance check:
 *
 *  A. CHIP-COUNT REPURPOSING — a payload numeral that is a pot, a call, a percentage or an EV loss
 *     is asserted as the size of a different quantity ("the shove risks 22bb", where 22 is the
 *     required pot-share percent; "Bet 0.5 bb", where 0.5 is the EV loss in bb). This is exactly
 *     the case PRODUCT-SPEC T4 names and declines to close.
 *
 *  B. BOUNDARY DIRECTION — the output states which way the flipping variable moves between the
 *     learner's hand and the boundary hand. The payload contains both hands, so the direction is
 *     checkable: "the top card downgrades from queen to ace" is false for Q8o -> A8o.
 *
 *  C. BOUNDARY-AS-FLOOR INVERSION — the boundary hand is presented as a threshold the learner's
 *     hand must clear ("K6s at 41% is the boundary: any stronger hand must bet") when the boundary
 *     hand's share is BELOW the learner's. The learner is already above it, so the sentence
 *     reverses which side of the line they are on.
 *
 *  D. REQUIREMENT SUBSTITUTION — the boundary hand's pot share is asserted as the share the
 *     decision REQUIRES ("needs 35% to bet profitably" where 35 is the boundary hand's equity and
 *     the payload's required share is 0). This installs a fabricated pot-odds rule.
 *
 *  E. RANK-DISTANCE COUNT — an explicit count of ranks between the hand and the boundary hand
 *     ("A8o at 36%: six ranks higher in the top card" — Q to A is two). Class B catches only the
 *     literal phrase "one rank"; the round-2 prompts, which instruct the model to check the ranks,
 *     made it state a count instead, so the arithmetic became checkable and often wrong.
 */
import { readFileSync } from 'node:fs';
import { RANKS } from '../../../src/core/cards.js';
import type { ExplainerPayload } from './spots.js';

interface Row {
  spotId: string; tier: string; variant: string; output: string;
  guard: { pass: boolean }; payload: ExplainerPayload;
}

const variant = process.argv[3] ?? 'terse';
const phase = process.argv[2] ?? 'explainer';
const data = JSON.parse(readFileSync(`scripts/experiments/tutorPrompts/out/${phase}.json`, 'utf8')) as { rows: Row[] };
const rows = data.rows.filter((r) => r.variant === variant && r.guard.pass && /\d/.test(r.output));

const RANK_WORDS: Record<string, string> = {
  ace: 'A', king: 'K', queen: 'Q', jack: 'J', ten: 'T', nine: '9', eight: '8', seven: '7',
  six: '6', five: '5', four: '4', three: '3', deuce: '2', two: '2',
};
const rv = (r: string) => RANKS.indexOf(r as (typeof RANKS)[number]);

type Klass = 'A' | 'B' | 'C' | 'D' | 'E';
interface Finding { spotId: string; tier: string; klass: Klass; claim: string; why: string }
const findings: Finding[] = [];

for (const r of rows) {
  const p = r.payload;
  const text = r.output.replace(/\s+/g, ' ');
  const pot = p.potBb, toCall = p.toCallBb;
  const loss = parseFloat(p.evLossBb);
  const isShove = p.yourAction === 'allin';

  // ── A. chip-count repurposing ──────────────────────────────────────────────
  // A quantity asserted as the amount RISKED / BET / SHOVED must be the amount actually put in.
  // A shove commits the stack, which the payload does not carry at all, so ANY bb figure attached
  // to a shove is unsupported; a bet/raise's amount is likewise absent from the payload.
  for (const m of text.matchAll(/(?:risk(?:s|ing)?|shov(?:e|ing)|jam(?:s|ming)?|bet(?:s|ting)?|commit(?:s|ting)?|size(?:s)?)\s+(?:the\s+)?([\d.]+)\s*(?:bb\b|into)/gi)) {
    const v = parseFloat(m[1]);
    const label = Math.abs(v - loss) < 0.01 ? `the EV loss (${loss} bb)`
      : Math.abs(v - pot) < 0.01 ? `the pot (${pot} bb)`
      : Math.abs(v - toCall) < 0.01 ? `the amount to call (${toCall} bb)`
      : v === p.requiredSharePct ? `the required pot share (${p.requiredSharePct}%)`
      : v === p.potSharePct ? `the held pot share (${p.potSharePct}%)`
      : null;
    if (label === null) continue;
    // Calling "X into Y" is legitimate when X is genuinely the call.
    if (/bet(?:s|ting)?\s+[\d.]+\s*bb\b/i.test(m[0]) === false && label.startsWith('the amount to call') && !isShove) continue;
    findings.push({
      spotId: r.spotId, tier: r.tier, klass: 'A',
      claim: m[0],
      why: `${v} is ${label}, asserted as the amount ${isShove ? 'shoved' : 'wagered'}${isShove ? ' (a shove commits the stack; no stack figure is in the payload)' : ''}`,
    });
  }

  // ── D. requirement substitution ───────────────────────────────────────────
  for (const m of text.matchAll(/needs?\s+(?:only\s+|just\s+)?([\d.]+)\s*%/gi)) {
    const v = parseFloat(m[1]);
    if (Math.abs(v - p.requiredSharePct) < 0.6) continue;
    const fromBoundary = p.boundarySharePct !== null && Math.abs(v - p.boundarySharePct) < 0.6;
    findings.push({
      spotId: r.spotId, tier: r.tier, klass: 'D', claim: m[0],
      why: fromBoundary
        ? `${v}% is the BOUNDARY HAND's pot share, asserted as the share this decision requires (payload required = ${p.requiredSharePct}%)`
        : `${v}% appears nowhere as a requirement (payload required = ${p.requiredSharePct}%)`,
    });
  }

  // ── B. boundary direction ─────────────────────────────────────────────────
  if (!p.boundaryHand) continue;

  // ── C. boundary-as-floor inversion ────────────────────────────────────────
  if (p.boundarySharePct !== null && p.boundarySharePct < p.potSharePct) {
    const m = text.match(/(?:marks|is|sits at|at)\s+the\s+(?:boundary|threshold)|threshold\s+(?:where|that)|becomes profitable|justifies|crosses|clears/i);
    if (m) {
      findings.push({
        spotId: r.spotId, tier: r.tier, klass: 'C', claim: m[0],
        why: `boundary ${p.boundaryHand} holds ${p.boundarySharePct}%, BELOW the hand's own ${p.potSharePct}% — it is not a bar this hand must clear`,
      });
    }
  }
  const heroLabel = p.yourHand.split(' ')[0];
  const bHand = p.boundaryHand;
  // Compare the two hands rank-wise to find which rank actually differs and in which direction.
  const heroRanks = [heroLabel[0], heroLabel[1]].map(rv).sort((a, b) => b - a);
  const bRanks = [bHand[0], bHand[1]].map(rv).sort((a, b) => b - a);
  const diffHi = bRanks[0] - heroRanks[0];
  const diffLo = bRanks[1] - heroRanks[1];

  // "from X to Y" — X and Y must be ranks actually present, in the actual direction.
  for (const m of text.matchAll(/from (?:a |an |the )?([A-Za-z2-9]+)\s+to (?:a |an |the )?([A-Za-z2-9]+)/gi)) {
    const from = RANK_WORDS[m[1].toLowerCase()] ?? (m[1].length === 1 ? m[1].toUpperCase() : null);
    const to = RANK_WORDS[m[2].toLowerCase()] ?? (m[2].length === 1 ? m[2].toUpperCase() : null);
    if (!from || !to) continue;
    const heroHas = heroLabel.includes(from);
    const bHas = bHand.includes(to);
    if (!heroHas || !bHas) {
      findings.push({
        spotId: r.spotId, tier: r.tier, klass: 'B', claim: m[0],
        why: `hand is ${heroLabel}, boundary is ${bHand}: ${!heroHas ? `${from} is not in ${heroLabel}` : ''}${!heroHas && !bHas ? ' and ' : ''}${!bHas ? `${to} is not in ${bHand}` : ''}`,
      });
    }
  }
  // "upgrade / higher / stronger" vs "downgrade / lower / weaker" applied to the boundary move.
  for (const m of text.matchAll(/(upgrad\w+|higher|stronger|improv\w+|rais\w+)\s*(?:the\s+)?(?:top card|kicker)|(?:top card|kicker)\s+(upgrad\w+|higher|stronger|improv\w+|downgrad\w+|lower|weaker)/gi)) {
    const word = (m[1] ?? m[2] ?? '').toLowerCase();
    if (!word) continue;
    const claimsUp = /upgrad|higher|stronger|improv|rais/.test(word);
    const actualUp = (diffHi !== 0 ? diffHi : diffLo) > 0;
    if (claimsUp !== actualUp) {
      findings.push({
        spotId: r.spotId, tier: r.tier, klass: 'B', claim: m[0],
        why: `claims the boundary is ${claimsUp ? 'higher' : 'lower'}, but ${heroLabel} -> ${bHand} moves ${actualUp ? 'up' : 'down'}`,
      });
    }
  }
  // E. an explicit count of ranks between the two hands.
  const NUMWORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  for (const m of text.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(?:kicker\s+)?ranks?\b/gi)) {
    const claimed = NUMWORD[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    if (!Number.isFinite(claimed)) continue;
    const gapHi = Math.abs(diffHi), gapLo = Math.abs(diffLo);
    if (claimed === gapHi || claimed === gapLo) continue;
    findings.push({
      spotId: r.spotId, tier: r.tier, klass: 'E', claim: m[0],
      why: `claims ${claimed} ranks, but ${heroLabel} -> ${bHand} differs by ${gapHi !== 0 ? gapHi : gapLo} (top card ${gapHi}, low card ${gapLo})`,
    });
  }

  // "one rank / one pip / one card" when the gap is larger.
  for (const m of text.matchAll(/\bone (?:rank|pip|card|kicker rank|seat)\b/gi)) {
    const gap = Math.abs(diffHi !== 0 ? diffHi : diffLo);
    if (gap > 1) {
      findings.push({
        spotId: r.spotId, tier: r.tier, klass: 'B', claim: m[0],
        why: `claims one step, but ${heroLabel} -> ${bHand} is ${gap} ranks`,
      });
    }
  }
}

const LABELS: Record<Klass, string> = {
  A: 'numeral repurposed as a different quantity',
  B: 'boundary direction / step size wrong    ',
  C: 'boundary presented as a floor it is not ',
  D: 'boundary share asserted as a requirement',
  E: 'explicit rank-distance count is wrong  ',
};
const KLASSES: Klass[] = ['A', 'B', 'C', 'D', 'E'];
const spotsAny = new Set<string>();

console.log(`${phase}/${variant}: ${rows.length} guard-PASSING numeral-bearing outputs`);
for (const k of KLASSES) {
  const fs = findings.filter((f) => f.klass === k);
  const spots = new Set(fs.map((f) => f.spotId));
  for (const s of spots) spotsAny.add(s);
  console.log(`  class ${k} (${LABELS[k]}): ${spots.size} outputs, ${fs.length} claims`);
}
console.log(`  AT LEAST ONE mechanically-false relationship: ${spotsAny.size}/${rows.length} = ${((spotsAny.size / rows.length) * 100).toFixed(1)}%`);
for (const k of KLASSES) {
  console.log(`\n--- CLASS ${k}: ${LABELS[k].trim()} ---`);
  for (const f of findings.filter((x) => x.klass === k)) {
    console.log(`  ${f.spotId} ${f.tier}\n    claim: "${f.claim}"\n    why:   ${f.why}`);
  }
}
