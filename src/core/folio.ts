/**
 * FOLIO, THE RULEBOOK: the learner's own rule sentences as cards.
 *
 * Sources, both already persisted: accepted lexicon sentences (contrast repairs, `session.lexicon`) and the rules
 * saved from lessons (`progression.dee.ruleSentences`). One card per concept: its newest sentence, with the earlier
 * ones kept as its history (the lexicon is append-only, L3).
 *
 * TARNISH FOLLOWS schedule.ts. A card is a reviewable item on the same flat waves as every concept (WAVES: day 0, 1,
 * 7, 21, 30): writing it is the day-0 rep, and each re-polish is a later rep. A wave is satisfied by a polish on or
 * after its day (late still counts, as VISION §4 pays a late review), in order. A card with a wave owed is
 * tarnished, and how far it has dulled is the schedule's own decay weight (DECAY_HALF_LIFE_DAYS) since its last
 * polish. Re-polishing (re-reading it and keeping it, or writing a new sentence) satisfies the owed wave.
 *
 * Every count is in the learner's local days (a lesson rule is saved with its day only).
 *
 * Concept ids differ between the lexicon (contrast concepts) and lessons, so a card is not joined to a drill
 * concept's schedule state; its own writing and polish history is its record.
 *
 * Pure: the caller passes `now`.
 */

import type { LexiconAttempt } from './lexicon.js';
import { DECAY_HALF_LIFE_DAYS, WAVES } from './schedule.js';
import type { DayKey, DayKeyOf } from './localDay.js';
import type { FolioState, RememberedSentence } from './progression/types.js';
import { MAX_FOLIO_REVIEWS } from './progression/persist.js';

export type CardSource = 'repair' | 'lesson';

export interface FolioCard {
  readonly conceptId: string;
  /** The newest sentence. */
  readonly text: string;
  readonly source: CardSource;
  /** The local day the newest sentence was written. */
  readonly writtenOn: DayKey;
  /** Earlier sentences for the concept, oldest first. */
  readonly earlier: readonly string[];
  /** The local day of the last polish (or the writing, if never polished). */
  readonly lastPolishedOn: DayKey;
  /** A wave is owed: the card needs a re-polish. */
  readonly tarnished: boolean;
  /** 0 = bright, rising toward 1 as it dulls (1 − the schedule's decay weight since the last polish). */
  readonly tarnish: number;
  /** The wave day owed (1, 7, 21, 30), or the next one coming when bright; null after the last wave. */
  readonly waveDay: number | null;
  /** Whole days until the next wave is owed (0 when owed now); null after the last wave. */
  readonly dueInDays: number | null;
}

interface Written {
  conceptId: string;
  text: string;
  /** Epoch ms for a lexicon sentence; null for a lesson rule, which is saved with its day only. */
  at: number | null;
  day: DayKey;
  source: CardSource;
}

/**
 * Cards are counted in the learner's local days (localDay.ts), never in raw milliseconds: a lesson rule is saved
 * with its day only, and a wave is a number of days on the learner's own calendar.
 */
export function folioCards(input: {
  readonly lexicon: readonly LexiconAttempt[];
  readonly rules: readonly RememberedSentence[];
  readonly folio: FolioState;
  readonly now: number;
  readonly dayOf: DayKeyOf;
}): FolioCard[] {
  const written: Written[] = [];
  for (const a of input.lexicon) {
    if (a.outcome === 'accepted') written.push({ conceptId: a.conceptId, text: a.sentence, at: a.at, day: input.dayOf(a.at), source: 'repair' });
  }
  for (const r of input.rules) written.push({ conceptId: r.conceptId, text: r.text, at: null, day: r.day, source: 'lesson' });

  const byConcept = new Map<string, Written[]>();
  for (const w of written) {
    const list = byConcept.get(w.conceptId) ?? [];
    if (!list.some((x) => x.text === w.text)) list.push(w);
    byConcept.set(w.conceptId, list);
  }

  const today = input.dayOf(input.now);
  const cards: FolioCard[] = [];
  for (const [conceptId, list] of byConcept) {
    list.sort((a, b) => a.day - b.day || (a.at ?? 0) - (b.at ?? 0));
    const newest = list[list.length - 1];
    // A polish counts for the newest sentence only from the moment (or, for a lesson rule, the day) it was written.
    const polishDays = (input.folio.polished[conceptId] ?? [])
      .filter((t) => (newest.at !== null ? t >= newest.at : input.dayOf(t) >= newest.day))
      .map((t) => input.dayOf(t));
    cards.push({
      conceptId,
      text: newest.text,
      source: newest.source,
      writtenOn: newest.day,
      earlier: list.slice(0, -1).map((w) => w.text),
      ...wear(newest.day, polishDays, today),
    });
  }
  // Tarnished first (the ones to polish), then newest written.
  return cards.sort((a, b) => Number(b.tarnished) - Number(a.tarnished) || b.writtenOn - a.writtenOn || a.conceptId.localeCompare(b.conceptId));
}

/**
 * The card's state on the waves, in local days: written on `writtenOn` (the day-0 rep), polished on `polishDays`.
 * Each later wave is satisfied by the first polish on or after its day that follows the previous wave's.
 */
export function wear(
  writtenOn: DayKey,
  polishDays: readonly DayKey[],
  today: DayKey,
): Pick<FolioCard, 'lastPolishedOn' | 'tarnished' | 'tarnish' | 'waveDay' | 'dueInDays'> {
  const polishes = [...polishDays].sort((a, b) => a - b);
  let p = 0;
  let owed: number | null = null;
  for (const wave of WAVES) {
    if (wave.day === 0) continue;
    const due = writtenOn + wave.day;
    while (p < polishes.length && polishes[p] < due) p++;
    if (p < polishes.length) {
      p++;
      continue;
    }
    owed = wave.day;
    break;
  }
  const lastPolishedOn = (polishes.length > 0 ? Math.max(writtenOn, polishes[polishes.length - 1]) : writtenOn) as DayKey;
  const dull = 1 - Math.pow(0.5, Math.max(0, today - lastPolishedOn) / DECAY_HALF_LIFE_DAYS);
  if (owed === null) return { lastPolishedOn, tarnished: false, tarnish: 0, waveDay: null, dueInDays: null };
  const dueOn = writtenOn + owed;
  const tarnished = today >= dueOn;
  return {
    lastPolishedOn,
    tarnished,
    tarnish: tarnished ? Math.max(0.05, round2(dull)) : 0,
    waveDay: owed,
    dueInDays: tarnished ? 0 : dueOn - today,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Re-polish one card at `at`. Bounded; a repeat at the same instant changes nothing. */
export function polish(state: FolioState, conceptId: string, at: number): FolioState {
  if (conceptId === '__proto__' || !Number.isFinite(at)) return state;
  const prior = state.polished[conceptId] ?? [];
  if (prior.includes(at)) return state;
  return { polished: { ...state.polished, [conceptId]: [...prior, at].sort((a, b) => a - b).slice(-MAX_FOLIO_REVIEWS) } };
}

/** The one-page sheet: every card's newest sentence, grouped by source, as plain text (Copy / print). */
export function folioSheet(cards: readonly FolioCard[], label: (conceptId: string) => string): string {
  const lines = ['Offsuit: the Rulebook', ''];
  for (const c of [...cards].sort((a, b) => a.writtenOn - b.writtenOn)) lines.push(`${label(c.conceptId)}: ${c.text}`);
  return lines.join('\n');
}
