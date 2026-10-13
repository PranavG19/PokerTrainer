#!/usr/bin/env bash
# Deploy (or upgrade) the Offsuit game server to a fresh Ubuntu 24.04 VPS.
#   server/deploy/deploy.sh <server-ip> <domain> <email-for-lets-encrypt>
# Runs on the owner's Mac. Re-running ships a new release and restarts the
# service; state in /var/lib/offsuit and the certificate are kept.
set -euo pipefail

usage() {
  echo "usage: server/deploy/deploy.sh <server-ip> <domain> <email-for-lets-encrypt> [licence-env-file]" >&2
  echo "       licence-env-file: optional, from server/deploy/licence.env.example (Pro licensing, Stripe)" >&2
  exit 2
}

[ "$#" -eq 3 ] || [ "$#" -eq 4 ] || usage
ip="$1"
domain="$2"
email="$3"
licence_env="${4:-}"

case "$ip" in *[!0-9A-Fa-f.:]* | "") echo "error: '$ip' does not look like an IP address" >&2; exit 2 ;; esac
case "$domain" in *.* ) ;; *) echo "error: '$domain' does not look like a domain name" >&2; exit 2 ;; esac
case "$domain" in *[!A-Za-z0-9.-]*) echo "error: '$domain' has characters a domain cannot have" >&2; exit 2 ;; esac
case "$email" in ?*@?*.?*) ;; *) echo "error: '$email' does not look like an email address" >&2; exit 2 ;; esac
case "$email" in *[[:space:]\'\"]*) echo "error: '$email' contains spaces or quotes" >&2; exit 2 ;; esac

# Run from the repo root whatever the caller's cwd.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

target="root@$ip"
# accept-new: trust a fresh VPS's host key on first contact, but refuse a changed one later.
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

echo "==> Checking SSH access to $target"
if ! ssh "${ssh_opts[@]}" "$target" true; then
  cat >&2 <<MSG
error: cannot log in as $target with an SSH key.
  Add your public key to the VPS (most providers have an "SSH keys" field when
  you create the server), or copy it once with:
    ssh-copy-id $target
  Then check that 'ssh $target' logs in without a password and re-run this.
MSG
  exit 1
fi

# Warn only: certbot needs the A record, but DNS may still be propagating.
if command -v dig >/dev/null 2>&1; then
  resolved="$(dig +short A "$domain" | tail -n 1 || true)"
  if [ "$resolved" != "$ip" ]; then
    echo "warning: $domain resolves to '${resolved:-nothing}', not $ip." >&2
    echo "         Let's Encrypt will fail until the A record points at the server." >&2
  fi
fi

echo "==> Building the server (npm run build:server)"
if ! grep -q '"build:server"' package.json; then
  echo "error: package.json has no build:server script" >&2
  exit 1
fi
npm run build:server
if [ ! -f dist-server/server/main.js ]; then
  echo "error: dist-server/server/main.js missing after the build" >&2
  exit 1
fi

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/offsuit-upload/app" "$stage/offsuit-upload/remote"
cp -R dist-server/. "$stage/offsuit-upload/app/"
cp -R server/deploy/remote/. "$stage/offsuit-upload/remote/"

# The licence server's secrets, only if the owner passed them: the signing key file is uploaded beside the
# env and the env is rewritten to point at its place on the VPS. Placeholders are refused when enabled.
if [ -n "$licence_env" ]; then
  [ -f "$licence_env" ] || { echo "error: licence env file '$licence_env' not found" >&2; exit 1; }
  # Quoted or not: systemd strips the quotes, so "1" is enabled at runtime too.
  if grep -Eq '^[[:space:]]*OFFSUIT_LICENCE_ENABLED=["'"'"']?1["'"'"']?[[:space:]]*$' "$licence_env"; then
    if grep -q 'REPLACE_ME' "$licence_env"; then
      echo "error: $licence_env still has REPLACE_ME placeholders" >&2
      exit 1
    fi
    key_file="$(sed -n 's/^OFFSUIT_LICENCE_SIGNING_KEY_FILE=//p' "$licence_env" | tail -n 1)"
    key_file="${key_file/#\~/$HOME}"
    [ -f "$key_file" ] || { echo "error: signing key '$key_file' (OFFSUIT_LICENCE_SIGNING_KEY_FILE) not found" >&2; exit 1; }
    cp "$key_file" "$stage/offsuit-upload/remote/licence-signing-key.json"
  fi
  grep -v '^OFFSUIT_LICENCE_SIGNING_KEY_FILE=' "$licence_env" > "$stage/offsuit-upload/remote/licence.env"
  echo "OFFSUIT_LICENCE_SIGNING_KEY_FILE=/etc/offsuit/licence-signing-key.json" >> "$stage/offsuit-upload/remote/licence.env"
  chmod 600 "$stage/offsuit-upload/remote/licence.env"
fi
tarball="$stage/offsuit-upload.tar.gz"
# COPYFILE_DISABLE: keep macOS ._ resource-fork files out of the release.
COPYFILE_DISABLE=1 tar -C "$stage" -czf "$tarball" offsuit-upload

echo "==> Uploading the release"
scp -q "${ssh_opts[@]}" "$tarball" "$target:/root/offsuit-upload.tar.gz"

echo "==> Running setup on the server (this takes a few minutes the first time)"
# Unpack fresh each time so a file deleted from the repo does not linger.
# shellcheck disable=SC2029 # domain and email are validated above and meant to expand here.
ssh "${ssh_opts[@]}" "$target" \
  "set -euo pipefail
   rm -rf /root/offsuit-upload
   tar --no-same-owner --warning=no-unknown-keyword -C /root -xzf /root/offsuit-upload.tar.gz
   bash /root/offsuit-upload/remote/setup.sh '$domain' '$email'
   rm -rf /root/offsuit-upload /root/offsuit-upload.tar.gz"

cat <<DONE

Done. In Offsuit, open Play with friends → Play online, turn online play on,
and set "Server address" to:

    $domain

Leave the certificate pin empty: the server has a Let's Encrypt certificate.

Pro licensing (only if you passed a licence env with OFFSUIT_LICENCE_ENABLED=1): in Stripe, point the
webhook at https://$domain/webhooks/stripe and the checkout success URL at
https://$domain/v1/licence/claim?session_id={CHECKOUT_SESSION_ID} (docs/PAYMENTS-SETUP.md).

Next steps:
  - Logs:    ssh $target journalctl -u offsuit -n 50
  - Stats:   ssh $target 'sudo -u offsuit node /opt/offsuit/current/server/admin.js --state /var/lib/offsuit stats'
  - Upgrade: re-run this same command after pulling new code.
  - Remove:  server/deploy/teardown.sh $ip $domain
DONE
