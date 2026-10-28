# API — HTTP と Socket.IO

ゲームサーバー `apps/server`（既定 `:4000`）。型とZodスキーマは `packages/shared/src/protocol.ts` / `events.ts`。
エラーは `{ "error": CODE, "message": "日本語 / English" }`。

## 認証

| 種類                             | 方法                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| パイロット（ブラウザ）           | HttpOnly Cookie `sw_session`（SameSite=Lax、本番 Secure）。`fetch(..., { credentials: 'include' })` |
| パイロット（スクリプト・テスト） | `Authorization: Bearer <token>`（ゲスト作成・LNURL状態の応答に含まれる）                            |
| 管理者                           | `POST /api/admin/login` → `Authorization: Bearer <token>`（12時間）                                 |

Cookie で認証される変更系リクエスト（POST/PATCH/PUT/DELETE）は `Origin` が許可リスト（`ALLOWED_ORIGINS`、開発時は localhost/LAN）に
ない場合 403（CSRF対策）。レート制限：既定 600/分（セッション単位、なければIP）、個別に厳しい制限あり。

## 公開

| メソッド | パス                                     | 説明                                                                                                 |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET      | `/health` `/healthz`                     | 生存確認                                                                                             |
| GET      | `/ready` `/readyz`                       | DB確認込み（503 で未準備）                                                                           |
| GET      | `/api/public/current-raid`               | `{ snapshot: PublicRaidSnapshot }` 現在のレイドの全量                                                |
| GET      | `/api/raids`                             | 最近のレイド20件                                                                                     |
| GET      | `/api/raids/:id/snapshot`                | 終了済みレイドは最終スナップショット                                                                 |
| GET      | `/api/raids/:id/results`                 | `{ raidId, result: RaidResult }`                                                                     |
| GET      | `/api/raids/:id/replay`                  | 終了したレイドのみ（進行中は404）。`{ events（patchなし）, frames（2秒ごとの公開盤面）, endGameMs }` |
| GET      | `/api/leaderboard?configHash=&assisted=0 | 1`                                                                                                   | 同じルール・同じAI支援有無・BOTなしのレイドのスコア順 |

## パイロット認証

| メソッド | パス                                                | 説明                                                                                                                      |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/auth/modes`                                   | `{ mock, lightning, demo }` 使えるログイン方法                                                                            |
| POST     | `/api/auth/guest`                                   | `{ callsign?, deviceId? }` → `{ pilot, token }` ＋ Cookie。同じ端末IDなら同じゲスト                                       |
| POST     | `/api/auth/logout` / `/api/auth/logout-all`         | このセッション／全端末のセッションを無効化                                                                                |
| POST     | `/api/auth/lightning/start`                         | `{ purpose: LOGIN                                                                                                         | LINK }`→`{ challengeId, lnurl, expiresAt, mockWallet, realWallets }`＋ 結び付けCookie`sw_lnurl_bind`。LINK はログイン必須 |
| GET      | `/api/auth/lightning/callback?tag=login&k1&sig&key` | **ウォレットが呼ぶ**（LUD-04）。常に200で `{status:"OK"}` か `{status:"ERROR",reason}`                                    |
| POST     | `/api/auth/lightning/mock-approve`                  | 開発用モックウォレット（`AUTH_MODE=mock                                                                                   | both` のみ）。`{ challengeId, walletSeed }`                                                                               |
| GET      | `/api/auth/lightning/status/:id`                    | 結び付けCookieのあるブラウザのみ。`PENDING` / `VERIFIED`（Cookie発行、ゲストがいれば `mergeOffer`）/ `FAILED` / `EXPIRED` |
| POST     | `/api/auth/merge-guest`                             | `{ token }`（mergeOffer の1回限りトークン）でゲストの経歴を統合                                                           |

## パイロット

| メソッド | パス               | 説明                                                                                                                 |
| -------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/me`          | `MeResponse`：プロフィール、現在レイドの席（搭乗・パス・席・クールダウン・未完タスク・成績）、未払い請求書、パス残高 |
| PATCH    | `/api/me`          | `{ callsign?, avatar?, showNameOnArena?, locale?, reducedMotion?, assistMode? }`                                     |
| GET      | `/api/me/passport` | 経歴・階級・称号・作戦履歴                                                                                           |
| POST     | `/api/me/export`   | 自分のデータ（秘密情報なし）のJSON                                                                                   |
| DELETE   | `/api/me`          | パイロット記録の削除（匿名化）とログアウト                                                                           |

## レイド操作

| メソッド | パス                              | 本文 → 応答                                                                                                                                                                                                                                                 |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/api/raids/current/board`        | `{ role, robot? }` → `{ pilot, entitlementSource }`。パスがなければ 402 `PASS_REQUIRED`、締切後 409 `JOIN_CLOSED`                                                                                                                                           |
| POST     | `/api/raids/current/change-role`  | `{ role, robot? }`（作戦中は20秒クールダウン）                                                                                                                                                                                                              |
| POST     | `/api/raids/current/tasks`        | `TaskChoice`（`enemyId+weakpoint` / `telegraphId+cityId` / `cityId` / `sink` / `repair` / `difficulty`、すべて省略可＝おすすめ）→ `TaskResponse { code, task, cooldownUntil, gameMs }`。`code` は `OK` または `COOLDOWN, NOT_LIVE, NO_TARGET, TASK_OPEN, …` |
| POST     | `/api/raids/current/tasks/submit` | `{ taskId, clientSubmissionId, input }` → `{ result: TaskResult, duplicate }`。同じ `clientSubmissionId` の再送は最初の結果を返す（二重適用しない）                                                                                                         |
| POST     | `/api/cheer`                      | `{ emoji? }` 無料の応援（1秒に1回）                                                                                                                                                                                                                         |

`input` はミニゲームの**生の入力**：
`{role:'GUNNER', stopAtMs}` / `{role:'GUARDIAN', direction, releaseAtMs}` / `{role:'ROUTER', path:[nodeId…]}` / `{role:'ENGINEER', sequence:[…]}`。
時刻はタスク受領からのms。サーバーは自分の経過時間＋2.5秒を超える時刻を拒否する。

## 出撃パス

| メソッド | パス                                | 説明                                                                                                             |
| -------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| POST     | `/api/raids/current/pass/invoice`   | 21 sats の請求書（同じパイロット・同じレイドの有効な請求書があればそれを返す）→ `InvoiceResponse`                |
| GET      | `/api/invoices/:id/status`          | 本人のみ。PENDING なら毎回プロバイダに再照会 → `{ invoiceId, status, entitled }`                                 |
| POST     | `/api/raids/current/pass/sponsored` | `{ code }` スポンサーパスを使う（1回限り、期限・レイド指定あり）                                                 |
| POST     | `/api/dev/mock-pay`                 | `PAYMENT_MODE=mock` のときだけ存在。`{ invoiceId }` を支払い済みにする                                           |
| POST     | `/api/webhooks/lnbits/:secret`      | LNbits Webhook。本文は**きっかけ**のみ：自分の請求書を payment_hash で探し、LNbits に再照会してから付与。常に200 |

## 管理（Bearer 必須、全操作を監査ログに記録）

| メソッド | パス                                                           | 説明                                                                                                                                    |
| -------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST     | `/api/admin/login` / `/api/admin/logout`                       |                                                                                                                                         |
| GET      | `/api/admin/overview`                                          | スナップショット、スイッチ状態、搭乗内訳、パス/請求書/スポンサー集計、接続数・会場画面FPS、サーバー指標、次レイド設定、アナウンス定型文 |
| POST     | `/api/admin/command`                                           | `{command: OPEN_LOBBY                                                                                                                   | START | PAUSE | RESUME | END | CANCEL | NEXT_RAID, reason?}`、`SET_PAYMENTS_ENABLED{enabled}`、`SET_PAYMENT_INTEGRATION{enabled}`、`SET_JOIN_STOPPED{stopped}`、`SET_NAMES_HIDDEN{hidden}`、`SET_AUTO_LOOP{enabled}`、`SET_PASS_MODE{mode}`、`SET_DEMO_BOTS{count,skill?}`、`SET_TIME_SCALE{speed}`（DEMO_MODEのみ）、`BROADCAST{template, ja?, en?, seconds}`、`BROADCAST_CLEAR`、`EMERGENCY_STOP`（一時停止＋搭乗停止＋決済停止＋自動ループ停止） |
| GET/PUT  | `/api/admin/next-config`                                       | 次のレイドから使う GameConfig（進行中には反映しない）                                                                                   |
| GET      | `/api/admin/pilots`                                            | パイロット一覧                                                                                                                          |
| POST     | `/api/admin/pilots/:id/name-visibility`                        | `{ hidden }` 名前の非表示                                                                                                               |
| POST     | `/api/admin/pilots/:id/pass-credit`                            | `{ delta, note }` パス残高の手動調整（理由必須）                                                                                        |
| GET      | `/api/admin/invoices` / POST `/api/admin/invoices/:id/recheck` | 請求書一覧（ハッシュ先頭のみ）／再照会                                                                                                  |
| GET/POST | `/api/admin/sponsored-passes` / POST `…/:idPrefix/revoke`      | スポンサーパスの一覧・発行（コードは発行時に1回だけ表示）・無効化                                                                       |
| GET      | `/api/admin/audit` / `/api/admin/events?afterSeq=`             | 監査ログ／現在レイドのイベント                                                                                                          |

## Socket.IO

接続後に `raid:subscribe({ role: 'arena'|'pilot'|'spectator'|'admin', token? })`。pilot は Cookie（または token）、admin は token 必須。

| 方向 | イベント                                                                                               | 内容                                                          |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| S→C  | `raid:snapshot`                                                                                        | `PublicRaidSnapshot` 全量（購読時・レイド変更時・設定変更時） |
| S→C  | `raid:event`                                                                                           | `GameEvent`（`raidId, seq, t, gameMs, type, data, patch`）    |
| S→C  | `raid:clock`                                                                                           | 2秒ごとの時刻アンカー（`lastSeq` 付き。欠番検出に使う）       |
| S→C  | `raid:cheer` / `raid:presence` / `server:notice`                                                       | 応援、接続中パイロット数、運営からの通知                      |
| S→C  | `pilot:entitlement`                                                                                    | 本人のパス付与（支払い確認・スポンサー）                      |
| C→S  | `raid:request-snapshot(ack)` / `time:sync(t, ack)` / `arena:status({fps, frameMs, renderer, quality})` | 再同期、時刻同期、会場画面の性能報告                          |

### GameEvent の種類

`RAID_STATUS_CHANGED, PHASE_CHANGED, PILOT_BOARDED, PILOT_ROLE_CHANGED, ENEMY_SPAWNED, ENEMY_TELEGRAPH, ATTACK_RESOLVED,
ENEMY_DEFEATED, TASK_RESOLVED, SYNC_CHANGED, CITY_DESTROYED, CITY_REBUILT, SPECIAL_WINDOW_OPENED, SPECIAL_PROGRESS, SPECIAL_RESOLVED, RAID_ENDED`。
`seq` はレイド内で1ずつ増える。クライアントは `seq <= lastSeq` を無視し、`seq > lastSeq + 1` なら全量を取り直す。
公開される名前はすべてサーバーで加工済み：`pilotId` と `callsign` を持つ値（イベント・搭乗者・結果のMVP）は、本人が許可していなければ `PILOT-xxxxx`、運営が隠した名前も同様。過去のレイド（スナップショット・結果・ランキング・リプレイ）は**いまの**設定で加工する（後から隠した名前は過去の記録でも隠れる）。
