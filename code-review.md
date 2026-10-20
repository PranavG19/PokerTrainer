# Independent review: profile export and import, challenge codes, a local QR (branch feat-profile-export, 2.8)

Two passes by one reviewer agent with no author context, at high effort (untrusted-file import and IPC are a
security surface). It reviewed read-only and ran typecheck and unit tests only, with no Playwright or app
launch, because the shared e2e lock governs those.

| Pass | HEAD | Verdict |
|---|---|---|
| 1. Review | 8967797 | **FAIL**: one high, two medium, five low (incl. test gaps) |
| 2. Re-review | cce2c05 | **PASS**: findings 1 and 3–7 fixed, 2 fixed in substance, 8 partly fixed; no new finding above low |

## Findings and outcomes

| ID | Finding | Outcome |
|---|---|---|
| 1 (H) | An import over a profile recovered from `.bakN` copied the torn or missing live file aside, so the profile in use survived only in the rotating backups | Fixed, red first (`store.test`): `store.replaceProfile` copies the file the profile was loaded from (`loadedFrom`) |
| 2 (M) | The strict check covered top-level types and hand cards only; nested junk (decisions, grades, a string streak) was silently repaired | Fixed, red first (`profileTransfer.test`): every value must come through the parser unchanged, else `bad-field` with its path. Remainder (low, accepted): values the parser keeps as they are (a bankroll of −1e300, depthFloor 1e12, long strings) still import, which is the same exposure as hand-editing the live file |
| 3 (M) | Unknown keys below the top level were dropped and not counted | Fixed, red first: carried at every level, as a save carries them, and listed in the preview |
| 4 (L-M) | Busting on a challenge hand offered a rebuy that dealt a second hand | Fixed, red first (`challenge-table.test`, jsdom): a table whose planned hands are played ends the sitting on a bust or sweep too |
| 5 (L) | Enter in the code field also committed an empty Math answer | Fixed, red first (`profile-export.spec`): the keypress stops at the field |
| 6 (L) | A swap between stat and read could hang main on a FIFO or read past the cap | Fixed (hardening; the race itself has no red test): one non-blocking descriptor, `fstat`, bounded read (`profileFile.test` covers a FIFO and a directory) |
| 7 (L) | The app-folder guard on export missed a path in another letter case | Fixed, red first (`profileFile.test` fails with `realpathSync`, passes with `.native`) |
| 8 (L) | Tests that could pass vacuously | Partly fixed: the receiver now has a real profile, asserted unchanged after a forced save; the code's button is pinned. **Open:** "same hand" compares hole cards and the button, not villains, stacks or board |
| R2-a (L) | `readBounded` allocates a zero-filled 16 MiB buffer per pick | **Open**: harmless at one pick per click; size it from `fstat` next time the file is touched |
| R2-b (L) | `exportEnvelope` normalises outside a `try`; an absurdly nested unknown key on disk makes the export say "could not be written" | **Open**: the renderer catches it; nothing is written |
| R2-c (L) | `challenge-table.test` never destroys the tables it renders | **Open**: test hygiene only |

## Found while fixing
- With the stricter check, exporting right after a load (before any save) could produce a file this same build
  refused. Exports are now parser-normalised (red first in `profileTransfer.test`).

## Checked and found fine (both passes)
- Dialogs are main's: `profile:export`/`importPick` take no arguments, `importConfirm` only `(id, accept)`; the
  renderer gets base file names. Confirm ids are random, single use, expire after 10 minutes.
- The licence never comes from a file: export empties entitlements, import is stamped with main's (`stamp`).
- No stale write-back after an import: saves are refused in main and the renderer until the reload's load.
- `deleteProfile` removes pre-import copies; the temp sweep covers their `.tmp` files.
- The Pro hand store (`hand-histories/`) is never read or written.
- Challenge codes: CRC-16 correct, canonical base32 and varints only, out-of-range values refused.
- QR encoder: tables, interleave, format and version bits, masks and placement match the standard;
  `scripts/qr-crosscheck.ts` has Core Image read back 61/61 symbols, versions 1–40.
- Regression sweep (pass 2): 3,278 profiles on disk written by e2e runs were run through `checkImport`; every
  refusal was a hand-made or junk fixture, none a profile the app built itself.
