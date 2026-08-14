/**
 * A single synthesized cue, played at a costly verdict when the learner has turned sound on.
 *
 * Honest by construction: it carries NO information the screen does not already show. It fires at
 * exactly one moment — a mistake verdict (the same `onVerdict` the coach panel and the optional voice
 * use) — so it can never disagree with them, and a correct/'free' decision stays silent to match the
 * panel's silence rule. There is one cue, not a correct/wrong pair: a "you were right" chime would
 * break that silence-on-free-grade invariant and would be the only channel announcing a free grade.
 *
 * No asset, no network, no IPC: two short detuned sine tones built with the Web Audio API in the
 * renderer. A failure to play (no AudioContext, an autoplay block, a suspended context) is swallowed —
 * audio must never interrupt or delay a hand, and the verdict is already on screen and in the live region.
 */

/** The Web Audio surface this module needs, narrowed so a test can supply a stub. */
export interface AudioEngine {
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
  readonly destination: AudioDestinationNode;
  readonly currentTime: number;
  resume?(): Promise<void>;
  readonly state?: string;
}

type EngineFactory = () => AudioEngine | null;

/** The mistake cue: a low → lower two-note fall, ~180ms, quiet. Deliberately not a harsh buzzer. */
const CUE = {
  first: { freq: 392, start: 0, stop: 0.1 },
  second: { freq: 311, start: 0.09, stop: 0.22 },
  peakGain: 0.09,
} as const;

/**
 * Default factory: one shared AudioContext, created on first use (constructing it before a user
 * gesture is what browsers block). Returns null when the API is absent so callers no-op cleanly.
 */
function defaultFactory(): EngineFactory {
  let ctx: AudioEngine | null = null;
  return () => {
    if (ctx) return ctx;
    const Ctor =
      (globalThis as { AudioContext?: new () => AudioEngine }).AudioContext ??
      (globalThis as { webkitAudioContext?: new () => AudioEngine }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      return ctx;
    } catch {
      return null;
    }
  };
}

/**
 * A sound player. `play()` renders the cue; it is safe to call regardless of the toggle — the caller
 * gates on the preference so that, with sound off, no engine is ever constructed (an off switch that
 * still touches the audio hardware is the risk this shape removes, mirroring narrate() in main.ts).
 */
export interface SoundPlayer {
  play(): void;
}

export function createSoundPlayer(factory: EngineFactory = defaultFactory()): SoundPlayer {
  return {
    play(): void {
      const engine = factory();
      if (!engine) return;
      try {
        // A context suspended by autoplay policy resumes on the gesture that led here; ignore the promise.
        if (engine.state === 'suspended') void engine.resume?.();
        const now = engine.currentTime;
        for (const tone of [CUE.first, CUE.second]) {
          const osc = engine.createOscillator();
          const gain = engine.createGain();
          osc.type = 'sine';
          osc.frequency.value = tone.freq;
          // A short attack/decay envelope so the tone never clicks on start or cut-off.
          gain.gain.setValueAtTime(0.0001, now + tone.start);
          gain.gain.exponentialRampToValueAtTime(CUE.peakGain, now + tone.start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.stop);
          osc.connect(gain);
          gain.connect(engine.destination);
          osc.start(now + tone.start);
          osc.stop(now + tone.stop);
        }
      } catch {
        // Audio must never break a hand: a mid-render fault is swallowed, the verdict stays on screen.
      }
    },
  };
}
