import { describe, expect, it } from 'vitest';
import {
  classifySentence,
  createLexicon,
  feedbackOpening,
  MECHANISM_FRAMES,
  REJECTION_TEXT,
  type AttemptInput,
  type LexiconAttempt,
  type MechanismClassifier,
} from '../../src/core/lexicon.js';

// The learner's sentences below are the real fixtures: L2's boundary is a claim about English, so
// every clause gets a sentence on each side of it.

const CACHED_CELL = 'K7s is a CO open';
/** The same hand, cited as an EXAMPLE inside a mechanism. Must be accepted. */
const HAND_AS_EXAMPLE = 'K7s is dominated by the better sevens in a CO calling range';

const attempt = (overrides: Partial<AttemptInput> = {}): AttemptInput => ({
  conceptId: 'domination-kicker-gap',
  sentence: HAND_AS_EXAMPLE,
  at: 1_000,
  ...overrides,
});

describe('L2 acceptance — the three mechanism framings', () => {
  it('accepts a sentence framed in domination risk', () => {
    expect(classifySentence('The worse kicker is what turns a made pair into dead equity')).toEqual({
      frame: 'domination-risk',
    });
  });

  it('accepts a sentence framed in equity realisation', () => {
    expect(
      classifySentence('Out of position this hand realises less of its equity because it gets barrelled'),
    ).toEqual({ frame: 'equity-realisation' });
  });

  it('accepts a sentence framed in range asymmetry', () => {
    expect(classifySentence('That flop is a range asymmetry in favour of the preflop raiser')).toEqual({
      frame: 'range-asymmetry',
    });
  });

  it('classifies which frame was used rather than returning a bare boolean', () => {
    const frames = [
      'card removal takes the sevens out of my own outs',
      'in position the hand reaches showdown far more often',
      'the button holds the nut advantage on that texture',
    ].map((sentence) => classifySentence(sentence));
    expect(frames).toEqual([
      { frame: 'domination-risk' },
      { frame: 'equity-realisation' },
      { frame: 'range-asymmetry' },
    ]);
  });

  it('needs equity beside the realise stem: noticing something is not equity realisation', () => {
    // "I realise" is ordinary English. Without equity it names no mechanism.
    expect(classifySentence('I realise now that I should have folded')).toEqual({
      frame: null,
      reason: 'no-mechanism-frame',
    });
    expect(classifySentence('I realise now that I do not realise my equity out of position')).toEqual(
      { frame: 'equity-realisation' },
    );
  });

  it('names one frame per sentence, spec order breaking a tie', () => {
    const both = 'my kicker is dominated and the range asymmetry is against me too';
    expect(classifySentence(both)).toEqual({ frame: 'domination-risk' });
    expect(MECHANISM_FRAMES[0]).toBe('domination-risk');
  });
});

describe('L2 rejection — cached cells, and the boundary against a cited example', () => {
  it('rejects a cached cell as a memorised conclusion', () => {
    expect(classifySentence(CACHED_CELL)).toEqual({ frame: null, reason: 'cached-cell' });
    expect(REJECTION_TEXT['cached-cell']).toBe(
      'this states a memorised conclusion rather than a mechanism',
    );
  });

  it('accepts a mechanism that cites the very same hand as its example', () => {
    // The naive "mentions a hand" rule fails here. This pair is the whole boundary.
    expect(classifySentence(HAND_AS_EXAMPLE)).toEqual({ frame: 'domination-risk' });
  });

  it.each([
    'A9o is a fold from the small blind',
    'T8s opens on the button',
    'QJo calls a raise here, that is standard',
  ])('rejects the cached cell %s', (sentence) => {
    expect(classifySentence(sentence)).toEqual({ frame: null, reason: 'cached-cell' });
  });

  it.each([
    'JTs plays better because it realises its equity in position',
    '72o loses to every dominating hand in that calling range',
    'AQo runs into the range asymmetry the big blind holds on low boards',
  ])('accepts the mechanism %s despite naming a hand', (sentence) => {
    const verdict = classifySentence(sentence);
    expect(verdict.frame).not.toBeNull();
  });

  it('rejects a sentence with no framing and no chart verdict as no-mechanism-frame', () => {
    expect(classifySentence('it just felt right')).toEqual({
      frame: null,
      reason: 'no-mechanism-frame',
    });
    expect(REJECTION_TEXT['no-mechanism-frame']).toContain('domination risk');
  });

  it('accepts a framing that sits on top of a chart verdict: mechanism vocabulary wins', () => {
    // THE ORDERING DECISION, pinned. Hand + chart verdict + a named mechanism: the framing decides,
    // because the alternative order rejects "K7s is dominated by the better sevens in a CO open".
    // A framing name pasted onto a bare cell is the known cost — that is what the tutor seam is for.
    expect(
      classifySentence('K7s opens from CO because the better sevens dominate my kicker when called'),
    ).toEqual({ frame: 'domination-risk' });
  });

  it('needs the chart verdict too: a hand named with no verdict is vague, not a cached cell', () => {
    // Both branches reject; the reason chooses the message, and "memorised conclusion" is wrong
    // for a sentence that files the hand nowhere.
    expect(classifySentence('K7s and A9o both look the same to me')).toEqual({
      frame: null,
      reason: 'no-mechanism-frame',
    });
  });

  it('needs the hand too: a verdict with no hand names no cell', () => {
    expect(classifySentence('it is a fold, I am not sure why')).toEqual({
      frame: null,
      reason: 'no-mechanism-frame',
    });
  });
});

describe('L2 — rejected attempts are kept, with their reason', () => {
  it('records a rejection as an outcome rather than throwing or dropping it', () => {
    const lexicon = createLexicon();
    const rejected = lexicon.record(attempt({ sentence: CACHED_CELL }));

    expect(rejected.outcome).toBe('rejected');
    if (rejected.outcome !== 'rejected') throw new Error('unreachable');
    expect(rejected.reason).toBe('cached-cell');
    expect(rejected.reasonText).toBe(REJECTION_TEXT['cached-cell']);
    expect(lexicon.attemptsFor('domination-kicker-gap')).toHaveLength(1);
    expect(lexicon.attempts()).toHaveLength(1);
  });

  it('keeps the rejection in the log after a later sentence is accepted', () => {
    const lexicon = createLexicon();
    lexicon.record(attempt({ sentence: CACHED_CELL, at: 1 }));
    lexicon.record(attempt({ sentence: HAND_AS_EXAMPLE, at: 2 }));

    const all = lexicon.attemptsFor('domination-kicker-gap');
    expect(all.map((a) => a.outcome)).toEqual(['rejected', 'accepted']);
    // Diagnostic, so it stays out of the quoted history but never out of the record.
    expect(lexicon.historyFor('domination-kicker-gap')).toHaveLength(1);
  });

  it('a rejected sentence is never quoted', () => {
    const lexicon = createLexicon();
    lexicon.record(attempt({ sentence: CACHED_CELL }));
    expect(lexicon.quoteFor('domination-kicker-gap')).toBeNull();
    expect(feedbackOpening(lexicon, 'domination-kicker-gap')).toBeNull();
  });

  it('pushes back once per concept, and still records the reason afterwards', () => {
    const lexicon = createLexicon();
    const first = lexicon.record(attempt({ sentence: CACHED_CELL, at: 1 }));
    const second = lexicon.record(attempt({ sentence: 'AJo is a fold', at: 2 }));
    const otherConcept = lexicon.record(
      attempt({ conceptId: 'equity-realisation', sentence: CACHED_CELL, at: 3 }),
    );

    const pushbacks = [first, second, otherConcept].map((a) =>
      a.outcome === 'rejected' ? a.pushback : 'accepted',
    );
    expect(pushbacks).toEqual([true, false, true]);
    expect(second.outcome === 'rejected' && second.reasonText).toBe(REJECTION_TEXT['cached-cell']);
  });

  it('lets the learner self-mark a sentence the keyword check could not place', () => {
    const lexicon = createLexicon();
    const marked = lexicon.record(
      attempt({ sentence: 'the second card decides whether I am ahead when called', selfMarkedFrame: 'domination-risk' }),
    );
    expect(marked.outcome).toBe('accepted');
    if (marked.outcome !== 'accepted') throw new Error('unreachable');
    expect(marked.frame).toBe('domination-risk');
    expect(marked.decidedBy).toBe('learner');
  });

  it('does not let a self-mark override a cached cell', () => {
    const lexicon = createLexicon();
    const marked = lexicon.record(
      attempt({ sentence: CACHED_CELL, selfMarkedFrame: 'range-asymmetry' }),
    );
    expect(marked.outcome).toBe('rejected');
    expect(marked.outcome === 'rejected' && marked.reason).toBe('cached-cell');
  });
});

describe('the tutor seam', () => {
  const alwaysCachedCell: MechanismClassifier = () => ({ frame: null, reason: 'cached-cell' });
  const alwaysRangeAsymmetry: MechanismClassifier = () => ({ frame: 'range-asymmetry' });

  it('uses the injected classifier instead of the keyword check, in both directions', () => {
    const lexicon = createLexicon();
    const overriddenReject = lexicon.record(attempt({ sentence: HAND_AS_EXAMPLE }), {
      classifier: alwaysCachedCell,
    });
    const overriddenAccept = lexicon.record(attempt({ sentence: CACHED_CELL, at: 2 }), {
      classifier: alwaysRangeAsymmetry,
    });

    expect(overriddenReject.outcome).toBe('rejected');
    expect(overriddenAccept.outcome).toBe('accepted');
    expect(overriddenAccept.outcome === 'accepted' && overriddenAccept.frame).toBe('range-asymmetry');
  });

  it('attributes the decision, so a keyword verdict is distinguishable from a tutor one', () => {
    const lexicon = createLexicon();
    const keyword = lexicon.record(attempt({ at: 1 }));
    const tutor = lexicon.record(attempt({ at: 2 }), { classifier: alwaysRangeAsymmetry });
    expect(keyword.outcome === 'accepted' && keyword.decidedBy).toBe('keyword-check');
    expect(tutor.outcome === 'accepted' && tutor.decidedBy).toBe('classifier');
  });

  it('sees the trimmed sentence', () => {
    const lexicon = createLexicon();
    const seen: string[] = [];
    lexicon.record(attempt({ sentence: `  ${HAND_AS_EXAMPLE}\n` }), {
      classifier: (sentence) => {
        seen.push(sentence);
        return { frame: 'domination-risk' };
      },
    });
    expect(seen).toEqual([HAND_AS_EXAMPLE]);
  });
});

describe('L3 — the most recent is quoted, earlier ones stay visible', () => {
  const three = (): ReturnType<typeof createLexicon> => {
    const lexicon = createLexicon();
    lexicon.record(attempt({ sentence: 'the worse kicker is dominated when I get called', at: 10 }));
    lexicon.record(attempt({ sentence: 'card removal kills the outs I was counting on', at: 20 }));
    lexicon.record(attempt({ sentence: 'a dominated kicker turns a pair into dead equity', at: 30 }));
    return lexicon;
  };

  it('quotes the newest accepted sentence', () => {
    expect(three().quoteFor('domination-kicker-gap')?.sentence).toBe(
      'a dominated kicker turns a pair into dead equity',
    );
  });

  it('keeps every earlier accepted sentence retrievable, oldest first', () => {
    expect(three().historyFor('domination-kicker-gap').map((a) => a.sentence)).toEqual([
      'the worse kicker is dominated when I get called',
      'card removal kills the outs I was counting on',
      'a dominated kicker turns a pair into dead equity',
    ]);
  });

  it('opens future feedback by quoting the newest sentence (L1, story 39)', () => {
    expect(feedbackOpening(three(), 'domination-kicker-gap')).toBe(
      'Your sentence for this: “a dominated kicker turns a pair into dead equity”',
    );
  });

  it('orders by append order, not by the caller-supplied timestamp', () => {
    // A replayed log or a skewed clock must not change which sentence is the learner's current name.
    const lexicon = createLexicon();
    lexicon.record(attempt({ sentence: 'a dominated kicker is the risk', at: 9_999 }));
    lexicon.record(attempt({ sentence: 'card removal is the risk', at: 1 }));
    expect(lexicon.quoteFor('domination-kicker-gap')?.sentence).toBe('card removal is the risk');
  });

  it('keeps concepts separate', () => {
    const lexicon = three();
    expect(lexicon.quoteFor('range-asymmetry-flop')).toBeNull();
    lexicon.record(
      attempt({ conceptId: 'range-asymmetry-flop', sentence: 'the range asymmetry is mine here', at: 40 }),
    );
    expect(lexicon.quoteFor('range-asymmetry-flop')?.sentence).toBe(
      'the range asymmetry is mine here',
    );
    expect(lexicon.quoteFor('domination-kicker-gap')?.sentence).toBe(
      'a dominated kicker turns a pair into dead equity',
    );
    expect(lexicon.concepts()).toEqual(['domination-kicker-gap', 'range-asymmetry-flop']);
  });

  it('carries the flipping variable from the resolved contrast set (L1)', () => {
    const lexicon = createLexicon();
    const recorded = lexicon.record(attempt({ flippingAxis: 'kickerGap' }));
    expect(recorded.flippingAxis).toBe('kickerGap');
    expect(lexicon.record(attempt({ at: 2 })).flippingAxis).toBeNull();
  });
});

describe('L3 — immutable and append-only, structurally', () => {
  it('exposes no member that can edit, replace or delete a recorded attempt', () => {
    const lexicon = createLexicon();
    const members = Object.keys(lexicon).sort();
    expect(members).toEqual([
      'attempts',
      'attemptsFor',
      'concepts',
      'historyFor',
      'quoteFor',
      'record',
    ]);
    const writers = members.filter((name) =>
      /edit|update|delete|remove|replace|clear|revise|amend|reclassif|accept$|reject$/i.test(name),
    );
    expect(writers).toEqual([]);
  });

  it('freezes a returned attempt, so a caller cannot rewrite the stored one', () => {
    const lexicon = createLexicon();
    const recorded = lexicon.record(attempt());
    expect(Object.isFrozen(recorded)).toBe(true);
    expect(() => {
      (recorded as { sentence: string }).sentence = 'rewritten';
    }).toThrow(TypeError);
    expect(lexicon.quoteFor('domination-kicker-gap')?.sentence).toBe(HAND_AS_EXAMPLE);
  });

  it('hands out no reference into its own log', () => {
    const lexicon = createLexicon();
    lexicon.record(attempt());
    const snapshot = lexicon.attempts();
    expect(() => (snapshot as LexiconAttempt[]).pop()).toThrow(TypeError);
    expect(lexicon.attempts()).toHaveLength(1);

    const perConcept = lexicon.attemptsFor('domination-kicker-gap');
    expect(() => (perConcept as LexiconAttempt[]).splice(0, 1)).toThrow(TypeError);
    const history = lexicon.historyFor('domination-kicker-gap');
    expect(() => (history as LexiconAttempt[]).splice(0, 1)).toThrow(TypeError);
    expect(lexicon.historyFor('domination-kicker-gap')).toHaveLength(1);
  });

  it('does not let a mutated input object change what was recorded', () => {
    const lexicon = createLexicon();
    const input = { conceptId: 'domination-kicker-gap', sentence: HAND_AS_EXAMPLE, at: 5 };
    lexicon.record(input);
    input.sentence = 'rewritten';
    input.at = 999;
    const stored = lexicon.attempts()[0];
    expect(stored.sentence).toBe(HAND_AS_EXAMPLE);
    expect(stored.at).toBe(5);
  });

  it('rehydrates a persisted log without offering a way to change it', () => {
    const first = createLexicon();
    first.record(attempt({ at: 1 }));
    first.record(attempt({ sentence: CACHED_CELL, at: 2 }));
    const persisted: readonly LexiconAttempt[] = JSON.parse(JSON.stringify(first.attempts()));

    const reopened = createLexicon(persisted);
    expect(reopened.attempts().map((a) => a.outcome)).toEqual(['accepted', 'rejected']);
    expect(reopened.quoteFor('domination-kicker-gap')?.sentence).toBe(HAND_AS_EXAMPLE);
    // seq keeps rising across the reload, so the log never gets two attempts with one id.
    const added = reopened.record(attempt({ sentence: 'card removal again', at: 3 }));
    expect(added.seq).toBe(2);
    expect(new Set(reopened.attempts().map((a) => a.seq)).size).toBe(3);
  });

  it('freezes rehydrated entries too, and copies them off the caller’s objects', () => {
    // A persisted log arrives as plain mutable objects. Storing those by reference would leave the
    // loader holding an editing handle on history.
    const loose = [
      {
        seq: 0,
        conceptId: 'domination-kicker-gap',
        sentence: HAND_AS_EXAMPLE,
        at: 1,
        flippingAxis: null,
        outcome: 'accepted',
        frame: 'domination-risk',
        decidedBy: 'keyword-check',
      } as LexiconAttempt,
    ];
    const reopened = createLexicon(loose);

    expect(Object.isFrozen(reopened.quoteFor('domination-kicker-gap'))).toBe(true);
    (loose[0] as { sentence: string }).sentence = 'rewritten by the loader';
    expect(reopened.quoteFor('domination-kicker-gap')?.sentence).toBe(HAND_AS_EXAMPLE);
  });

  it('refuses an empty sentence rather than recording a blank row in the history', () => {
    const lexicon = createLexicon();
    expect(() => lexicon.record(attempt({ sentence: '   \n' }))).toThrow(TypeError);
    expect(() => lexicon.record(attempt({ conceptId: ' ' }))).toThrow(TypeError);
    expect(lexicon.attempts()).toEqual([]);
  });

  it('stores the sentence trimmed and otherwise verbatim', () => {
    const lexicon = createLexicon();
    const recorded = lexicon.record(attempt({ sentence: `  ${HAND_AS_EXAMPLE}  ` }));
    expect(recorded.sentence).toBe(HAND_AS_EXAMPLE);
  });
});
