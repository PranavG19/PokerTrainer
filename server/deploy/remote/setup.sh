#!/usr/bin/env bash
# Provision or upgrade the Offsuit server. Runs as root on Ubuntu 24.04, from
# the unpacked upload (remote/ next to app/). Idempotent: every step either
# checks first or converges to the same state.
#   setup.sh <domain> <email-for-lets-encrypt>
set -euo pipefail

[ "$#" -eq 2 ] || { echo "usage: setup.sh <domain> <email>" >&2; exit 2; }
domain="$1"
email="$2"
# The domain is baked into the certbot hook script, so it must be plain.
case "$domain" in *.*) ;; *) echo "error: bad domain '$domain'" >&2; exit 2 ;; esac
case "$domain" in *[!A-Za-z0-9.-]*) echo "error: bad domain '$domain'" >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "error: setup.sh must run as root" >&2; exit 1; }

here="$(cd "$(dirname "$0")" && pwd)"
app_src="$here/../app"
[ -f "$app_src/server/main.js" ] || { echo "error: $app_src/server/main.js not found" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
# confold: never replace a config file an admin (or this script) edited.
apt_opts=(-y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)

log() { echo "--> $*"; }

log "Updating packages"
apt-get update -q
apt-get "${apt_opts[@]}" upgrade
apt-get "${apt_opts[@]}" install ufw unattended-upgrades certbot ca-certificates curl gnupg openssl

node_major="$(node --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || true)"
if [ "${node_major:-0}" -ge 22 ] 2>/dev/null; then
  log "Node.js $(node --version) already installed"
else
  log "Installing Node.js 22 from NodeSource"
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  # signed-by pins this repo to its own key instead of trusting it for every repo.
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -q
  apt-get "${apt_opts[@]}" install nodejs
fi
[ -x /usr/bin/node ] || { echo "error: /usr/bin/node missing (the unit runs it from there)" >&2; exit 1; }

log "Enabling unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
# A kernel or libc fix only takes effect after a reboot; do it when nobody plays.
cat > /etc/apt/apt.conf.d/52offsuit-unattended-reboot <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
CONF
systemctl enable --now unattended-upgrades.service >/dev/null

log "Creating the offsuit user and directories"
if ! id offsuit >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /var/lib/offsuit \
    --shell /usr/sbin/nologin offsuit
fi
# Code is root-owned so a compromised server process cannot rewrite itself.
install -d -m 0755 -o root -g root /opt/offsuit /opt/offsuit/releases
install -d -m 0700 -o offsuit -g offsuit /var/lib/offsuit /var/lib/offsuit/tls
install -d -m 0700 -o root -g root /var/backups/offsuit

log "Installing the release"
release="/opt/offsuit/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir "$release"
cp -R "$app_src/." "$release/"
chown -R root:root "$release"
chmod -R u=rwX,go=rX "$release"
# rename(2) over the old link is atomic: the unit never sees a missing path.
ln -sfn "$release" /opt/offsuit/current.new
mv -Tf /opt/offsuit/current.new /opt/offsuit/current
# Keep the newest 3 (timestamps sort lexically); never prune the live one.
current="$(readlink -f /opt/offsuit/current)"
find /opt/offsuit/releases -mindepth 1 -maxdepth 1 -type d | sort | head -n -3 \
  | while IFS= read -r old; do
      [ "$old" = "$current" ] || rm -rf -- "$old"
    done

log "Hardening SSH"
# Only once a key is installed: password-off without a key would lock the owner out.
if [ -s /root/.ssh/authorized_keys ]; then
  # 10- sorts before the cloud image's 50-cloud-init.conf; sshd keeps the first value it reads.
  cat > /etc/ssh/sshd_config.d/10-offsuit.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
CONF
  chmod 0644 /etc/ssh/sshd_config.d/10-offsuit.conf
  if sshd -t; then
    # try-: on 24.04 sshd may be socket-activated and not running; it reads the drop-in on next start.
    systemctl try-reload-or-restart ssh.service
  else
    rm -f /etc/ssh/sshd_config.d/10-offsuit.conf
    echo "error: sshd rejected the hardening drop-in; removed it, SSH unchanged" >&2
    exit 1
  fi
else
  echo "warning: /root/.ssh/authorized_keys is empty; leaving SSH password settings alone" >&2
fi

log "Configuring the firewall"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw limit OpenSSH >/dev/null
ufw allow 443/tcp comment 'offsuit game (raw TLS)' >/dev/null
# 80 is only for certbot's standalone HTTP-01 challenge; nothing else listens there.
ufw allow 80/tcp comment 'lets encrypt http-01' >/dev/null
ufw --force enable >/dev/null

log "Installing the certificate deploy hook"
hook=/etc/letsencrypt/renewal-hooks/deploy/offsuit.sh
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > "$hook" <<HOOK
#!/usr/bin/env bash
# Installed by Offsuit setup.sh. certbot runs this after each issuance or renewal:
# the service cannot read /etc/letsencrypt, so it gets its own 0600 copy.
set -euo pipefail
lineage=/etc/letsencrypt/live/$domain
# certbot runs every deploy hook for every certificate on the box; skip others.
if [ -n "\${RENEWED_LINEAGE:-}" ] && [ "\$RENEWED_LINEAGE" != "\$lineage" ]; then exit 0; fi
for f in fullchain.pem privkey.pem; do
  install -m 0600 -o offsuit -g offsuit "\$lineage/\$f" "/var/lib/offsuit/tls/\$f.new"
  mv -f "/var/lib/offsuit/tls/\$f.new" "/var/lib/offsuit/tls/\$f"
done
# The server reloads its certificate on SIGHUP; no dropped tables.
if systemctl is-active --quiet offsuit; then systemctl reload offsuit; fi
HOOK
chmod 0755 "$hook"

if [ ! -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]; then
  log "Requesting a Let's Encrypt certificate for $domain"
  # Standalone binds :80 itself; the game only listens on 443, so nothing is in the way.
  certbot certonly --standalone -d "$domain" -m "$email" --agree-tos --non-interactive
else
  log "Certificate for $domain already present (certbot.timer renews it)"
fi
# Every run, so a re-run repairs missing or stale copies.
RENEWED_LINEAGE="/etc/letsencrypt/live/$domain" "$hook"
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

log "Installing the licence server's env"
# Secrets for the licence server live here, readable by root and the service only. Uploaded by deploy.sh
# when the owner passes a licence env file; otherwise a disabled template, never overwriting a real one.
install -d -m 0750 -o root -g offsuit /etc/offsuit
if [ -f "$here/licence.env" ]; then
  install -m 0640 -o root -g offsuit "$here/licence.env" /etc/offsuit/licence.env
  if [ -f "$here/licence-signing-key.json" ]; then
    install -m 0640 -o root -g offsuit "$here/licence-signing-key.json" /etc/offsuit/licence-signing-key.json
  fi
elif [ ! -f /etc/offsuit/licence.env ]; then
  printf 'OFFSUIT_LICENCE_ENABLED=0\n' > /etc/offsuit/licence.env
  chown root:offsuit /etc/offsuit/licence.env
  chmod 0640 /etc/offsuit/licence.env
fi

log "Installing the systemd units"
install -m 0644 "$here/offsuit.service" /etc/systemd/system/offsuit.service
install -m 0644 "$here/offsuit-backup.service" /etc/systemd/system/offsuit-backup.service
install -m 0644 "$here/offsuit-backup.timer" /etc/systemd/system/offsuit-backup.timer
install -m 0755 -o root -g root "$here/backup.sh" /usr/local/sbin/offsuit-backup
systemctl daemon-reload
systemctl enable offsuit.service >/dev/null
# restart starts it if stopped, so first install and upgrade take the same path.
systemctl restart offsuit.service
systemctl enable --now offsuit-backup.timer >/dev/null

log "Capping journald"
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/offsuit.conf <<'CONF'
[Journal]
SystemMaxUse=200M
MaxRetentionSec=14day
CONF
systemctl restart systemd-journald

# Give a crash-on-start a moment to show before declaring success.
sleep 3
state="$(systemctl is-active offsuit || true)"
echo
echo "offsuit service: $state"
echo "certificate:     $(openssl x509 -enddate -noout -in /var/lib/offsuit/tls/fullchain.pem)"
if [ "$state" != "active" ]; then
  journalctl -u offsuit -n 30 --no-pager || true
  echo "error: offsuit is not running; see the log above" >&2
  exit 1
fi
