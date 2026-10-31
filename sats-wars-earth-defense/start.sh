#!/usr/bin/env bash
# SATS WARS: EARTH DEFENSE — one command to start everything (sandbox, no money moves).
#
#   ./start.sh            install what is missing, build if the code changed, start, open the browser
#   ./start.sh --no-open  same, without opening the browser
#
# The server serves all three screens on one port: /display/ (big screen), /pilot/ (phones,
# via the QR), /operator/ (staff). Ctrl+C stops it. Real Lightning payments stay off: this
# script always runs APP_MODE=sandbox (VIRTUAL pulses only).
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
PORT="${PORT:-4400}"
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    -h | --help)
      sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg (try --help)"
      exit 1
      ;;
  esac
done

trap 'printf "\n\033[1;31m✖ 途中で失敗しました（上のエラーを確認してください）\033[0m\n" >&2' ERR
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
fail() {
  printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2
  exit 1
}

# --- 1. Node.js 22.13+ ---------------------------------------------------------------
node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'
}
if ! node_ok; then
  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1 && [[ -t 0 ]]; then
    echo "Node.js 22.13 以上が見つかりません（現在: $(node -v 2>/dev/null || echo なし)）。"
    read -r -p "Homebrew で Node.js 22 をインストールしますか？ [Y/n] " ans
    if [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; then
      brew install node@22
      export PATH="$(brew --prefix node@22)/bin:$PATH"
    fi
  fi
  node_ok || fail "Node.js 22.13 以上が必要です。https://nodejs.org/ から LTS をインストールして、もう一度 ./start.sh を実行してください。"
fi

# --- 2. pnpm (the version pinned in package.json) ------------------------------------
# Without a global pnpm, put a small shim on PATH: the build scripts call `pnpm` themselves.
export npm_config_update_notifier=false COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  mkdir -p .tools/bin
  if command -v corepack >/dev/null 2>&1; then
    printf '#!/usr/bin/env bash\nexec corepack pnpm "$@"\n' >.tools/bin/pnpm
  else
    printf '#!/usr/bin/env bash\nexec npx --yes pnpm@10.28.0 "$@"\n' >.tools/bin/pnpm
  fi
  chmod +x .tools/bin/pnpm
  export PATH="$ROOT/.tools/bin:$PATH"
fi
PNPM=(pnpm)

# --- 3. Dependencies (only when missing or the lockfile changed) ---------------------
if [[ ! -f node_modules/.modules.yaml || pnpm-lock.yaml -nt node_modules/.modules.yaml ]]; then
  say "依存パッケージをインストールしています（初回は数分かかります）"
  "${PNPM[@]}" install --frozen-lockfile
fi

# --- 4. Settings: a fixed operator password on first run -----------------------------
if ! grep -qE '^OPERATOR_PASSWORD=.+' .env 2>/dev/null; then
  pw="$(node -e 'console.log(require("node:crypto").randomBytes(9).toString("base64url"))')"
  [[ -f .env ]] || echo "# Created by start.sh. Edit freely; never commit this file." >.env
  echo "OPERATOR_PASSWORD=$pw" >>.env
  say "運営パスワードを作成して .env に保存しました"
fi
OPERATOR_PASSWORD_SHOWN="$(sed -n 's/^OPERATOR_PASSWORD=//p' .env | tail -1)"
mkdir -p data

# --- 5. An old game still running would keep serving the old version: stop it --------
port_busy() { (echo >"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; }
if port_busy; then
  # Only our own server answers /health with its sandbox/live mode; anything else is left alone.
  if node -e "fetch('http://127.0.0.1:$PORT/health').then(r=>r.json()).then(j=>process.exit(j&&j.mode?0:1),()=>process.exit(1))" 2>/dev/null &&
    command -v lsof >/dev/null 2>&1; then
    say "前に起動したゲームがまだ動いていたので止めます（ポート $PORT）"
    for pid in $(lsof -ti "tcp:$PORT" -sTCP:LISTEN); do kill "$pid" 2>/dev/null || true; done
    for _ in $(seq 1 20); do
      port_busy || break
      sleep 0.5
    done
  fi
  port_busy && fail "ポート $PORT が別のアプリに使われています。そのアプリを止めるか、PORT=4500 ./start.sh で別のポートを使ってください。"
fi

# --- 6. Build (when the version or the code changed since the last build) ------------
VERSION="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
VERSION_DATE="$(git log -1 --format=%cd --date=format:'%Y-%m-%d %H:%M' 2>/dev/null || echo '')"
STAMP=".build-stamp"
needs_build=0
for d in apps/server/dist apps/display/dist apps/pilot/dist apps/operator/dist; do
  [[ -d "$d" ]] || needs_build=1
done
if [[ ! -f "$STAMP" || "$(cat "$STAMP" 2>/dev/null)" != "$VERSION" ]]; then
  needs_build=1
elif [[ -n "$(find apps packages -name node_modules -prune -o -name dist -prune -o -type f -newer "$STAMP" -print -quit)" ]]; then
  needs_build=1
fi
if [[ $needs_build -eq 1 ]]; then
  say "ビルドしています（1分ほど）"
  "${PNPM[@]}" build
  echo "$VERSION" >"$STAMP"
fi

# --- 7. Start ----------------------------------------------------------------------
say "ゲームサーバーを起動しています"
NODE_ENV=development APP_MODE=sandbox WEB_MODE=static PORT="$PORT" LOG_LEVEL="${LOG_LEVEL:-warn}" \
  node --disable-warning=ExperimentalWarning apps/server/dist/index.mjs &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true' INT TERM EXIT

for _ in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:$PORT/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" 2>/dev/null; then
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "サーバーが起動できませんでした（上のメッセージを確認してください）。"
  sleep 0.5
done

cat <<EOF

  ================================================================
   SATS WARS: EARTH DEFENSE を起動しました（SANDBOX・お金は動きません）
   バージョン  $VERSION（$VERSION_DATE）

   大画面     http://localhost:$PORT/display/
   運営       http://localhost:$PORT/operator/
   運営パスワード  $OPERATOR_PASSWORD_SHOWN
   スマホ     大画面の QR を読み取る（PC と同じ Wi-Fi に接続）

   すぐ遊ぶ：運営画面で「DEMO BOTS」をオン → 一番上の「出撃する」
   新しい画面の目印：運営画面の一番上に「今の状態 NOW」、大画面の左上に「今やること」
   （古い画面のままなら、ブラウザで再読み込み：Mac は ⌘+Shift+R）
   止める：このターミナルで Ctrl+C
  ================================================================

EOF

if [[ $OPEN_BROWSER -eq 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:$PORT/display/"
    open "http://localhost:$PORT/operator/"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT/display/" >/dev/null 2>&1 || true
    xdg-open "http://localhost:$PORT/operator/" >/dev/null 2>&1 || true
  fi
fi

# Ctrl+C lands here: a normal stop, not a failure.
wait "$SERVER_PID" || true
