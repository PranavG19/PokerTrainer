# Review: feat/online-server (e3e58df)
Verdict: PASS WITH NOTES (re-verified at 894080a: A1-A5, A7-A9 fixed, A6 recorded as the owner's call; no Act-on remains)
Base: 0e9fd0780faecf7314c2bda1ad73cb570e0e9bd7  Head reviewed: e3e58dfe247aa5b5e8238349208f107e87c4a9a8  Re-verified: ff5c28a, 1ec6c3d, then 894080a

The Act-on items are numbered A1-A8 in the order below, and A9 is new at 1ec6c3d. Each carries its end state; the latest check is at 894080a.

Probes were written under `tests/tmp/` (git-ignored) and run with `npx vitest run --config /tmp/osv-review/vitest.config.mjs --root .`.
Copies are kept in `/tmp/osv-review/*.test.ts`, and `tests/tmp/` has been removed. Note: while this review ran, another agent
committed 680886c (renderer only: `src/renderer/**`, `tests/e2e/online.spec.ts`, `tests/unit/online-screen.test.ts`) on top
of e3e58df in this worktree. No file under `server/`, `src/core/` or `src/main/` changed, so every probe below exercises e3e58df's code.

## Act on (all resolved at 894080a; kept with their end states for the record)

- **src/core/relayGuest.ts:138-157 (onResync) + src/main/onlineClient.ts:141. A server can stack the deck against a player by
  forcing one reconnect.** `open()` builds a fresh `GuestProtocol` on every connection, and a fresh protocol accepts any
  internally consistent `resync`. The only own-entropy check is `memory.revealed(nonce)`, and `remember` runs only at REVEAL
  time (:196). So a server that drops the player's socket after the player commits but before it reveals (or one talking to an
  app that was restarted, which empties the in-memory `revealed` map) can deal the player a hand with no entropy from the player,
  grind that deal until it likes the outcome, and replay it. The live path rejects `set === null` (:207, "dealt without
  publishing the entropy commitments"), but onResync accepts `set: null, reveals: []`, a deal the server chose alone. This
  breaks the guarantee DECISIONS.md "Protocol" gives: "protects players from an operator or a compromised server stacking a
  deck". An honest server never needs this, because a held player is not a deal recipient (relayServer.ts beginDeal:
  `recipients: new Set(this.connected)`).
  Probe `resync-stack.test.ts`: it ground deals until the victim held two cards below 9, then fed the resync and the state to a
  fresh guest:
  `tries 5 victim hole 8s 5s resync events [] state events state` (no violation). With `set=null, reveals=[]` the output is
  `resync: []` (accepted).
  Fix: remember entropy at COMMIT time (nonce → entropy), and persist it across app restarts or bound it per server. When a
  resync's nonce has no remembered entropy, accept it as watch-only, like the `live === null` branch at :232-240: no own hole
  before showdown, never `yourTurn`. Reject `set === null` whenever `reveals` is non-empty or the view deals this guest in.
  - **A1, fixed (verified at ff5c28a).** Entropy is now remembered at commit (relayGuest.ts:183), `set === null` is a
    violation, and a resync with no remembered entropy plays on with a visible `warning` (relayGuest.ts:162).
    Re-run of `resync-stack.test.ts`:
    - unremembered resync gives `[{"type":"warning","reason":"You rejoined a hand dealt before you reconnected…"}]`;
    - `set=null` gives `violation … dealt without publishing the entropy commitments`;
    - `remembered at commit? true`;
    - committed-but-left-out gives `violation … the host dealt without the entropy you revealed`.

    The remaining limit is in Noted.

- **server/store.ts:266-285 and :291-307, reached from server/lobby.ts:379-386 before the profile check (:388). Export and
  forget are synchronous full-ledger passes that any signed-in key can trigger.** A key that has never set a name can send
  `export` 10 times a second (burst 30). Each request runs `readFileSync` + `JSON.parse` on every line of both ledgers on the
  event loop. Each `forget` also rewrites and fsyncs every ledger, even for a key that has nothing stored, then the client
  reconnects (30 a minute per address) and repeats. Every table's clock, deal handshake and socket stalls meanwhile.
  Probe `store-scale.test.ts`: a 95.5 MB ledger (200k decisions) gives `export ms 233` and `forget (unknown key) ms 409`.
  Probe `export-dos.test.ts`, on the real server: a 53 MB ledger and one unnamed key sending a 30-frame burst of `export` gives
  `bystander ladder reply after 3656 ms`.
  At about 1.1M decision lines (about 475 B each) `readFileSync(..., 'utf8')` exceeds V8's string limit and throws. The throw
  happens in the Rankings constructor too (rankings.ts:103), so startup would crash-loop.
  Fix: require a player row and add a per-key cooldown for export and forget (for example one per minute). Keep a per-key
  index or per-key files instead of rescanning. Stream the ledger by line (readline) rather than reading it as one string.
  Do the forget rewrite off the hot path, or batch it.
  - **A2, fixed (verified at 1ec6c3d).** At ff5c28a it was fixed only in part, history below.
    1ec6c3d does one scan at page 0 and caches it per key for 5 minutes. Later pages come only from that cache, in order,
    each once. Export starts and erasures are limited per key and per network, within a server-wide budget of 4 scans a
    minute.
    Re-run of `export-dos.test.ts` (53 MB, a 30-frame burst of pages 5000, 5001, 1, 1, 3, 2, 7000…7023 after page 0):
    - `bystander ladder reply after 21 ms` (it was 4170 ms);
    - `5000:refused 5001:refused 1:served 1:refused 3:refused 2:served 7000…7023:refused`.

    Re-run of `forget-sybil.test.ts` (6 fresh keys, one network): `ok,Try that again in a minute.×5 took 763 ms` (it
    was 4371 ms). The budget brings in a new problem: see A9.
    History at ff5c28a:
    - Fixed: export and forget now need a player row; page 0 and forget may each start once a minute per key; ledgers are
      streamed. Re-run: `unnamed export -> This server holds nothing about this key.` and
      `second page 0 -> Try that again in a minute.`
    - **New bypass: page > 0 is not limited at all.** For 5 minutes after any page 0, `continuing` skips the limiter
      (lobby.ts:402-405). `page` may be anything up to 10,000, and every page is a full scan of both ledgers. One named
      key does page 0 once, then floods page 5000, 5001, … at the frame rate.
      Probe `export-dos.test.ts` (53 MB ledger, 30 frames): `page>0 burst: bystander ladder reply after 4170 ms` and
      `page>0 burst replies ok: 30 of 30`. That is the same 3.7 s stall as before the fix.
    - **Per-key limits do not bound the work, because keys and names are free.** Each new connection (30 a minute per
      address) can be a fresh key that sets a name and forgets once. The streamed rewrite is also slower than before:
      `forget (unknown key) ms 1213` on 95 MB (`store-scale.test.ts`; it was 409 ms).
      Probe `forget-sybil.test.ts`: `6 fresh-key forgets: ok,… took 4371 ms of event loop (ledger 52 MB)`.
      At 30 a minute from one address that is about 22 s of blocked loop per minute.
    - Fix:
      - Accept only `page < pages`, each page once, in order, after its own page 0 (or cache the page-0 scan per key for
        the window and serve later pages from it).
      - Add a server-wide budget on concurrent or per-minute scans, plus a per-address limit for export and forget.
      - Move the forget rewrite and the export scan off the event loop (a worker, or a queued job that replies when
        done).

- **src/core/online/protocol.ts:35 + server/store.ts:266 (`limit = 3000`) + src/main/onlineClient.ts:165. A regular player
  cannot export their data.** One decision row with its `GradeInput` is about 380 B, so 3,000 decisions alone exceed
  `MAX_SERVER_FRAME` (1 MiB). The client then treats the reply as hostile: "The server sent a message too large to read".
  It drops the connection and reconnects, and the export promise rejects. The right of access in docs/PRIVACY-ONLINE.md
  ("Export your server data") fails for anyone with roughly 2,700 or more ranked decisions in the two kept seasons.
  Probe `export-dos.test.ts` part 1 (3,000 decisions + 1,500 hands for the player):
  `heavy player export -> rejected: The connection to the server closed. | ... "reconnecting:The server sent a message too large to read."`
  (`store-scale.test.ts`: `reply chars 1403258 MAX_SERVER_FRAME 1048576 over? true`).
  Fix: page the export (a cursor request) or bound it by bytes, with a test at the cap.
  - **A3, fixed (verified at ff5c28a).** The export is paged (`EXPORT_PAGE` 1000) and main joins the pages (onlineMain.ts
    `exportAll`).
    Re-run of `export-dos.test.ts`: `heavy: decisionCount 3750 pages 4 largest page chars 467256`.
    `store-scale.test.ts`: `pages 4 reply chars 523294 … over? false`.

- **server/rankings.ts:95-96, :104, :109-118. A restart across a month boundary loses the finished season.** The constructor
  sets `this.season = seasonOf(now())` directly. The previous season's results are saved only by `rollover()`, which runs
  lazily on a request or a grade in a process that was already running when the month turned. If the server restarts before
  any such call (a deploy, the 04:30 unattended-upgrade reboot, a crash), those results are never saved. Next month `prune()`
  then deletes that season's ledger. That breaks the store's documented invariant "Their results must already be saved"
  (store.ts:240) and the privacy doc's "keeping only each player's final figure for each finished season".
  Probe `rollover.test.ts` (250 rated decisions in 2026-09, restart at 2026-10-01 00:30):
  `after restart in Oct: results(2026-09) = undefined | seasonView.last = null`. Then:
  `Nov: ledger files =  | results keys = 2026-10 | Sept result for k = undefined`.
  Fix: at startup, for every ledger season older than the current one with no `results` row, compute the results from its
  ledger and save them before `prune` runs. Add the restart-across-boundary test.
  - **A4, fixed (verified at ff5c28a).** `openSeason` closes every earlier season that has no results, from its own ledger,
    before `prune` runs.
    Re-run of `rollover.test.ts`:
    - `after restart in Oct: results(2026-09) = {"AAAA…":{"decisions":250,…,"rated":true}} | seasonView.last = {…250…}`;
    - `Nov: ledger files =  | results keys = 2026-09,2026-10 | Sept result for k = {"decisions":250,…}`.

- **server/lobby.ts:136-141 + server/rankings.ts:172, :188. `forget` does not erase "every ledger line naming the key".**
  The opponents list is read from `dealtTo` at each decision. When a player forgets mid-hand, the others' later decisions in
  that hand are graded after the rewrite and store the forgotten key in `opp`. `ingest` also puts the key back into the
  in-memory `pairs`. `grade()` checks only `job.key`.
  Probe `ranked-cheats.test.ts` #2 (3-handed ranked, Di forgets on the first live state):
  `ledger lines naming the forgotten key after forget: 7 {"k":"8WWP…","opp":[…]}` and `in-memory pairs still naming it: true`.
  This contradicts DECISIONS.md "Identity" and docs/PRIVACY-ONLINE.md "every ranked record naming you".
  Fix: in `grade()`, filter `job.opponents` to known keys, and do the same in `submit` or `ingest`. Add a mid-hand forget test.
  - **A5, fixed (verified at ff5c28a).** Opponents erased before grading are filtered out (rankings.ts `grade`).
    Re-run of `ranked-cheats.test.ts` #2: `ledger lines naming the forgotten key after forget: 0` and
    `in-memory pairs still naming it: false`.

- **src/core/online/ranked.ts (score) + src/core/coach.ts:65-130. A ~15-line bot that applies the shipped grader's thresholds
  takes first place on the ladder.** The grader charges nothing for: calling or raising when equity ≥ the pot-odds price,
  folding when equity ≤ the price, betting or shoving any size with equity ≥ 0.35 when no bet is faced, and checking otherwise
  (except a late-street check above 0.55). Bet size is never graded. The client has every input:
  - its hole, the board, the pot and the price, from the view;
  - `VILLAIN_BETTING_RANGE` and the equity code, shipped in the app;
  - the exact Monte Carlo seed, which `decisionSeed(nonce, index)` (ranked.ts:82) derives from the commit nonce the client
    receives.
  So an automated client scores exactly 0 bb/100, with low = high = 0. The ladder sorts on `high` (ranked.ts:219), so that
  bot is first. MIN_OPPONENTS and PAIR_CAP do not stop it, because keys are free: three throwaway keys cover MIN_OPPONENTS, and
  the shared-network signal is per exact IP, flag-only.
  Probe `ranked-cheats.test.ts` #1 (25 hands each, real server; the bot uses its own seed rather than the server's, so
  borderline spots add noise):
  `BOT decisions 58 nonzero 0 bb/100 0.00`, `BOT decisions 54 nonzero 1 bb/100 5.26`, against
  `HUMAN decisions 96 nonzero 22 bb/100 4.73` (check/call players).
  The DECISIONS "Ranked" section says no client value enters the score, but it never considers a client that simply plays the
  grader. A public ladder that measures "agreement with an open grader" is won by automation or real-time assistance. The
  app's own solo coach already shows these verdicts.
  Fix, owner decision required: at minimum, record this limitation in DECISIONS.md and the ladder copy. Stop exposing the exact
  seed (derive it from a server-secret salt). Consider showing the season ladder only within leagues, or grading against a
  stronger, hidden evaluation.
  - **A6, now Noted (recorded at 1ec6c3d).** The seed is an HMAC under `gradeSecret` (ff5c28a). DECISIONS.md "Ranked"
    now states "Known limit, the owner's call: a scripted player can sit near 0 bb/100", with the default taken (no
    prizes, invite-only) and what a public ladder would need. The ff5c28a re-run of the bot is unchanged:
    `BOT … 0.00` twice, against `HUMAN … 4.28 / 3.46`. That result is what is recorded; there is no code defect left.

- **server/transport.ts:129-130, :139-140, :218-219 + server/lobby.ts:95-107. Raw IP addresses stay in memory forever, which
  contradicts docs/PRIVACY-ONLINE.md** ("Held in memory only while connected") **and grows the heap without bound.** Every
  connecting address gets an `attempts` Bucket and every failed sign-in an `authFailures` row. Neither is ever deleted, so a
  visitor's IP stays in process memory until the next restart. The lobby's `failedJoins` and `created` Windows keep one entry
  per key and per netTag, and an entry is cleaned only if that same id is counted again. Keys are free, so every Sybil key
  leaves an entry. Under the 400 MB `MemoryMax`, growth ends in an OOM restart that drops every table.
  Fix: sweep these maps on the existing ticker. Drop a bucket once it is full again, an authFailures row once `until` has
  passed, and Window ids with no hits inside the window. Correct the doc if any of this is kept.
  - **A7, fixed (verified at ff5c28a; checked by code reading and the red-to-green test, with no new probe).**
    `sweepAddresses` runs once a second: it drops an `attempts` bucket once no socket from that address is open and the
    bucket is full again, and an `authFailures` row once `until` has passed. `Lobby.sweep` clears the Windows and
    `exporting`. Strikes decay by 10 a minute. The privacy doc now says "dropped within a few minutes".
    online-review-fixes.test.ts "7. addresses are not kept…" passes.

- **src/main/onlineIdentity.ts:53-55. Any load failure silently overwrites the irreplaceable identity.** `loadIdentity` returns
  null for a missing file, and also for an unreadable, truncated or hand-edited one, or for the EXPORT format the app itself
  produces (`{what, identity: {...}, server, name, adultOn}`, onlineMain.ts:180-195). `loadOrCreateIdentity` then writes a new
  key over it. A player who "restores" their exported identity by copying it into place, which is the only restore path the doc
  implies ("Export it to keep it"), loses the account at their next Go online. The doc admits "There is no account recovery".
  Probe `identity.test.ts`: `restored export -> same key? false | file now holds original? false` and
  `truncated file -> same key? false`.
  Fix: create a key only on ENOENT. Otherwise refuse with the reason and leave the file alone. Accept the export wrapper, or
  ship an import.
  - **A8, fixed (verified at ff5c28a).** A key is created only when the file is missing. An unreadable file throws
    `IDENTITY_UNREADABLE`, which `connect` surfaces. The export wrapper loads back.
    Re-run of `identity.test.ts`: `restored export -> same key? true` (the file still holds the wrapper and is not
    rewritten). The truncated file now throws "could not be read, so Offsuit did not replace it" instead of being
    replaced.

- **A9, fixed (verified at 894080a).** Forget no longer touches the scan budget or any limit. It needs a player row, then
  at once removes the row, leagues, results, rankings tallies and any cached export, and queues the key in `erasing`
  (persisted). `Lobby.sweep` runs one streamed `eraseLedgers` pass for all pending keys at most every `erasePassMs` (60 s).
  `Store.open` finishes a pending pass before anything reads a ledger. Later export pages require the player row.
  Re-runs:
  - `budget-lockout.test.ts`, the same two-network attack: `min0: export ok | forget ok`, and the same at `min1` and
    `min2`. Export denial now needs 4 networks; it can be retried and is recorded in DECISIONS "Limits".
  - `forget-sybil.test.ts`: `6 fresh-key forgets: ok,ok,ok,ok,ok,ok took 37 ms of event loop`. The ledger work moves
    into one pass a minute, about 0.7-1.2 s on a 52-95 MB ledger.
  - `ranked-cheats.test.ts` #2 (mid-hand forget, after the pass): `ledger lines naming the forgotten key after forget: 0`
    and `in-memory pairs still naming it: false`.

  Original finding at 1ec6c3d:
  server/lobby.ts:415-421, the shared scan budget: anyone with two networks can deny every
  player's export and erasure, indefinitely.** `scansPerMinute: 4` is one counter for the whole server, and keys and names
  are free. Per network, a fresh key can start one export and another fresh key one forget each minute. Two networks
  therefore spend all 4 scans every minute, and every other player gets "The server is busy. Try that again in a minute."
  for both rights. Erasure is the serious half: "Delete your server data" (docs/PRIVACY-ONLINE.md) can be held off as long
  as the attacker keeps it up, and the data stays stored meanwhile.
  Probe `budget-lockout.test.ts` (Lobby driven directly with two attacker netTags, fresh named keys, one victim on a third
  network, over 3 consecutive minutes):
  `min0: export The server is busy… | forget The server is busy…`, the same at `min1` and at `min2`.
  Fix: never refuse an erasure because of other people's traffic. Apply its cheap part at once (delete the player row,
  `rankings.forget`, record the key as erased, drop any cached export). Queue the ledger rewrites and run them in batches,
  several keys per scan, within the budget. Give exports their own budget, shared fairly per network (for example, one
  network may not take more than 1 of the 4).

## Consider
- **server/store.ts `Store.open` (pending pass) + server/admin.ts:1-3 (new at 894080a). The "read-only" admin commands
  can now lose live ledger lines.** Every `Store.open` runs `eraseLedgers()` when `erasing` is non-empty. The admin
  header says `stats`, `signals`, `regrade` and `export` may run while the server is up. If one runs within about a minute
  of a player's forget, the admin process rewrites and renames the ledgers while the server is appending. Any line the
  server appends between the admin's scan and its rename goes to the replaced file and is lost. The server's in-memory
  tallies still count it, until the next restart. The admin also writes its own `state.json` snapshot.
  Tradeoff: one flag. `Store.open(dir, { finishErasures: true })` from the server only, and read-only opens from admin;
  `admin forget` already says to stop the service.
  Fixed at 0f8e41a: `Store.open(dir, { readOnly })`; admin opens read-only for every command but `forget`
  (test "review notes at 894080a").

- **server/rankings.ts:149-167. The grading queue has no bound** (at ff5c28a this is in part addressed: new ranked tables are refused while more than 1,000 grades are queued, but rooms already open keep adding to it). One grade costs 5-13 ms here (`grade-cost.test.ts`: preflop
  5-way 7.99 ms, turn heads-up 5.09 ms, flop 5-way check 12.59 ms), so one core manages roughly 100-200 grades a second. A
  6-max ranked room of instant-acting bots produces about 6 decisions a second, so roughly 25-30 such rooms saturate the
  grader. Every queued job holds a full `TableState`. Tradeoff: a per-room or per-key decision-rate cap, or a queue bound
  that sheds and logs, costs a little code; without one, ranked capacity is set by whoever brings bots.
- **Resolved at ff5c28a (strikes decay by 10 a minute):** server/transport.ts:192-198, :281-283. Strikes never decay, and over-rate frames are dropped silently.** A long-lived
  honest connection that mashes the emote button (or sends a few bursts over an evening) collects 20 strikes and gets `bye`.
  The client treats any non-"restarting" bye as final (onlineClient.ts:181), so the player is offline and loses the held seat
  after 60 s. A dropped request frame also leaves its promise waiting 15 s. Tradeoff: decay strikes over time, or answer an
  over-rate request with an error reply.
- **server/transport.ts:146, server/lobby.ts:356-366. Per-address auth blocks and per-network failed-join limits let one
  person lock out a shared NAT** (a dorm, CGNAT, a household of friends) for 10 minutes with 10 bad signatures or 10 bad codes.
  Tradeoff: key the auth block on the key as well as the address, or raise the address threshold.
- **server/lobby.ts:149-150 (netTag = full address). The shared-network signal is evaded by any second network** (mobile
  hotspot, VPN). It is also asymmetric: `shareOfA` (rankings.ts:283) is computed only for the key that sorts first, and the
  multiway `flow` (:271-275) counts one loss against several winners. Tradeoff: these are operator hints, so document how
  weak they are, or compute both shares.
- **Resolved at ff5c28a (hand rows no longer carry `shared`):** server/store.ts:283. The export leaked other players' shared-network signal. `shared: h.shared.length` counts pairs that
  do not include the requester, so a player learns that two other people at their hand were on one network. This contradicts
  "never shown to other players". Tradeoff: count only pairs that include the requester, or omit the field.
- **server/rankings.ts:212-221, server/store.ts:183-187. `ladder` and `leagues` are O(players) and O(leagues × members) on
  every request**, at 10 requests a second per connection, and keys and leagues are free to make. Tradeoff: cache the sorted
  board per graded batch, and index leagues by member.
- **src/core/online/ranked.ts:123-147. The fingerprint corpus has 9 spots.** A grader change outside those branches (multiway
  equity, villain range content, rounding) passes the pin, and two graders mix in one season. `regrade` would catch it only
  if someone ran it. Tradeoff: a larger corpus (all street × price × opponents buckets), or fingerprint `VILLAIN_BETTING_RANGE`
  and `DISPLAY_ITERATIONS` too.
- **server/store.ts:265-285. The export omits ledger lines that name the player as an opponent**, although forget strips
  them. "Everything the server holds about your key" is not quite literal. Tradeoff: include the count, or the lines with
  prefixes.

## Noted
- 894080a: a key that forgets and then sets a name again before the next pass loses its new ledger lines. The pass
  deletes every line whose `k` is in `erasing`, whenever it was written. Probe `erase-window.test.ts`:
  `before pass: old0…old4,new0,new1,new2 | after pass: (none) | player row exists: true`. In-memory tallies would keep
  any graded ones until a restart. This only happens when the player re-registers within about a minute; a fix is to
  refuse `profile` for a key while it is in `erasing`, or to record the erase time and keep later lines.
  Fixed at 0f8e41a: `profile` is refused while the key is in `erasing` (same test).
- 894080a: until the pass, another player's export can still show the erased key's 10-character prefix in shared hands
  (up to about 60 s). This is within the privacy doc's "within about a minute".
- Resolved at 894080a (forget drops the cached export; later pages need the row): 1ec6c3d: the export cache outlived an erasure. `forget` (lobby.ts:433-438) does not delete `exporting.get(key)`, and the
  page > 0 path checks no player row. A key that exports and then forgets can, after reconnecting, fetch the remaining
  pages of its erased data for up to 5 minutes. This is the requester's own data, held in memory only; the A9 fix
  (dropping the cached export on forget) closes it.
- 1ec6c3d: the per-network limit also means two people on one home network cannot both export, or both erase, within
  the same minute.
- New at ff5c28a: a resync with nothing remembered still lets the player play that hand (warned, not refused). A
  malicious server can reach this state by never sending the player the commit, or by evicting the guest's 16-entry
  memory with repeated commits, so a ground deal is visible but not prevented. The honest server sends the same warning
  when a player held during a deal resumes into a hand they were not dealt, which may confuse them. This is the design
  accepted in DECISIONS.md ("plays on with a warning").
- New at ff5c28a: `exportAll` (onlineMain.ts) makes `pages` sequential requests, and each one scans the full ledger
  server-side. This is bounded by the player's own pages, but it feeds the A2 cost.
- Action frames carry no turn id. A late click that lands after the clock auto-acted is applied to the player's next spot if
  they are first to act on the next street, and graded as their own decision.
- A hold that expires during the player's own turn folds through `foldAbsent` even when checking was free, and is graded as a
  fold-for-free penalty. Before expiry, `autoAct` would have checked.
- A server that welcomes and then closes keeps the client reconnecting every 250 ms forever (attempt resets on welcome).
- Base64url keys of 43 characters are not canonical: one Ed25519 key can register up to 4 key strings. Harmless while keys
  are free.
- `admin.js signals` constructs `Rankings`, which runs `openSeason` and `prune`, so a command described as read-only can delete
  ledgers.
- `OnlineController.exportIdentity` returns the private key PEM to the renderer, which contradicts the onlineIdentity.ts
  header ("The renderer never sees the private key"). This is intended for the export button, but the header should say so.
- Decisions from a hand that straddles the month are graded into the new season.
- Forget-and-recreate resets a bad season, which is equivalent to a fresh key. With optional stopping, a player can "reroll" a
  thin sample. Inherent to the design.

## Dismissed
- **A middleman that terminates TLS on each side relays the sign-in.** Proof: `mitm.test.ts` relayed every byte between a
  client pinned to the middleman and the real server, and got `refused: Sign-in failed.` with the server replying `bye
  "Sign-in failed."`. The EKM binding holds.
- **Frames before auth, or acting for another seat, while held, after leaving, or in another room.** Proof: transport.ts:200-253
  accepts only hello and then auth before `ready`. lobby.ts:334-341 routes by the connection's own key, and only for the live
  conn of the room it is seated in. relayServer.ts `message('action')` refuses a non-connected (held) player. `apply` refuses
  during a pending deal, and `applyPlayerAction` checks the turn and legality. Amounts are bounded in protocol.ts:198.
- **Hole cards in resync, resume, rebuy or newcomer seats, kick, export, boards or logs.** Proof: the resync carries only
  hashes and entropy (the commit `leaves` are salted, dealCommit.ts:202). Views go through `viewFor`, whose hole visibility is
  gated on `dealtTo` (multiplayer.ts:398). The export filters to `d.k === key`, and hand rows hold stacks only. Logs take no
  card field. online-server.test's wire test covers 3-handed play to hand 3.
- **The turn clock is not reset when the same player acts on consecutive streets.** Proof: `turn().key` is
  `${handNumber}:${actionCount}`, and every recorded action bumps `actionCount` (relayServer.ts `record`).
- **The LAN path regressed.** Proof: `held` is empty, `rebuyBusted` is false and `onDecision` is undefined on LAN.
  relay*/multiplayer/mp-deal-secrecy suites pass (82/82).

## Verification
- At 894080a:
  - The four online test files: exit 0, 94 passed (22 + 53 + 3 + 16).
  - relay*/multiplayer/mp-deal-secrecy: exit 0, 82 passed.
  - `npm run typecheck`: exit 0, with the probes removed.
  - Probes re-run: budget-lockout, forget-sybil, and ranked-cheats #2 (the bot test skipped; it is unchanged and
    recorded). New probe: erase-window. Copies are in /tmp/osv-review; `tests/tmp/` has been deleted.
  - Checked by reading:
    - a crash mid-pass is safe: each rewrite is temp-then-rename, and `erasing` is cleared only after every file, so
      the pass repeats idempotently at startup;
    - queued grades of an erased key are still skipped (`store.player` check), and its opponents are filtered;
    - `recordHand` drops unknown keys;
    - rollover during a pending pass closes the season from in-memory tallies that already exclude the key;
    - forget closes the socket (transport `bye`), so the free per-forget `writeNow` is bounded by the connection rate.
- At 1ec6c3d:
  - The four online test files: exit 0, 92 passed (22 + 53 + 3 + 14).
  - relay*/multiplayer/mp-deal-secrecy: exit 0, 82 passed.
  - `npm run typecheck`: exit 0, run after the probes were removed. A probe file under `tests/tmp/` is picked up by
    tsconfig's `tests` include while it exists.
  - Probes re-run: export-dos (the page>0 burst, rewritten for in-order paging), forget-sybil, and the new
    budget-lockout. Copies are in /tmp/osv-review; `tests/tmp/` has been deleted.
- At ff5c28a:
  - `npx vitest run tests/unit/online-server.test.ts tests/unit/online-core.test.ts tests/unit/online-gate.test.ts tests/unit/online-review-fixes.test.ts`
    exit 0, 90 passed (22 + 53 + 3 + 12; online-core lost the removed `decisionSeed` test).
  - relay*/multiplayer/mp-deal-secrecy: exit 0, 82 passed.
  - `npm run typecheck`: exit 0.
  - Probes re-run from /tmp/osv-review, adapted to the paged API, under a temporary `tests/tmp/` that has since been
    deleted: resync-stack, store-scale, export-dos (adds the page>0 burst), rollover, ranked-cheats (2 tests),
    identity, mitm (still `refused: Sign-in failed.`).
  - New probe forget-sybil (fresh keys each forget once). Outputs are quoted in each item.
- At e3e58df (original review):
- `npx vitest run tests/unit/online-server.test.ts tests/unit/online-core.test.ts tests/unit/online-gate.test.ts`: exit 0,
  79 passed (22 + 54 + 3).
- `npx vitest run tests/unit/relay* tests/unit/multiplayer.test.ts tests/unit/mp-deal-secrecy.test.ts`: exit 0, 6 files,
  82 passed.
- `npm run typecheck`: exit 0.
- Probes, all against the real code (`/tmp/osv-review/`): resync-stack, store-scale, export-dos (real server over TLS),
  rollover, ranked-cheats (real server, 2 tests), identity, mitm (real server), grade-cost. Outputs are quoted above.
- Untested by the suite: export size at the cap; restart across a month; forget mid-hand with others still acting; resync
  for a deal the guest committed to but did not reveal; any load or flood against export, forget or ladder; identity file
  corruption or restore. A run of `npm run test:full` was not done: this is review only.
