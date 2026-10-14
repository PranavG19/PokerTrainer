# Hand-history fixtures

These files are hand-written in each site's hand-history export format (PokerStars, GGPoker, ACR), for
the parsers in `src/core/pro/`. They are not real exports: every player name is made up, and no real
player, table or tournament is named. Where a site's exact wording was not known for certain, the
fixture follows the closest known form and the parser accepts the variants (see the parser headers).

`*-partial.txt` are a complete hand followed by one cut off mid-hand, as a file copied while the site is
still writing the current hand looks. The cut hand must be skipped as `partial`, never half-kept.
