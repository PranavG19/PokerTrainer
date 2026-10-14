/**
 * ICM: what a stack is worth in prize money, by the Malmuth-Harville model. A player finishes first with
 * probability stack / total; given who finished above, the next place goes the same way among those
 * left. Each player's equity is the sum over places of P(that place) x the payout for it.
 *
 * Exact, by dynamic programming over the set of players already placed (2^n x n steps; 10 players is
 * ~10k states). Payouts are shares of the pool
 * in any unit; equities come back in the same unit.
 *
 * A stack of 0 is a player who has JUST busted (lost an all-in in the hand being priced): they finish
 * below everyone still alive, so they take the places after the live players, shared evenly when more
 * than one busts at once. Players already out of the tournament are not passed in at all.
 */

export const MAX_ICM_PLAYERS = 10;

export function icmEquities(stacks: readonly number[], payouts: readonly number[]): number[] {
  const n = stacks.length;
  if (n > MAX_ICM_PLAYERS) throw new RangeError(`ICM over ${n} players`);
  for (const s of stacks) if (!(s >= 0) || !Number.isFinite(s)) throw new RangeError(`stack ${s}`);
  for (const p of payouts) if (!(p >= 0) || !Number.isFinite(p)) throw new RangeError(`payout ${p}`);
  const eq = new Array<number>(n).fill(0);
  const alive = stacks.filter((s) => s > 0).length;
  const places = Math.min(payouts.length, alive);
  const total = stacks.reduce((a, b) => a + b, 0);

  // DP over who has already finished: reach[mask] = P(the players in `mask` took the top |mask| places,
  // in some order). The next place goes to i among the rest with probability stack_i / chips left. This is
  // the same Harville sum as walking every finishing order, in 2^n x n steps instead of n! / (n - places)!.
  if (total > 0 && places > 0) {
    const size = 1 << n;
    const reach = new Float64Array(size);
    const left = new Float64Array(size);
    const count = new Uint8Array(size);
    reach[0] = 1;
    left[0] = total;
    for (let mask = 0; mask < size; mask++) {
      const p = reach[mask];
      if (p === 0) continue;
      const place = count[mask];
      if (place >= places) continue;
      const chips = left[mask];
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i) || stacks[i] === 0) continue;
        const q = (p * stacks[i]) / chips;
        eq[i] += q * payouts[place];
        const next = mask | (1 << i);
        if (reach[next] === 0) {
          left[next] = chips - stacks[i];
          count[next] = place + 1;
        }
        reach[next] += q;
      }
    }
  }
  const busted = n - alive;
  if (busted > 0) {
    let pool = 0;
    for (let place = alive; place < Math.min(payouts.length, n); place++) pool += payouts[place];
    for (let i = 0; i < n; i++) if (stacks[i] === 0) eq[i] = pool / busted;
  }
  return eq;
}

/**
 * The bubble factor of `hero` against `villain`: what losing an all-in between them costs hero in prize
 * equity, over what winning it gains. 1 in a winner-take-all or chip-EV world; above 1 near the money.
 * Calling off with no dead money needs equity BF / (1 + BF). Null when either player has no chips.
 */
export function bubbleFactor(stacks: readonly number[], payouts: readonly number[], hero: number, villain: number): number | null {
  const risk = Math.min(stacks[hero], stacks[villain]);
  if (!(risk > 0) || hero === villain) return null;
  const now = icmEquities(stacks, payouts)[hero];
  const win = stacks.slice();
  win[hero] += risk;
  win[villain] -= risk;
  const lose = stacks.slice();
  lose[hero] -= risk;
  lose[villain] += risk;
  const gain = icmEquities(win, payouts)[hero] - now;
  const loss = now - icmEquities(lose, payouts)[hero];
  return gain > 0 ? loss / gain : null;
}

/** The equity a pure call-off needs at a given bubble factor. */
export function requiredEquity(bf: number): number {
  return bf / (1 + bf);
}
