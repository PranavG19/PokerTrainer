import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { Severity } from '../../src/core/coach.js';
import {
  G4_ELIGIBLE_SEVERITY,
  G4_REASONS,
  G4_SEVERITY,
  REASON_CATEGORIES,
  applyG4Override,
  gateAttemptIsHit,
  gradeReason,
  type ReasonCategory,
  type ReasonGraderSource,
} from '../../src/core/reasonGrade.js';

/**
 * The corpus is the RECORDED one (spec line 218: test determinism is bought by "the reason-grader's
 * recorded corpus"), not lines invented here: research/corpus/reasons.jsonl, 100 authored lines with
 * hand labels, measured in research/EXPERIMENT-3-reason-grader.md.
 */
interface CorpusLine {
  readonly id: string;
  readonly label: ReasonCategory;
  readonly family: string;
  readonly text: string;
  readonly arguable?: string;
}

const CORPUS: readonly CorpusLine[] = fs
  .readFileSync(new URL('../../research/corpus/reasons.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line) as CorpusLine);

function lineById(id: string): CorpusLine {
  const found = CORPUS.find((line) => line.id === id);
  if (found === undefined) throw new Error(`corpus line ${id} is missing`);
  return found;
}

function g4(
  severityFromEv: Severity,
  category: ReasonCategory,
  graderSource: ReasonGraderSource = 'tutor',
  explicitGuess = false,
) {
  return applyG4Override({
    severityFromEv,
    reason: { category, explicitGuess },
    graderSource,
  });
}

describe('corpus integrity — the fixtures are the recorded ones', () => {
  it('holds 100 lines with the recorded class balance', () => {
    expect(CORPUS).toHaveLength(100);
    const counts = new Map<ReasonCategory, number>();
    for (const line of CORPUS) counts.set(line.label, (counts.get(line.label) ?? 0) + 1);
    // EXPERIMENT-3 "Corpus:" header: range 25 / price 25 / hand-strength 30 / none 20.
    expect(Object.fromEntries(counts)).toEqual({
      range: 25,
      price: 25,
      'hand-strength': 30,
      none: 20,
    });
  });

  it('labels every line with one of the four categories spec line 293 fixes', () => {
    for (const line of CORPUS) expect(REASON_CATEGORIES).toContain(line.label);
  });
});

describe('gradeReason — closed label set', () => {
  it('returns one of exactly four categories for every corpus line', () => {
    for (const line of CORPUS) {
      expect(REASON_CATEGORIES).toContain(gradeReason(line.text).category);
    }
  });

  it('is deterministic: the same sentence grades the same on two occasions', () => {
    // The reason this module is local rather than a model call. EXPERIMENT-3 measured 93%
    // self-agreement across identical model runs — "the same learner sentence can grade differently
    // on two occasions... for a rule that fires an interrupt, that is a fairness problem
    // independent of accuracy".
    for (const line of CORPUS) {
      const first = gradeReason(line.text);
      const second = gradeReason(line.text);
      expect(second).toEqual(first);
    }
  });

  it('makes no network call: the module imports nothing that can reach the wire', () => {
    // HARD RULE, and the reason line 436's no-key path can use this grader at all: "Full app, zero
    // network calls." Asserted on the source because a stub can only prove the paths a test walks.
    const source = fs.readFileSync(
      new URL('../../src/core/reasonGrade.ts', import.meta.url),
      'utf8',
    );
    const imports = [...source.matchAll(/^import[^;]*from '([^']+)';/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./coach.js']);
    expect(source).not.toMatch(/\bfetch\b|https?:|bedrock|XMLHttpRequest|node:https?/i);
  });
});

describe('gradeReason — the two categories G4 names', () => {
  it("grades every 'clear-hs' line hand-strength", () => {
    // G4 fires on `hand-strength`, so the plainest form of the thing it exists to catch — a reason
    // that is just the learner's own two cards — must land in that class.
    const clearHs = CORPUS.filter((line) => line.family === 'clear-hs');
    expect(clearHs.length).toBeGreaterThan(0);
    const missed = clearHs.filter((line) => gradeReason(line.text).category !== 'hand-strength');
    // h17 h18 h20 h21 h22 are the recorded misses of this classifier (see the pinned matrix below);
    // they fall to `none`, which is G4's other escalating label, so G4 still fires on all of them.
    expect(missed.map((line) => line.id)).toEqual(['h17', 'h18', 'h20', 'h21', 'h22']);
    for (const line of missed) expect(G4_REASONS).toContain(gradeReason(line.text).category);
  });

  it("grades every 'degenerate' and 'clear-none' line none", () => {
    const nothingStated = CORPUS.filter(
      (line) => line.family === 'degenerate' || line.family === 'clear-none',
    );
    expect(nothingStated.length).toBeGreaterThan(0);
    for (const line of nothingStated) {
      expect(gradeReason(line.text).category).toBe('none');
    }
  });

  it('grades an empty and a whitespace-only reason none', () => {
    expect(gradeReason('').category).toBe('none');
    expect(gradeReason('   \t ').category).toBe('none');
  });

  it("grades a hunch none, not range or price, when it carries no mechanism", () => {
    for (const line of CORPUS.filter((l) => l.family === 'hunch')) {
      const got = gradeReason(line.text).category;
      // n03 "he always bluffs, i just have a feeling" is the recorded miss: `bluffs` is range
      // vocabulary. It is the one corpus line where this classifier fails to escalate a hunch.
      if (line.id === 'n03') expect(got).toBe('range');
      else expect(got).toBe('none');
    }
  });
});

describe('gradeReason — mechanism categories', () => {
  it('grades a price line price even when it names no number', () => {
    for (const line of CORPUS.filter((l) => l.family === 'price-no-number')) {
      expect(gradeReason(line.text).category).toBe('price');
    }
  });

  it('grades a percentage-only price argument price, not none', () => {
    // The bug PRICE_NUMERIC exists for. PRICE's trailing \b kills `%` and `need(ed|s)? \d`, so in
    // the measured harness all four of these graded `none` — i.e. a learner doing the arithmetic the
    // spec demands was swept into a G4-escalating class.
    for (const id of ['p01', 'p03', 'p17', 'p25']) {
      const line = lineById(id);
      expect(gradeReason(line.text).category).toBe('price');
      expect(G4_REASONS).not.toContain(gradeReason(line.text).category);
    }
  });

  it('grades a range-width percentage range, not price', () => {
    // The ordering PRICE_NUMERIC has to respect: r04 "he opens like 70% from the button so my
    // defend needs to be wide" is a range width wearing a percent sign.
    expect(gradeReason(lineById('r04').text).category).toBe('range');
  });

  it('grades clumsy jargon-free range reasoning range where the vocabulary reaches it', () => {
    const clumsy = CORPUS.filter((line) => line.family === 'range-clumsy');
    const graded = clumsy.map((line) => `${line.id}:${gradeReason(line.text).category}`);
    // r08 r19 r24 are recorded misses — this is the measured cost of a word list on plain phrasing,
    // and EXPERIMENT-3 names it: "range-clumsy scored 3/6".
    expect(graded).toEqual([
      'r06:range',
      'r07:range',
      'r08:hand-strength',
      'r19:none',
      'r24:none',
      'r25:range',
    ]);
  });

  it('grades "i beat most of his range BECAUSE two pair is strong" hand-strength', () => {
    // h16, the one hs-in-range-vocab line this classifier gets right, and it gets it right through
    // the subordinate-clause check alone: the operative claim is the learner's own two pair, and
    // "because" is the connective that reveals it. Without that check h16 grades `range` — a
    // hand-strength reason wearing range words, which is precisely the reasoning G4 exists to catch
    // and which would then never escalate.
    expect(gradeReason(lineById('h16').text).category).toBe('hand-strength');
    expect(G4_REASONS).toContain(gradeReason(lineById('h16').text).category);
  });

  it('grades hand strength wearing price vocabulary hand-strength', () => {
    // "my equity is high because pocket tens is a big pair" — the inversion G4 exists for. If the
    // subordinate-clause check failed, these would grade `price` and G4 would never fire.
    for (const line of CORPUS.filter((l) => l.family === 'hs-in-price-vocab')) {
      const got = gradeReason(line.text).category;
      // h26 "i have 15 outs, thats basically a made hand" is the recorded miss: a real out count.
      if (line.id === 'h26') expect(got).toBe('price');
      else expect(got).toBe('hand-strength');
    }
  });

  it('grades "the price is irrelevant, I have the best hand" hand-strength even with a numeral in it', () => {
    // The dismissal check (OTHER_IS_IRRELEVANT) proved unfalsifiable on the corpus alone: h15 and
    // h23 both reach hand-strength by a second route, the own-hand fallthrough, because neither
    // carries a digit. Adding one moves them — the digit branch sends a price-flavoured line to
    // `price` — so the assertion is stated where the right and the wrong answer differ. These two
    // strings are h15 and h23 with an out count spliced in, not invented reasoning.
    expect(gradeReason('pot odds are irrelevant, i have 15 outs and the best hand').category).toBe(
      'hand-strength',
    );
    expect(gradeReason('my draw is huge so the price doesnt matter, 12 outs').category).toBe(
      'hand-strength',
    );
  });

  it('leaves hand strength wearing range vocabulary as the known weak spot', () => {
    // Recorded honestly rather than asserted away. EXPERIMENT-3: "hand-strength dressed in range
    // vocabulary is the weak spot... its residual failure mode is under-firing on the most
    // sophisticated-sounding wrong reasoning." h25 is the hardest line in the corpus and every
    // configuration, LLM included, missed it in every run.
    const graded = CORPUS.filter((line) => line.family === 'hs-in-range-vocab').map(
      (line) => `${line.id}:${gradeReason(line.text).category}`,
    );
    expect(graded).toEqual([
      'h06:range',
      'h14:range',
      'h16:hand-strength',
      'h25:range',
      'h30:hand-strength',
    ]);
  });
});

describe('gradeReason — the recorded accuracy, pinned per line', () => {
  /**
   * The confusion matrix, so a regex edit that trades one class for another cannot pass. This is
   * NOT a target: EXPERIMENT-3 records 82/100 for the harness classifier, and this port measures
   * 86/100 because PRICE_NUMERIC recovers the four percentage-only price lines the harness lost to
   * a regex-boundary bug. Every cell below was measured, not chosen.
   */
  it('reproduces the measured confusion matrix', () => {
    const matrix = new Map<string, number>();
    for (const line of CORPUS) {
      const key = `${line.label}>${gradeReason(line.text).category}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
    }
    const cell = (truth: ReasonCategory, predicted: ReasonCategory): number =>
      matrix.get(`${truth}>${predicted}`) ?? 0;

    expect(REASON_CATEGORIES.map((p) => cell('range', p))).toEqual([21, 0, 2, 2]);
    expect(REASON_CATEGORIES.map((p) => cell('price', p))).toEqual([0, 25, 0, 0]);
    expect(REASON_CATEGORIES.map((p) => cell('hand-strength', p))).toEqual([3, 1, 21, 5]);
    expect(REASON_CATEGORIES.map((p) => cell('none', p))).toEqual([1, 0, 0, 19]);
  });

  it('names the exact set of lines it gets wrong', () => {
    const wrong = CORPUS.filter((line) => gradeReason(line.text).category !== line.label).map(
      (line) => line.id,
    );
    expect(wrong).toEqual([
      'r05',
      'r08',
      'r19',
      'r24',
      'h06',
      'h14',
      'h17',
      'h18',
      'h20',
      'h21',
      'h22',
      'h25',
      'h26',
      'n03',
    ]);
    expect(CORPUS.length - wrong.length).toBe(86);
  });

  it('keeps G4 precision at the measured 91.8% and never below the harness 84.9%', () => {
    // The number the spec's gate turns on (EXPERIMENT-3 "The number the gate turns on"): precision
    // of the union class {hand-strength, none} — one minus it is the share of well-reasoned
    // decisions the harshest event in the design punishes.
    const escalates = (category: ReasonCategory): boolean => G4_REASONS.includes(category);
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const line of CORPUS) {
      const predicted = escalates(gradeReason(line.text).category);
      const actual = escalates(line.label);
      if (predicted && actual) truePositives++;
      else if (predicted) falsePositives++;
      else if (actual) falseNegatives++;
    }
    expect({ truePositives, falsePositives, falseNegatives }).toEqual({
      truePositives: 45,
      falsePositives: 4,
      falseNegatives: 5,
    });
    const precision = truePositives / (truePositives + falsePositives);
    expect(precision).toBeCloseTo(0.918, 3);
    expect(precision).toBeGreaterThan(0.849);
  });

  it('never predicts a G4 label for a price line', () => {
    // The direction that matters. A false positive here is a learner who priced the decision
    // correctly and got the interrupt anyway: "erodes trust in the loudest channel."
    for (const line of CORPUS.filter((l) => l.label === 'price')) {
      expect(G4_REASONS).not.toContain(gradeReason(line.text).category);
    }
  });
});

describe('explicitGuess — the narrower trigger spec line 436 reduces G4 to', () => {
  it('is true only for an outright admission, never for a hunch or a degenerate line', () => {
    const admitting = CORPUS.filter((line) => gradeReason(line.text).explicitGuess).map(
      (line) => line.id,
    );
    // The five `clear-none` lines and only those. "felt right", "gut call", "vibes", "asdf", "?"
    // all grade `none` but admit nothing — line 436 reduces G4 to `I'm guessing`, not to `none`.
    expect(admitting).toEqual(['n02', 'n04', 'n07', 'n08', 'n11']);
    for (const id of admitting) expect(lineById(id).family).toBe('clear-none');
  });

  it('is false for every line that states a mechanism', () => {
    for (const line of CORPUS.filter((l) => l.label === 'range' || l.label === 'price')) {
      expect(gradeReason(line.text).explicitGuess).toBe(false);
    }
  });
});

describe('G4 — the override, and its precedence over the severity function', () => {
  it('escalates a T0/T1 hand-strength reason to T3, overriding silence', () => {
    // Spec line 212, verbatim: "Right-for-the-wrong-reason is T3 unconditionally, overriding the
    // severity function, whenever ΔEV is T0/T1 and the reason grader returns hand-strength or
    // none." The severity function said 'free' — silence — and G4 must beat it.
    const result = g4('free', 'hand-strength');
    expect(result.severity).toBe('serious');
    expect(result.severity).not.toBe('free');
    expect(result.escalated).toBe(true);
    expect(result.rightForWrongReason).toBe(true);
  });

  it('escalates a T0/T1 none reason to T3', () => {
    expect(g4('free', 'none').severity).toBe('serious');
    expect(g4('free', 'none').escalated).toBe(true);
  });

  it('escalates on BOTH labels G4 names and on neither of the other two', () => {
    for (const category of REASON_CATEGORIES) {
      const result = g4('free', category);
      const shouldEscalate = category === 'hand-strength' || category === 'none';
      expect(result.escalated).toBe(shouldEscalate);
      expect(result.severity).toBe(shouldEscalate ? 'serious' : 'free');
    }
  });

  it('leaves a T0/T1 decision silent when the reason states a mechanism', () => {
    // G3: silence is the contract for a decision that cost almost nothing. G4 is the ONE exception,
    // and a range or price reason is not it — escalating here would break the silence promise.
    for (const category of ['range', 'price'] as const) {
      const result = g4('free', category);
      expect(result.severity).toBe('free');
      expect(result.rightForWrongReason).toBe(false);
      expect(result.escalated).toBe(false);
    }
  });

  it('escalates unconditionally: the ΔEV magnitude inside T0/T1 is not weighed', () => {
    // "Unconditionally" is the load-bearing word. Every input that reaches G4's condition escalates
    // to the same tier; there is no severity-function quantity that can dilute it. Both a 0.00 bb
    // and a 0.49 bb decision grade 'free' in coach.ts, and both must come out 'serious'.
    expect(g4('free', 'hand-strength').severity).toBe(G4_SEVERITY);
    expect(g4(G4_ELIGIBLE_SEVERITY, 'none').severity).toBe(G4_SEVERITY);
  });

  it('escalates to a severity that is strictly louder than the one it replaced', () => {
    // The override is UPWARD. If G4_SEVERITY were ever set to the input severity, every assertion
    // above would still pass while the clause did nothing, so the direction is asserted separately.
    const bands: readonly Severity[] = ['free', 'notable', 'serious'];
    const before = bands.indexOf(G4_ELIGIBLE_SEVERITY);
    const after = bands.indexOf(g4('free', 'hand-strength').severity);
    expect(after).toBeGreaterThan(before);
  });

  it('never LOWERS a severity: a T2+ decision keeps what it earned', () => {
    // G4's own precondition is ΔEV in T0/T1, so a louder decision is outside the clause. A grader
    // that applied G4 as a plain assignment would silence a 'serious' error whose reason was bad,
    // which is the opposite of the clause's purpose.
    for (const severity of ['notable', 'serious'] as const) {
      for (const category of REASON_CATEGORIES) {
        const result = g4(severity, category);
        expect(result.severity).toBe(severity);
        expect(result.escalated).toBe(false);
        expect(result.rightForWrongReason).toBe(false);
      }
    }
  });

  it('reports rightForWrongReason false above the silent band because the condition is false', () => {
    // Not because it was overruled. The distinction matters for logging: a T2 hand-strength reason
    // is a leak with a bad reason, not a right-for-the-wrong-reason event.
    expect(g4('notable', 'hand-strength').rightForWrongReason).toBe(false);
  });

  it('applies to a grade produced by gradeReason, end to end', () => {
    // The two exports composed the way a caller will compose them, on a recorded line.
    const reason = gradeReason(lineById('h02').text); // "trip aces is a monster so I bet"
    expect(reason.category).toBe('hand-strength');
    const result = applyG4Override({
      severityFromEv: 'free',
      reason,
      graderSource: 'tutor',
    });
    expect(result.severity).toBe('serious');
    expect(result.escalated).toBe(true);
  });
});

describe('G4 on the fallback path — logs, does not interrupt (spec line 436)', () => {
  it('withholds the escalation for a local label that is not an admission of guessing', () => {
    // Line 436: with no API key, "G4 fires only on `I'm guessing`". EXPERIMENT-3 recommendation 2
    // confirms the reduction as necessary at 84.9% precision and extends it to line 218's other two
    // fallback cases. The event is still reported, per open question 3: "G4 logs but does not
    // interrupt."
    const result = g4('free', 'hand-strength', 'local', false);
    expect(result.rightForWrongReason).toBe(true);
    expect(result.escalated).toBe(false);
    expect(result.severity).toBe('free');
  });

  it('escalates on the local path when the learner admitted to guessing', () => {
    const result = g4('free', 'none', 'local', true);
    expect(result.escalated).toBe(true);
    expect(result.severity).toBe('serious');
  });

  it('separates the two sources: the same reason escalates under tutor, not under local', () => {
    // Equivalent-mutant guard: with both sources treated alike this assertion could not distinguish
    // them, so it is stated on a single reason graded twice.
    const reason = gradeReason(lineById('h01').text); // "my hand is garbage, 7 high"
    expect(reason.category).toBe('hand-strength');
    expect(reason.explicitGuess).toBe(false);
    const asTutor = applyG4Override({ severityFromEv: 'free', reason, graderSource: 'tutor' });
    const asLocal = applyG4Override({ severityFromEv: 'free', reason, graderSource: 'local' });
    expect(asTutor.escalated).toBe(true);
    expect(asLocal.escalated).toBe(false);
    expect(asTutor.severity).not.toBe(asLocal.severity);
  });

  it('withholds it for a hunch on the local path but fires for the admission next to it', () => {
    const hunch = gradeReason(lineById('n15').text); // "gut call"
    const admission = gradeReason(lineById('n02').text); // "I am guessing"
    expect(hunch.category).toBe('none');
    expect(admission.category).toBe('none');
    expect(
      applyG4Override({ severityFromEv: 'free', reason: hunch, graderSource: 'local' }).escalated,
    ).toBe(false);
    expect(
      applyG4Override({ severityFromEv: 'free', reason: admission, graderSource: 'local' })
        .escalated,
    ).toBe(true);
  });

  it('never escalates a range or price reason on the local path either', () => {
    for (const category of ['range', 'price'] as const) {
      expect(g4('free', category, 'local', true).escalated).toBe(false);
      expect(g4('free', category, 'local', true).rightForWrongReason).toBe(false);
    }
  });
});

describe('G4 constants agree with the severity type this build grades in', () => {
  it("uses coach.ts's own Severity, not a parallel tier type", () => {
    const bands: readonly Severity[] = ['free', 'notable', 'serious'];
    expect(bands).toContain(G4_SEVERITY);
    expect(bands).toContain(G4_ELIGIBLE_SEVERITY);
  });

  it("maps T3 to 'serious' and T0/T1 to 'free', the mapping already stated in contrastManifest", () => {
    // contrastManifest.ts: "'free' is silent (T0/T1) and 'serious' is the interrupt band (T3+)".
    // G4 escalates to T3, which is the interrupt band, so it must not stop at 'notable' (T2) —
    // T2 is an end-of-block correction and G4's whole point is that the learner is told loudly
    // (story 15) in the hand.
    expect(G4_SEVERITY).toBe('serious');
    expect(G4_ELIGIBLE_SEVERITY).toBe('free');
  });

  it('names exactly the two reason labels spec line 212 lists', () => {
    expect([...G4_REASONS].sort()).toEqual(['hand-strength', 'none']);
  });
});

describe('gateAttemptIsHit — the GATE (state 4) early-resolution predicate', () => {
  // These exact strings are reused verbatim by tests/e2e/gate.spec.ts. Pinning them here means a regex
  // edit to gradeReason that silently reclassifies a gate reason reddens a unit test rather than
  // surfacing only as a flaky e2e — the strings and their hit/miss verdict are the contract.
  it('a range rationale is a hit', () => {
    expect(gateAttemptIsHit(gradeReason('villain only continues a stronger range here'))).toBe(true);
  });

  it('a price rationale is a hit', () => {
    expect(gateAttemptIsHit(gradeReason("the pot odds don't justify it"))).toBe(true);
  });

  it('a bare hand-strength claim is a miss (a real mechanism was not named)', () => {
    expect(gradeReason('my hand is too weak').category).toBe('hand-strength');
    expect(gateAttemptIsHit(gradeReason('my hand is too weak'))).toBe(false);
  });

  it('an explicit guess is a miss', () => {
    const graded = gradeReason('idk');
    expect(graded.category).toBe('none');
    expect(graded.explicitGuess).toBe(true);
    expect(gateAttemptIsHit(graded)).toBe(false);
  });

  it('is exactly range-or-price and nothing else', () => {
    expect(gateAttemptIsHit({ category: 'range', explicitGuess: false })).toBe(true);
    expect(gateAttemptIsHit({ category: 'price', explicitGuess: false })).toBe(true);
    expect(gateAttemptIsHit({ category: 'hand-strength', explicitGuess: false })).toBe(false);
    expect(gateAttemptIsHit({ category: 'none', explicitGuess: false })).toBe(false);
  });
});
