# DONE — net-robustness fixes (branch fix/net-robustness)

Two network-robustness fixes from CONSOLIDATED.md (#5 and #6).

## What changed

### 1. Relay receive-buffer / message-size cap (CONSOLIDATED #5) — `src/main/relayHost.ts`, `src/main/relaySession.ts`
- Added `MAX_MESSAGE_BYTES` (64 KB) and a pure `frameChunk(buffer, maxBytes)` helper that wraps
  `splitLines` and reports `overflow` when a single frame (a complete line, or the still-arriving
  partial tail) exceeds the cap.
- Wired the guard into both socket data handlers:
  - host accept path (`relayHost.ts`): on overflow, sends `{type:'error', reason:'message too large'}`
    to the peer and `socket.destroy()`s it.
  - join client path (`relaySession.ts`): on overflow, `callbacks.onError('message too large')` and
    `socket.destroy()`.
- Added `MAX_CONNECTIONS` (32): a new socket past the cap is destroyed before a player id/buffer is
  spent, bounding memory from a peer opening connections without bound.
- **The 0.0.0.0 bind was left as-is on purpose.** It is already documented at `relaySession.ts:94-96`
  and load-bearing: `relaySession.test.ts` has a test ("a guest can connect over the LAN address the
  host advertises") that fails if it reverts to the loopback default. So I capped the input rather than
  changing the bind, exactly as the task's fallback instructs.

### 2. Multiplayer screen error handling (CONSOLIDATED #6) — `src/renderer/screens/multiplayer.ts`
- `host()` / `join()` / `enable()` awaited bridge IPC calls with no try/catch. A real IPC *rejection*
  (vs the modeled `{error}` resolve) stranded the screen in `connecting` forever. Each is now wrapped:
  on rejection it falls back to the `setup` phase, clears `role`, and shows a notice
  ("Could not start the table" / "Could not connect" / "Could not enable multiplayer").
- The `mpStatus()` poll had no `.catch`, so a rejection became an unhandled rejection. Added a rejection
  handler that leaves the panel in its default disabled state (Enable button still offered).

## Tests (real oracles, red-first verified)
- `tests/unit/relayHost.test.ts`: 5 pure `frameChunk` cases (normal pass-through, oversized tail,
  oversized complete line, exactly-at-cap, custom cap) + a real-socket test that an oversized frame is
  errored and the socket dropped. Confirmed RED with the host guard removed.
- `tests/unit/relaySession.test.ts`: a real-socket test standing up a rogue host that floods an
  oversized frame; asserts the join client surfaces `message too large`.
- The multiplayer *screen* fix has no unit test: this codebase has no jsdom/happy-dom test environment
  (vitest runs in node) and forbids adding npm deps; screens are covered by Playwright e2e, not unit
  tests. The fix is verified by typecheck and by mirroring the existing `{error}`-handling structure.

## Verification (real results)
- `npm run typecheck` — PASS (exit 0, no errors)
- `npm test` — PASS, 76 files, **1677 tests passed, 0 failed** (baseline was 1670; +7 new)

## What I left alone
- The `0.0.0.0` bind (see above — deliberate, documented, test-pinned).
- CONSOLIDATED #8/#9 (auth/room-code, RFC1918 restriction) — separate hardening findings, out of scope.
- All existing tests unchanged; none weakened or deleted.

## Concerns
- The join-side overflow test destroys the rogue server's accepted socket in `finally` before
  `server.close()`, because the client resets mid-write and the lingering server socket otherwise keeps
  `close()`'s callback from firing. This is test-harness bookkeeping, not production behavior.
- 64 KB is generous for the current tiny JSON messages; if a future feature sends larger frames (bulk
  state, chat), revisit the constant.
