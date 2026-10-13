/**
 * The Long Orbit: six venues, six rivals, one per archetype (VISION §2.1, panel/character-designer.md §3–4).
 *
 * Pure data. A rival's name never contains an archetype id (two ids are banned words), and nothing here is
 * shown in-hand: at a story table a masked rival sits as "Masked", and the archetype label stays hidden even
 * after the hand ends, until the learner beats the chapter on decision quality (campaign.ts).
 *
 * D17: rivals appear in Story first. Live play keeps its anonymous regulars (Ada, Bo, Cy) and their
 * per-session archetype draw; nothing here touches it.
 */

import type { ArchetypeName } from '../archetypes.js';

/**
 * The costly decision patterns a chapter is built against, read from the learner's own graded decisions
 * (route.ts `leakKindOf`). Each is a (coach principle × action) pair, so it names a decision, never a person.
 */
export const LEAK_KINDS = ['over-fold', 'over-call', 'missed-value', 'empty-bluff', 'light-raise', 'free-fold'] as const;
export type LeakKind = (typeof LEAK_KINDS)[number];

/** What each pattern is, in words the UI shows beside its numbers. */
export const LEAK_LABELS: Readonly<Record<LeakKind, string>> = {
  'over-fold': 'folding to bets the price said to call',
  'over-call': 'calling bets above the price',
  'missed-value': 'checking back hands that wanted a bet',
  'empty-bluff': 'betting hands with too little behind them',
  'light-raise': 'raising into bets with too little',
  'free-fold': 'folding when checking was free',
};

export const CHAPTER_IDS = ['lighthouse', 'diner', 'library', 'night-train', 'pier', 'observatory'] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

export const RIVAL_IDS = ['wren', 'barnaby', 'percival', 'vesper', 'juniper', 'ines'] as const;
export type RivalId = (typeof RIVAL_IDS)[number];

export interface Rival {
  readonly id: RivalId;
  readonly name: string;
  /** Short enough for a seat pod. */
  readonly short: string;
  readonly title: string;
  readonly archetype: ArchetypeName;
  /** How the rival plays, in plain words, shown once unmasked. Never an archetype id. */
  readonly style: string;
  /** The keepsake glyph (VISION §2.1): what their medallion carries. */
  readonly keepsake: 'wick' | 'ticket' | 'bookmark' | 'punch' | 'fuse' | 'fork';
  /** Said at the unmasking (panel §3 showdown banks). Never a claim about the learner. */
  readonly unmaskLine: string;
}

export interface Venue {
  readonly id: ChapterId;
  readonly name: string;
  readonly rival: RivalId;
  /** The concept cluster the venue is built around. */
  readonly cluster: string;
  /** One sentence of place, shown on the chapter screen. */
  readonly place: string;
  /** What beating the rival teaches (VISION §2.1). */
  readonly lesson: string;
  /** The leak kinds this rival's style punishes, costliest-first routing reads these (route.ts). */
  readonly targets: readonly LeakKind[];
  /** The lesson the dialogue beat comes from, and which of its examples supplies the numbers. */
  readonly beat: { readonly lessonId: string; readonly exampleIndex: number };
}

export const RIVALS: Readonly<Record<RivalId, Rival>> = {
  wren: {
    id: 'wren',
    name: 'Wren Holloway',
    short: 'Wren',
    title: 'the lighthouse keeper',
    archetype: 'nit',
    style: 'Plays few hands, and bets only when the hand is real',
    keepsake: 'wick',
    unmaskLine: 'Lamp’s only lit when the ship is real.',
  },
  barnaby: {
    id: 'barnaby',
    name: 'Barnaby Tull',
    short: 'Barnaby',
    title: 'keeper of the toll road',
    archetype: 'station',
    style: 'Pays almost every bet to see what comes next',
    keepsake: 'ticket',
    unmaskLine: 'Had to see what was round the bend. Always do.',
  },
  percival: {
    id: 'percival',
    name: 'Percival Hush',
    short: 'Percival',
    title: 'the head librarian',
    archetype: 'over-folder',
    style: 'Lets go of most hands the moment a bet arrives',
    keepsake: 'bookmark',
    unmaskLine: 'Shh. I fold when it gets loud. It gets loud a lot.',
  },
  vesper: {
    id: 'vesper',
    name: 'Vesper Kade',
    short: 'Vesper',
    title: 'the night-train conductor',
    archetype: 'lag',
    style: 'Plays wide and keeps betting, street after street',
    keepsake: 'punch',
    unmaskLine: 'Train doesn’t stop. Never has.',
  },
  juniper: {
    id: 'juniper',
    name: 'Juniper Vale',
    short: 'Juniper',
    title: 'the pier pyrotechnician',
    archetype: 'maniac',
    style: 'Bets and raises nearly everything, and big',
    keepsake: 'fuse',
    unmaskLine: 'Who needs a fuse? Light the whole box!',
  },
  ines: {
    id: 'ines',
    name: 'Ines Marlow',
    short: 'Ines',
    title: 'the metronome',
    archetype: 'tag-reg',
    style: 'Sound and balanced: no leak worth chasing',
    keepsake: 'fork',
    unmaskLine: 'Standard. I’d do it again.',
  },
};

/**
 * The default orbit, in the designer's order (panel §4): reads first, arithmetic next, principles last, and
 * the Observatory, where the lesson is not deviating, always at the end.
 */
export const VENUES: readonly Venue[] = [
  {
    id: 'lighthouse',
    name: 'The Lighthouse',
    rival: 'wren',
    cluster: 'A bet that means it',
    place: 'A tower over dark water. The keeper lights the lamp only for a real ship.',
    lesson: 'Her bet means strength: let it go, and take her blinds when she is quiet.',
    targets: ['over-call'],
    beat: { lessonId: 'pot-odds-as-a-price', exampleIndex: 0 },
  },
  {
    id: 'diner',
    name: 'The Toll Road Diner',
    rival: 'barnaby',
    cluster: 'Thin value',
    place: 'An all-night diner at the toll booth. Every traveller pays to see what is down the road.',
    lesson: 'He pays: bet the hands that beat what he calls with, and never bluff him.',
    targets: ['missed-value', 'empty-bluff'],
    beat: { lessonId: 'what-the-actions-mean', exampleIndex: 1 },
  },
  {
    id: 'library',
    name: 'The Library',
    rival: 'percival',
    cluster: 'The price of a bluff',
    place: 'A reading room after hours. A raised voice clears the table.',
    lesson: 'He folds too often for the price: a bet asks the question, and it profits.',
    targets: ['free-fold'],
    beat: { lessonId: 'minimum-defence-frequency', exampleIndex: 0 },
  },
  {
    id: 'night-train',
    name: 'The Night Train',
    rival: 'vesper',
    cluster: 'Defending against barrels',
    place: 'The last carriage of the sleeper. The conductor never stops the train.',
    lesson: 'Widen the defence and let her barrel; do not try to out-bluff her.',
    targets: ['over-fold'],
    beat: { lessonId: 'minimum-defence-frequency', exampleIndex: 1 },
  },
  {
    id: 'pier',
    name: 'The Fireworks Pier',
    rival: 'juniper',
    cluster: 'Trapping and calling down',
    place: 'A pier lit by rockets. She is weather, not a role model.',
    lesson: 'Trap the strong hands and call her down; a raise only folds her bluffs.',
    targets: ['light-raise'],
    beat: { lessonId: 'equity-realisation', exampleIndex: 0 },
  },
  {
    id: 'observatory',
    name: 'The Observatory',
    rival: 'ines',
    cluster: 'Not deviating',
    place: 'A dome with its slit open. The last room of the orbit, and the quietest.',
    lesson: 'No leak to chase: the standard line holds by not inventing one.',
    targets: [],
    beat: { lessonId: 'pot-odds-as-a-price', exampleIndex: 2 },
  },
];

export function venueById(id: string): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

export function rivalOf(venue: Venue): Rival {
  return RIVALS[venue.rival];
}

export function isChapterId(id: string): id is ChapterId {
  return (CHAPTER_IDS as readonly string[]).includes(id);
}

/** What the map, the seat and the dossier call a rival: their name once unmasked, else the venue's regular. */
export function rivalDisplayName(venue: Venue, unmasked: boolean): string {
  return unmasked ? rivalOf(venue).short : `${venue.name}’s regular`;
}
