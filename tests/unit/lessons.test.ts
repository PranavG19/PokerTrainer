import { describe, expect, it } from 'vitest';
import { LESSONS, lessonById, lessonsInPhase } from '../../src/core/lessons/index.js';
import {
  formatIssues,
  tryBuildExample,
  validateLesson,
  validateLessons,
  type IssueCode,
} from '../../src/core/lessons/validate.js';
import type { Lesson, LessonExample } from '../../src/core/lessons/types.js';

// ── Fixtures for the rejection half ──────────────────────────────────────────
//
// A validator nobody has watched reject is not a validator, so every check gets
// deliberately broken content of its own.

function example(overrides: Partial<LessonExample> = {}): LessonExample {
  return {
    id: 'ex',
    hole: ['Ah', 'Kh'],
    board: ['Qh', '7d', '2c'],
    street: 'flop',
    pot: 200,
    heroStack: 1000,
    villainStacks: [1000],
    bb: 20,
    position: 'BTN',
    toCall: 50,
    prompt: 'A bet of 50 makes the pot 200. What price is on offer?',
    reasoning:
      'The bet asks 50 to win 250, about 1 time in 5. Two overcards and a backdoor draw clear that. Read the price before the cards next time.',
    ...overrides,
  };
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: 'test-lesson',
    phase: 2,
    title: 'Test lesson',
    mechanism: 'A price states the frequency a call must beat.',
    prerequisites: [],
    examples: [example()],
    acceptanceKeywords: ['price'],
    ...overrides,
  };
}

function codes(issues: readonly { code: IssueCode }[]): IssueCode[] {
  return issues.map((issue) => issue.code);
}

// ── Half one: the registry is clean ──────────────────────────────────────────

describe('registered lessons', () => {
  it('registers at least one lesson', () => {
    expect(LESSONS.length).toBeGreaterThan(0);
  });

  it('passes validation with no issues', () => {
    const issues = validateLessons(LESSONS);
    expect(formatIssues(issues)).toBe('');
  });

  it('looks up by id and by phase', () => {
    for (const registered of LESSONS) {
      expect(lessonById(registered.id)).toBe(registered);
      expect(lessonsInPhase(registered.phase)).toContain(registered);
    }
    expect(lessonById('no-such-lesson')).toBeUndefined();
  });

  it('builds every example on the real engine with hero to act', () => {
    for (const registered of LESSONS) {
      for (const authored of registered.examples) {
        const built = tryBuildExample(authored);
        if (!built.ok) throw new Error(`${registered.id}/${authored.id}: ${built.reason}`);
        expect(built.state.seats[built.state.toAct].isHero).toBe(true);
        expect(built.state.board).toEqual(authored.board);
        expect(built.state.seats[built.state.toAct].hole).toEqual(authored.hole);
      }
    }
  });

  it('keeps the reference lesson exemplary: prices in natural frequencies, no percentages', () => {
    const reference = lessonById('pot-odds-as-a-price');
    expect(reference).toBeDefined();
    for (const authored of reference!.examples) {
      expect(authored.reasoning).toMatch(/\d+ times? in \d+/);
      expect(authored.reasoning).not.toMatch(/%/);
    }
  });

  it('never gates: prerequisites resolve but no lesson is unreachable (N1)', () => {
    const known = new Set(LESSONS.map((l) => l.id));
    for (const registered of LESSONS) {
      for (const prerequisite of registered.prerequisites) {
        expect(known.has(prerequisite)).toBe(true);
      }
    }
  });
});

// ── Half two: the validator rejects ──────────────────────────────────────────

describe('validator rejects malformed content', () => {
  // Without this, every rejection below could be passing on a fixture that was broken already.
  it('accepts the unmodified fixture, so each rejection isolates one defect', () => {
    expect(formatIssues(validateLessons([lesson()]))).toBe('');
  });

  it('catches a duplicate lesson id', () => {
    const issues = validateLessons([lesson(), lesson({ title: 'Same id again' })]);
    expect(codes(issues)).toContain('duplicate-lesson-id');
  });

  it('catches a duplicate example id inside one lesson', () => {
    const issues = validateLesson(
      lesson({ examples: [example(), example({ hole: ['2c', '3d'] })] }),
    );
    expect(codes(issues)).toContain('duplicate-example-id');
  });

  it('catches a prerequisite that names no lesson', () => {
    const issues = validateLessons([lesson({ prerequisites: ['does-not-exist'] })]);
    expect(codes(issues)).toContain('unknown-prerequisite');
  });

  it('catches a prerequisite cycle', () => {
    const issues = validateLessons([
      lesson({ id: 'alpha', prerequisites: ['beta'] }),
      lesson({ id: 'beta', prerequisites: ['gamma'] }),
      lesson({ id: 'gamma', prerequisites: ['alpha'] }),
    ]);
    expect(codes(issues)).toContain('prerequisite-cycle');
  });

  it('catches a lesson listing itself', () => {
    const issues = validateLessons([lesson({ id: 'test-lesson', prerequisites: ['test-lesson'] })]);
    expect(codes(issues)).toContain('self-prerequisite');
  });

  it('rejects an example whose cards cannot be dealt', () => {
    const duplicated = example({ hole: ['Ah', 'Kh'], board: ['Ah', '7d', '2c'] });
    const built = tryBuildExample(duplicated);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/dealt twice/);
    expect(codes(validateLesson(lesson({ examples: [duplicated] })))).toContain(
      'unbuildable-example',
    );
  });

  it('rejects a card that is not a card', () => {
    const built = tryBuildExample(example({ hole: ['Ah', 'Zx'] }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/not a card/);
  });

  it('rejects a board that disagrees with the street', () => {
    const built = tryBuildExample(example({ street: 'turn' }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/board cards/);
  });

  it('rejects a position that cannot be constructed', () => {
    expect(tryBuildExample(example({ street: 'showdown', board: ['Qh', '7d', '2c', '5s', '9c'] })).ok).toBe(
      false,
    );
    expect(tryBuildExample(example({ villainStacks: [] })).ok).toBe(false);
    expect(tryBuildExample(example({ villainStacks: [100, 100, 100, 100] })).ok).toBe(false);
    expect(tryBuildExample(example({ toCall: 500 })).ok).toBe(false);
    expect(tryBuildExample(example({ pot: 0, toCall: 0 })).ok).toBe(false);
    expect(tryBuildExample(example({ heroStack: -1 })).ok).toBe(false);
    expect(tryBuildExample(example({ bb: 25 })).ok).toBe(false);
  });

  it('accepts a checking spot, where the engine offers check rather than call', () => {
    const built = tryBuildExample(
      example({
        toCall: 0,
        prompt: 'Checking is free here. What price would a half-pot bet offer?',
      }),
    );
    expect(built.ok).toBe(true);
  });

  it('accepts every lesson position on the 4-seat table', () => {
    for (const position of ['BTN', 'CO', 'SB', 'BB'] as const) {
      const built = tryBuildExample(example({ position }));
      if (!built.ok) throw new Error(`${position}: ${built.reason}`);
    }
  });

  it('catches prose over the word budget', () => {
    const long = Array.from({ length: 70 }, (_, i) => `word${i}`).join(' ');
    const issues = validateLesson(
      lesson({ examples: [example({ reasoning: `${long}. Second chunk. Third chunk.` })] }),
    );
    expect(codes(issues)).toContain('prose-too-long');
  });

  it('catches reasoning that is not three chunks', () => {
    const issues = validateLesson(
      lesson({ examples: [example({ reasoning: 'The bet asks 50 to win 250, one chunk only.' })] }),
    );
    expect(codes(issues)).toContain('prose-shape');
  });

  it('catches a prompt that is not a question, so the learner is not told the answer (G5)', () => {
    const issues = validateLesson(
      lesson({ examples: [example({ prompt: 'Call, because the price is 1 in 5.' })] }),
    );
    expect(codes(issues)).toContain('prose-shape');
  });

  it('catches second-person trait attribution (G7)', () => {
    const issues = validateLesson(
      lesson({
        examples: [
          example({
            reasoning:
              'The price is 1 time in 5. You are too loose against small bets. Read the price first.',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('banned-phrase');
  });

  it('catches praise', () => {
    const issues = validateLesson(
      lesson({
        examples: [
          example({
            reasoning: 'Nice call. The price was 1 time in 5. Read the price first next time.',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('banned-phrase');
  });

  it('no longer flags streak, rank or percentile language (allowed 2026-08-14)', () => {
    // Gamification vocabulary is permitted now that the app has honest progress features. These strings
    // must NOT raise a banned-phrase issue; the trait/praise/fold-reveal guards below still do.
    for (const allowed of [
      'The price is 1 time in 5. That is three correct in a row. Read the price first.',
      'The price is 1 time in 5. This sits in the 90th percentile. Read the price first.',
      'The price is 1 time in 5. Two more calls to level up. Read the price first.',
    ]) {
      expect(
        codes(validateLesson(lesson({ examples: [example({ reasoning: allowed })] }))),
      ).not.toContain('banned-phrase');
    }
  });

  it('catches a per-hand fold reveal (G10)', () => {
    const issues = validateLesson(
      lesson({
        examples: [
          example({
            reasoning:
              'The price was 1 time in 5. The hand would have flopped a straight. Read the price first.',
          }),
        ],
      }),
    );
    expect(codes(issues)).toContain('banned-phrase');
  });

  it('catches a lesson with no examples and no acceptance keywords', () => {
    const issues = validateLesson(lesson({ examples: [], acceptanceKeywords: [] }));
    expect(codes(issues).filter((code) => code === 'empty-lesson')).toHaveLength(2);
  });

  it('catches an id that is not kebab-case', () => {
    const issues = validateLesson(lesson({ id: 'Pot Odds' }));
    expect(codes(issues)).toContain('prose-shape');
  });

  it('formats issues into readable lines', () => {
    const formatted = formatIssues(validateLessons([lesson({ prerequisites: ['ghost'] })]));
    expect(formatted).toContain('unknown-prerequisite');
    expect(formatted).toContain('ghost');
  });
});
