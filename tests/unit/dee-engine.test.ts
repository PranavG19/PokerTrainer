import { describe, expect, it } from 'vitest';
import { gradeDecision } from '../../src/core/coach.js';
import {
  CLOSE_SPOT_POINTS,
  NEW_SITTING,
  handEndEvent,
  isPriceHeld,
  QUIET_SPACING,
  QUIET_STRETCH,
  quietnessForDepth,
  recordHandInSitting,
  rememberLine,
  selectLine,
  sessionEndEvent,
  watchHand,
  type BeatDecision,
  type DeeContext,
} from '../../src/core/dee/engine.js';
import { DEE_BANK } from '../../src/core/dee/bank.js';
import { contextOf, forgetRules, lineMemoryOf, rememberRule, setCharacter, setFrequency, setQuiet, setTone, withLineMemory } from '../../src/core/dee/memory.js';
import { defaultProgression, parseProgression, serializeProgression } from '../../src/core/progression/persist.js';
import { asDayKey } from '../../src/core/localDay.js';

const CTX: DeeContext = { tone: 'warm', frequency: 'normal', character: true, rules: {}, biggestLeak: null, quietness: 1 };
const FRESH = { handsWatched: 0, said: [] };

function decision(over: Omit<Partial<BeatDecision>, 'grade'> & { grade?: Partial<BeatDecision['grade']> } = {}): BeatDecision {
  const { grade, ...rest } = over;
  return {
    action: 'call',
    street: 'flop',
    toCall: 75,
    pot: 225,
    confidence: 'sure',
    reasonCategory: 'price',
    rightForWrongReason: false,
    ...rest,
    grade: { severity: 'free', evLossBb: 0, principle: null, spot: { needed: 0.25, had: 0.3 }, ...grade },
  };
}

const serious = (over: Partial<BeatDecision> = {}): BeatDecision =>
  decision({ ...over, grade: { severity: 'serious', evLossBb: 2.9, principle: 'pot odds', price: { needed: 0.25, had: 0.74 }, spot: { needed: 0.25, had: 0.74 } }, action: 'fold' });

describe('the silence rule', () => {
  it('a hand whose decisions all cost under 0.5 bb and held no close price says nothing', () => {
    const easy = decision({ grade: { spot: { needed: 0.2, had: 0.8 } } });
    expect(handEndEvent([easy], NEW_SITTING, CTX)).toBeNull();
    const unpriced = decision({ toCall: 0, grade: { spot: undefined } });
    expect(handEndEvent([unpriced], NEW_SITTING, CTX)).toBeNull();
  });

  it('a real grade under 0.5 bb is free and silent, at the boundary too', () => {
    const g = gradeDecision({ hole: ['2c', '7d'], board: [], street: 'preflop', pot: 75, toCall: 0, stack: 5000, bb: 50, chosen: 'fold', opponents: 3, seed: 1 });
    expect(g.severity).toBe('free');
    const d = decision({ action: 'fold', toCall: 0, grade: { ...g } });
    expect(handEndEvent([d], NEW_SITTING, CTX)).toBeNull();
    const justUnder = decision({ grade: { severity: 'notable', evLossBb: 0.49, principle: 'pot odds' } });
    expect(handEndEvent([justUnder], NEW_SITTING, CTX)).toBeNull();
  });

  it('a mistake speaks, and the costliest decision of the hand is the one Dee names', () => {
    const small = decision({ grade: { severity: 'notable', evLossBb: 0.8, principle: 'value or bluff' }, action: 'check', toCall: 0 });
    const e = handEndEvent([small, serious()], NEW_SITTING, CTX);
    expect(e?.kind).toBe('verdict');
    expect(e?.severity).toBe('serious');
    expect(e?.principle).toBe('pot odds');
    expect(e?.facts.reqPct).toBe('25%');
    expect(e?.facts.sharePct).toBe('74%');
    expect(e?.facts.evLossBb).toBe('2.9');
  });
});

describe('Price held (owner D6)', () => {
  it('fires on a free, close, priced decision said Sure with a mechanism reason', () => {
    expect(isPriceHeld(decision())).toBe(true);
    const e = handEndEvent([decision()], NEW_SITTING, CTX);
    expect(e?.kind).toBe('price-held');
    expect(e?.facts).toMatchObject({ reqPct: '25%', sharePct: '30%' });
  });

  it('never fires on a guess, a hand-strength reason, an easy spot, a mistake, or an unpriced spot', () => {
    expect(isPriceHeld(decision({ confidence: 'guess' }))).toBe(false);
    expect(isPriceHeld(decision({ confidence: null }))).toBe(false);
    expect(isPriceHeld(decision({ reasonCategory: 'hand-strength' }))).toBe(false);
    expect(isPriceHeld(decision({ reasonCategory: null }))).toBe(false);
    expect(isPriceHeld(decision({ grade: { spot: { needed: 0.25, had: 0.25 + CLOSE_SPOT_POINTS + 0.01 } } }))).toBe(false);
    expect(isPriceHeld(decision({ grade: { severity: 'notable', evLossBb: 0.6 } }))).toBe(false);
    expect(isPriceHeld(decision({ toCall: 0 }))).toBe(false);
    expect(isPriceHeld(decision({ street: 'preflop' }))).toBe(false);
  });

  it('never fires on the wrong side of the price, even when the cost was under half a big blind (free)', () => {
    // A call with 31% against a 33% price: free (cheap) but short of the price.
    expect(isPriceHeld(decision({ grade: { spot: { needed: 0.33, had: 0.31 } } }))).toBe(false);
    // A fold with 36% against a 33% price: the call was the side the price favoured.
    expect(isPriceHeld(decision({ action: 'fold', grade: { spot: { needed: 0.33, had: 0.36 } } }))).toBe(false);
    expect(isPriceHeld(decision({ action: 'fold', grade: { spot: { needed: 0.33, had: 0.3 } } }))).toBe(true);
  });

  it('the close-spot band seam decides when the grader supplies it', () => {
    expect(isPriceHeld(decision({ grade: { spot: { needed: 0.25, had: 0.6 } } }), true)).toBe(true);
    expect(isPriceHeld(decision(), false)).toBe(false);
  });

  it('fires once per principle per sitting', () => {
    const first = handEndEvent([decision()], NEW_SITTING, CTX);
    const sitting = recordHandInSitting(NEW_SITTING, [decision()], first);
    expect(sitting.priceHeld).toBe(1);
    expect(handEndEvent([decision()], sitting, CTX)).toBeNull();
    // A raise over the price is a ranges spot: its own once-per-sitting.
    expect(handEndEvent([decision({ action: 'raise' })], sitting, CTX)?.kind).toBe('price-held');
  });

  it('a real coach grade carries the pot shares on a free priced decision (the seam Price held reads)', () => {
    const g = gradeDecision({ hole: ['Ah', 'Ad'], board: ['2c', '7d', '9s'], street: 'flop', pot: 225, toCall: 75, stack: 5000, bb: 50, chosen: 'call', opponents: 1, seed: 3 });
    expect(g.severity).toBe('free');
    expect(g.price).toBeUndefined();
    expect(g.spot?.needed).toBeCloseTo(0.25, 5);
    expect(g.spot?.had).toBeGreaterThan(0.25);
  });
});

describe('frequency, Character off, right-for-the-wrong-reason', () => {
  it('"Mistakes only" keeps mistakes and drops Price held; "After sessions only" drops both', () => {
    expect(handEndEvent([decision()], NEW_SITTING, { ...CTX, frequency: 'mistakes' })).toBeNull();
    expect(handEndEvent([serious()], NEW_SITTING, { ...CTX, frequency: 'mistakes' })?.kind).toBe('verdict');
    expect(handEndEvent([serious()], NEW_SITTING, { ...CTX, frequency: 'sessions' })).toBeNull();
    expect(sessionEndEvent(recordHandInSitting(NEW_SITTING, [serious()], null), CTX)?.kind).toBe('session-end');
  });

  it('Character off silences every Dee line', () => {
    const off = { ...CTX, character: false };
    expect(handEndEvent([serious()], NEW_SITTING, off)).toBeNull();
    expect(sessionEndEvent(recordHandInSitting(NEW_SITTING, [serious()], null), off)).toBeNull();
    expect(selectLine({ kind: 'lesson-open', facts: {} }, off, FRESH, 1)).toBeNull();
  });

  it('a right action for the wrong reason is its own event, ahead of Price held', () => {
    const g4 = decision({ rightForWrongReason: true, reasonCategory: 'hand-strength', confidence: 'guess' });
    const e = handEndEvent([g4], NEW_SITTING, CTX);
    expect(e?.kind).toBe('right-action-wrong-reason');
    expect(e?.reason).toBe('hand-strength');
  });
});

describe('selection: deterministic, specific first, cooldowns, depth quieting', () => {
  const event = handEndEvent([serious()], NEW_SITTING, CTX);

  it('the same seed says the same line; the text carries only engine numbers', () => {
    const a = selectLine(event, CTX, FRESH, 11);
    const b = selectLine(event, CTX, FRESH, 11);
    expect(a).toEqual(b);
    for (const n of a?.text.match(/\d+(?:\.\d+)?/g) ?? []) expect(['25', '74', '2.9', '75', '225']).toContain(n);
    expect(a?.pose).toBe('serious');
    expect(DEE_BANK.find((l) => l.id === a?.lineId)?.when?.principle).toBe('pot odds');
  });

  it('a repeat notable in the same principle is "Noted."', () => {
    const sitting = recordHandInSitting(NEW_SITTING, [decision({ grade: { severity: 'notable', evLossBb: 1, principle: 'pot odds' } })], null);
    const e = handEndEvent([decision({ grade: { severity: 'notable', evLossBb: 1.1, principle: 'pot odds' } })], sitting, CTX);
    expect(e?.repeat).toBe(1);
    expect(selectLine(e, CTX, FRESH, 1)?.text).toMatch(/^Noted/);
  });

  it('{repeat} counts the same kind of mistake, not just the same principle', () => {
    const fold = serious();
    const call = decision({ action: 'call', grade: { severity: 'serious', evLossBb: 2.5, principle: 'pot odds', price: { needed: 0.33, had: 0.2 } } });
    const after = recordHandInSitting(NEW_SITTING, [fold], null);
    expect(handEndEvent([call], after, CTX)?.repeat).toBe(0);
    expect(handEndEvent([fold], after, CTX)?.repeat).toBe(1);
  });

  it('counts every close price that held for the summary, under any frequency', () => {
    const s = recordHandInSitting(NEW_SITTING, [decision()], null);
    expect(s.priceHeld).toBe(1);
  });

  it('quotes the learner’s own sentence when one is saved for the principle', () => {
    const ctx = { ...CTX, rules: { 'pot odds': 'the price is the call over the pot after I call' } };
    const e = handEndEvent([serious()], NEW_SITTING, ctx);
    expect(selectLine(e, ctx, FRESH, 2)?.text).toContain('“the price is the call over the pot after I call”');
    const long = { ...CTX, rules: { 'pot odds': 'a very long sentence that keeps going far past the space the beat has room for' } };
    expect(handEndEvent([serious()], NEW_SITTING, long)?.facts.rule).toBeUndefined();
  });

  it('a line said within its cooldown is skipped; every line on cooldown means silence', () => {
    let memory = FRESH as { handsWatched: number; said: { lineId: string; at: number }[] };
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const line = selectLine(event, CTX, memory, 5);
      if (line === null) break;
      expect(seen.has(line.lineId), `${line.lineId} repeated inside its cooldown`).toBe(false);
      seen.add(line.lineId);
      memory = rememberLine(memory, line.lineId) as typeof memory;
    }
    expect(selectLine(event, CTX, memory, 5)).toBeNull();
    // Hands pass, and lines come back.
    for (let i = 0; i < 30; i++) memory = watchHand(memory) as typeof memory;
    expect(selectLine(event, CTX, memory, 5)).not.toBeNull();
  });

  it('depth quieting stretches cooldowns: 1×, 1.5×, 2×, 3×', () => {
    expect([0, 1, 2, 3, 4].map(quietnessForDepth)).toEqual([1, 1, 1.5, 2, 3]);
    const said = selectLine(event, CTX, FRESH, 5);
    let memory = rememberLine(FRESH, said?.lineId ?? '');
    for (let i = 0; i < 7; i++) memory = watchHand(memory);
    const line = DEE_BANK.find((l) => l.id === said?.lineId);
    const pick = (q: number): string[] => {
      const out: string[] = [];
      for (let s = 0; s < 200; s++) out.push(selectLine(event, { ...CTX, quietness: q }, memory, s)?.lineId ?? '');
      return out;
    };
    // At 1× a 6-hand cooldown has passed after 7 hands; at 3× it has not.
    if (line && line.cooldown <= 7) expect(pick(1)).toContain(line.id);
    expect(pick(3)).not.toContain(said?.lineId);
  });

  it('the quieter level (1.8): a gap of hands after any line, and longer cooldowns; standard changes nothing', () => {
    const said = selectLine(event, CTX, FRESH, 5);
    expect(said).not.toBeNull();
    let memory = rememberLine(FRESH, said?.lineId ?? '');
    memory = watchHand(memory);
    // Standard: another line is free to come one hand later.
    expect(selectLine(event, { ...CTX, spacing: QUIET_SPACING.standard }, memory, 6)).not.toBeNull();
    // Quieter: three hands must pass after any line, whichever line it was.
    expect(selectLine(event, { ...CTX, spacing: QUIET_SPACING.quieter }, memory, 6)).toBeNull();
    for (let i = 0; i < 2; i++) memory = watchHand(memory);
    expect(selectLine(event, { ...CTX, spacing: QUIET_SPACING.quieter }, memory, 6)).not.toBeNull();
    expect(selectLine(event, { ...CTX, spacing: QUIET_SPACING.quietest }, memory, 6)).toBeNull();
    // The profile's level reaches the engine through contextOf, on top of depth quieting.
    const dee = { ...defaultProgression().dee, personality: { tone: 'warm', frequency: 'normal', quiet: 'quietest' } };
    expect(contextOf(dee, { biggestLeak: null, quietness: 1.5 })).toMatchObject({ quietness: 1.5 * QUIET_STRETCH.quietest, spacing: QUIET_SPACING.quietest });
    const unknown = { ...dee, personality: { ...dee.personality, quiet: 'whisper' } };
    expect(contextOf(unknown, { biggestLeak: null, quietness: 1 })).toMatchObject({ quietness: 1, spacing: 0 });
    expect(setQuiet(defaultProgression(), 'quieter').dee.personality.quiet).toBe('quieter');
  });

  it('tone changes the words, never the numbers', () => {
    const facts = (t: 'dry' | 'warm' | 'blunt'): string[] => {
      const out = new Set<string>();
      for (let s = 0; s < 50; s++) for (const n of selectLine(event, { ...CTX, tone: t }, FRESH, s)?.text.match(/\d+(?:\.\d+)?%?/g) ?? []) out.add(n);
      return [...out];
    };
    for (const t of ['dry', 'warm', 'blunt'] as const) for (const n of facts(t)) expect(['25%', '74%', '2.9', '75', '225']).toContain(n);
  });
});

describe('session summary', () => {
  it('counts the sitting and names the principle with the most verdicts', () => {
    let s = NEW_SITTING;
    s = recordHandInSitting(s, [serious()], null);
    s = recordHandInSitting(s, [decision()], { kind: 'price-held', principle: 'pot odds', facts: {} });
    const e = sessionEndEvent(s, CTX);
    expect(e?.facts).toEqual({ hands: '2', mistakes: '1', priceHeld: '1' });
    expect(e?.principle).toBe('pot odds');
    expect(e?.clean).toBe(false);
    expect(sessionEndEvent(NEW_SITTING, CTX)).toBeNull();
  });
});

describe('Dee in the profile (progression.dee)', () => {
  it('settings and memory round-trip through the parser', () => {
    let p = defaultProgression();
    expect(p.dee.character).toBe(true);
    p = setTone(p, 'blunt');
    p = setFrequency(p, 'sessions');
    p = setCharacter(p, false);
    p = rememberRule(p, 'pot-odds-as-a-price', 'the price is the call over the pot after I call', asDayKey(20000)!);
    p = withLineMemory(p, rememberLine(watchHand(lineMemoryOf(p.dee)), 'ph-1'));
    const back = parseProgression(JSON.parse(JSON.stringify(serializeProgression(p))));
    expect(back).toEqual(p);
    const ctx = contextOf(back.dee, { biggestLeak: null, quietness: 1 });
    expect(ctx).toMatchObject({ tone: 'blunt', frequency: 'sessions', character: false });
    expect(ctx.rules['pot odds']).toBe('the price is the call over the pot after I call');
    expect(forgetRules(back).dee.ruleSentences).toEqual([]);
  });

  it('bad input reads as the defaults, never throws; unknown vocabulary is kept and read as the default', () => {
    const p = parseProgression({ dee: { character: 'yes', handsWatched: -4, said: [{ lineId: 7 }, { lineId: 'ok', at: 'x' }, null], personality: { tone: 'sardonic', frequency: 'hourly' } } });
    expect(p.dee.character).toBe(true);
    expect(p.dee.handsWatched).toBe(0);
    expect(p.dee.said).toEqual([{ lineId: 'ok', at: 0 }]);
    expect(p.dee.personality).toEqual({ tone: 'sardonic', frequency: 'hourly', quiet: 'standard' });
    expect(contextOf(p.dee, { biggestLeak: null, quietness: 1 })).toMatchObject({ tone: 'warm', frequency: 'normal' });
  });

  it('a recorded hand count above the lifetime count is clamped, so no line is locked out', () => {
    const p = parseProgression({ dee: { handsWatched: 3, said: [{ lineId: 'ph-1', at: 900 }] } });
    expect(lineMemoryOf(p.dee).said[0].at).toBe(3);
  });
});
