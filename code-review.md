# Review: fix/mp-deal-security
Verdict: PASS WITH NOTES
Base: 2b28855  Head: f9e75c2

This is the final review after three rounds. Every Act-on item from rounds 1 and 2 is fixed and was
checked again at f9e75c2. My temporary attack tests (`tests/unit/zz-review4.test.ts` and
`tests/unit/zz-review5.test.ts`) have been deleted, and the tree is clean. History was rewritten again, so
this head is f9e75c2, not a80620c.

## Status of earlier findings

**Round-2 Act-on items**

- **R2-1. A busted player who stays gets a free rebuy: FIXED.**
  - What changed: newcomers are detected by `RelayServer.seatedAt` (relayServer.ts:108-109, :272). That
    map records every seat's occupant at each completed deal, whether or not the seat was dealt in. It is
    taken from `pending.occupants` (:293, :358), so a restarted deal recomputes the base and never
    stacks two buy-ins.
  - Proof: dealCommit.test.ts "a player who busts and stays is not bought in again" passes; it checks
    chips each hand for 30 hands.
  - My check E1: seat 2 busts and stays. Next deal it is not dealt and chips stay 15000.
  - My check E1b: the player then leaves and a new player joins that seat. The newcomer is bought in at
    5000 (chips 20000), which is the intended rejoin behaviour.
  - My check E2: a newcomer arrives, the deal restarts on a timeout, then another newcomer arrives.
    Chips go from 10000 to 15000, which is exactly one buy-in.
  - First hand: `handNumber > 0` guards it, and the seats are built from `createTable`.
- **R2-2. A guest leaving mid-hand stalls the table: FIXED.**
  - What changed: `foldAbsent` (multiplayer.ts:301-321) runs at the top of every `broadcastState`
    (relayServer.ts:144-148). It folds through the engine when the turn sits on a seat whose `dealtTo`
    owner is neither connected nor the dealer.
  - Proof: dealCommit.test.ts "a guest who leaves mid-hand is folded…" and "a heads-up opponent leaving…"
    pass.
  - My checks:
    - D1, 4 seats: two seats in a row leave. Both are folded when the turn reaches them, and the player
      to act is not folded. The hand finishes with no guest violations.
    - D2: a leaver who is already all-in is not folded. The hand settles, and that seat can win the pot
      (it won 14850); chips are conserved.
    - D3, side pot: a short stack is all-in, a deep stack is all-in, and a third seat leaves facing the
      bet. It is folded at its turn, and the main pot and side pot settle correctly (15050 before and
      after).
    - D4: a leaver during a pending deal causes no fold. The previous hand is settled, so it is a no-op,
      and the redeal is clean.
    - D5: the dealer's in-process seat is never folded across 4 hands.
  - Looping: the loop is bounded by `seatCount`. Each absent seat folds at most once, `isHandOver` and
    `settle` stop it, and `fold` is always legal while the seat may act (table.ts:285).
- **Guard `k` and "fifty-fifty" false positives (Consider): FIXED.**
  - "9 K 2", "3k-high" and "fifty-fifty" are no longer read as numbers.
  - "1k", "1.5k", "3k" and "2k, 3k" are still caught.
  - Proof: my check F.

**Round-1 Act-on items, still fixed at f9e75c2**

- A1, entropy left out: now a violation, and warnings persist.
- A2, `isYou` spectator bypass: the seat is held once learned.
- A3, a malformed frame throws: shapes are checked, with a try/catch behind them.
- A4, a false violation for a newcomer during a pending deal: `dealtTo` comes from the recipients.
- A5: an engine throw now becomes an error.
- A8: handshakes are capped per address.
- A9: spelled-out numbers have their own check, and the post-reveal path keeps it.
- Sigma binds the dealer and the deal order.
- The oracle covers `dns.promises` and `sh -c`.
- The `node_modules` symlink and the `wip:` commit are gone.

The round-2 proofs (B1 to B5) still hold: the unit suite is green at this head.

## Consider
- **src/core/relayGuest.ts:208-212. "Verified" covers the cards only.**
  - Winners, pot and stacks are taken from the host, though the guest holds every showdown card and
    the board.
  - Tradeoff: a few lines with the existing evaluator, against a label that suggests more than it checks.
- **src/core/relayServer.ts:238-245 with relayGuest.ts:121-125. A guest can be removed and rejoin
  repeatedly.**
  - A guest that commits and never reveals is removed after 10 s, and can then rejoin with the same
    invite.
  - Each cycle costs about 10 s per hand.
  - It also shows honest guests "the host restarted a deal" warnings that blame the host.
  - Tradeoff: a rejoin cool-down, and a warning that names the removed seat.
- **src/core/relayServer.ts:266-274. A rejoin is a rebuy.**
  - A busted player can leave and rejoin to get a fresh `startStack`.
  - A player who leaves with chips loses them: an absent seat is zeroed at the next deal, which includes
    an all-in leaver's winnings, as in D2.
  - This is intended ("rejoining should buy in"), but no UI tells the player.
  - Tradeoff: hold a leaver's stack for a rejoin under the same name, against having no persistent
    identity.

## Noted
- After a restart, a late commitment gets "no deal is waiting for that commitment" as an error toast. It
  is noise, not harm.
- A LAN peer with 8 or more IPv4 aliases can still hold all 32 slots, each for `HELLO_TIMEOUT_MS`.
- Heads-up, after one player busts nothing is dealt until a newcomer joins (`dealOrder.length < 2`), and no
  UI message says so.
- The guard's `k` rule is now lowercase only, so "2K" is read as just `2`, which the digit provenance
  check still runs on. "a dozen" and "half" are out of scope, as declared.
- Whether an absent seat is folded depends on the turn reaching it. An absent seat that never gets the turn
  again (others all-in) stays in to showdown. That matches table rules, but its winnings then leave with
  the seat.
- DECISIONS.md records that `npm run e2e` fails at `electron.launch` in this checkout. AGENTS.md "Done"
  requires e2e to pass, so that is unmet here. Electron was not run, per the brief.

## Dismissed
- **foldAbsent can fold a present player's seat.**
  - Proof: it breaks when `present.has(dealtTo[toAct])`, and `present` is everyone connected plus the
    dealer.
  - Every dealt seat has a `dealtTo` owner, because unoccupied seats are zeroed and `recipients` is
    everyone connected.
  - D1 and D5 confirm it.
- **foldAbsent folds during the pending phase.** Proof: during a pending deal `room.table` is the
  previous, already-settled hand (`winners !== null`), or null before the first hand. D4 confirms it.
- **foldAbsent mis-settles side pots or loops.** Proof: it folds only through `applyAction` and `settle`,
  and the loop is bounded by `seatCount`. D3 conserves chips across a main pot and a side pot.
- **seatedAt misfires on the first hand, on a restart, or on bust-leave-rejoin.** Proof: the
  `handNumber > 0` guard; `occupants` is recomputed on each `beginDeal` and committed only in
  `finishDeal`; and E1, E1b and E2.
- **Round-1 and round-2 dismissals stand.** These cover unseen-card leaks, sigma grinding, the token sent
  before the pin, the handshake sniff, the counter leak, false violations from guest seat rules, and solo
  determinism.

## Verification
- At f9e75c2, after deleting my temporary files:
  - `npm run typecheck` exits 0.
  - `npx vitest run --exclude tests/unit/perf.test.ts` exits 0, with 88 of 88 files and 1852 of 1852
    tests passing.
- Temporary tests, now deleted:
  - D1 to D5 for foldAbsent: consecutive leavers, an all-in leaver, a side pot (the D3 run was redone with
    a legal all-in after a harness misstep in my own script), pending, and the dealer seat.
  - E1, E1b and E2 for seatedAt.
  - F for the guard `k` and fifty-fifty rules.
- Not run: e2e and Electron.
- Untested by the branch's suite: a leaver who is all-in and wins (their chips disappear at the next
  deal); side pots with an auto-fold; and the guard's `k` card-text cases (only "fifty-fifty" was added to
  guard.test.ts).
