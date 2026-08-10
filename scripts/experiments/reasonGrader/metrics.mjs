export const LABELS = ['range', 'price', 'hand-strength', 'none'];

/** Confusion matrix as truth -> predicted -> count, including an `unparsed` predicted column. */
export function confusion(rows) {
  const m = {};
  for (const truth of LABELS) {
    m[truth] = {};
    for (const pred of [...LABELS, 'unparsed']) m[truth][pred] = 0;
  }
  for (const r of rows) m[r.label][LABELS.includes(r.got) ? r.got : 'unparsed']++;
  return m;
}

export function perClass(rows) {
  const m = confusion(rows);
  const out = {};
  for (const label of LABELS) {
    const tp = m[label][label];
    const support = LABELS.concat('unparsed').reduce((s, p) => s + m[label][p], 0);
    const predicted = LABELS.reduce((s, t) => s + m[t][label], 0);
    const precision = predicted === 0 ? null : tp / predicted;
    const recall = support === 0 ? null : tp / support;
    const f1 = precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
    out[label] = { support, predicted, tp, precision, recall, f1 };
  }
  return out;
}

/**
 * G4's gate quantity. The escalation fires iff the predicted label is hand-strength or none, so
 * treat {hand-strength, none} as one positive class "no legitimate mechanism given".
 * - precision = of the decisions G4 would interrupt, the share that really lacked a mechanism.
 * - 1 - precision = the share of well-reasoned decisions punished. That is the number the spec
 *   gates on ("at 80% accuracy roughly one in five well-reasoned decisions gets punished").
 */
export function g4Binary(rows) {
  const isPos = (l) => l === 'hand-strength' || l === 'none';
  const tp = rows.filter((r) => isPos(r.label) && isPos(r.got)).length;
  const fp = rows.filter((r) => !isPos(r.label) && isPos(r.got)).length;
  const fn = rows.filter((r) => isPos(r.label) && !isPos(r.got)).length;
  const tn = rows.filter((r) => !isPos(r.label) && !isPos(r.got)).length;
  return {
    tp, fp, fn, tn,
    precision: tp + fp === 0 ? null : tp / (tp + fp),
    recall: tp + fn === 0 ? null : tp / (tp + fn),
    // Wilson 95% interval on precision — n is 100, so the point estimate alone is misleading.
    precisionCI95: wilson(tp, tp + fp),
    recallCI95: wilson(tp, tp + fn),
  };
}

/** Wilson score interval; normal-approx intervals are wrong near p=1, which is where we land. */
export function wilson(successes, n, z = 1.96) {
  if (n === 0) return null;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function pct(x) {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

export function markdownConfusion(rows) {
  const m = confusion(rows);
  const cols = [...LABELS, 'unparsed'];
  const head = `| truth \\ predicted | ${cols.join(' | ')} | recall |`;
  const sep = `|---|${cols.map(() => '---:').join('|')}|---:|`;
  const body = LABELS.map((t) => {
    const support = cols.reduce((s, c) => s + m[t][c], 0);
    const cells = cols.map((c) => (t === c ? `**${m[t][c]}**` : String(m[t][c])));
    return `| **${t}** (n=${support}) | ${cells.join(' | ')} | ${pct(m[t][t] / support)} |`;
  });
  const precisions = cols.map((c) => {
    if (c === 'unparsed') return '—';
    const predicted = LABELS.reduce((s, t) => s + m[t][c], 0);
    return predicted === 0 ? 'n/a' : pct(m[c][c] / predicted);
  });
  return [head, sep, ...body, `| **precision** | ${precisions.join(' | ')} | |`].join('\n');
}
