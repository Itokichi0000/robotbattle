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

# --- 5. Build (only when the code changed since the last build) ----------------------
STAMP=".build-stamp"
needs_build=0
for d in apps/server/dist apps/display/dist apps/pilot/dist apps/operator/dist; do
  [[ -d "$d" ]] || needs_build=1
done
if [[ $needs_build -eq 0 && -f "$STAMP" ]]; then
  changed="$(find apps packages -name node_modules -prune -o -name dist -prune -o -type f -newer "$STAMP" -print -quit)"
  [[ -n "$changed" ]] && needs_build=1
elif [[ ! -f "$STAMP" ]]; then
  needs_build=1
fi
if [[ $needs_build -eq 1 ]]; then
  say "ビルドしています（1分ほど）"
  "${PNPM[@]}" build
  touch "$STAMP"
fi

# --- 6. Start ----------------------------------------------------------------------
if (echo >"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1; then
  fail "ポート $PORT はすでに使われています。前に起動したゲームが残っていれば、そのターミナルで Ctrl+C してから再実行してください（別のポートなら PORT=4500 ./start.sh）。"
fi

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

   大画面     http://localhost:$PORT/display/
   運営       http://localhost:$PORT/operator/
   運営パスワード  $OPERATOR_PASSWORD_SHOWN
   スマホ     大画面の QR を読み取る（PC と同じ Wi-Fi に接続）

   すぐ遊ぶ：運営画面で「DEMO BOTS」をオン → 「START 出撃」
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
