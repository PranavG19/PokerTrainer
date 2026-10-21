# Independent review: PR 2 (branch feat-cosmetics): Chalk, the celebration moment, newer-slot equips, the fix-up script

Two reviewer agents with no author context, each over two passes. They reviewed read-only and ran typecheck, units and
the script on temp copies only (no Playwright or build: the shared e2e lock governs those). The cosmetics and Locker
review (#35) is in that PR's history.

| Scope | Pass | HEAD | Verdict |
|---|---|---|---|
| Chalk (2.6) | 1. Review | d3e4db9 | **PASS WITH NOTES**: no farming or double-pay; two medium, five low, test gaps |
| Chalk | 2. Re-review | 557f8a7 | **PASS WITH NOTES**: one medium-low, two low, fixed in 6540c48 |
| The moment, schema, script | 1. Review | 2b080a1 | **PASS WITH NOTES**: one medium-high, one medium, five low |
| The moment, schema, script | 2. Re-review | f52ef96 | **PASS WITH NOTES**: every fix landed; one medium, one low-medium, fixed in the final commit |

## Findings and outcomes (red first wherever a defect was repaired)

| ID | Finding | Outcome |
|---|---|---|
| C1 (M) | A double-click bypassed the two-press confirm | Fixed: a confirm within 500 ms is ignored; key repeat never confirms; the armed confirm lapses after 8 s |
| C2 (M) | Chalk bought celebrations before the moment existed | Fixed then, and moot now: the moment plays them |
| C3–C7 (L) | Clock behind the ledger promised Chalk; owed Chalk not shown; stale snapshot during a save; read-only could spend; `spend` trusted the caller's price | All fixed (`economy.test`, `locker.spec`) |
| M1 (M-H) | On a read-only profile or a failing save, the moment replayed on every save | Fixed: it plays only after the save lands, once per session |
| M2 (M) | Only the table's verdicts held the moment | Fixed: drill, puzzle and assessment verdicts hold it, and one raised mid-moment ends it |
| M3 (L-M) | `--file=path` fell through to the real profile | Fixed: unknown arguments are refused |
| M4–M8 (L) | Script race and temp file; a vacuous `__proto__` test; the "every byte" wording; a moment surviving a delete or sound toggle; stale counts and a weak Ink ring | Fixed: re-read before the rename, fsync and cleanup; JSON.parse; "every other value"; `cancelMoment`; sound read at show time; counts verified |
| R1 (M) | Keying by day and kind silenced a second assessment or story table that day | Fixed (`moment.test`): one key per session |
| R2 (L-M) | The top-left moment covered Train's rail | Fixed (`moment.spec`, red first): bottom left, measured over the table and Train at both sizes |
| Rebase | Main moved under this PR six times (#44, #45, #47, #49, #46, #48); every conflict was a union (catalogue rules and items, token blocks, imports, the save path, the import flag) | A third read-only pass found nothing broken: every paint has its block, the counts match, every earn context passes `story` for keepsakes, and the save path is not duplicated |
| S1 | After the rebase the fix-up script's imports reached an `enum` (core/evaluate.ts), which Node 26 cannot strip | Fixed, red first (the two CLI tests): `ts-js-resolve.mjs` transpiles .ts with the repo's TypeScript |

## Checked and found fine
- Chalk: the curve (225 a day at most) holds whatever is replayed, gone stale or evicted. Every path into Chalk is
  Reps; nothing converts out; there is no money path, sale or randomness, and nothing cosmetic or currency-like is Pro.
- The parser change keeps an owned item in an unknown slot, with no overlap with the profileSchema carry, and no
  prototype issue. The script keeps unknown keys at every level, is idempotent, skips newer-build and v1 files, and
  never writes without a byte-checked backup (`COPYFILE_EXCL`).
- The clack is the only 880 Hz tone, and sound.spec's oscillator counts are unaffected. The new settings copy is
  accurate.
