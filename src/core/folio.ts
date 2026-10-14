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
 * Concept ids differ between the lexicon (contrast concepts) and lessons, so a card is not joined to a drill
 * concept's schedule state; its own writing and polish history is its record.
 *
 * Pure: the caller passes `now`.
 */

import type { LexiconAttempt } from './lexicon.js';
import { DECAY_HALF_LIFE_DAYS, MS_PER_DAY, WAVES } from './schedule.js';
import type { FolioState, RememberedSentence } from './progression/types.js';
import { MAX_FOLIO_REVIEWS } from './progression/persist.js';

export type CardSource = 'repair' | 'lesson';

export interface FolioCard {
  readonly conceptId: string;
  /** The newest sentence. */
  readonly text: string;
  readonly source: CardSource;
  /** Epoch ms the newest sentence was written. */
  readonly writtenAt: number;
  /** Earlier sentences for the concept, oldest first. */
  readonly earlier: readonly string[];
  /** Epoch ms of the last polish (or the writing, if never polished). */
  readonly lastPolished: number;
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
  at: number;
  source: CardSource;
}

/** A lesson rule is saved with its day only; it is placed at that day number's UTC start, within a day of the real time. */
function dayStartMs(day: number): number {
  return day * MS_PER_DAY;
}

export function folioCards(input: {
  readonly lexicon: readonly LexiconAttempt[];
  readonly rules: readonly RememberedSentence[];
  readonly folio: FolioState;
  readonly now: number;
}): FolioCard[] {
  const written: Written[] = [];
  for (const a of input.lexicon) {
    if (a.outcome === 'accepted') written.push({ conceptId: a.conceptId, text: a.sentence, at: a.at, source: 'repair' });
  }
  for (const r of input.rules) written.push({ conceptId: r.conceptId, text: r.text, at: dayStartMs(r.day), source: 'lesson' });

  const byConcept = new Map<string, Written[]>();
  for (const w of written) {
    const list = byConcept.get(w.conceptId) ?? [];
    if (!list.some((x) => x.text === w.text)) list.push(w);
    byConcept.set(w.conceptId, list);
  }

  const cards: FolioCard[] = [];
  for (const [conceptId, list] of byConcept) {
    list.sort((a, b) => a.at - b.at);
    const newest = list[list.length - 1];
    const polishes = (input.folio.polished[conceptId] ?? []).filter((t) => t >= newest.at);
    cards.push({
      conceptId,
      text: newest.text,
      source: newest.source,
      writtenAt: newest.at,
      earlier: list.slice(0, -1).map((w) => w.text),
      ...wear(newest.at, polishes, input.now),
    });
  }
  // Tarnished first (the ones to polish), then newest written.
  return cards.sort((a, b) => Number(b.tarnished) - Number(a.tarnished) || b.writtenAt - a.writtenAt || a.conceptId.localeCompare(b.conceptId));
}

/**
 * The card's state on the waves: written at `writtenAt` (the day-0 rep), polished at `polishes` (ascending). Each
 * later wave is satisfied by the first polish on or after its day that follows the previous wave's satisfaction.
 */
export function wear(
  writtenAt: number,
  polishes: readonly number[],
  now: number,
): Pick<FolioCard, 'lastPolished' | 'tarnished' | 'tarnish' | 'waveDay' | 'dueInDays'> {
  const later = WAVES.filter((w) => w.day > 0);
  let p = 0;
  let owed: (typeof later)[number] | null = null;
  for (const wave of later) {
    const due = writtenAt + wave.day * MS_PER_DAY;
    while (p < polishes.length && polishes[p] < due) p++;
    if (p < polishes.length) {
      p++;
      continue;
    }
    owed = wave;
    break;
  }
  const lastPolished = polishes.length > 0 ? Math.max(writtenAt, polishes[polishes.length - 1]) : writtenAt;
  const ageDays = Math.max(0, (now - lastPolished) / MS_PER_DAY);
  const dull = 1 - Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
  if (owed === null) return { lastPolished, tarnished: false, tarnish: 0, waveDay: null, dueInDays: null };
  const dueAt = writtenAt + owed.day * MS_PER_DAY;
  const tarnished = now >= dueAt;
  return {
    lastPolished,
    tarnished,
    tarnish: tarnished ? Math.max(0.05, round2(dull)) : 0,
    waveDay: owed.day,
    dueInDays: tarnished ? 0 : Math.ceil((dueAt - now) / MS_PER_DAY),
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
  for (const c of [...cards].sort((a, b) => a.writtenAt - b.writtenAt)) lines.push(`${label(c.conceptId)}: ${c.text}`);
  return lines.join('\n');
}
