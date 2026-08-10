/**
 * S2a says a short sitting is served by free-roam "without decay probes, remediation floors, or a
 * scoreboard". A wave-12 verifier claimed the scoreboard block fires in free-roam anyway. This probe
 * settles it against the real API: assemble returns a PlanResult union and dueProbes is required.
 */
import { assemble } from '../../src/core/sessionPlan.js';

for (const mode of ['session', 'free-roam'] as const) {
  for (const durationMinutes of [15, 22, 23, 30, 60]) {
    for (const dueProbes of [0, 6]) {
      const result = assemble({ durationMinutes, mode, dueProbes });
      const head = `${mode.padEnd(10)} ${String(durationMinutes).padStart(3)}min due=${dueProbes}`;
      if (!result.ok) {
        console.log(`${head}  REFUSED: ${result.reason}`);
        continue;
      }
      const kinds = result.plan.blocks.map((b) => `${b.kind}:${b.minutes}m/${b.units}`);
      const banned = result.plan.blocks
        .filter((b) => b.kind === 'scoreboard' || b.kind === 'decay-probes' || b.kind === 'contrast-remediation')
        .map((b) => b.kind);
      console.log(`${head}  ${kinds.join('  ')}`);
      if (mode === 'free-roam' && banned.length > 0) {
        console.log(`${' '.repeat(head.length)}  ^^ S2a FORBIDS IN FREE-ROAM: ${banned.join(', ')}`);
      }
    }
  }
}
