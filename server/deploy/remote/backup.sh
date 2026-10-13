#!/usr/bin/env bash
# Snapshot /var/lib/offsuit (minus tls/, which certbot can reissue) into
# /var/backups/offsuit/offsuit-YYYYMMDD.tar.gz and keep the newest 14.
# Installed by setup.sh as /usr/local/sbin/offsuit-backup; runs as root.
set -euo pipefail

src_parent=/var/lib
src_name=offsuit
dest=/var/backups/offsuit
keep=14

umask 077
install -d -m 0700 "$dest"
final="$dest/offsuit-$(date -u +%Y%m%d).tar.gz"
tmp="$final.tmp"
trap 'rm -f "$tmp"' EXIT

# Write aside then rename, so a half-written archive never replaces a good one.
tar -C "$src_parent" --exclude="$src_name/tls" -czf "$tmp" "$src_name"
chmod 600 "$tmp"
mv -f "$tmp" "$final"

# Date-stamped names sort chronologically; drop all but the newest $keep.
find "$dest" -maxdepth 1 -type f -name 'offsuit-*.tar.gz' | sort | head -n "-$keep" \
  | while IFS= read -r old; do rm -f -- "$old"; done

echo "backup written: $final ($(du -h "$final" | cut -f1))"
