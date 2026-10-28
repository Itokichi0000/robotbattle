# API_EVENTS — REST / Socket.IO 契約（ZAP BATTLE）

型定義の正：`packages/shared/src/protocol.ts`, `events.ts`, `state.ts`。エラーは `{ error: CODE, message }`（message は日英併記でそのまま表示可）。

## REST（`apps/server`, 既定 :4000）

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| GET | `/health` | - | 生存確認 |
| GET | `/ready` | - | DB・シーズンロード状態 |
| GET | `/api/public/current-match` | - | `{ snapshot: PublicMatchSnapshot }` |
| GET | `/api/matches` | - | 最近のシーズン一覧 |
| GET | `/api/matches/:id/snapshot` | - | 現在 or 終了時の凍結スナップショット（`/results/:id`） |
| POST | `/api/players` | - | `{teamId, nickname?, deviceId?}` → `JoinResponse`（`token` を保存）。同じ deviceId なら同じプレイヤー・残高 |
| GET | `/api/me` | プレイヤー | 残高・今シーズンのパンチ数・KO・保留中の請求書・直近結果 |
| POST | `/api/me/team` | プレイヤー | `{teamId}` チーム変更（無料） |
| POST | `/api/me/nickname` | プレイヤー | `{nickname}` |
| POST | `/api/topups` | プレイヤー | `{amountSats}`（`topupOptionsSats` のいずれか）→ `InvoiceResponse` |
| GET | `/api/topups/:invoiceId` | プレイヤー | 状態。PENDING ならサーバーがプロバイダへ再照会 |
| POST | `/api/codes/redeem` | プレイヤー | `{code}` → `{addedSats, creditSats}` |
| POST | `/api/zap` | プレイヤー | `{clientActionId}` → `ZapResponse {result, creditSats, duplicate}`。残高不足は 402 `INSUFFICIENT_CREDIT`、連打は 429 |
| POST | `/api/cheer` | プレイヤー | `{emoji?}` 無料の応援（1秒に1回） |
| POST | `/api/dev/mock-pay` | プレイヤー | **mockモードのみ登録**。`{invoiceId}` |
| POST | `/api/webhooks/lnbits/:secret` | パス秘密 | `{payment_hash}`。常に200。再照会してから加算 |
| POST | `/api/admin/login` / `logout` | - / 管理 | `{password}` → `{token}` |
| GET | `/api/admin/overview` | 管理 | シーズン・自動ループ・残高集計・請求書・コード・接続・会場FPS・サーバー遅延 |
| POST | `/api/admin/command` | 管理 | `START / PAUSE / RESUME / CANCEL / NEXT_MATCH / EMERGENCY_STOP / SET_PAYMENTS_ENABLED {enabled} / SET_AUTO_LOOP {enabled} / SET_DEMO_BOTS {perTeam}` |
| GET/PUT | `/api/admin/next-config` | 管理 | 次シーズンの `GameConfig`（Zod検証） |
| GET | `/api/admin/players` | 管理 | プレイヤー一覧（残高・パンチ数・KO） |
| POST | `/api/admin/players/:id/nickname-visibility` | 管理 | `{hidden}` |
| POST | `/api/admin/players/:id/credit` | 管理 | `{deltaSats, note}` 残高調整（監査ログ、0未満不可） |
| GET | `/api/admin/invoices` | 管理 | 請求書（hash は先頭12桁のみ） |
| POST | `/api/admin/invoices/:id/recheck` | 管理 | 再照会 |
| POST/GET | `/api/admin/passes` | 管理 | 配布コード発行 `{count, amountSats, expiresInMinutes, label}`（コードは発行時のみ返す）/ 一覧 |
| POST | `/api/admin/passes/:idPrefix/revoke` | 管理 | 失効 |
| GET | `/api/admin/audit`, `/api/admin/events?afterSeq=` | 管理 | 監査ログ・イベント履歴 |

認証は `Authorization: Bearer <token>`。管理APIはさらに `Origin` が `ALLOWED_ORIGINS` に含まれることを要求。
クライアントが `damage`, `hp`, `credit` 等を送っても無視される（スキーマにない）。

レート制限：全体 600/分（プレイヤートークン単位、なければIP）、プレイヤー作成 120/分、コード 20/分、管理ログイン 10/分、
パンチ 250ms/人（`zapCooldownMs`）、応援 1秒/人。

## Socket.IO

client → server

| イベント | ペイロード | 説明 |
|---|---|---|
| `joinRoom` | `{role: 'arena'|'player'|'spectator'|'admin', token?}` | player/admin はトークン必須。応答後 `matchSnapshot` |
| `requestSnapshot` | ack(snapshot) | 欠番時の再同期 |
| `timeSync` | `clientSentAt`, ack(serverTime) | 時刻オフセット推定 |
| `arenaStatus` | `{fps, frameMs, renderer, quality}` | 会場画面の描画状態（運営表示用） |

パンチ・応援は REST のみ（二重適用経路を作らない）。

server → client

| イベント | 宛先 | 説明 |
|---|---|---|
| `matchSnapshot` | 全員 | `PublicMatchSnapshot`（`phase`, `phaseEndsAt`, `roundOrder`, `round`, `rounds`, `regions`, `teams`, `result`, `supporters`, `recentEvents`, `paymentMode`, `paymentsEnabled`, `playUrl`, 時計） |
| `matchEvent` | 全員 | `GameEvent`（下表） |
| `clockTick` | 全員 | 2秒ごと。`{matchId, status, clockMs, gameMs, running, serverTime, lastSeq}` |
| `presence` | 全員 | 応援人数 `{RAIJIN, FUJIN}`（変化時のみ、最大1回/秒） |
| `cheer` | 全員 | `{teamId, nickname, emoji}`（非表示指定の名前は「匿名」） |
| `credit` | 本人の `p:{id}` のみ | `{creditSats, invoiceId, invoiceStatus, addedSats}` |
| `serverNotice` | 全員 | 全体告知 |

### GameEvent 種別

| type | data | patch |
|---|---|---|
| `MATCH_STATUS_CHANGED` | `{from, to, reason}` | status, pausedFrom, liveStartClock, phase… |
| `ROUND_STARTED` | `{round: RoundState}` | phase, phaseEndsAt, roundIndex, round |
| `ZAP` | `{participantId, nickname, teamId, code: HIT/SPECIAL/KO, damage, special, pinch, hp}` | round, teams |
| `ROUND_ENDED` | `{summary: RoundSummary, finisher}` | phase, phaseEndsAt, round, regions, teams |
| `SEASON_ENDED` | `{result: SeasonResult}` | phase, phaseEndsAt, result |

例：

```json
{"matchId":"m_1f…","seq":42,"t":21500,"gameMs":21500,"type":"ZAP",
 "data":{"participantId":"p_9a…","nickname":"たろう","teamId":"RAIJIN","code":"SPECIAL","damage":60,"special":true,"pinch":false,
         "hp":{"RAIJIN":180,"FUJIN":90}},
 "patch":{"round":{"index":0,"regionId":"kanto","hpMax":200,"hp":{"RAIJIN":180,"FUJIN":90},"gauge":{"RAIJIN":0,"FUJIN":4},"zaps":{"RAIJIN":10,"FUJIN":2},"…":"…"},
          "teams":[{"teamId":"RAIJIN","robotId":"raijin","regionsWon":0,"zapsTotal":10,"specialsTotal":1,"kos":0}]}}
```

公開スナップショット・イベントに支払い情報は含まれない。非表示にされたニックネームは「匿名」に置換される。
