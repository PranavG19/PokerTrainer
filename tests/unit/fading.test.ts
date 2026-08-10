import { describe, it, expect } from 'vitest';
import type { FadingEvent, FadingState, Rung } from '../../src/core/fading.js';
import {
  ACCURACY_FLOOR,
  ACCURACY_WINDOW,
  LEAST_SUPPORT_RUNG,
  MOST_SUPPORT_RUNG,
  RESTORE_STREAK,
  SUPPORT_LEVELS,
  applyEvent,
  assertRungZeroIsMostSupport,
  blockedPracticeAllowed,
  deriveState,
  hintPrice,
  initialState,
  supportFor,
  supportLevel,
  windowAccuracy,
} from '../../src/core/fading.js';

/**
 * PER-CONCEPT FADING LADDER — the clauses cited, each asserted where right and wrong differ.
 *
 * The three structural claims get direct assertions rather than incidental coverage:
 *   1. per concept, never global — an event for one concept must not move another, and the API is
 *      checked for the absence of any multi-concept entry point;
 *   2. recomputable from the log — every rung claim below is stated as a fold over an event list,
 *      and Reset KC is asserted to be exactly `deriveState(id, [])`;
 *   3. rung 0 is the MOST support — asserted by direction, not by a magic number, so an inverted
 *      ladder fails loudly.
 */

const CONCEPT = 'polarity-wants-size';
const OTHER = 'blockers-beat-hand-strength';
const T0 = 1_700_000_000_000;

let clock = T0;
const tick = (): number => (clock += 1000);

const graded = (correct: boolean, conceptId = CONCEPT): FadingEvent => ({
  kind: 'graded',
  conceptId,
  at: tick(),
  correct,
});

const faded = (conceptId = CONCEPT): FadingEvent => ({
  kind: 'supportFaded',
  conceptId,
  at: tick(),
});

/** A hint whose quoted price is taken from the state it is charged against, as T6 requires. */
const hintAgainst = (state: FadingState, conceptId = CONCEPT): FadingEvent => ({
  kind: 'hintRequested',
  conceptId,
  at: tick(),
  quotedRungAfter: hintPrice(state).rungAfter,
});

/** Climb to a target rung using the only upward event there is. */
function atRung(rung: Rung, conceptId = CONCEPT): FadingState {
  const events: FadingEvent[] = [];
  for (let i = 0; i < rung; i++) events.push(faded(conceptId));
  return deriveState(conceptId, events);
}

/** n correct then m wrong, as a log. */
function run(correct: number, wrong: number): FadingEvent[] {
  return [
    ...Array.from({ length: correct }, () => graded(true)),
    ...Array.from({ length: wrong }, () => graded(false)),
  ];
}

describe('T7 — the five rungs and their order', () => {
  it('names exactly the five support levels T7 lists, in T7 order', () => {
    expect(SUPPORT_LEVELS.map((l) => l.description)).toEqual([
      'worked examples',
      'full correction',
      'principle name only',
      'bare "incorrect"',
      'batched self-marked review',
    ]);
    expect(SUPPORT_LEVELS.map((l) => l.rung)).toEqual([0, 1, 2, 3, 4]);
  });

  it('rung 0 is the MOST support and rung 4 the least — dropping moves toward worked examples', () => {
    expect(MOST_SUPPORT_RUNG).toBe(0);
    expect(LEAST_SUPPORT_RUNG).toBe(4);
    expect(supportLevel(MOST_SUPPORT_RUNG).description).toBe('worked examples');
    expect(supportLevel(LEAST_SUPPORT_RUNG).description).toBe('batched self-marked review');

    // The direction claim, stated as behaviour: a hint at rung 4 must land on rung 3, i.e. NEARER
    // to worked examples. If the ladder were inverted this would land on batched review.
    const top = atRung(4);
    const afterHint = applyEvent(top, hintAgainst(top));
    expect(afterHint.rung).toBeLessThan(top.rung);
    expect(supportLevel(afterHint.rung).description).toBe('bare "incorrect"');
  });

  it('assertRungZeroIsMostSupport passes on the shipped ladder and REJECTS an inverted one', () => {
    expect(() => assertRungZeroIsMostSupport()).not.toThrow();

    // The guard is only worth anything if it can fail. A ladder with batched self-marked review at
    // rung 0 is the exact inversion T7 forbids — the thing a future change reaches for when it
    // reads "drop a rung" as "less help".
    const inverted = [...SUPPORT_LEVELS].reverse().map((l, i) => ({ rung: i, id: l.id }));
    expect(() => assertRungZeroIsMostSupport(inverted)).toThrow(/out of T7 order/);

    // Two adjacent rungs swapped is the subtler version, and it must also fail.
    const swapped = SUPPORT_LEVELS.map((l) => ({ rung: l.rung, id: l.id as string }));
    const held = swapped[1];
    swapped[1] = { rung: 1, id: swapped[2].id };
    swapped[2] = { rung: 2, id: held.id };
    expect(() => assertRungZeroIsMostSupport(swapped)).toThrow(/out of T7 order/);

    // A truncated ladder fails too: four rungs is not T7's five.
    expect(() => assertRungZeroIsMostSupport(swapped.slice(0, 4))).toThrow(/T7 names 5/);
  });

  it('only rung 4 is batched and self-marked, and only there is the 13x13 grid a legitimate index', () => {
    const batched = SUPPORT_LEVELS.filter((l) => l.feedbackTiming === 'batched');
    expect(batched.map((l) => l.rung)).toEqual([4]);
    expect(SUPPORT_LEVELS.filter((l) => l.selfMarked).map((l) => l.rung)).toEqual([4]);
    expect(SUPPORT_LEVELS.filter((l) => l.gridLookupIsLegitimate).map((l) => l.rung)).toEqual([4]);
  });

  it('a fresh concept starts at worked examples, the most scaffolded state', () => {
    expect(supportFor(initialState(CONCEPT)).description).toBe('worked examples');
  });

  it('dropping saturates at worked examples rather than wrapping', () => {
    let state = initialState(CONCEPT);
    for (let i = 0; i < 3; i++) state = applyEvent(state, hintAgainst(state));
    expect(state.rung).toBe(0);
  });

  /**
   * TEN FADES, NOT NINE, AND THE COUNT IS THE ENTIRE TEST. With 9 this assertion could not detect the
   * property in its own title: 9 fades from rung 0 land on rung 4 whether the ladder saturates or
   * WRAPS, because 9 mod 5 === 4. An adversarial pass made `fadedRung` wrap (`rung === 4 ? 0 : rung + 1`)
   * and all 38 tests stayed green.
   *
   * 10 separates them: saturating stays at 4, wrapping returns to 0. Only multiples of 5 (and counts
   * whose residue is not 4) can tell the two readings apart, so the fixture size is load-bearing rather
   * than arbitrary — hence the extra assertion below, which fails loudly if someone "tidies" the count
   * back to a value that cannot discriminate.
   */
  it('fading saturates at batched self-marked review rather than wrapping', () => {
    const fades = 10;
    expect(fades % 5, 'a fade count whose residue is 4 cannot distinguish saturating from wrapping').not.toBe(4);
    const state = deriveState(CONCEPT, Array.from({ length: fades }, () => faded()));
    expect(state.rung).toBe(4);
  });
});

describe('T6 — hints are priced, and the price is shown before the answer', () => {
  it('quotes the rung it will cost, and the quote is a pure read that charges nothing', () => {
    const before = atRung(3);
    const price = hintPrice(before);

    expect(price.rungBefore).toBe(3);
    expect(price.rungAfter).toBe(2);
    expect(price.costsARung).toBe(true);
    expect(price.supportBefore.description).toBe('bare "incorrect"');
    expect(price.supportAfter.description).toBe('principle name only');
    expect(price.correctAnswersToRestore).toBe(RESTORE_STREAK);
    expect(price.notice).toContain('costs one scaffolding rung');
    expect(price.notice).toContain('bare "incorrect" becomes principle name only');

    // Quoting is not charging: story 22 wants the cost visible BEFORE committing to the answer.
    expect(hintPrice(before).rungBefore).toBe(3);
    expect(before.rung).toBe(3);
    expect(before.hintDebt).toBe(0);
  });

  it('rejects a hint event whose quoted price does not match the price charged', () => {
    const before = atRung(3);
    // droppedRung(3) === 2, so the honest quote is 2. Both a too-HIGH and a too-LOW quote must throw:
    // an `!==` check is symmetric, and a one-sided `>` or `<` mutation silently accepts the other
    // direction — a hint shown at a price that is not the price charged, which is the exact clause the
    // throw makes structural. Quoted-too-high (3) says the answer costs more support than it does;
    // quoted-too-low (1) hides part of the cost, which is the worse of the two for story 22.
    for (const quotedRungAfter of [3, 1] as const) {
      expect(() =>
        applyEvent(before, { kind: 'hintRequested', conceptId: CONCEPT, at: T0, quotedRungAfter }),
      ).toThrow(/price shown before the answer/);
    }
    // And the mismatch is caught rather than silently charged.
    expect(before.rung).toBe(3);
  });

  it('charges exactly one rung toward more support and records the debt', () => {
    const before = atRung(4);
    const after = applyEvent(before, hintAgainst(before));
    expect(after.rung).toBe(3);
    expect(after.hintDebt).toBe(1);
  });

  it('a supportFaded promotion moves the rung but does NOT forgive hint debt', () => {
    // supportFaded is an externally-emitted mastery promotion (fade toward less support). It must not
    // touch hintDebt: only three consecutive correct (repayHintDebt) earn a rung back, and letting a
    // promotion silently cancel a debt would give the learner back scaffolding they have not re-earned,
    // defeating T6's reversibility accounting. Charge a hint at rung 3 (debt 1, rung 2), then fade:
    // the rung climbs to 3 but the debt stays at 1.
    const charged = applyEvent(atRung(3), hintAgainst(atRung(3)));
    expect(charged.rung).toBe(2);
    expect(charged.hintDebt).toBe(1);
    const promoted = applyEvent(charged, { kind: 'supportFaded', conceptId: CONCEPT, at: T0 });
    expect(promoted.rung).toBe(3);
    expect(promoted.hintDebt).toBe(1);
  });

  it('at worked examples a hint costs nothing, says so, and owes nothing', () => {
    const floor = initialState(CONCEPT);
    const price = hintPrice(floor);
    expect(price.costsARung).toBe(false);
    expect(price.rungAfter).toBe(0);
    expect(price.correctAnswersToRestore).toBe(0);
    expect(price.notice).toContain('costs no rung');

    const after = applyEvent(floor, hintAgainst(floor));
    expect(after.rung).toBe(0);
    expect(after.hintDebt).toBe(0);
  });

  it('three consecutive correct clear the rung the hint cost', () => {
    const before = atRung(4);
    const events: FadingEvent[] = [];
    for (let i = 0; i < 4; i++) events.push(faded());
    const hint = hintAgainst(before);
    events.push(hint);

    const charged = deriveState(CONCEPT, events);
    expect(charged.rung).toBe(3);

    const twoCorrect = deriveState(CONCEPT, [...events, graded(true), graded(true)]);
    expect(twoCorrect.rung).toBe(3); // two is not three
    expect(twoCorrect.hintDebt).toBe(1);

    const threeCorrect = deriveState(CONCEPT, [...events, graded(true), graded(true), graded(true)]);
    expect(threeCorrect.rung).toBe(4);
    expect(threeCorrect.hintDebt).toBe(0);
  });

  it('the three must be CONSECUTIVE — a miss in the middle restarts the count', () => {
    const before = atRung(4);
    const base: FadingEvent[] = [...Array.from({ length: 4 }, () => faded()), hintAgainst(before)];

    const broken = deriveState(CONCEPT, [
      ...base,
      graded(true),
      graded(true),
      graded(false),
      graded(true),
      graded(true),
    ]);
    expect(broken.rung).toBe(3);
    expect(broken.hintDebt).toBe(1);

    const healed = deriveState(CONCEPT, [...base, graded(true), graded(true), graded(false), graded(true), graded(true), graded(true)]);
    expect(healed.rung).toBe(4);
    expect(healed.hintDebt).toBe(0);
  });

  it('"the NEXT three" — correct answers banked before the hint do not pay for it', () => {
    const climbed: FadingEvent[] = Array.from({ length: 4 }, () => faded());
    const beforeHint = deriveState(CONCEPT, [...climbed, graded(true), graded(true), graded(true)]);
    expect(beforeHint.consecutiveCorrect).toBe(3);

    const charged = applyEvent(beforeHint, hintAgainst(beforeHint));
    expect(charged.rung).toBe(3);
    expect(charged.consecutiveCorrect).toBe(0);

    const oneAfter = applyEvent(charged, graded(true));
    expect(oneAfter.rung).toBe(3);
  });

  it('two hints owe two rungs, and each needs its own three correct', () => {
    const events: FadingEvent[] = Array.from({ length: 4 }, () => faded());
    const s4 = deriveState(CONCEPT, events);
    events.push(hintAgainst(s4));
    const s3 = deriveState(CONCEPT, events);
    events.push(hintAgainst(s3));

    expect(deriveState(CONCEPT, events).rung).toBe(2);
    expect(deriveState(CONCEPT, events).hintDebt).toBe(2);

    const threeMore = [...events, graded(true), graded(true), graded(true)];
    expect(deriveState(CONCEPT, threeMore).rung).toBe(3);
    expect(deriveState(CONCEPT, threeMore).hintDebt).toBe(1);

    // The streak restarts after each repayment: a fourth and fifth correct do not repay the second
    // rung, only a fresh run of three does.
    const fourMore = [...threeMore, graded(true)];
    expect(deriveState(CONCEPT, fourMore).rung).toBe(3);
    const fiveMore = [...fourMore, graded(true)];
    expect(deriveState(CONCEPT, fiveMore).rung).toBe(3);

    const sixMore = [...threeMore, graded(true), graded(true), graded(true)];
    expect(deriveState(CONCEPT, sixMore).rung).toBe(4);
    expect(deriveState(CONCEPT, sixMore).hintDebt).toBe(0);
  });

  it('applies the repayment before the accuracy drop when a single attempt triggers both', () => {
    // applyGraded runs repayHintDebt then applyAccuracyRule. On an interior rung the two commute — a
    // +1 repay and a -1 drop net to -1 in either order — which is why a naive swap survives every
    // other test. They diverge only at the rung-4 BOUNDARY, where the repay's fadedRung SATURATES:
    //   base is rung 4 with a hint outstanding (climb → hint → one more fade back up to 4, debt 1).
    //   Then 7 wrong + 3 correct: the last correct both completes the 3-streak AND leaves the window
    //   at 3/10 < 70%. Shipped (repay-first): repay saturates at rung 4, then the drop takes it to 3.
    //   Swapped (drop-first): drop to 3, then repay climbs back to 4 — a different ladder position.
    // Pinning rung 3 here is what makes the order load-bearing rather than incidental.
    const climb: FadingEvent[] = Array.from({ length: 4 }, () => faded());
    const s4 = deriveState(CONCEPT, climb);
    const base = [...climb, hintAgainst(s4), faded()]; // rung 4, hintDebt 1
    expect(deriveState(CONCEPT, base).rung).toBe(4);
    expect(deriveState(CONCEPT, base).hintDebt).toBe(1);

    const log = [...base, ...run(0, 7), ...run(3, 0)];
    const state = deriveState(CONCEPT, log);
    expect(state.rung).toBe(3);
    expect(state.hintDebt).toBe(0);
    expect(state.consecutiveCorrect).toBe(0);
  });

  it('a correct streak with no hint outstanding does not climb the ladder on its own', () => {
    const state = deriveState(CONCEPT, [...Array.from({ length: 4 }, () => faded()), ...run(9, 0)]);
    expect(state.rung).toBe(4);
    expect(state.hintDebt).toBe(0);
  });
});

describe('T7 — accuracy under 70% drops exactly one rung on that concept alone', () => {
  it('does not arm until the accuracy window is full', () => {
    const climbed = Array.from({ length: 4 }, () => faded());
    const oneMiss = deriveState(CONCEPT, [...climbed, graded(false)]);
    expect(windowAccuracy(oneMiss)).toBeNull();
    expect(oneMiss.rung).toBe(4);

    const nineOfWhichFourWrong = deriveState(CONCEPT, [...climbed, ...run(5, 4)]);
    expect(windowAccuracy(nineOfWhichFourWrong)).toBeNull();
    expect(nineOfWhichFourWrong.rung).toBe(4);
  });

  it('70% exactly is NOT under the floor — 7 of 10 keeps the rung', () => {
    const state = deriveState(CONCEPT, [...Array.from({ length: 4 }, () => faded()), ...run(7, 3)]);
    expect(windowAccuracy(state)).toBe(0.7);
    expect(ACCURACY_FLOOR).toBe(0.7);
    expect(state.rung).toBe(4);
    expect(state.belowAccuracyFloor).toBe(false);
  });

  it('6 of 10 is under the floor and costs exactly one rung', () => {
    const state = deriveState(CONCEPT, [...Array.from({ length: 4 }, () => faded()), ...run(6, 4)]);
    expect(windowAccuracy(state)).toBeCloseTo(0.6, 10);
    expect(state.rung).toBe(3);
    expect(state.belowAccuracyFloor).toBe(true);
  });

  it('EXACTLY one — a long run under the floor does not walk the concept down the ladder', () => {
    const events: FadingEvent[] = [...Array.from({ length: 4 }, () => faded()), ...run(6, 4)];
    let state = deriveState(CONCEPT, events);
    expect(state.rung).toBe(3);

    for (let i = 0; i < 6; i++) events.push(graded(false));
    state = deriveState(CONCEPT, events);
    expect(windowAccuracy(state)).toBe(0);
    expect(state.rung).toBe(3);
  });

  it('re-arms once accuracy recovers to the floor, and fires again on the next crossing', () => {
    const events: FadingEvent[] = [...Array.from({ length: 4 }, () => faded()), ...run(6, 4)];
    expect(deriveState(CONCEPT, events).rung).toBe(3);

    // Ten straight correct flush the window back to 100%: the crossing re-arms.
    for (let i = 0; i < 10; i++) events.push(graded(true));
    const recovered = deriveState(CONCEPT, events);
    expect(windowAccuracy(recovered)).toBe(1);
    expect(recovered.belowAccuracyFloor).toBe(false);
    expect(recovered.rung).toBe(3);

    // Now fall under again: a second crossing, a second single rung.
    for (let i = 0; i < 4; i++) events.push(graded(false));
    const fallenAgain = deriveState(CONCEPT, events);
    expect(windowAccuracy(fallenAgain)).toBeCloseTo(0.6, 10);
    expect(fallenAgain.rung).toBe(2);
  });

  it('the accuracy window is trailing, so ancient misses stop counting', () => {
    const events: FadingEvent[] = [
      ...Array.from({ length: 4 }, () => faded()),
      ...run(0, ACCURACY_WINDOW),
      ...run(ACCURACY_WINDOW, 0),
    ];
    const state = deriveState(CONCEPT, events);
    expect(state.recentAttempts.length).toBe(ACCURACY_WINDOW);
    expect(windowAccuracy(state)).toBe(1);
    expect(state.attempts).toBe(2 * ACCURACY_WINDOW);
  });

  it('a concept already at worked examples cannot be dropped further by bad accuracy', () => {
    const state = deriveState(CONCEPT, run(0, 12));
    expect(state.rung).toBe(0);
    expect(supportFor(state).description).toBe('worked examples');
  });
});

describe('per concept, never global — property 1', () => {
  it('an event for one concept leaves every other concept untouched', () => {
    const log: FadingEvent[] = [
      ...Array.from({ length: 4 }, () => faded(CONCEPT)),
      ...Array.from({ length: 4 }, () => faded(OTHER)),
      ...run(6, 4).map((e) => e), // six correct, four wrong, all on CONCEPT
    ];

    expect(deriveState(CONCEPT, log).rung).toBe(3);
    expect(deriveState(OTHER, log).rung).toBe(4);
    expect(deriveState(OTHER, log).attempts).toBe(0);
  });

  it('a hint on one concept does not price or charge another', () => {
    const log: FadingEvent[] = [
      ...Array.from({ length: 4 }, () => faded(CONCEPT)),
      ...Array.from({ length: 4 }, () => faded(OTHER)),
    ];
    const heroBefore = deriveState(CONCEPT, log);
    const withHint = [...log, hintAgainst(heroBefore, CONCEPT)];

    expect(deriveState(CONCEPT, withHint).rung).toBe(3);
    expect(deriveState(CONCEPT, withHint).hintDebt).toBe(1);
    expect(deriveState(OTHER, withHint).rung).toBe(4);
    expect(deriveState(OTHER, withHint).hintDebt).toBe(0);
  });

  it('no wildcard concept id exists: an event addressed to "*" moves nothing', () => {
    const log: FadingEvent[] = [
      ...Array.from({ length: 4 }, () => faded(CONCEPT)),
      { kind: 'graded', conceptId: '*', at: T0, correct: false },
      { kind: 'supportFaded', conceptId: '*', at: T0 },
      { kind: 'hintRequested', conceptId: '*', at: T0, quotedRungAfter: 0 },
    ];
    const state = deriveState(CONCEPT, log);
    expect(state.rung).toBe(4);
    expect(state.attempts).toBe(0);
    expect(state.hintDebt).toBe(0);
  });

  it('a rung with no concept is not constructible', () => {
    expect(() => initialState('')).toThrow(/global level/);
    expect(() => initialState('   ')).toThrow(/global level/);
  });

  it('concept ids are matched EXACTLY, not case-insensitively — a near-miss id moves nothing', () => {
    // The isolation tests above use wholesale-different ids (CONCEPT vs OTHER), so a mutation that
    // compares ids case-insensitively survives them. This pins the exact-string claim in fading.ts's
    // header: an event addressed to the upper-cased spelling of a concept is a DIFFERENT concept and
    // must not touch the lower-cased one. Cross-concept contamination via a differently-normalised id
    // would silently strip scaffolding from a concept the event was never about.
    const lower = 'polarity-wants-size';
    const upper = 'POLARITY-WANTS-SIZE';
    const log: FadingEvent[] = [
      ...Array.from({ length: 4 }, () => faded(lower)),
      { kind: 'graded', conceptId: upper, at: T0, correct: false },
      { kind: 'supportFaded', conceptId: upper, at: T0 },
    ];
    // The lower-cased concept climbed to rung 4 on its own fades and saw NONE of the upper-cased events.
    expect(deriveState(lower, log).rung).toBe(4);
    expect(deriveState(lower, log).attempts).toBe(0);
    // The upper-cased concept is its own state, carrying only its own events.
    expect(deriveState(upper, log).attempts).toBe(1);
    expect(deriveState(upper, log).rung).toBe(1); // one supportFaded from rung 0
  });

  /**
   * T7: "A GLOBAL DIFFICULTY LEVEL IS FORBIDDEN — it strips scaffolding from concepts never learned."
   *
   * ENFORCED STRUCTURALLY OVER EVERY EXPORT, NOT BY A NAME DENYLIST. The previous version of this test
   * arity-checked five hand-listed functions and then grepped export NAMES against
   * /global|difficulty|allConcepts|setRung|everyConcept/i. An adversarial pass defeated it in one line
   * by adding an evasively-named mover:
   *
   *   export function bulkRungOverride(rung: Rung, states: readonly FadingState[]): FadingState[]
   *
   * which sets every concept's rung at once — exactly the forbidden global level — and passed, because
   * the name matched no pattern and the function was not in the hand-written arity list. A denylist
   * only catches vocabulary someone thought of in advance.
   *
   * The structural version: EVERY exported function is inspected, and none may accept an array or a
   * Map. A global level needs a way to name many concepts at once; if no signature can express "these
   * concepts", the level has nowhere to live. This catches an addition nobody remembered to list, which
   * is the whole point.
   *
   * The one sanctioned array parameter is deriveState's LOG — a list of events, all addressed to the
   * single concept named in its first parameter — so it is allowed by name and its shape is pinned
   * separately by the per-concept isolation tests above.
   */
  it('no exported function can move more than one concept, whatever it is called', async () => {
    const fading = await import('../../src/core/fading.js');
    const functions: [string, Function][] = Object.entries(fading).flatMap((entry) =>
      typeof entry[1] === 'function' ? [[entry[0], entry[1] as Function]] : [],
    );
    expect(functions.length, 'no exports found, so this test would pass vacuously').toBeGreaterThan(4);

    /** deriveState(conceptId, log) is the sanctioned exception: one concept, many of ITS events. */
    const LOG_TAKERS = new Set(['deriveState']);

    for (const [name, fn] of functions) {
      const source = fn.toString();
      // The parameter list only — a body may legitimately map over its own internal collections.
      const params = source.slice(source.indexOf('(') + 1, source.indexOf(')'));
      if (LOG_TAKERS.has(name)) continue;
      expect(
        /\[\]|Array|Map|Set|readonly |states|concepts/i.test(params),
        `${name}(${params}) can address more than one concept, which is T7's forbidden global level`,
      ).toBe(false);
    }

    // The named movers still keep their arity, so a silent widening of one of them also fails.
    expect(fading.deriveState.length).toBe(2);
    expect(fading.applyEvent.length).toBe(2);
    expect(fading.initialState.length).toBe(1);
    expect(fading.hintPrice.length).toBe(1);
    expect(fading.supportFor.length).toBe(1);
  });
});

describe('recomputable from the log — property 2', () => {
  it('state is a fold: replaying the log from scratch equals the incremental walk', () => {
    const log: FadingEvent[] = [];
    const climb = Array.from({ length: 4 }, () => faded());
    log.push(...climb);
    log.push(hintAgainst(deriveState(CONCEPT, log)));
    log.push(...run(6, 4));
    log.push(graded(true), graded(true), graded(true));

    let incremental = initialState(CONCEPT);
    for (const event of log) incremental = applyEvent(incremental, event);

    expect(deriveState(CONCEPT, log)).toEqual(incremental);
  });

  it('resuming from a persisted aggregate and replaying only the tail gives the same state', () => {
    const head: FadingEvent[] = [...Array.from({ length: 4 }, () => faded()), ...run(6, 4)];
    const tail: FadingEvent[] = [graded(true), graded(true), graded(true), graded(false)];

    const snapshot: FadingState = JSON.parse(JSON.stringify(deriveState(CONCEPT, head)));
    const resumed = tail.reduce(applyEvent, snapshot);

    expect(resumed).toEqual(deriveState(CONCEPT, [...head, ...tail]));
  });

  it('the state shape survives a JSON round trip with nothing lost', () => {
    const state = deriveState(CONCEPT, [
      ...Array.from({ length: 4 }, () => faded()),
      ...run(6, 4),
      graded(true),
    ]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('Reset KC is recompute-from-empty, not a delete path', () => {
    const log: FadingEvent[] = [...Array.from({ length: 4 }, () => faded()), ...run(6, 4)];
    const dirty = deriveState(CONCEPT, log);
    expect(dirty.rung).toBe(3);
    expect(dirty.attempts).toBe(10);

    const reset = deriveState(CONCEPT, []);
    expect(reset).toEqual(initialState(CONCEPT));
    expect(reset.rung).toBe(MOST_SUPPORT_RUNG);
    expect(reset.attempts).toBe(0);
    expect(reset.hintDebt).toBe(0);

    // Reversible, because the records were never touched: replaying the same log rebuilds the
    // pre-reset rung exactly.
    expect(deriveState(CONCEPT, log)).toEqual(dirty);
  });

  it('exposes no mutating or deleting entry point — the rung is derived, never set', async () => {
    const fading = await import('../../src/core/fading.js');
    const mutators = Object.keys(fading).filter((k) => /^(set|delete|clear|reset|drop|promote)/i.test(k));
    expect(mutators).toEqual([]);
  });
});

describe('Q2 — blocking only on first exposure at rung 0', () => {
  it('a genuinely new concept at rung 0 with no attempts blocks', () => {
    expect(blockedPracticeAllowed(initialState(CONCEPT))).toBe(true);
  });

  it('one attempt ends the first exposure even though the rung is still 0', () => {
    const state = deriveState(CONCEPT, [graded(true)]);
    expect(state.rung).toBe(0);
    expect(blockedPracticeAllowed(state)).toBe(false);
  });

  it('a concept dropped back to rung 0 is NOT a first exposure', () => {
    // One rung up, then a bad window: the single crossing lands it back on worked examples with a
    // history behind it. (Falling from rung 4 would only reach rung 3 — one crossing, one rung.)
    const state = deriveState(CONCEPT, [faded(), ...run(0, ACCURACY_WINDOW)]);
    expect(state.rung).toBe(0);
    expect(state.attempts).toBeGreaterThan(0);
    expect(blockedPracticeAllowed(state)).toBe(false);
  });

  it('a faded concept with no attempts still does not block — rung 0 is required', () => {
    const state = atRung(2);
    expect(state.attempts).toBe(0);
    expect(blockedPracticeAllowed(state)).toBe(false);
  });
});

describe('story 22 — the learner is told what asking cost', () => {
  it('the notice names the concept, the rung, both support levels and the way back', () => {
    const price = hintPrice(atRung(2));
    expect(price.notice).toContain(CONCEPT);
    expect(price.notice).toContain('one scaffolding rung');
    expect(price.notice).toContain('principle name only becomes full correction');
    expect(price.notice).toContain('3 consecutive correct');
  });
});
