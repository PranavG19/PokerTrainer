/**
 * Dee's settings and memory in the profile (`progression.dee`, types.ts DeeMemory). Pure updates on
 * ProgressionState; the renderer persists the result. Unknown tone and frequency strings a newer build
 * wrote are kept as stored until the learner picks a value here (AGENTS.md, "Profile schema").
 */

import type { DayKey } from '../localDay.js';
import { MAX_DEE_SAID, MAX_REMEMBERED_SENTENCES } from '../progression/persist.js';
import type { DeeMemory, ProgressionState } from '../progression/types.js';
import { frequencyOf, principleOf, QUIET_SPACING, QUIET_STRETCH, quietOf, toneOf, type DeeContext, type DeeLineMemory, type QuietLevel } from './engine.js';
import type { Frequency, Principle, Tone } from './types.js';

function withDee(p: ProgressionState, dee: Partial<DeeMemory>): ProgressionState {
  return { ...p, dee: { ...p.dee, ...dee } };
}

export function setTone(p: ProgressionState, tone: Tone): ProgressionState {
  return withDee(p, { personality: { ...p.dee.personality, tone } });
}

export function setFrequency(p: ProgressionState, frequency: Frequency): ProgressionState {
  return withDee(p, { personality: { ...p.dee.personality, frequency } });
}

export function setQuiet(p: ProgressionState, quiet: QuietLevel): ProgressionState {
  return withDee(p, { personality: { ...p.dee.personality, quiet } });
}

export function setCharacter(p: ProgressionState, character: boolean): ProgressionState {
  return withDee(p, { character });
}

/** The cooldown clock and the recent lines, as the engine reads them. */
export function lineMemoryOf(dee: DeeMemory): DeeLineMemory {
  // A recorded hand count above the lifetime count is corruption; clamp it so a line is never locked out.
  return { handsWatched: dee.handsWatched, said: dee.said.map((s) => ({ lineId: s.lineId, at: Math.min(s.at, dee.handsWatched) })) };
}

export function withLineMemory(p: ProgressionState, memory: DeeLineMemory): ProgressionState {
  return withDee(p, { handsWatched: memory.handsWatched, said: memory.said.slice(-MAX_DEE_SAID).map((s) => ({ ...s })) });
}

/**
 * Lessons whose mechanism the reason grader files under price or range (reasonGrade.ts names the split),
 * so a sentence the learner saved there is quoted when a verdict of that principle lands.
 */
const LESSON_PRINCIPLE: Readonly<Record<string, Principle>> = {
  'pot-odds-as-a-price': 'pot odds',
  'counting-outs-as-a-frequency': 'pot odds',
  'minimum-defence-frequency': 'pot odds',
  'equity-realisation': 'pot odds',
  'alpha-the-bluff-price': 'value or bluff',
  'polarity-picks-the-size': 'value or bluff',
  'range-role-bettor-or-caller': 'ranges',
  'who-holds-the-nuts': 'ranges',
  'range-advantage-versus-nut-advantage': 'ranges',
  'combos-not-hands': 'ranges',
  'domination-and-dead-hands': 'ranges',
};

export function principleOfConcept(conceptId: string): Principle {
  return LESSON_PRINCIPLE[conceptId] ?? principleOf(conceptId);
}

/** Remember an accepted sentence so Dee can quote it back. The newest per concept wins; bounded. */
export function rememberRule(p: ProgressionState, conceptId: string, text: string, day: DayKey): ProgressionState {
  const kept = p.dee.ruleSentences.filter((r) => !(r.conceptId === conceptId && r.text === text));
  return withDee(p, { ruleSentences: [...kept, { conceptId, text, day }].slice(-MAX_REMEMBERED_SENTENCES) });
}

/** "Forget": Dee stops quoting the learner's sentences. The lexicon itself (L3, append-only) is untouched. */
export function forgetRules(p: ProgressionState): ProgressionState {
  return withDee(p, { ruleSentences: [] });
}

/** The newest remembered sentence per principle. */
export function rulesByPrinciple(dee: DeeMemory): Partial<Record<Principle, string>> {
  const out: Partial<Record<Principle, string>> = {};
  for (const r of dee.ruleSentences) out[principleOfConcept(r.conceptId)] = r.text;
  return out;
}

/** The engine's context from the profile, plus the two derived inputs the renderer computes. */
export function contextOf(dee: DeeMemory, derived: { biggestLeak: Principle | null; quietness: number }): DeeContext {
  return {
    tone: toneOf(dee.personality.tone),
    frequency: frequencyOf(dee.personality.frequency),
    character: dee.character,
    rules: rulesByPrinciple(dee),
    biggestLeak: derived.biggestLeak,
    quietness: derived.quietness * QUIET_STRETCH[quietOf(dee.personality.quiet)],
    spacing: QUIET_SPACING[quietOf(dee.personality.quiet)],
  };
}
