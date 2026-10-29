#!/usr/bin/env bash
# Build a new release next to the running one and switch to it (run as root on the VPS).
#
#   sudo bash /opt/sats-wars/repo/deploy/deploy.sh [git-ref]      # default: origin/main
#   FORCE=1 sudo -E bash .../deploy.sh                             # even during a running raid
#
# Steps: fetch → export the commit into releases/<time>-<sha> → install + build
# (the running site is untouched meanwhile) → back up the database → switch the
# `current` link → restart → health checks and smoke test. If the new release
# does not come up healthy, it switches back to the previous one by itself.
set -euo pipefail

# Overridable only for the local rehearsal of this script (deploy/README.md).
APP="${SATS_WARS_APP:-/opt/sats-wars}"
ETC="${SATS_WARS_ETC:-/etc/sats-wars}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
REF="${1:-origin/main}"
KEEP=3
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
step() { printf '\n==> %s\n' "$*"; }
envval() { sed -n "s/^$1=//p" "$2" | tail -n1; }

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
DOMAIN_URL=$(envval SERVER_PUBLIC_URL "$ETC/server.env")
DB=$(envval DATABASE_PATH "$ETC/server.env")
BACKUPS=$(envval BACKUP_DIR "$ETC/server.env")

step "Raid status"
status=$(curl -fsS --max-time 3 http://127.0.0.1:4000/api/public/current-raid 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).snapshot.status)}catch{console.log("DOWN")}})' ||
  echo DOWN)
echo "current raid: $status"
if { [ "$status" = LIVE ] || [ "$status" = PAUSED ]; } && [ "${FORCE:-0}" != 1 ]; then
  echo "A raid is running. Deploy between raids, or FORCE=1 (the raid pauses and resumes by itself)." >&2
  exit 3
fi

step "Source $REF"
git -C "$APP/repo" fetch --quiet --prune origin
SHA=$(git -C "$APP/repo" rev-parse --verify "$REF^{commit}")
# Carry on with the deploy scripts of the commit being deployed: move the checkout
# in repo/ there and start again, so fixes to deploy.sh and rollback.sh reach the
# VPS by themselves. (bash has read this whole block before checkout rewrites the file.)
if [ "${SATS_WARS_DEPLOY_SHA:-}" != "$SHA" ]; then
  git -C "$APP/repo" checkout --quiet --detach "$SHA"
  SATS_WARS_DEPLOY_SHA=$SHA exec bash "$APP/repo/deploy/deploy.sh" "$SHA"
fi
REL="$APP/releases/$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:7}"
mkdir -p "$REL"
# Until the new release has run healthy, any failure (build, start, smoke test)
# deletes it, so releases/ only holds releases that worked and rollback.sh never
# picks a broken one. A failed first deploy is kept: it is what is running.
healthy_rel=0
trap '[ "$healthy_rel" = 1 ] || [ "$(readlink -f "$APP/current" 2>/dev/null)" = "$REL" ] || rm -rf "$REL"' EXIT
git -C "$APP/repo" archive "$SHA" | tar -x -C "$REL"
echo "$SHA" >"$REL/REVISION"

step "Install and build (the site keeps running)"
cd "$REL"
corepack pnpm install --frozen-lockfile
# Only the public web settings are needed at build time (never the server secrets,
# and not NODE_ENV: devDependencies are build tools).
NEXT_PUBLIC_GAME_SERVER_URL=$(envval NEXT_PUBLIC_GAME_SERVER_URL "$ETC/web.env") \
  NEXT_TELEMETRY_DISABLED=1 corepack pnpm build
install -d -o satswars -g satswars "$REL/apps/web/.next/cache"

step "Database backup before switching"
if [ -f "$DB" ]; then
  runuser -u satswars -- env DATABASE_PATH="$DB" BACKUP_DIR="$BACKUPS" \
    node --disable-warning=ExperimentalWarning tools/db-backup.mjs
fi

# The release to fall back to. (Only a real link: `readlink -f` also prints a
# path that does not exist yet, which on a first deploy made `current` point at itself.)
PREV=""
[ -L "$APP/current" ] && PREV=$(readlink -f "$APP/current")
switch_to() {
  ln -sfn "$1" "$APP/current.next"
  mv -Tf "$APP/current.next" "$APP/current"
  "$SYSTEMCTL" restart sats-wars-server sats-wars-web
}
healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 http://127.0.0.1:4000/readyz >/dev/null 2>&1 &&
      curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Through Caddy and the public name. On the very first deploy the certificate
# may still be on its way, so allow up to a minute.
smoke() {
  for _ in 1 2 3 4 5 6; do
    node tools/smoke.mjs --server "$DOMAIN_URL" --web "$DOMAIN_URL" && return 0
    sleep 10
  done
  return 1
}

step "Switch to $(basename "$REL")"
switch_to "$REL"
if ! healthy || ! smoke; then
  echo "The new release is not healthy." >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "Switching back to $(basename "$PREV")." >&2
    switch_to "$PREV"
    healthy && echo "Previous release is running again." >&2
  fi
  echo "Logs: journalctl -u sats-wars-server -u sats-wars-web -n 100" >&2
  exit 1
fi
healthy_rel=1

step "Clean up old releases (keeping $KEEP)"
cur=$(readlink -f "$APP/current")
# Newest first by name (it starts with the UTC time; directory times change as the site runs).
ls -1d "$APP"/releases/*/ 2>/dev/null | sed 's:/$::' | sort -r | tail -n +$((KEEP + 1)) |
  while read -r old; do
    [ "$old" = "$cur" ] || [ "$old" = "$PREV" ] || rm -rf "$old"
  done
echo
echo "Deployed $(cat "$APP/current/REVISION") → $DOMAIN_URL"
