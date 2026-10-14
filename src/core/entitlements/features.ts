/**
 * Tiers and features (owner's tier decisions, DECISIONS.md "Pro and licensing").
 *
 * Free is the whole trainer. Pro is only what costs money to run or is a power tool on top of learning:
 * online ranked play and seasons (the server bill), the hand-history leak finder, ICM / push-fold, and
 * cloud sync. Nothing else is ever sold: no cosmetics, currency, streak freezes, boosts or randomness.
 *
 * Every feature is listed here, Free ones included, so `can()` is total and a Free feature can never be
 * locked by accident: its tier is 'free', and every snapshot grants Free (entitlements.ts).
 */

export const TIERS = ['free', 'pro'] as const;
export type Tier = (typeof TIERS)[number];

export const FREE_FEATURES = ['trainer', 'dee', 'local-chat', 'lan-play', 'earned-cosmetics'] as const;
export const PRO_FEATURES = ['ranked-play', 'leak-finder', 'icm-tools', 'cloud-sync'] as const;

export type FreeFeature = (typeof FREE_FEATURES)[number];
export type ProFeature = (typeof PRO_FEATURES)[number];
export type Feature = FreeFeature | ProFeature;

export interface FeatureInfo {
  readonly tier: Tier;
  readonly title: string;
  /** One honest line: what it is, not what you are missing. */
  readonly blurb: string;
  /** Shipped in this build. A Pro feature that is not is labelled "Coming in an update", never implied. */
  readonly available: boolean;
}

export const FEATURE_INFO: Readonly<Record<Feature, FeatureInfo>> = {
  trainer: {
    tier: 'free',
    title: 'The whole trainer',
    blurb: 'Every table, drill, lesson, puzzle, chart and review.',
    available: true,
  },
  dee: { tier: 'free', title: 'Dee', blurb: 'Your coach at the table, with everything Dee remembers.', available: true },
  'local-chat': {
    tier: 'free',
    title: 'Chat on this Mac',
    blurb: 'Ask Dee about a hand; an optional model on this Mac can reword the answers.',
    available: true,
  },
  'lan-play': { tier: 'free', title: 'Play friends nearby', blurb: 'Host or join a table on your own network.', available: true },
  'earned-cosmetics': {
    tier: 'free',
    title: 'Everything you earn',
    blurb: 'Card backs, felts and finishes, each earned by a decision. Never sold.',
    available: false,
  },
  'ranked-play': {
    tier: 'pro',
    title: 'Online ranked play and seasons',
    blurb: 'Play people anywhere, ranked, in seasons. Pro pays for the servers this needs.',
    available: false,
  },
  'leak-finder': {
    tier: 'pro',
    title: 'Leak finder',
    blurb: 'Import hand histories from where you play and see where your frequencies leave the charts.',
    available: true,
  },
  'icm-tools': {
    tier: 'pro',
    title: 'ICM and push-fold',
    blurb: 'Tournament equity and shove charts for short stacks.',
    available: true,
  },
  'cloud-sync': {
    tier: 'pro',
    title: 'Cloud sync',
    blurb: 'Your profile on every Mac you use, backed up off this one.',
    available: false,
  },
};

export function isFeature(value: unknown): value is Feature {
  return typeof value === 'string' && Object.hasOwn(FEATURE_INFO, value);
}

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/** The features a tier grants. Pro includes Free: a tier only ever adds. */
export function featuresOf(tier: Tier): readonly Feature[] {
  return tier === 'pro' ? [...FREE_FEATURES, ...PRO_FEATURES] : FREE_FEATURES;
}
