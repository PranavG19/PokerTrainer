/**
 * a40 — is reasonGrade's EMPTY_OR_EVASIVE gate load-bearing, or does every evasive input reach the
 * same 'none' by falling through? Removing the gate (M7) survived the suite; this probe finds whether
 * any classification actually changes, distinguishing an equivalent mutant from a blind spot.
 */
import { gradeReason } from '../../src/core/reasonGrade.js';

const EVASIVE = ['', '   ', 'idk', 'asdf', 'vibes', 'n/a', 'na', 'because', 'dunno', 'no idea', '???', '.', '?!'];
for (const s of EVASIVE) {
  const g = gradeReason(s);
  console.log(`${JSON.stringify(s).padEnd(10)} -> category=${g.category} explicitGuess=${g.explicitGuess}`);
}
