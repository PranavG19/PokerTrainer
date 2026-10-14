#!/usr/bin/env bash
# Remove Offsuit from the VPS after saving a final backup locally.
#   server/deploy/teardown.sh <server-ip> [domain]
# Leaves the OS, firewall and SSH hardening in place. Billing continues until
# the VPS itself is destroyed in the provider's console.
set -euo pipefail

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || {
  echo "usage: server/deploy/teardown.sh <server-ip> [domain]" >&2
  exit 2
}
ip="$1"
domain="${2:-}"
case "$ip" in *[!0-9A-Fa-f.:]* | "") echo "error: '$ip' does not look like an IP address" >&2; exit 2 ;; esac
case "$domain" in *[!A-Za-z0-9.-]*) echo "error: '$domain' has characters a domain cannot have" >&2; exit 2 ;; esac

target="root@$ip"
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

echo "This deletes the Offsuit server, all player state and all backups on $ip."
if [ -n "$domain" ]; then echo "It also deletes the Let's Encrypt certificate for $domain."; fi
printf 'Type the IP again to confirm: '
read -r confirm
if [ "$confirm" != "$ip" ]; then
  echo "Not confirmed; nothing changed." >&2
  exit 1
fi

if ! ssh "${ssh_opts[@]}" "$target" true; then
  echo "error: cannot log in as $target with an SSH key; nothing changed." >&2
  exit 1
fi

# Stop the game first so the final snapshot cannot race a write.
echo "==> Stopping the server and taking a final backup"
ssh "${ssh_opts[@]}" "$target" \
  'set -euo pipefail
   systemctl stop offsuit.service 2>/dev/null || true
   if [ -x /usr/local/sbin/offsuit-backup ]; then /usr/local/sbin/offsuit-backup; fi'

latest="$(ssh "${ssh_opts[@]}" "$target" \
  'find /var/backups/offsuit -maxdepth 1 -type f -name "offsuit-*.tar.gz" 2>/dev/null | sort | tail -n 1')"
if [ -z "$latest" ]; then
  echo "error: no backup found in /var/backups/offsuit; refusing to delete state." >&2
  echo "       (the server is stopped; 'ssh $target systemctl start offsuit' restarts it)" >&2
  exit 1
fi

local_file="./offsuit-final-backup-$(date +%Y%m%d).tar.gz"
[ -e "$local_file" ] && local_file="./offsuit-final-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
echo "==> Downloading $latest to $local_file"
scp -q "${ssh_opts[@]}" "$target:$latest" "$local_file"
# Verify the copy reads back before anything on the server is deleted.
if ! tar -tzf "$local_file" >/dev/null; then
  echo "error: $local_file is not a readable archive; refusing to delete state." >&2
  exit 1
fi

echo "==> Removing Offsuit from the server"
ssh "${ssh_opts[@]}" "$target" bash -s -- "$domain" <<'REMOTE'
set -euo pipefail
domain="${1:-}"
systemctl disable --now offsuit.service offsuit-backup.timer offsuit-backup.service 2>/dev/null || true
rm -f /etc/systemd/system/offsuit.service \
      /etc/systemd/system/offsuit-backup.service \
      /etc/systemd/system/offsuit-backup.timer \
      /usr/local/sbin/offsuit-backup \
      /etc/letsencrypt/renewal-hooks/deploy/offsuit.sh
systemctl daemon-reload
systemctl reset-failed offsuit.service offsuit-backup.service 2>/dev/null || true
rm -rf /opt/offsuit /var/lib/offsuit /var/backups/offsuit /etc/offsuit
if id offsuit >/dev/null 2>&1; then userdel offsuit; fi
if [ -n "$domain" ]; then
  certbot delete --cert-name "$domain" --non-interactive || echo "note: no certificate named $domain"
fi
echo "Offsuit removed."
REMOTE

cat <<DONE

Final backup saved to: $local_file

Still to do by hand:
  - Destroy the VPS in your provider's console. Billing stops only then.
  - Delete the DNS A record${domain:+ for $domain} at your registrar.
DONE
