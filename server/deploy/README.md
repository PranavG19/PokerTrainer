# Deploying the Offsuit server

One command puts the multiplayer server on a $5 Ubuntu 24.04 VPS with TLS,
a firewall, automatic security updates and daily backups. Re-running it
upgrades the code and restarts the service; state and the certificate stay.

## Deploy

1. Buy an Ubuntu 24.04 VPS with your SSH key installed for `root`.
2. Point a DNS A record (e.g. `play.example.com`) at its IPv4 address.
3. From the repo root on your Mac:

   ```sh
   server/deploy/deploy.sh <server-ip> <domain> <email-for-lets-encrypt>
   ```

4. In Offsuit: Play with friends → Play online, turn it on, and set "Server address" to `<domain>` (no pin).

## Check on it

```sh
ssh root@<ip> journalctl -u offsuit -n 50
ssh root@<ip> 'sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit stats'
ssh root@<ip> systemctl status offsuit
ssh root@<ip> ls -l /var/backups/offsuit
```

## Tear down

```sh
server/deploy/teardown.sh <server-ip> [domain]
```

Asks you to type the IP again, stops the server, saves a final backup to
`./offsuit-final-backup-<date>.tar.gz`, then removes the service, code, state,
backups and (with a domain) the certificate. Billing stops only when you destroy
the VPS in the provider's console; delete the DNS record too.

## Files

| File | What it does |
|---|---|
| `deploy.sh` | Runs on your Mac: checks SSH, runs `npm run build:server`, uploads `dist-server/` plus `remote/`, runs `remote/setup.sh`. |
| `teardown.sh` | Runs on your Mac: final backup download, then removes Offsuit from the VPS. |
| `remote/setup.sh` | Runs as root on the VPS: packages, Node 22, unattended upgrades (reboot 04:30 if needed), `offsuit` user, release switch (keeps 3), SSH key-only login, ufw (22 limited, 80, 443), Let's Encrypt, systemd units, journald cap (200M / 14 days). |
| `remote/offsuit.service` | The sandboxed systemd unit: non-root, binds 443 via `CAP_NET_BIND_SERVICE`, writes only `/var/lib/offsuit`, `reload` sends SIGHUP to pick up a renewed certificate. |
| `remote/backup.sh` | Daily `tar.gz` of `/var/lib/offsuit` (without `tls/`) into `/var/backups/offsuit`, keeps 14. |
| `remote/offsuit-backup.service`, `.timer` | Run `backup.sh` daily. |

Layout on the VPS: code in `/opt/offsuit/releases/<timestamp>` with
`/opt/offsuit/current` pointing at the live one (root-owned, read-only to the
service); state in `/var/lib/offsuit`; certificate copies in
`/var/lib/offsuit/tls`, refreshed by `/etc/letsencrypt/renewal-hooks/deploy/offsuit.sh`
whenever certbot's timer renews. Port 80 is open only for certbot's HTTP-01
renewal; the game itself is raw TLS on 443, not HTTP.

To roll back by hand: `ln -sfn /opt/offsuit/releases/<older> /opt/offsuit/current && systemctl restart offsuit`.

## Cost

- VPS: about $4–6/month flat (a DigitalOcean $4–6 droplet, or Hetzner CX22 at
  about €4–5 plus its IPv4 charge).
- Certificate: Let's Encrypt, free.
- Domain: about $10–15/year.
- Bandwidth: negligible, roughly 0.3–3 GB/month at 100–1k monthly players,
  far inside any plan's included transfer.
