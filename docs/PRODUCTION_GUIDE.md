# PRODUCTION_GUIDE — 本番設定ガイド（仕様 PHASE 7）

> **本番デプロイ・外部公開・実決済は、オーナーの明示承認があるまで実施しない。** このガイドは手順の準備であり、
> このリポジトリの作業では一度も本番公開・実入金をしていない。会場での当日運用は `docs/EVENT_RUNBOOK.md`、
> 合否の一覧は `docs/RELEASE_GATE.md`。

## 1. 構成

```
[スマホ / 会場PC] --HTTPS/WSS--> [TLS終端 (Caddy/nginx)] --> web  (Next.js, :3000, 静的ページ中心)
                                                     └--> server (Fastify + Socket.IO, :4000, 常駐1プロセス)
                                                              └-- SQLite（永続ボリューム）＋ バックアップ
                                                              └-- LNbits（承認後のみ。Invoice/read key）
```

- サーバーは**常駐する単一インスタンス**（レイドはメモリ上の状態＋コマンドログ。サーバーレス・複数台は不可）。
- DB は SQLite（D-037）。外部DBは不要。差し替える場合は `apps/server/src/db/repo.ts`。

## 2. 環境の差分

| 変数 / 設定                      | 開発（`pnpm dev`）         | 会場LAN デモ                     | 有料イベント（承認後）                                                |
| -------------------------------- | -------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `NODE_ENV`                       | development                | development                      | **production**（起動時に下の必須項目を検査）                          |
| `DEMO_MODE`                      | true（任意）               | true                             | **false**                                                             |
| `AUTH_MODE`                      | mock / both                | mock（ゲストのみ）               | **lnurl**（本番は必須）                                               |
| `PASS_MODE`                      | FREE                       | FREE（または PAID＋mock でリハ） | PAID（または FREE イベント）                                          |
| `PAYMENT_MODE`                   | mock                       | mock                             | lnbits ＋ `ALLOW_REAL_PAYMENTS=true`（**オーナー承認後**）            |
| `SERVER_PUBLIC_URL`              | 空                         | 空                               | **https://api.…**（LNURL と Webhook に必須）                          |
| `ALLOWED_ORIGINS`                | 空（localhost/LAN）        | 空                               | **https://game.…**（必須）                                            |
| `PUBLIC_PARTICIPANT_URL`         | http://localhost:3000/play | http://<会場PCのIP>:3000/play    | https://game.…/play（QR に載る。**実際に開いて確認**）                |
| `NEXT_PUBLIC_GAME_SERVER_URL`    | 未設定（同ホスト:4000）    | 未設定                           | https://api.…（web のビルド時）                                       |
| `ADMIN_PASSWORD` / `ADMIN_USERS` | 空なら起動時に生成         | 12文字以上                       | `ADMIN_USERS`（個人別・役割・TOTP）＋ `ADMIN_SHARED_LOGIN=false` 推奨 |
| `COOKIE_SECURE`                  | false                      | false（http のLAN）              | true（production の既定）                                             |
| `BACKUP_INTERVAL_MINUTES`        | 30                         | 30                               | 15〜30（レイド終了ごとにも自動）                                      |
| `LOG_LEVEL`                      | info                       | info                             | info（JSON。機密はマスク済み）                                        |

本番（`NODE_ENV=production`）では、`AUTH_MODE=lnurl`・https の `SERVER_PUBLIC_URL`・`ALLOWED_ORIGINS`・管理者の認証情報がないと
**サーバーが起動を拒否する**。`PAYMENT_MODE=lnbits` は `ALLOW_REAL_PAYMENTS=true` がないと起動しない。

## 3. 見積もり（リソース）

`docs/LOAD_TEST_REPORT.md`（同一ホスト・localhost）の実測：50パイロット＋観客100接続で サーバーCPU 約4%（1コア比）、RSS 約135MB、
提出→全観客への到達 p95 7ms。過去の測定では100パイロット＋観客300で CPU 約15%・RSS 約140MB。

| 規模（同時）         | サーバー                     | 備考                                               |
| -------------------- | ---------------------------- | -------------------------------------------------- |
| 〜50人＋会場画面数台 | 1 vCPU / 512MB / ディスク1GB | 会場PCと兼用も可                                   |
| 〜100人＋観客300     | 1〜2 vCPU / 1GB              | 実ネットワークの遅延は未測定（OPEN_ISSUES）        |
| 会場PC（大画面）     | WebGL 対応GPU、1920×1080     | 自動品質低下と2D表示あり。**会場GPUのFPSは未測定** |

DB は1レイドあたり数百KB〜数MB（コマンド＋イベント）。バックアップは `BACKUP_KEEP` 世代。費用はホスティング先の料金表で見積もる
（このリポジトリは特定の有料サービスに依存しない）。

## 4. デプロイ手順（承認後）

1. `pnpm install --frozen-lockfile && pnpm build`（server: `apps/server/dist/index.js`、web: `.next`、solo: 単一HTML）。
2. `.env` を作成（`.env.example` から。実値はサーバーの環境変数のみ。git に入れない）。管理者は `pnpm admin:user` でハッシュを作る。
3. TLS 終端（Caddy/nginx）：`https://game… → web:3000`、`https://api.game… → server:4000`（WebSocket Upgrade を通す）。
4. `pnpm start`（または systemd / 任意の Dockerfile。Docker はこのコンテナで未検証）。SQLite と `BACKUP_DIR` は永続ボリューム。
5. **スモークテスト**：`pnpm smoke --server https://api.game… --web https://game…`（読み取り＋ゲスト1人だけ。支払わない・管理状態に触れない）。
   すべて PASS であること。
6. `/admin` にログイン → 監視（ソケット数・遅延・会場画面FPS）→ 各スイッチの状態を確認。
7. 実決済を使う場合は `docs/EVENT_RUNBOOK.md`「実決済（承認後）」の少額試験を**オーナー立ち会いで**行う。

## 5. ロールバック

- **アプリ**：直前のビルド（またはタグ）に戻して再起動。レイドはコマンドログから復元され PAUSED で再開待ちになる（統合テスト済み）。
  DB スキーマはマイグレーション番号つきで前方互換。戻す前に `pnpm db:backup`。
- **DB**：サーバーを止めて `pnpm db:restore <バックアップファイル>`（起動中は拒否）。復元前の DB は自動で退避される。
- **設定**：次のレイドの設定（難度・価格・定員）は `/admin` の「次のレイド」で戻す。進行中のレイドには反映されない（configHash で凍結）。
- **決済トラブル**：「決済連携」OFF → 新規請求書を止め、スポンサーパス・無料で続行。締切後の入金は自動でパス残高になる。
- **緊急時**：`/admin` 🛑 緊急停止（一時停止＋搭乗停止＋決済停止＋自動ループ停止）。

## 6. 運営が確認すること（アプリは判断しない）

| 分野     | 確認項目                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 法務     | 出撃パス（21 sats）の表示・支払先・使途・返金なし・パス残高（換金なし）の文言。景品表示・特定商取引・資金決済に関する法令の確認 |
| 賞品     | 賭け・換金・抽選型景品を**行わない**ことの周知。ランキングは記録のみ。表彰は運営判断（現金価値のある景品の自動配布はしない）    |
| 決済     | LNbits の運用者・鍵の保管者・入金の会計処理。実ウォレットでの少額試験（承認後）。プロバイダ障害時の案内文                       |
| 未成年   | 保護者同伴・利用規約・プライバシー案内。実名・写真・連絡先を求めない（アプリ側は実装済み）。「本人確認」と表示しない            |
| 商標     | 「SATS WARS」「雷神」「風神」等の名称・ロゴの商標調査。Bitcoin ロゴをロボットに付けない（実装済み）                             |
| 著作権   | ロボ・ボス・地図・効果音・BGM は自作（`assets/LICENSES.md`）。日本地図データの出典とライセンス（DECISION_LOG 保留事項）         |
| 個人情報 | アクセスログ・IP の保持期間（ホスティング側）。期限切れセッションは `RETENTION_DAYS` で削除、BOLT11 は24時間で消去              |
| 会場     | 会場規約（音量・投影・Wi-Fi 利用）、スタッフの役割（viewer/operator/owner）、非常時の連絡先                                     |

## 7. 公開前の最終確認

`docs/RELEASE_GATE.md` のすべての行が「済」または「承認待ち」で、**「未検証」の行はオーナーが受け入れを判断する**。
