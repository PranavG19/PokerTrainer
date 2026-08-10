/**
 * a39 — pin the repay-then-drop order in applyGraded. repay uses fadedRung (+1, toward less support),
 * the accuracy drop uses droppedRung (-1). On an interior rung they COMMUTE (net -1 either way), which
 * is why a naive swap survives. They diverge only at a BOUNDARY: at rung 4, fadedRung saturates (stays
 * 4) but droppedRung does not. So the discriminating log sits at rung 4 with a hint debt outstanding.
 */
import { deriveState, hintPrice, type FadingEvent } from '../../src/core/fading.js';

const C = 'polarity-wants-size';
const faded = (): FadingEvent => ({ kind: 'supportFaded', conceptId: C, at: 1 });
const graded = (correct: boolean): FadingEvent => ({ kind: 'graded', conceptId: C, at: 1, correct });

// rung 4 (4 fades) → hint (rung 3, debt 1) → supportFaded (rung 4, debt 1, attempts untouched).
const climb: FadingEvent[] = Array.from({ length: 4 }, faded);
const s4 = deriveState(C, climb);
const hint: FadingEvent = { kind: 'hintRequested', conceptId: C, at: 1, quotedRungAfter: hintPrice(s4).rungAfter };
const s3 = deriveState(C, [...climb, hint]);
const base = [...climb, hint, faded()]; // rung 4, debt 1
console.log('base:', JSON.stringify({ rung: deriveState(C, base).rung, debt: deriveState(C, base).hintDebt }));

// 7 wrong then 3 correct: the last correct completes the streak AND puts the window at 3/10 < 70%.
const log = [...base, ...Array.from({ length: 7 }, () => graded(false)), ...Array.from({ length: 3 }, () => graded(true))];
const s = deriveState(C, log);
console.log(`7w 3c -> rung ${s.rung}, hintDebt ${s.hintDebt}, streak ${s.consecutiveCorrect}, recent ${s.recentAttempts.filter(Boolean).length}/${s.recentAttempts.length}`);
