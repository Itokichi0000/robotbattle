#!/usr/bin/env bash
# One-time setup of a fresh VPS for SATS WARS: EARTH DEFENSE (Ubuntu 24.04 / Debian 12, run as root).
#
#   sudo bash setup-vps.sh --domain game.example.com --email you@example.com \
#        --repo https://github.com/<owner>/robotbattle.git [--ref main] [--event-id my-event]
#
# Installs Node.js 22, pnpm (corepack) and Caddy, creates the `satswars` user and
# directories, writes /etc/sats-wars/*.env (a random admin password, shown once),
# installs the systemd units and the Caddyfile, opens 22/80/443 only, then runs
# deploy.sh for the first release. Safe to run again: existing env files and the
# database are kept. Point the domain's DNS A/AAAA record at this VPS first, or
# Caddy cannot get a certificate. Docs: deploy/README.md.
set -euo pipefail

DOMAIN="" EMAIL="" REPO="" REF="main" EVENT_ID="sats-wars-event"
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --ref) REF="$2"; shift 2 ;;
    --event-id) EVENT_ID="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] && [ -n "$REPO" ] || {
  echo "usage: setup-vps.sh --domain <domain> --email <acme-email> --repo <git-url> [--ref main] [--event-id id]" >&2
  exit 2
}
case "$DOMAIN" in *[!a-zA-Z0-9.-]*) echo "bad domain: $DOMAIN" >&2; exit 2 ;; esac
case "$EVENT_ID" in *[!a-z0-9-]*) echo "event id: lowercase letters, digits and - only" >&2; exit 2 ;; esac

APP=/opt/sats-wars
export DEBIAN_FRONTEND=noninteractive
step() { printf '\n==> %s\n' "$*"; }

step "System packages"
apt-get update -q
apt-get install -y -q ca-certificates curl git gnupg ufw openssl \
  debian-keyring debian-archive-keyring apt-transport-https

step "Node.js 22 (NodeSource) and pnpm (corepack)"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y -q nodejs
fi
corepack enable
node --version

step "Caddy (official repository)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

step "Swap (building the web app needs more than 1 GB of memory)"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 3000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

step "User and directories"
id satswars >/dev/null 2>&1 ||
  useradd --system --home-dir /var/lib/sats-wars --shell /usr/sbin/nologin satswars
install -d -o root -g root -m 755 "$APP" "$APP/releases"
install -d -o satswars -g satswars -m 750 /var/lib/sats-wars /var/lib/sats-wars/backups
install -d -o root -g satswars -m 750 /etc/sats-wars

step "Source code"
if [ ! -d "$APP/repo/.git" ]; then
  git clone --quiet "$REPO" "$APP/repo"
fi
git -C "$APP/repo" fetch --quiet --prune origin
# A branch name means its latest commit on GitHub; a tag or commit is used as is.
if git -C "$APP/repo" rev-parse --verify --quiet "origin/$REF^{commit}" >/dev/null; then
  DEPLOY_REF="origin/$REF"
else
  DEPLOY_REF="$REF"
fi
git -C "$APP/repo" checkout --quiet --detach "$DEPLOY_REF"

step "Settings (/etc/sats-wars)"
render() { sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__EMAIL__/$EMAIL/g" -e "s/__EVENT_ID__/$EVENT_ID/g" "$1"; }
NEW_PASSWORD=""
if [ ! -f /etc/sats-wars/server.env ]; then
  NEW_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
  render "$APP/repo/deploy/env/server.env.template" |
    sed -e "s/__ADMIN_PASSWORD__/$NEW_PASSWORD/" >/etc/sats-wars/server.env
fi
[ -f /etc/sats-wars/web.env ] || render "$APP/repo/deploy/env/web.env.template" >/etc/sats-wars/web.env
chown root:satswars /etc/sats-wars/server.env /etc/sats-wars/web.env
chmod 640 /etc/sats-wars/server.env /etc/sats-wars/web.env

step "systemd units and Caddy"
install -m 644 "$APP/repo/deploy/systemd/sats-wars-server.service" /etc/systemd/system/
install -m 644 "$APP/repo/deploy/systemd/sats-wars-web.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable sats-wars-server sats-wars-web >/dev/null
render "$APP/repo/deploy/Caddyfile.template" >/etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null
systemctl reload-or-restart caddy

step "Firewall (SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

step "First release"
bash "$APP/repo/deploy/deploy.sh" "$DEPLOY_REF"

echo
echo "SATS WARS is up:  https://$DOMAIN/arena  (venue screen)   https://$DOMAIN/play  (phones)"
echo "Operators:        https://$DOMAIN/admin"
if [ -n "$NEW_PASSWORD" ]; then
  echo
  echo "Admin password (shown once; also in /etc/sats-wars/server.env): $NEW_PASSWORD"
fi
