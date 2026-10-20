/**
 * NAVIGATION (1.14, owner D9 as decided): seven sections, Home · Play · Learn · Story · Train · Study · You, and a
 * You sub-nav of Profile · Trophies · Style · Hands · Letters · Rivals · Locker · Dee. The twelve tabs before it fold
 * in, and nothing is locked (N1): every destination is one or two clicks from anywhere, at 900 px.
 *
 * A destination ("leaf") is what main.ts renders; a section is what the bar highlights. Every leaf that used to be
 * a tab keeps its old testid on whatever button now opens it (a section tab, a sub-nav button, a Train rail rung or
 * the title-bar Settings button), so a spec that clicked it needs at most one click on the parent first.
 *
 *  - Home       the old Play tab's launcher: greeting, streak, ring, Ticket, the launch rows, recent hands
 *  - Play       the tables and their panels (solo, friends, online, assessment, variance) and the planner
 *  - Learn      lessons and the Folio; Story the Long Orbit; Train the hub, Charts now a rung of it
 *  - Study      Bank · Equity · Ranges · Dossier · Pro (the reference tools, and the Pro hand-history tools)
 *  - You        the owner's eight, plus Progress (opened from Profile) and the hand log under Hands
 *  - Settings   a title-bar button, not a section
 *
 * Pure data, no DOM: tests/unit/nav.test.ts checks the folding.
 */

export type Section = 'home' | 'play' | 'learn' | 'story' | 'train' | 'study' | 'you';

export type Leaf =
  | 'home'
  | 'play'
  | 'learn'
  | 'story'
  | 'train'
  // Study
  | 'chart-bank'
  | 'equity'
  | 'ranges'
  | 'dossier'
  | 'pro'
  // You
  | 'profile'
  | 'trophies'
  | 'style'
  | 'hands'
  | 'letters'
  | 'rivals'
  | 'locker'
  | 'dee'
  | 'progress'
  // The title bar
  | 'settings';

export const SECTIONS: readonly { id: Section; label: string; testid: string; leaf: Leaf }[] = [
  { id: 'home', label: 'Home', testid: 'tab-home', leaf: 'home' },
  { id: 'play', label: 'Play', testid: 'tab-play', leaf: 'play' },
  { id: 'learn', label: 'Learn', testid: 'tab-learn', leaf: 'learn' },
  { id: 'story', label: 'Story', testid: 'tab-story', leaf: 'story' },
  { id: 'train', label: 'Train', testid: 'tab-train', leaf: 'train' },
  { id: 'study', label: 'Study', testid: 'tab-study', leaf: 'chart-bank' },
  { id: 'you', label: 'You', testid: 'tab-you', leaf: 'profile' },
];

/** Dividers before these, as the mock draws them: play · practice · you. */
export const SECTION_GROUP_STARTS: ReadonlySet<Section> = new Set<Section>(['train', 'you']);

export interface SubNavItem {
  readonly leaf: Leaf;
  readonly label: string;
  readonly testid: string;
}

export const STUDY_NAV: readonly SubNavItem[] = [
  { leaf: 'chart-bank', label: 'Bank', testid: 'tab-chart-bank' },
  { leaf: 'equity', label: 'Equity', testid: 'tab-equity' },
  { leaf: 'ranges', label: 'Ranges', testid: 'tab-ranges' },
  { leaf: 'dossier', label: 'Dossier', testid: 'tab-dossier' },
  { leaf: 'pro', label: 'Pro', testid: 'tab-pro' },
];

/** The owner's You sub-nav, in order. */
export const YOU_NAV: readonly SubNavItem[] = [
  { leaf: 'profile', label: 'Profile', testid: 'tab-profile' },
  { leaf: 'trophies', label: 'Trophies', testid: 'tab-trophies' },
  { leaf: 'style', label: 'Style', testid: 'tab-style' },
  { leaf: 'hands', label: 'Hands', testid: 'tab-hands' },
  { leaf: 'letters', label: 'Letters', testid: 'tab-letters' },
  { leaf: 'rivals', label: 'Rivals', testid: 'tab-rivals' },
  { leaf: 'locker', label: 'Locker', testid: 'tab-locker' },
  { leaf: 'dee', label: 'Dee', testid: 'tab-dee' },
];

/** The section a leaf lives in (null: the title bar's Settings, which highlights no section). */
export function sectionOf(leaf: Leaf): Section | null {
  if (leaf === 'settings') return null;
  if (STUDY_NAV.some((i) => i.leaf === leaf)) return 'study';
  if (YOU_NAV.some((i) => i.leaf === leaf) || leaf === 'progress') return 'you';
  return leaf as Section;
}

/** The sub-nav a leaf's screen carries, or null. Progress sits under You and shows You's bar (Profile lit). */
export function subNavOf(leaf: Leaf): readonly SubNavItem[] | null {
  const s = sectionOf(leaf);
  return s === 'study' ? STUDY_NAV : s === 'you' ? YOU_NAV : null;
}

/** The sub-nav item lit for a leaf (Progress is opened from Profile, so Profile stays lit). */
export function litSubItem(leaf: Leaf): Leaf {
  return leaf === 'progress' ? 'profile' : leaf;
}

/**
 * The thirteen old tabs (twelve, plus Pro from the Pro-tools work), and how each one's DESTINATION is reached now: the testids to press, in order, from any
 * screen. Two destinations moved under a new name, deliberately: the old Play tab's launcher is Home (the tables
 * stay under Play), and the old Profile screen (the session record, with its bankroll graph) is You › Hands,
 * because the new Profile shows decisions, never results.
 */
export const OLD_TABS: Readonly<Record<string, readonly string[]>> = {
  'tab-play': ['tab-home'],
  'tab-learn': ['tab-learn'],
  'tab-story': ['tab-story'],
  'tab-train': ['tab-train'],
  'tab-charts': ['tab-train', 'tab-charts'],
  'tab-chart-bank': ['tab-study', 'tab-chart-bank'],
  'tab-equity': ['tab-study', 'tab-equity'],
  'tab-ranges': ['tab-study', 'tab-ranges'],
  'tab-dossier': ['tab-study', 'tab-dossier'],
  'tab-pro': ['tab-study', 'tab-pro'],
  'tab-progress': ['tab-you', 'tab-progress'],
  'tab-profile': ['tab-you', 'tab-hands'],
  'tab-settings': ['tab-settings'],
};
