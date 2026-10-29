#!/usr/bin/env bash
# Switch back to the previous release (or a named one) and restart (run as root on the VPS).
#
#   sudo bash /opt/sats-wars/repo/deploy/rollback.sh                 # the release before the current one
#                                                                    # (again: one further back)
#   sudo bash /opt/sats-wars/repo/deploy/rollback.sh 20261029T0400Z-abc1234
#
# The code changes; the database stays as it is. Schema migrations only add
# tables and columns, so an older release runs on a newer database. To also go
# back in data, stop the server and restore the backup deploy.sh took:
#   sudo systemctl stop sats-wars-server
#   sudo -u satswars node /opt/sats-wars/current/tools/db-restore.mjs <backup.db> --db <DATABASE_PATH>
#   sudo systemctl start sats-wars-server
set -euo pipefail

# Overridable only for the local rehearsal of this script (deploy/README.md).
APP="${SATS_WARS_APP:-/opt/sats-wars}"
ETC="${SATS_WARS_ETC:-/etc/sats-wars}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
cur=$(readlink -f "$APP/current")
if [ $# -ge 1 ]; then
  target="$APP/releases/$1"
else
  # The newest release older than the current one. Names start with the UTC time
  # of the build; directory times change as the site runs, so sort by name.
  target=$(ls -1d "$APP"/releases/*/ | sed 's:/$::' | sort -r | awk -v cur="$cur" 'seen { print; exit } $0 == cur { seen = 1 }')
fi
[ -n "$target" ] && [ -d "$target" ] || { echo "no release to roll back to" >&2; ls -1t "$APP/releases" >&2; exit 1; }

echo "current:  $(basename "$cur")"
echo "rollback: $(basename "$target")"
ln -sfn "$target" "$APP/current.next"
mv -Tf "$APP/current.next" "$APP/current"
"$SYSTEMCTL" restart sats-wars-server sats-wars-web
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:4000/readyz >/dev/null 2>&1 &&
    curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
    echo "Running $(cat "$APP/current/REVISION" 2>/dev/null || basename "$target")"
    exit 0
  fi
  sleep 1
done
echo "Not healthy after 60 s: journalctl -u sats-wars-server -u sats-wars-web -n 100" >&2
exit 1
