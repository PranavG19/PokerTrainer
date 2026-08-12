/**
 * SEAT POSITIONS — the poker position label (BTN / SB / BB / UTG…) for each seat, derived exactly the
 * way the engine assigns the button and blinds in startHand.
 *
 * This is a PURE view over the same inputs startHand uses — the dealer index and which seats have
 * chips — so it cannot drift from where the engine actually posts the blinds. It re-derives, rather
 * than re-implements: the SB/BB rule here is copied line-for-line from table.ts (heads-up → SB is the
 * button; otherwise SB is the next funded seat left of the button, BB the next after that), because
 * getting position wrong is worse than showing none. A seat with no chips sits out and gets no label,
 * matching the engine sitting it out of the deal.
 *
 * Labels beyond the blinds are named by PREFLOP ACTION ORDER, which is unambiguous: the first seat to
 * act preflop (left of the BB) is UTG, then UTG+1, and so on around to the button. This avoids the
 * table-size-dependent MP/HJ/CO conventions, which are informal and would be inventing a naming the
 * engine has no opinion on — the app does not fabricate data a module cannot ground.
 */

export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | string;

/** Next seat index left of `from` (wrapping) whose `funded` flag is true, or `from` if none other is. */
function nextFunded(funded: readonly boolean[], from: number): number {
  const n = funded.length;
  for (let step = 1; step <= n; step += 1) {
    const i = (from + step) % n;
    if (funded[i]) return i;
  }
  return from;
}

/**
 * Position labels indexed by seat id. A funded seat gets its label; an unfunded (sitting-out) seat gets
 * null. `dealer` is the button seat; `funded[i]` is whether seat i has chips (the engine's own test for
 * who is dealt in). Mirrors startHand's blind assignment so BTN/SB/BB always match where blinds post.
 */
export function seatPositions(dealer: number, funded: readonly boolean[]): (Position | null)[] {
  const n = funded.length;
  const labels: (Position | null)[] = new Array(n).fill(null);
  const fundedCount = funded.filter(Boolean).length;
  if (fundedCount < 2 || dealer < 0 || dealer >= n || !funded[dealer]) return labels;

  // Heads-up: the button is the small blind (table.ts isHeadsUp branch).
  const headsUp = fundedCount === 2;
  const sb = headsUp ? dealer : nextFunded(funded, dealer);
  const bb = nextFunded(funded, sb);

  labels[dealer] = 'BTN';
  labels[sb] = 'SB';
  labels[bb] = 'BB';

  // Everyone else, in preflop action order starting left of the BB: UTG, UTG+1, … The seat just before
  // the button is the last of these. Heads-up has no such seats (BTN and BB cover both funded seats).
  let seat = nextFunded(funded, bb);
  let order = 0;
  while (labels[seat] === null) {
    labels[seat] = order === 0 ? 'UTG' : `UTG+${order}`;
    order += 1;
    seat = nextFunded(funded, seat);
  }
  return labels;
}
