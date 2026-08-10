// When is a concept NOT due? My recommender tests assumed "firstSeenDaysAgo: 1" means not-yet-due.
// Check against the real WAVES/WAVE_WINDOWS.
import { WAVES, MS_PER_DAY, nextDue, gate, posterior, type ConceptState } from '../../src/core/schedule.js';

console.log('WAVES:', JSON.stringify(WAVES));
const NOW = 100 * MS_PER_DAY;
const mk = (firstSeenDaysAgo: number, reps: number, hits: number, recordedDaysAgo = 0): ConceptState => ({
  id: 'x',
  firstSeen: NOW - firstSeenDaysAgo * MS_PER_DAY,
  opportunities: Array.from({ length: reps }, (_, i) => ({ at: NOW - recordedDaysAgo * MS_PER_DAY, correct: i < hits })),
  probeMisses: 0,
});
console.log('\nage | reps | due? | gate | posterior');
for (const age of [0, 1, 2, 3, 7, 14, 40]) {
  for (const [reps, hits] of [[12, 2], [12, 11], [30, 12], [1, 1]] as const) {
    const c = mk(age, reps, hits);
    const d = nextDue(c, NOW);
    console.log(`${String(age).padStart(3)} | ${reps}/${hits} | ${d ? 'day-'+d.waveDay+' overdue'+d.overdueDays : 'no'} | ${gate(c, NOW).status} | ${posterior(c, NOW).mean.toFixed(3)}`);
  }
}
