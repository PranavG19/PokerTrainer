# Online play: what leaves your computer

Offsuit is offline by default. Nothing in this document happens until you open **Play with friends → Play
online**, turn online play on, type a server address, confirm you are 18 or over, and press **Go online**.
Typing an address only stores it; the app contacts nothing until you press the button.

## What is sent, and to whom

Only to the one server address you typed, over TLS 1.3. The app checks that server's certificate: either
against public certificate authorities for that host name, or, if you pasted a certificate pin, against that
pin. A server that fails the check is never sent anything.

| Sent | Why | Kept by the server |
|---|---|---|
| A **device public key** (Ed25519, made on this computer the first time you go online) and a signature proving you hold its private key | How the server knows it is you, with no password or e-mail | Yes, as your account id |
| Your **display name** (2–16 characters) | Shown to people at your table and on ladders | Yes |
| That you confirmed you are **18 or over** | Online play is for adults | The **date** you confirmed it, nothing else |
| Your **table actions** (fold, check, call, bet, raise and amounts), preset **emotes**, and your share of the **deal entropy** | Playing the hand; the entropy lets you check the server did not stack the deck | Unranked tables: nothing is kept after the hand. **Ranked** tables: see below |
| Room and league **codes** you create or type | Joining the table or league | League codes and names, and who is in them |
| Your **IP address** (every internet connection reveals it) | Unavoidable; also used to rate-limit abuse | **No.** Held in memory only, for the connection limits, and dropped within a few minutes of your last connection (at most 10 minutes after a blocked sign-in). Never written to disk or logs |

The server also sees **your hole cards**, because it is the dealer: it deals them, it hides them from
everyone else until showdown, and on ranked tables it grades your decisions with them.

## What is never sent

Your profile (`offsuit-state.json`), your solo hands and decision log, your progress, lessons, lexicon,
tutor questions and answers, the tutor's credentials, your device's private key, your e-mail, your contacts,
or anything about your computer. There is no analytics or telemetry of any kind, online or off.

## Ranked tables

On a ranked table the server records, for each decision you make: the spot (your two cards, the board, the
pot, the price, your stack), what you did, the grade (big blinds lost against the coach's grader), and which
other players' keys were dealt in. It records for each hand who sat and their chips before and after. This
is what your score is computed from, and it lets any score be recomputed and checked. The server deletes
these records after the season following the one they belong to (so at most about two months), keeping only
each player's final figure for each finished season.

The operator can see statistics about pairs of players (how often they sit together, chips that moved between
them, whether they connected from the same network on a given hand — recorded as a yes/no, never the
address) to look for collusion. These are never shown to other players.

## Logs

The server's logs record events (a table opened, a sign-in failed) with a **salted one-way stand-in** for
your key. They never contain your name, key, IP address or cards. Logs are kept for 14 days.

## Your choices

- **Go offline** at any time; turning online play off in the app closes the connection.
- **Export your server data**: the app's export request returns everything the server holds about your key
  (your row, leagues, past season figures, your ranked decision records), fetched in pages and joined into one
  file. One export may be started per minute.
- **Delete your server data**: the delete request erases your player row, league memberships and past season
  figures at once, and every ranked record naming you within about a minute, then signs you out. Hands you shared with others keep the
  other players' rows, with yours removed.
- **Your device key** lives in `offsuit-online-identity.json` next to your profile, readable only by your
  user account. Export it to keep it; anyone with that file can play as you. There is no account recovery:
  if the file is lost, the server cannot tell a new key is you.

## The operator

The server is run by whoever deployed it (for the official build, the Offsuit owner). They can read
everything the server keeps, as described above. Play money only: there are no prizes, nothing can be bought
or cashed out, and nothing you win has value.

*This describes what the code does. It is not legal advice; a privacy notice reviewed by counsel is an open
item before any public launch (FINDINGS).*
