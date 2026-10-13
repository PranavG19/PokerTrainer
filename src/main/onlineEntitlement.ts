/**
 * THE SEAM for ranked online play being a Pro feature (VISION tiers; feature id 'ranked-play').
 *
 * The entitlements core (`src/core/entitlements/`, `can(snapshot, feature)`) is being built in parallel and
 * is not on main yet. Until it lands, this is the single place ranked play is allowed or refused: replace
 * the body with `can(currentEntitlements(), 'ranked-play')` and nothing else changes — main's request
 * gate (onlineMain.ts) and the Play online screen both read it.
 *
 * It returns true today: no licence exists to check, and a ranked table needs an online server, which
 * nobody has until the owner deploys one. The server cannot verify a licence either; that is an open
 * question (FINDINGS), not a property this seam provides.
 */
export function rankedEntitled(): boolean {
  return true;
}
