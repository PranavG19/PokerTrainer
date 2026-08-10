// Where does the session floor actually sit? sessionPlan.ts claims 14 + 7*1.25 = 22.75 min in a
// comment; the test must assert the real boundary, not a number I picked.
import { assemble } from '../../src/core/sessionPlan.js';

console.log('=== session mode, 4 probes due ===');
for (const m of [15, 20, 22, 22.5, 22.75, 23, 24, 29, 30, 50]) {
  const r = assemble({ durationMinutes: m, mode: 'session', dueProbes: 4 });
  console.log(`  ${m}: ${r.ok ? `ok total=${r.plan.totalMinutes}` : `refused — ${r.reason}`}`);
}

console.log('=== free-roam ===');
for (const m of [0.5, 1, 5, 10, 15, 30]) {
  const r = assemble({ durationMinutes: m, mode: 'free-roam', dueProbes: 4 });
  console.log(`  ${m}: ${r.ok ? `ok total=${r.plan.totalMinutes}` : `refused — ${r.reason}`}`);
}

console.log('=== the probe reallocation, 50 min ===');
for (const due of [0, 1, 2, 3, 4]) {
  const r = assemble({ durationMinutes: 50, mode: 'session', dueProbes: due });
  if (!r.ok) { console.log(`  due=${due}: refused — ${r.reason}`); continue; }
  const graded = r.plan.blocks.find((b) => b.kind === 'graded-spots');
  const probes = r.plan.blocks.find((b) => b.kind === 'decay-probes');
  console.log(
    `  due=${due}: total=${r.plan.totalMinutes} probes=${probes?.minutes ?? 0}(${probes?.units ?? 0}) graded=${graded?.minutes}(${graded?.units} spots)`,
  );
}

console.log('=== which durations actually record cuts? ===');
for (const m of [22.75, 24, 26, 28, 30, 35, 40, 45, 50, 60, 90]) {
  const r = assemble({ durationMinutes: m, mode: 'session', dueProbes: 4 });
  if (!r.ok) { console.log(`  ${m}: refused`); continue; }
  console.log(`  ${m}: cuts=${JSON.stringify(r.plan.cuts)}`);
}
