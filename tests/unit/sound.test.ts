import { describe, expect, it, vi } from 'vitest';
import { createSoundPlayer, type AudioEngine } from '../../src/renderer/sound.js';

/**
 * A recording stub of the narrow AudioEngine surface. It captures every oscillator built so a test can
 * assert the cue's shape without a real audio device (jsdom has no Web Audio).
 */
function stubEngine(overrides: Partial<AudioEngine> = {}): {
  engine: AudioEngine;
  oscillators: { freq: number; started: boolean; stopped: boolean; connected: boolean }[];
  gains: { connectedToDestination: boolean }[];
} {
  const oscillators: { freq: number; started: boolean; stopped: boolean; connected: boolean }[] = [];
  const gains: { connectedToDestination: boolean }[] = [];
  const destination = {} as AudioDestinationNode;

  const engine: AudioEngine = {
    currentTime: 0,
    destination,
    state: 'running',
    createOscillator(): OscillatorNode {
      const rec = { freq: 0, started: false, stopped: false, connected: false };
      oscillators.push(rec);
      return {
        type: 'sine',
        frequency: { set value(v: number) { rec.freq = v; }, get value() { return rec.freq; } },
        connect: () => { rec.connected = true; },
        start: () => { rec.started = true; },
        stop: () => { rec.stopped = true; },
      } as unknown as OscillatorNode;
    },
    createGain(): GainNode {
      const rec = { connectedToDestination: false };
      gains.push(rec);
      return {
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: (target: unknown) => { if (target === destination) rec.connectedToDestination = true; },
      } as unknown as GainNode;
    },
    ...overrides,
  };
  return { engine, oscillators, gains };
}

describe('createSoundPlayer', () => {
  it('plays the two-tone cue: two oscillators, both started, stopped and routed to the destination', () => {
    const { engine, oscillators, gains } = stubEngine();
    createSoundPlayer(() => engine).play();

    expect(oscillators).toHaveLength(2);
    for (const osc of oscillators) {
      expect(osc.started).toBe(true);
      expect(osc.stopped).toBe(true);
      expect(osc.connected).toBe(true);
    }
    // The gain nodes are what reach the speakers; both must connect to the destination.
    expect(gains.every((g) => g.connectedToDestination)).toBe(true);
    // The two tones are distinct pitches (a fall), not the same note twice.
    expect(oscillators[0].freq).not.toBe(oscillators[1].freq);
  });

  it('no-ops silently when the Web Audio API is absent (factory returns null)', () => {
    expect(() => createSoundPlayer(() => null).play()).not.toThrow();
  });

  it('swallows an engine that throws mid-render — audio must never break a hand', () => {
    const throwing: AudioEngine = {
      currentTime: 0,
      destination: {} as AudioDestinationNode,
      state: 'running',
      createOscillator() { throw new Error('audio hardware fault'); },
      createGain() { return {} as GainNode; },
    };
    expect(() => createSoundPlayer(() => throwing).play()).not.toThrow();
  });

  it('resumes a context suspended by autoplay policy before playing', () => {
    const resume = vi.fn(() => Promise.resolve());
    const { engine } = stubEngine({ state: 'suspended', resume });
    createSoundPlayer(() => engine).play();
    expect(resume).toHaveBeenCalledOnce();
  });

  it('does not construct an engine until play() is called', () => {
    const factory = vi.fn(() => null);
    createSoundPlayer(factory);
    expect(factory).not.toHaveBeenCalled();
  });
});
