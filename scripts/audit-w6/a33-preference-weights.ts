// N4 promises the recommender "adjusts weighting" after 5 declines. Is the bonus big enough to actually
// reorder families, without being big enough to beat spacing debt? Print the real weight bands.
import { recommend, prefer, emptyRecommender, SOURCES, type Source } from '../../src/core/recommend.js';
import { MS_PER_DAY, type ConceptState } from '../../src/core/schedule.js';

const NOW = 100 * MS_PER_DAY;
const c = (id: string, age: number, reps: number, hits: number): ConceptState => ({
  id, firstSeen: NOW - age*MS_PER_DAY,
  opportunities: Array.from({length: reps}, (_, i) => ({ at: NOW, correct: i < hits })),
  probeMisses: 0,
});

const weak = c('weak', 0, 12, 3);           // fluency-gate candidate
const strong = c('strong', 0, 12, 11);      // mastery candidate
const overdue = c('spaced', 40, 1, 1);      // spacing debt
const leaks = [{ principle: 'lk', count: 1, costBb: 3 }];

const scen = (label: string, concepts: ConceptState[], pref?: Source) => {
  const r = pref ? prefer(emptyRecommender(), pref) : emptyRecommender();
  const s = recommend({ concepts, leaks, recommender: r, now: NOW });
  console.log(`${label.padEnd(46)} -> ${s?.source ?? 'null'} (${s?.subject ?? '-'})`);
};

console.log('=== no preference ===');
scen('weak gate vs leak', [weak]);
scen('strong mastery vs leak', [strong]);
scen('overdue vs weak vs leak', [overdue, weak]);
console.log('=== preferring each source ===');
for (const p of SOURCES) {
  scen(`prefer ${p}: weak gate vs leak`, [weak], p);
  scen(`prefer ${p}: overdue vs weak vs leak`, [overdue, weak], p);
}
