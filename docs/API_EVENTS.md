# API_EVENTS — REST / Socket.IO 契約

型定義の正：`packages/shared/src/protocol.ts`, `events.ts`, `state.ts`。エラーは `{ error: CODE, message }`（message は日英併記でそのまま表示可）。

## REST（`apps/server`, 既定 :4000）

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/health` | - | 生存確認 |
| GET | `/ready` | - | DB・試合ロード状態 |
| GET | `/api/public/current-match` | - | `{ snapshot: PublicMatchSnapshot }` |
| GET | `/api/matches` | - | 最近の試合一覧 |
| GET | `/api/matches/:id/snapshot` | - | 現在試合 or 終了時の凍結スナップショット |
| POST | `/api/join/reserve` | - | `{nickname?, deviceId?}` → `ReserveResponse`（`token` を保存） |
| POST | `/api/join/invoice` | 参加者 | `{reservationId}` → `InvoiceResponse`（有効な既存請求書があれば同じものを返す） |
| GET | `/api/join/payment-status/:reservationId` | 参加者 | 状態。PENDING ならサーバーがプロバイダへ再照会 |
| POST | `/api/join/redeem-pass` | 参加者 | `{reservationId, code}` |
| GET | `/api/me` | 参加者 | 自分の状態・AP・貢献・直近結果・繰越コード |
| POST | `/api/actions` | 参加者 | `{clientActionId, type, regionId?}` → `{result, apRemaining}` |
| POST | `/api/dev/mock-pay` | 参加者 | **mockモードのみ登録**。`{invoiceId}` |
| POST | `/api/webhooks/lnbits/:secret` | パス秘密 | `{payment_hash}`。常に200（存在を漏らさない）。再照会してから付与 |
| POST | `/api/admin/login` / `logout` | - / 管理 | `{password}` → `{token}` |
| GET | `/api/admin/overview` | 管理 | 試合・決済集計・参加・接続・会場FPS・サーバー遅延 |
| POST | `/api/admin/command` | 管理 | `OPEN_LOBBY / START / PAUSE / RESUME / CANCEL / NEXT_MATCH / EMERGENCY_STOP / SET_PAYMENTS_ENABLED {enabled} / SET_DEMO_BOTS {perTeam}` |
| GET/PUT | `/api/admin/next-config` | 管理 | 次試合の `GameConfig`（Zod検証） |
| GET | `/api/admin/participants` | 管理 | 参加者一覧 |
| POST | `/api/admin/participants/:id/nickname-visibility` | 管理 | `{hidden}` |
| GET | `/api/admin/invoices` | 管理 | 請求書（hash は先頭12桁のみ） |
| POST | `/api/admin/invoices/:id/recheck` | 管理 | 再照会 |
| POST | `/api/admin/invoices/:id/disposition` | 管理 | 遅延入金：`CARRY_OVER`（繰越コード発行）/`REFUND_REQUESTED`/`RESOLVED` |
| POST/GET | `/api/admin/passes` | 管理 | 発行 `{count, expiresInMinutes, label, currentMatchOnly}`（コードは発行時のみ返す）/ 一覧 |
| POST | `/api/admin/passes/:idPrefix/revoke` | 管理 | 失効 |
| GET | `/api/admin/audit`, `/api/admin/events?afterSeq=` | 管理 | 監査ログ・イベント履歴 |

認証は `Authorization: Bearer <token>`。管理APIはさらに `Origin` が `ALLOWED_ORIGINS` に含まれることを要求。
クライアントが `teamId`, `ap`, `paid`, `damage` 等を送っても無視される（スキーマにない）。

レート制限：全体 600/分（参加者トークン単位、なければIP）、予約 120/分、パス 20/分、管理ログイン 10/分、アクション 8件/10秒/参加者。

## Socket.IO

client → server

| イベント | ペイロード | 説明 |
|---|---|---|
| `joinRoom` | `{role: 'arena'|'player'|'spectator'|'admin', token?}` | player/admin はトークン必須。応答後 `matchSnapshot` |
| `requestSnapshot` | ack(snapshot) | 欠番時の再同期 |
| `timeSync` | `clientSentAt`, ack(serverTime) | 時刻オフセット推定 |
| `arenaStatus` | `{fps, frameMs, renderer, quality}` | 会場画面の描画状態（運営表示用） |

アクション送信は REST のみ（二重適用経路を作らない）。

server → client

| イベント | 説明 |
|---|---|
| `matchSnapshot` | `PublicMatchSnapshot`（`lastSeq`, `serverTime`, `config`, `regions`, `teams`, `clashes`, `result`, `leaders`, `recentEvents`, `joinOpen`, `paymentMode`, `playUrl`） |
| `matchEvent` | `GameEvent`（下表）。`matchId`・`seq`・`t`・`gameMs`・`data`・`patch` |
| `clockTick` | 2秒ごと。`{matchId, status, clockMs, gameMs, running, serverTime, lastSeq}` |
| `actionAck` | 本人の `p:{id}` ルームのみ |
| `paymentStatus` | 本人のみ |
| `serverNotice` | 全体告知 |

### GameEvent 種別

| type | data | patch |
|---|---|---|
| `MATCH_STATUS_CHANGED` | `{from, to, reason}` | status, pausedFrom, liveStartClock |
| `PARTICIPANT_JOINED` | `{participantId, teamId, nickname, isBot}` | teams |
| `ACTION_APPLIED` | `{participantId, nickname, teamId, actionType, regionId, code}` | regions, teams |
| `CONTEST_EXPIRED` | `{regionId, ownerTeamId}` | regions |
| `SHIELD_EXPIRED` | `{regionId}` | regions |
| `CLASH_RESOLVED` | `{clash: ClashRecord}`（スナップショット・各チームの与ダメ・必殺・HP/EN・KO） | teams |
| `MATCH_RESULT` | `{result}` | result |

例：

```json
{"matchId":"m_1f…","seq":42,"t":76500,"gameMs":46500,"type":"ACTION_APPLIED",
 "data":{"participantId":"p_9a…","nickname":"たろう","teamId":"RAIJIN","actionType":"ATTACK","regionId":"kanto","code":"CONTEST_STARTED"},
 "patch":{"regions":[{"regionId":"kanto","kind":"ENERGY","ownerTeamId":"FUJIN","contestedByTeamId":"RAIJIN","contestedUntil":71500,"shieldCharges":0,"shieldExpiresAt":null,"updatedAt":46500,"revision":3}],
          "teams":[{"teamId":"RAIJIN","hp":100,"energy":0,"participantCount":4,"apRemaining":9,"apTotal":12,"actionCount":3}, {"teamId":"FUJIN","…":"…"}]}}
```
