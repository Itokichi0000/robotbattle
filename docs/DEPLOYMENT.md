# DEPLOYMENT

> 本番デプロイ・外部公開はオーナーの明示承認後にのみ行う。このドキュメントは手順の準備であり、まだ実施していない。

## 構成

- `apps/server`：常駐 Node プロセス（Fastify + Socket.IO, :4000）。**サーバーレスに載せない**（WebSocket常時接続・単一プロセスの試合状態）。
- `apps/web`：Next.js（`next start`, :3000）。静的ページ中心。
- DB：SQLite ファイル（`DATABASE_PATH`）。永続ボリュームに置く。単一インスタンス前提。

## ビルドと起動

```bash
pnpm install --frozen-lockfile
pnpm build                 # server: dist/index.js（esbuild バンドル）, web: .next
cp .env.example .env       # 編集（NODE_ENV=production, ADMIN_PASSWORD, ALLOWED_ORIGINS, PUBLIC_PLAY_URL ...）
pnpm start                 # server + web
```

個別起動：`node --disable-warning=ExperimentalWarning apps/server/dist/index.js`、`pnpm --filter @sats-wars/web start`。

## 公開時（HTTPS/WSS 必須）

リバースプロキシ（例：Caddy / nginx）で TLS 終端：

```
https://game.example.com        → web :3000
https://api.game.example.com    → server :4000（WebSocket Upgrade を通す）
```

- Web のビルド時に `NEXT_PUBLIC_GAME_SERVER_URL=https://api.game.example.com`。
- サーバー：`ALLOWED_ORIGINS=https://game.example.com`、`PUBLIC_PLAY_URL=https://game.example.com/play`、`SERVER_PUBLIC_URL=https://api.game.example.com`。
- `trustProxy` は有効（レート制限は参加者トークン単位なのでプロキシ越しでも機能）。

## 会場LAN（インターネットなし）

- 会場PCで `pnpm start`。スマホは `http://<会場PCのIP>:3000/play`。`PUBLIC_PLAY_URL` をそのURLに。
- 実決済は使わない（mock/スポンサーパスのみ）。画面に「DEMO MODE（実決済なし）」が表示され、実決済と混同しない。

## Docker

現時点で Dockerfile / docker-compose は未作成（外部DB不要のため）。ROADMAP に記載。

## 監視

- `/health`, `/ready`。`/admin` の「接続・性能」（ソケット数、イベントループ遅延、tick遅延、メモリ、会場FPS）。
- ログは pino（JSON）。`LOG_LEVEL`。
