# Running the Offsuit online server

The online server is the same table code the app uses for LAN play (`src/core/relayServer.ts` over the real
engine), run as a plain Node process on one small VPS, speaking raw TLS 1.3 on port 443. It has no
dependencies: `node:tls`, `node:crypto` and the filesystem.

## The one command

After you (1) create an Ubuntu 24.04 VPS with your SSH key for `root`, and (2) point a DNS A record at its IP:

```sh
server/deploy/deploy.sh <server-ip> <domain> <email-for-lets-encrypt>
```

For example `server/deploy/deploy.sh 203.0.113.10 play.example.com you@example.com`. To sell Pro as well, add a
4th argument: a filled copy of [server/deploy/licence.env.example](../server/deploy/licence.env.example) kept
outside the repo (`deploy.sh … you@example.com ~/offsuit-licence.env`); see "Pro licensing" below. It builds the server on
your Mac (`npm run build:server`), uploads it, and on the VPS installs Node 22, a non-root `offsuit` user, a
firewall (SSH rate-limited, 443 for the game, 80 only for certificate renewal), automatic security updates,
key-only SSH, a Let's Encrypt certificate with automatic renewal, the sandboxed systemd service, a 14-day log
cap and daily backups of the state directory (14 kept). Re-run the same command to upgrade.

Then in Offsuit: **Play with friends → Play online**, turn it on, and set **Server address** to your domain.
Leave the certificate pin empty.

Details of every file: [server/deploy/README.md](../server/deploy/README.md).

## Pro licensing (the Stripe webhook → licence server)

The same server process hosts PR #24's licence server (`src/server/licensing/handler.ts`) on the same port: after
the TLS handshake a connection that speaks HTTP goes to it, anything else to the game. So Stripe's webhook is
`https://<domain>/webhooks/stripe` and the checkout success URL is
`https://<domain>/v1/licence/claim?session_id={CHECKOUT_SESSION_ID}`, both on the Let's Encrypt certificate.

1. Do the Stripe steps and run `node scripts/payments-setup.ts` ([docs/PAYMENTS-SETUP.md](PAYMENTS-SETUP.md)).
2. Copy `server/deploy/licence.env.example` outside the repo, set `OFFSUIT_LICENCE_ENABLED=1` and fill every
   `REPLACE_ME` from that command's output (Stripe test-mode keys first). Never commit it.
3. Re-run the one command with that file as its 4th argument. It uploads the env to `/etc/offsuit/licence.env`
   and the signing key to `/etc/offsuit/licence-signing-key.json` (both `root:offsuit`, mode 640), and refuses an
   enabled file that still has placeholders. Without the 4th argument an existing env is left as it is.

Its store is `licences.json` in the state directory (backed up with it). Writes are serialised in the one
process; the deploy runs exactly one instance, which is what makes that safe (more instances would need a
database with per-subscription locking). `/v1/*` is limited to 20 requests a minute per address. An HTTP request
with licensing off gets 404. Enabled but incomplete, the server refuses to start and names the missing variable.

## Cost

| Item | Monthly |
|---|---|
| VPS, 1 vCPU, 512 MB–1 GB (e.g. DigitalOcean $4–6; Hetzner CX22 about €4–5 plus IPv4) | $4–6 flat |
| Domain name | about $1 ($10–15 a year) |
| Let's Encrypt certificate | $0 |
| Bandwidth: about 0.3 GB at 100 monthly players, 3 GB at 1,000 (research TECH-MULTIPLAYER §2) | inside every plan's allowance |

**Is a $5 VPS enough?** Measured on localhost with `npm run server:loadtest` (evidence/online/): 50 ranked
tables, 150 players, a decision every ~1.5 s each, every decision graded — the server process averaged
**12% of one core (p95 22%) and at most 123 MB of memory**; at 200 players acting every ~0.2 s it averaged
18% (max 69%) and at most 163 MB. That machine's core is faster than a VPS vCPU, so budget 2–3× the CPU:
still under one vCPU at 50 busy tables, and the research expects about 10 concurrent tables at 10,000 monthly
players. The systemd unit caps memory at 400 MB.

The real cost is the operator's time: patching is automatic, but abuse reports, deletion requests by e-mail
(`admin.js forget <key>`), and watching the logs are yours.

## Without a domain (self-signed)

```sh
node dist-server/server/main.js --state /var/lib/offsuit --self-signed --port 443 --host 0.0.0.0
```

The server makes and keeps a certificate and logs its **pin** (`"pin":"…"` in the `server.ready` line).
Players paste the address (an IP is fine) and that pin into Play online. To print it again:
`node dist-server/server/admin.js pin /var/lib/offsuit/tls-self-signed.cert.pem`.

## Try it locally

```sh
npm run server:local    # self-signed, port 8443, state in ./.offsuit-server (git-ignored)
```

Then Play online with server `127.0.0.1:8443` and the pin it logs.

## Operating it

```sh
ssh root@<ip> journalctl -u offsuit -n 50                       # structured JSON logs, no personal data
ssh root@<ip> 'sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit stats'
ssh root@<ip> 'sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit signals'   # collusion signals
ssh root@<ip> 'sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit regrade'   # recompute every stored grade
ssh root@<ip> 'systemctl stop offsuit && sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit forget <key> && systemctl start offsuit'
```

## Tear down

```sh
server/deploy/teardown.sh <server-ip> [domain]
```

It asks you to type the IP again, saves a final backup to `./offsuit-final-backup-<date>.tar.gz`, then removes
the service, code, state, backups and certificate. **Billing stops only when you destroy the VPS in the
provider's console**; delete the DNS record too.

## Seasons and the grader

A season is a calendar month (UTC). It opens pinned to the grader version this server runs
(`GRADER_VERSION`, src/core/online/ranked.ts). Deploying a build with a different grader mid-month pauses
ranked play until the next month, so one season is never scored by two graders; unranked tables keep
working. Plan grader changes for the turn of a month.
