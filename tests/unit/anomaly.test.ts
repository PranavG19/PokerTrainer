import { describe, expect, it } from 'vitest';
import {
  ANOMALY_RATE,
  DISABLED_MESSAGE,
  EXHAUSTED_MESSAGE,
  MIN_ANOMALY_TRIALS,
  MIN_TRIALS,
  RT_THRESHOLD_MS,
  TRAINED_DEPTHS_BB,
  TRAINED_SIZINGS_PCT,
  TRAINED_TEXTURES,
  TRIGGER_CATEGORIES,
  drawBlock,
  drawStimulus,
  fluencyGate,
  scoreResponse,
  stimulusPool,
  transferPool,
  type AnomalyStimulus,
  type Response,
  type TriggerCategory,
} from '../../src/core/anomaly';

const respond = (
  stimulus: AnomalyStimulus,
  answeredStandard: boolean,
  rtMs: number,
): Response => ({
  stimulusId: stimulus.id,
  answeredStandard,
  wasStandard: !stimulus.anomalous,
  rtMs,
});

/** A learner who is always right, at whatever speed the caller names. */
const perfectBlock = (count: number, rtMs: number, anomalies = MIN_ANOMALY_TRIALS): Response[] =>
  Array.from({ length: count }, (_, i) => {
    const wasStandard = i >= anomalies;
    return { stimulusId: `s${i}`, answeredStandard: wasStandard, wasStandard, rtMs };
  });

describe('anomaly rate', () => {
  it('lands near 15% over 4000 seeded draws, inside 4 binomial standard errors', () => {
    const draws = 4000;
    let anomalous = 0;
    for (let seed = 1; seed <= draws; seed++) {
      const { stimulus } = drawStimulus(seed, 'off-tree-sizing');
      if (stimulus?.anomalous) anomalous += 1;
    }
    const observed = anomalous / draws;

    // Each draw is one Bernoulli(0.15) trial, so the sample proportion has
    // SE = sqrt(p(1-p)/n) = sqrt(0.15*0.85/4000) ~= 0.00565. A 4-SE band (~2.3 points) is a ~1-in-16k
    // false-failure rate — tight enough to catch a real drift (e.g. 0.10 or 0.20) yet not flaky.
    const standardError = Math.sqrt((ANOMALY_RATE * (1 - ANOMALY_RATE)) / draws);
    expect(Math.abs(observed - ANOMALY_RATE)).toBeLessThan(4 * standardError);
  });

  it('holds the rate independently in every category', () => {
    const draws = 2000;
    const standardError = Math.sqrt((ANOMALY_RATE * (1 - ANOMALY_RATE)) / draws);
    for (const category of TRIGGER_CATEGORIES) {
      let anomalous = 0;
      for (let seed = 1; seed <= draws; seed++) {
        if (drawStimulus(seed * 7 + 3, category).stimulus?.anomalous) anomalous += 1;
      }
      expect(Math.abs(anomalous / draws - ANOMALY_RATE)).toBeLessThan(4 * standardError);
    }
  });
});

describe('trigger categories', () => {
  it('produces all four, each labelled, across a large sample', () => {
    const seenTriggers = new Set<TriggerCategory>();
    for (const category of TRIGGER_CATEGORIES) {
      for (let seed = 1; seed <= 500; seed++) {
        const { stimulus } = drawStimulus(seed, category);
        if (stimulus?.anomalous) {
          expect(stimulus.trigger).toBe(category);
          seenTriggers.add(category);
        }
      }
    }
    expect([...seenTriggers].sort()).toEqual([...TRIGGER_CATEGORIES].sort());
  });

  it('labels standard stimuli with a null trigger and every feature inside the trained ranges', () => {
    for (const category of TRIGGER_CATEGORIES) {
      for (const stimulus of stimulusPool(category).filter((s) => !s.anomalous)) {
        expect(stimulus.trigger).toBeNull();
        expect(TRAINED_DEPTHS_BB).toContain(stimulus.stackDepthBb);
        expect(TRAINED_SIZINGS_PCT).toContain(stimulus.sizingPctPot);
        expect(TRAINED_TEXTURES as readonly string[]).toContain(stimulus.textureClass);
      }
    }
  });

  it('deviates exactly one feature per anomalous stimulus, on the axis its trigger names', () => {
    const inTree = (s: AnomalyStimulus) => TRAINED_SIZINGS_PCT.includes(s.sizingPctPot);
    const inRange = (s: AnomalyStimulus) => TRAINED_DEPTHS_BB.includes(s.stackDepthBb);
    const knownTexture = (s: AnomalyStimulus) =>
      (TRAINED_TEXTURES as readonly string[]).includes(s.textureClass);
    const frameConsistent = (s: AnomalyStimulus) => !s.read.startsWith('frame says');

    for (const category of TRIGGER_CATEGORIES) {
      for (const s of stimulusPool(category).filter((a) => a.anomalous)) {
        const off = [!inTree(s), !knownTexture(s), !inRange(s), !frameConsistent(s)].filter(Boolean);
        expect(off).toHaveLength(1);
      }
      // And that single deviation is on the axis the category is about.
      const anomalies = stimulusPool(category).filter((a) => a.anomalous);
      if (category === 'off-tree-sizing') expect(anomalies.every((s) => !inTree(s))).toBe(true);
      if (category === 'unfamiliar-texture') expect(anomalies.every((s) => !knownTexture(s))).toBe(true);
      if (category === 'stack-depth-outside-range') expect(anomalies.every((s) => !inRange(s))).toBe(true);
      if (category === 'read-contradicts-frame') expect(anomalies.every((s) => !frameConsistent(s))).toBe(true);
    }
  });
});

describe('fluency gate — correct AND fast', () => {
  it('fails a learner at 10/10 accuracy whose responses are above the RT threshold (spec oracle row)', () => {
    const result = fluencyGate(perfectBlock(10, RT_THRESHOLD_MS + 400));
    expect(result.accuracy).toBe(1);
    expect(result.correct).toBe(10);
    expect(result.passed).toBe(false);
    expect(result.errorsByTag.slow).toBe(10);
    expect(result.reason).toContain('speed is part of the gate');
  });

  it('passes the same accuracy under the threshold', () => {
    const result = fluencyGate(perfectBlock(10, RT_THRESHOLD_MS - 400));
    expect(result.passed).toBe(true);
    expect(result.passRate).toBe(1);
  });

  it('treats the threshold itself as fast and one millisecond past it as slow', () => {
    expect(fluencyGate(perfectBlock(10, RT_THRESHOLD_MS)).passed).toBe(true);
    expect(fluencyGate(perfectBlock(10, RT_THRESHOLD_MS + 1)).passed).toBe(false);
  });

  it('fails a fast learner who is wrong too often, and names the dominant error tag not a trait', () => {
    const responses: Response[] = Array.from({ length: 10 }, (_, i) => ({
      stimulusId: `s${i}`,
      answeredStandard: true,
      wasStandard: i >= 3, // three anomalies, all played as standard
      rtMs: 900,
    }));
    const result = fluencyGate(responses);
    expect(result.passed).toBe(false);
    expect(result.errorsByTag['missed-anomaly']).toBe(3);
    expect(result.errorsByTag['false-alarm']).toBe(0);
    expect(result.reason).toContain('missed-anomaly');
  });

  it('refuses to certify a block with too few trials or too few anomalies', () => {
    const short = fluencyGate(perfectBlock(MIN_TRIALS - 1, 800));
    expect(short.passed).toBe(false);
    expect(short.reason).toContain(`of ${MIN_TRIALS} trials`);

    // A "standard" reflex scores 100% on an all-standard block; the anomaly floor is what stops it.
    const noAnomalies = fluencyGate(perfectBlock(20, 800, 0));
    expect(noAnomalies.accuracy).toBe(1);
    expect(noAnomalies.passed).toBe(false);
    expect(noAnomalies.reason).toContain('anomalous trials');
  });

  it('handles the degenerate empty block without dividing by zero', () => {
    const result = fluencyGate([]);
    expect(result.passed).toBe(false);
    expect(result.accuracy).toBe(0);
    expect(result.medianRtMs).toBe(0);
    expect(result.attempts).toBe(0);
  });

  it('respects a caller-supplied threshold', () => {
    expect(fluencyGate(perfectBlock(10, 2500), 3000).passed).toBe(true);
    expect(fluencyGate(perfectBlock(10, 2500), 1500).passed).toBe(false);
  });
});

describe('per-response scoring and G3 silence', () => {
  it('says nothing on a correct, fast response', () => {
    const scored = scoreResponse({ stimulusId: 'a', answeredStandard: true, wasStandard: true, rtMs: 700 });
    expect(scored.pass).toBe(true);
    expect(scored.tag).toBeNull();
    expect(scored.comment).toBeNull();
  });

  it('tags a correct-but-slow response slow, never as an accuracy error', () => {
    const scored = scoreResponse({ stimulusId: 'a', answeredStandard: false, wasStandard: false, rtMs: 5000 });
    expect(scored.correct).toBe(true);
    expect(scored.fast).toBe(false);
    expect(scored.pass).toBe(false);
    expect(scored.tag).toBe('slow');
  });

  it('separates a missed anomaly from a false alarm', () => {
    const missed = scoreResponse({ stimulusId: 'a', answeredStandard: true, wasStandard: false, rtMs: 600 });
    const alarm = scoreResponse({ stimulusId: 'b', answeredStandard: false, wasStandard: true, rtMs: 600 });
    expect(missed.tag).toBe('missed-anomaly');
    expect(alarm.tag).toBe('false-alarm');
  });
});

describe('seen-set and exhaustion', () => {
  it('never repeats a stimulus within a category across a full-length block', () => {
    for (const category of TRIGGER_CATEGORIES) {
      const size = stimulusPool(category).length + transferPool(category).length;
      const draws = drawBlock(4242, category, size);
      const ids = draws.map((d) => d.stimulus?.id).filter((id): id is string => id !== undefined);
      expect(ids).toHaveLength(size);
      expect(new Set(ids).size).toBe(size);
    }
  });

  it('honours a pre-populated seen-set', () => {
    const pool = stimulusPool('off-tree-sizing');
    const seen = new Set(pool.slice(0, pool.length - 1).map((s) => s.id));
    const { stimulus } = drawStimulus(99, 'off-tree-sizing', seen);
    expect(stimulus?.id).toBe(pool[pool.length - 1].id);
  });

  it('marks the category exhausted and rotates to held-out transfer stimuli', () => {
    const category: TriggerCategory = 'unfamiliar-texture';
    const seen = new Set(stimulusPool(category).map((s) => s.id));
    const draw = drawStimulus(11, category, seen);

    expect(draw.categoryExhausted).toBe(true);
    expect(draw.disabled).toBe(false);
    expect(draw.message).toBe(EXHAUSTED_MESSAGE);
    expect(draw.stimulus?.transfer).toBe(true);
    expect(transferPool(category).map((s) => s.id)).toContain(draw.stimulus?.id);
  });

  it('disables the drill with a message rather than repeating once transfer is gone too', () => {
    const category: TriggerCategory = 'read-contradicts-frame';
    const seen = new Set([...stimulusPool(category), ...transferPool(category)].map((s) => s.id));
    const draw = drawStimulus(5, category, seen);

    expect(draw.stimulus).toBeNull();
    expect(draw.disabled).toBe(true);
    expect(draw.categoryExhausted).toBe(true);
    expect(draw.message).toBe(DISABLED_MESSAGE);
  });

  it('ends a block on the disabled draw instead of overrunning the pool', () => {
    const category: TriggerCategory = 'stack-depth-outside-range';
    const size = stimulusPool(category).length + transferPool(category).length;
    const draws = drawBlock(777, category, size + 25);

    expect(draws).toHaveLength(size + 1);
    expect(draws[draws.length - 1].disabled).toBe(true);
    expect(draws.slice(0, -1).every((d) => d.stimulus !== null)).toBe(true);
    // The rotation boundary lands exactly where the main pool runs out.
    expect(draws.filter((d) => d.stimulus?.transfer).length).toBe(transferPool(category).length);
  });

  it('still serves both standard and anomalous stimuli after transfer rotation', () => {
    const category: TriggerCategory = 'off-tree-sizing';
    const size = stimulusPool(category).length + transferPool(category).length;
    const transferDraws = drawBlock(31337, category, size)
      .map((d) => d.stimulus)
      .filter((s): s is AnomalyStimulus => s?.transfer === true);

    expect(transferDraws.some((s) => s.anomalous)).toBe(true);
    expect(transferDraws.some((s) => !s.anomalous)).toBe(true);
  });
});

describe('determinism', () => {
  it('gives identical output for identical seeds and diverges across seeds', () => {
    const first = drawStimulus(20260810, 'unfamiliar-texture');
    const again = drawStimulus(20260810, 'unfamiliar-texture');
    expect(again).toEqual(first);

    const blockA = drawBlock(555, 'read-contradicts-frame', 30);
    const blockB = drawBlock(555, 'read-contradicts-frame', 30);
    expect(blockB).toEqual(blockA);

    const other = drawBlock(556, 'read-contradicts-frame', 30);
    expect(other.map((d) => d.stimulus?.id)).not.toEqual(blockA.map((d) => d.stimulus?.id));
  });

  it('keeps prompts stable and free of the answer', () => {
    const { stimulus } = drawStimulus(8, 'stack-depth-outside-range');
    expect(stimulus?.prompt).toContain('standard?');
    expect(stimulus?.prompt.toLowerCase()).not.toContain('anomal');
  });
});
