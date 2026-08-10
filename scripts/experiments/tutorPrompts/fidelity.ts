/**
 * EXPERIMENT 4 — measurement 2: NUMBER FIDELITY.
 *
 * PRODUCT-SPEC T4 admits plainly that number provenance is string membership, so it "passes output
 * that is false using only permitted numerals (payload has pot 10 and bet 5; 'risking 10 to win 5'
 * inverts the relationship and passes)". This file measures how big that hole is on real output.
 *
 * It does NOT decide fidelity. It extracts every quantitative CLAIM from each guard-passing output
 * and prints it beside the payload value it should match, so a human adjudicates each one. The
 * mechanical checks below are pre-flags to make sure nothing is missed by eye — a claim can be
 * false in ways no regex reaches (the "risks 22bb" case is only false because 22 is the required
 * share percent being reused as a chip count).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { ExplainerPayload } from './spots.js';

interface Row {
  spotId: string; street: string; tier: string; tag: string; variant: string;
  output: string; guard: { pass: boolean }; payload: ExplainerPayload;
}

const variant = process.argv[3] ?? 'terse';
const phase = process.argv[2] ?? 'explainer';
const data = JSON.parse(readFileSync(`scripts/experiments/tutorPrompts/out/${phase}.json`, 'utf8')) as { rows: Row[] };
const rows = data.rows.filter((r) => r.variant === variant && r.guard.pass && /\d/.test(r.output));

interface Flag { kind: string; detail: string }

function flags(r: Row): Flag[] {
  const p = r.payload;
  const out: Flag[] = [];
  const text = r.output.replace(/\s+/g, ' ');
  const share = p.potSharePct;
  const req = p.requiredSharePct;
  const pot = p.potBb;
  const toCall = p.toCallBb;
  const num = (s: string) => parseFloat(s);

  // "risk(s|ing) X to win Y" — X must be the amount put in, Y the amount available.
  for (const m of text.matchAll(/risk(?:s|ing)?\s+([\d.]+)\s*(?:bb)?\s+to (?:win|contest|capture)\s+([\d.]+)/gi)) {
    out.push({ kind: 'risk-to-win', detail: `claims risk ${m[1]} to win ${m[2]}; payload toCall=${toCall} pot=${pot}` });
  }
  // "call Xbb into Ybb" — X is the call, Y the pot; swapped is a real inversion.
  for (const m of text.matchAll(/call(?:ing)?\s+([\d.]+)\s*(?:bb)?\s+into\s+(?:a\s+)?([\d.]+)/gi)) {
    const a = num(m[1]), b = num(m[2]);
    const ok = Math.abs(a - toCall) < 0.15 && Math.abs(b - pot) < 0.15;
    out.push({ kind: 'call-into', detail: `${ok ? 'OK' : 'MISMATCH'} claims call ${a} into ${b}; payload toCall=${toCall} pot=${pot}` });
  }
  // "needs N% ... holds/has M%" and the reverse ordering.
  for (const m of text.matchAll(/needs?\s+(?:only\s+)?([\d.]+)\s*%/gi)) {
    const a = num(m[1]);
    if (Math.abs(a - req) > 0.6) out.push({ kind: 'needs-pct', detail: `claims needs ${a}%; payload required=${req}%` });
  }
  for (const m of text.matchAll(/(?:holds?|has|hold|with)\s+(?:only\s+|just\s+)?([\d.]+)\s*%\s*(?:equity|pot share|share)?/gi)) {
    const a = num(m[1]);
    const known = [share, req, p.boundarySharePct].filter((x): x is number => x !== null);
    if (!known.some((k) => Math.abs(a - k) < 0.6)) {
      out.push({ kind: 'holds-pct', detail: `claims holds ${a}%; payload share=${share}% boundary=${p.boundarySharePct}%` });
    }
  }
  // inequality direction: "A% ... below/above ... B%"
  for (const m of text.matchAll(/([\d.]+)\s*%[^.]{0,60}?\b(below|above|under|over|short of|beneath|exceeds?)\b[^.]{0,30}?([\d.]+)\s*%/gi)) {
    const a = num(m[1]), rel = m[2].toLowerCase(), b = num(m[3]);
    const lower = /below|under|short of|beneath/.test(rel);
    const truth = lower ? a < b : a > b;
    if (!truth) out.push({ kind: 'inequality', detail: `claims ${a}% ${rel} ${b}% — arithmetically false` });
  }
  // pot-odds ratio "X:1" or "X-to-1"
  for (const m of text.matchAll(/([\d.]+)\s*(?::|-to-)\s*1\b/gi)) {
    const a = num(m[1]);
    const realOdds = toCall > 0 ? pot / toCall : null;
    const realReq = req > 0 ? (100 - req) / req : null;
    const okOdds = realOdds !== null && Math.abs(a - realOdds) < 0.35;
    const okReq = realReq !== null && Math.abs(a - realReq) < 0.35;
    out.push({ kind: 'odds-ratio', detail: `${okOdds || okReq ? 'OK' : 'CHECK'} claims ${a}:1; pot/toCall=${realOdds?.toFixed(2) ?? 'n/a'} (100-req)/req=${realReq?.toFixed(2) ?? 'n/a'}` });
  }
  // a bb amount attributed to the shove/stack
  for (const m of text.matchAll(/(?:shove|jam|all-in|allin|stack)[^.]{0,40}?([\d.]+)\s*bb/gi)) {
    out.push({ kind: 'shove-size', detail: `claims ${m[1]}bb for the shove; payload has no stack field (pot=${pot} toCall=${toCall})` });
  }
  return out;
}

const scored = rows.map((r) => ({ ...r, flags: flags(r) }));
const flagged = scored.filter((r) => r.flags.some((f) => !f.detail.startsWith('OK')));

console.log(`${phase}/${variant}: ${rows.length} guard-passing numeral-bearing outputs; ${flagged.length} pre-flagged mechanically`);
for (const r of scored) {
  const p = r.payload;
  console.log(`\n### ${r.spotId} ${r.tier} ${r.tag} | action=${p.yourAction} pot=${p.potBb} toCall=${p.toCallBb} share=${p.potSharePct}% req=${p.requiredSharePct}% loss=${p.evLossBb}bb rw=${p.classRwBb100} boundary=${p.boundaryHand}@${p.boundarySharePct}% var="${p.flippingVariable}" hand=${p.yourHand} board=${p.board} cheapest=${p.cheapestAction}`);
  console.log(`OUT: ${r.output.replace(/\s+/g, ' ')}`);
  for (const f of r.flags) console.log(`  FLAG ${f.kind}: ${f.detail}`);
}

writeFileSync(
  `scripts/experiments/tutorPrompts/out/fidelity-${phase}-${variant}.json`,
  JSON.stringify(scored.map((r) => ({ spotId: r.spotId, output: r.output, payload: r.payload, flags: r.flags })), null, 2),
);
