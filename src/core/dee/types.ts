/**
 * Dee, the character layer: shapes only. Dee is the dealer button with two engraved lights (owner D8,
 * "Two lights"). It PHRASES what the engine decided and owns no number: every numeral Dee shows comes
 * from a slot filled with an engine fact (engine.ts), and the bank lint (tests/unit/dee-bank.test.ts)
 * fails any line that writes one itself.
 *
 * Pure: no DOM, no clock, no RNG of its own. The renderer passes in the seed and the hand count.
 */

/** The eight expressions of the rig (demo/vision/dee-marks.html). `blink` is a rig detail, not a pose. */
export const DEE_POSES = ['rest', 'listening', 'glance', 'thinking', 'price-held', 'serious', 'gate', 'asleep'] as const;
export type DeePose = (typeof DEE_POSES)[number];

/** The personality dial. The numbers never change, only the words around them. */
export const TONES = ['dry', 'warm', 'blunt'] as const;
export type Tone = (typeof TONES)[number];

/**
 * When Dee speaks. Persisted as these strings in `progression.dee.personality.frequency`; `normal` is the
 * id the v2 default already wrote, so it keeps meaning the default, "After notable hands".
 */
export const FREQUENCIES = ['normal', 'mistakes', 'sessions'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** The coach principles `coach.ts` tags a verdict with. A principle this build does not know reads as `other`. */
export type Principle = 'pot odds' | 'value or bluff' | 'ranges' | 'other';

export type DeeAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

/**
 * The slots a line may use. Each is filled ONLY from an engine fact (the grade, the session counts, the
 * learner's own saved sentence). A line whose slot has no fact is not eligible, so Dee goes quiet rather
 * than say a sentence with a hole in it.
 */
export const SLOTS = [
  'reqPct',
  'sharePct',
  'evLossBb',
  'toCall',
  'pot',
  'repeat',
  'hands',
  'mistakes',
  'priceHeld',
  'rule',
] as const;
export type Slot = (typeof SLOTS)[number];

/** Filled slot values, already formatted (a percentage carries its % sign). */
export type Facts = Partial<Record<Slot, string>>;

/**
 * What happened, as the engine saw it. Hand-end events come from the hand's decisions; `session-end` from
 * the sitting's counts; the `lesson-*` events from the dialogue engine.
 */
export type DeeEventKind =
  | 'verdict'
  | 'right-action-wrong-reason'
  | 'price-held'
  | 'session-end'
  | 'lesson-open'
  | 'lesson-retry'
  | 'lesson-done';

export interface DeeEvent {
  readonly kind: DeeEventKind;
  readonly severity?: 'notable' | 'serious';
  readonly principle?: Principle;
  readonly action?: DeeAction;
  /** A bet was faced (toCall > 0). */
  readonly priced?: boolean;
  /** Turn or river. */
  readonly late?: boolean;
  /** How many earlier verdicts this session carried the same principle (0 = the first). */
  readonly repeat?: number;
  /** The learner committed Sure on this decision. */
  readonly sure?: boolean;
  /** For `right-action-wrong-reason`: what the reason grader heard. */
  readonly reason?: 'hand-strength' | 'none';
  /** For `session-end`: no notable or serious verdict all sitting. */
  readonly clean?: boolean;
  /** This principle is the learner's costliest leak (career). */
  readonly leak?: boolean;
  readonly facts: Facts;
}

/** Conditions a line can require; every listed key must match the event. */
export interface LineWhen {
  readonly severity?: 'notable' | 'serious';
  readonly principle?: Principle;
  readonly action?: readonly DeeAction[];
  readonly priced?: boolean;
  readonly late?: boolean;
  /** 'first' = repeat 0; 'repeat' = repeat ≥ 1. */
  readonly repeat?: 'first' | 'repeat';
  readonly sure?: boolean;
  readonly reason?: 'hand-strength' | 'none';
  readonly clean?: boolean;
  readonly leak?: boolean;
}

export interface Line {
  /** Stable, unique: cooldown history and tests cite it. */
  readonly id: string;
  readonly event: DeeEventKind;
  readonly when?: LineWhen;
  readonly pose: DeePose;
  /** Hands before this line may be said again (stretched by depth quieting). */
  readonly cooldown: number;
  /** The canonical (Warm) line. */
  readonly text: string;
  /** Tone variants. Each must keep the canonical line's polarity and its slots in order (strict.ts). */
  readonly dry?: string;
  readonly blunt?: string;
  /** Relative pick weight among eligible lines; default 1. */
  readonly weight?: number;
  /** Added to the line's specificity, so a tic ("Noted.") outranks longer lines for its moment. */
  readonly priority?: number;
}

/** Where a line is shown, which sets its word budget (bank lint). */
export const WORD_BUDGET: Readonly<Record<DeeEventKind, number>> = {
  verdict: 18,
  'right-action-wrong-reason': 18,
  'price-held': 18,
  'session-end': 22,
  'lesson-open': 20,
  'lesson-retry': 20,
  'lesson-done': 20,
};

/** One line Dee will say, with the pose to wear while saying it. */
export interface SpokenLine {
  readonly lineId: string;
  readonly event: DeeEventKind;
  readonly pose: DeePose;
  readonly text: string;
}
