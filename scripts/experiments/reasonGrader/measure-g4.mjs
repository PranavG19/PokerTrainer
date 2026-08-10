import { invoke } from './scripts/experiments/socratic/bedrock.mjs';
import { readFileSync } from 'node:fs';

const rows = readFileSync('research/corpus/reasons.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const SYSTEM = `Classify a poker learner's stated reason into exactly one category.
range — reasoning about which hands the opponent (or the learner) can hold
price — reasoning about the cost of continuing vs the pot
hand-strength — reasoning only about how strong this specific hand is
none — no reasoning, evasive, or off-topic
Reply with the single category word and nothing else.`;

const CONC = 8;
const out = [];
let i = 0;
async function worker() {
  while (i < rows.length) {
    const k = i++;
    const r = rows[k];
    try {
      const t = await invoke([{ role: 'user', content: `Reason: "${r.text}"` }], { system: SYSTEM, maxTokens: 8 });
      out[k] = { ...r, pred: t.toLowerCase().trim().replace(/[^a-z-]/g,'') };
    } catch (e) { out[k] = { ...r, pred: 'ERROR' }; }
  }
}
await Promise.all(Array.from({length:CONC}, worker));

const cm = {};
for (const r of out) { cm[r.label] ??= {}; cm[r.label][r.pred] = (cm[r.label][r.pred]??0)+1; }
const correct = out.filter(r=>r.pred===r.label).length;
console.log('ACCURACY', correct, '/', out.length, '=', (100*correct/out.length).toFixed(1)+'%');
for (const cls of ['range','price','hand-strength','none']) {
  const tp = out.filter(r=>r.pred===cls&&r.label===cls).length;
  const fp = out.filter(r=>r.pred===cls&&r.label!==cls).length;
  const fn = out.filter(r=>r.pred!==cls&&r.label===cls).length;
  const prec = tp+fp?100*tp/(tp+fp):0, rec = tp+fn?100*tp/(tp+fn):0;
  console.log(`${cls}: precision ${prec.toFixed(1)}% recall ${rec.toFixed(1)}% (tp=${tp} fp=${fp} fn=${fn})`);
}
// G4 fires on hand-strength or none: how many well-reasoned decisions get punished per 100?
const g4fp = out.filter(r=>(r.pred==='hand-strength'||r.pred==='none') && (r.label==='range'||r.label==='price')).length;
const wellReasoned = out.filter(r=>r.label==='range'||r.label==='price').length;
console.log(`G4 FALSE ESCALATION: ${g4fp}/${wellReasoned} well-reasoned = ${(100*g4fp/wellReasoned).toFixed(1)}%`);
console.log('confusion', JSON.stringify(cm));
