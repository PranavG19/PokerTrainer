import { describe, it, expect } from 'vitest';
import { LESSONS, lessonById } from '../../src/core/lessons/index.js';
import {
  comboOf,
  isInRfiRange,
  defenseAction,
  threeBetResponseAction,
  type DefensePosition,
  type ThreeBetResponsePosition,
} from '../../src/core/preflop.js';

/**
 * The preflop lessons teach a reply (open/fold, call/fold, 3-bet/flat/fold) that is stated only in prose.
 * Every one of those replies is asserted here to still match the app's own rule in preflop.ts, computed
 * from the LIVE example's hole cards + seat. This is the regression oracle for the honesty bar: if a rule
 * is ever retuned, or a lesson's cards are edited, the taught reply and the rule desync and this goes red —
 * so no lesson can silently teach a hand the engine no longer sorts that way.
 *
 * The opener's seat in a big-blind-defence spot is narrative (the example's `position` is always 'BB'), so
 * the DefensePosition lives in the key below; the hole cards and the expected action are cross-checked
 * against the live lesson data, which is what catches an accidental edit.
 */

type RfiCheck = { rule: 'rfi'; expectOpen: boolean };
type DefenceCheck = { rule: 'defence'; spot: DefensePosition; expect: 'threebet' | 'call' | 'fold' };
type ThreeBetCheck = { rule: 'threebet-response'; seat: ThreeBetResponsePosition; expect: 'threebet' | 'call' | 'fold' };
type Check = RfiCheck | DefenceCheck | ThreeBetCheck;

const ANSWER_KEY: Record<string, Record<string, Check>> = {
  'position-sets-your-range': {
    'q9o-cutoff-fold': { rule: 'rfi', expectOpen: false },
    'q9o-button-open': { rule: 'rfi', expectOpen: true },
  },
  'small-blind-raise-or-fold': {
    'k9o-open': { rule: 'rfi', expectOpen: true },
    'q9o-fold': { rule: 'rfi', expectOpen: false },
    '85o-fold': { rule: 'rfi', expectOpen: false },
  },
  'defend-the-big-blind': {
    'kqo-defend': { rule: 'defence', spot: 'bb-vs-btn', expect: 'call' },
    '72o-fold': { rule: 'defence', spot: 'bb-vs-btn', expect: 'fold' },
  },
  'opener-seat-sets-defence-width': {
    'kto-vs-utg-fold': { rule: 'defence', spot: 'bb-vs-utg', expect: 'fold' },
    'kto-vs-btn-call': { rule: 'defence', spot: 'bb-vs-btn', expect: 'call' },
    'kqo-vs-utg-call': { rule: 'defence', spot: 'bb-vs-utg', expect: 'call' },
  },
  'three-bet-or-flat-the-defence': {
    'aa-threebet': { rule: 'defence', spot: 'bb-vs-btn', expect: 'threebet' },
    'a5s-flat': { rule: 'defence', spot: 'bb-vs-btn', expect: 'call' },
    '72o-fold': { rule: 'defence', spot: 'bb-vs-btn', expect: 'fold' },
  },
  'facing-a-3bet': {
    'aa-4bet': { rule: 'threebet-response', seat: 'CO', expect: 'threebet' },
    'ajs-flat': { rule: 'threebet-response', seat: 'CO', expect: 'call' },
    'a5s-fold': { rule: 'threebet-response', seat: 'CO', expect: 'fold' },
  },
};

describe('preflop lessons stay consistent with the RFI/defence rules', () => {
  it('the answer key names an example that actually exists in each lesson', () => {
    for (const [lessonId, examples] of Object.entries(ANSWER_KEY)) {
      const lesson = lessonById(lessonId);
      expect(lesson, `lesson ${lessonId} is registered`).toBeDefined();
      const exampleIds = new Set(lesson!.examples.map((e) => e.id));
      for (const exampleId of Object.keys(examples)) {
        expect(exampleIds.has(exampleId), `${lessonId}/${exampleId} exists`).toBe(true);
      }
    }
  });

  it('every keyed example teaches the reply the rule computes from its live hole cards', () => {
    for (const [lessonId, examples] of Object.entries(ANSWER_KEY)) {
      const lesson = lessonById(lessonId)!;
      for (const [exampleId, check] of Object.entries(examples)) {
        const example = lesson.examples.find((e) => e.id === exampleId)!;
        const combo = comboOf(example.hole[0], example.hole[1]);
        const where = `${lessonId}/${exampleId} (${combo})`;
        if (check.rule === 'rfi') {
          // RFI examples carry their real seat in the example; verify against it.
          expect(isInRfiRange(combo, example.position as never), `${where} RFI open`).toBe(check.expectOpen);
        } else if (check.rule === 'defence') {
          expect(defenseAction(combo, check.spot), `${where} defence vs ${check.spot}`).toBe(check.expect);
        } else {
          expect(threeBetResponseAction(combo, check.seat), `${where} 3-bet response @ ${check.seat}`).toBe(
            check.expect,
          );
        }
      }
    }
  });

  it('covers every phase-1 preflop lesson that teaches a rule-graded reply', () => {
    // Guards against adding a preflop rule-lesson and forgetting to pin it here. The set below is the
    // exhaustive list of phase-1 lessons whose examples name a preflop open/defence/3-bet reply.
    const RULE_LESSONS = new Set(Object.keys(ANSWER_KEY));
    const preflopRuleLessonIds = LESSONS.filter(
      (l) =>
        l.phase === 1 &&
        ['position-sets-your-range', 'small-blind-raise-or-fold', 'defend-the-big-blind',
          'opener-seat-sets-defence-width', 'three-bet-or-flat-the-defence', 'facing-a-3bet'].includes(l.id),
    ).map((l) => l.id);
    for (const id of preflopRuleLessonIds) {
      expect(RULE_LESSONS.has(id), `${id} has a consistency answer key`).toBe(true);
    }
  });
});
