# 02 — Network protocol / 通信仕様

型の正本：[`packages/shared/src/protocol.ts`](../packages/shared/src/protocol.ts)（イベント・状態）、
入力検証：[`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts)（Zod、サーバー専用）。

## 原則

- **サーバー権威**。クライアントは「意図」だけを送る（`LOCK` `FIRE` `DEPLOY_SHIELD` `SET_POWER` `ROUTE_SUBMIT` `REPAIR_START`
  `REPAIR_FINISH` `SYNC_NOW`）。
  HP・ダメージ・チャージ量・成否はエンジンが決め、クライアント由来の数値は受け付けない（`payload` は `.strict()`、余計な欄は `INVALID`）。
- 1つのオリジンに `/display` `/pilot` `/operator` `/api` `/socket.io` `/health`。Cookie と CSRF 検査が単純になる。
- シミュレーション 20 Hz（50 ms 固定グリッド）、公開スナップショット 10 Hz（コマンド直後は次の tick で即送信）、確定イベントは即時。
  スナップショットは perMessageDeflate で圧縮。クライアントは `serverTime + 経過` で時計を補間し、一時停止中は止める。
- 複数の大画面を開いても試合は1つ（全員が同じランタイムを見る）。

## 名前空間

| namespace   | 認証                          | クライアント → サーバー                                                                      | サーバー → クライアント                                                                                                              |
| ----------- | ----------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/display`  | なし（公開・読み取り専用）    | `display:stats`（FPS・画質・WebGL 喪失・解像度）                                             | `match:snapshot` `match:event` `seat:changed` `display:settings`                                                                     |
| `/pilot`    | `sw_pilot` Cookie（HttpOnly） | `pilot:joinSeat` `pilot:ready` `pilot:action` `pilot:syncFinisher` `pilot:leave`（ack 付き） | `match:snapshot` `match:event` `seat:changed` `pilot:actionResult` `pilot:sessionStatus` `payment:status`（本人のみ） `pilot:notice` |
| `/operator` | `sw_operator` Cookie          | `operator:command`（ack 付き）                                                               | `match:snapshot` `match:event` `operator:status`（1秒ごと）                                                                          |

ハンドシェイクは `Origin` を検査（同一ホスト・`PUBLIC_BASE_URL`・`ALLOWED_ORIGINS` のみ）。`Origin` のない非ブラウザ接続は Cookie を
持ち得ないため許可（パイロット/運営は Cookie がなければ `NOT_AUTHENTICATED` で拒否）。

## メッセージ

```ts
'match:snapshot': { matchId, phase, version, serverTime, state: PublicMatchState }
'match:event':    { eventId: `${matchId}:${seq}`, matchId, seq, serverTime, type, payload: MatchEvent }
'seat:changed':   { seatId, pilotDisplayName, connected, isAutoSupport }
'pilot:action':   { matchId, seatId, clientActionId, action: { actionType, payload } }  → ack ActionResult
'pilot:actionResult': { clientActionId, accepted, reasonCode?, resultingStateVersion? }
'pilot:sessionStatus': { authenticated, pilot: { publicName, kind, callsign, showCallsign }, matchId, assignedSeat }
'pilot:syncFinisher': { matchId, clientActionId }  → ack ActionResult（RAIJIN OVERDRIVE の SYNC NOW）
'payment:status':     PaymentIntentView           // 支払った本人のソケットにだけ
'pilot:notice':       { code: 'SESSION_REPLACED' | 'KICKED' }
```

### 操作の payload（`action.actionType`）

| actionType       | 席                 | payload                                                                     | 主な拒否理由                                       |
| ---------------- | ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------- |
| `LOCK` / `FIRE`  | GUNNER_L/R         | `{ targetId }` / `{}`                                                       | `NO_TARGET` `CHARGING` `NO_ENERGY` `WEAPON_BROKEN` |
| `DEPLOY_SHIELD`  | SHIELD_L/R         | `{ dir }`（担当方向のみ）                                                   | `BAD_DIRECTION` `COOLDOWN` `NO_ENERGY`             |
| `SET_POWER`      | POWER_CORE         | `{ distribution: {weapon,shield,mobility,repair}, baseVersion }`（合計100） | `STALE_VERSION` `BAD_DISTRIBUTION`                 |
| `ROUTE_SUBMIT`   | POWER_ROUTER       | `{ lane, rotations: number[9] }`                                            | `CIRCUIT_OK` `ROUTE_INCOMPLETE`                    |
| `REPAIR_START`   | ENGINEER_LEGS/CORE | `{ part }`（担当区画のみ）                                                  | `NOT_YOUR_PART` `PART_OK` `COOLDOWN` `NO_ENERGY`   |
| `REPAIR_FINISH`  | ENGINEER_LEGS/CORE | `{ part, order: number[] }`（ボルトを締めた順）                             | `NO_JOB` `JOB_EXPIRED` `WRONG_ORDER`               |
| `SYNC_NOW`       | 全席               | `{}`                                                                        | `OVERDRIVE_NOT_READY`                              |
| `BLACKOUT_ROUTE` | POWER_ROUTER       | `{ rotations: number[9] }`（炉心回路）                                      | `NO_CRISIS` `ROUTE_INCOMPLETE`                     |

- `PublicMatchState` に内部 `pilotId`・乱数状態・冪等ログは含めない（エンジンのテストとサーバー統合テストで検査）。
- `seq` は試合ごとに単調増加。クライアントの `MatchStore` は同じ `seq` を二度配らない。
- `clientActionId` は端末で生成（`crypto.getRandomValues`。http の LAN でも動く）。サーバーは `pilotId:clientActionId` で名前空間化して
  冪等にする（他人のキーを再送しても他人の結果は返らない）。ack が来なければ同じ ID で1回だけ再送。
- レート制限：パイロット 1 ソケットあたりトークンバケット（容量10・毎秒6）。超過は `RATE_LIMITED`。

## 理由コード（`reasonCode`）

`NOT_AUTHENTICATED` `INVALID` `RATE_LIMITED` `STALE_MATCH` `UNKNOWN_SEAT` `SEAT_TAKEN` `SEAT_NOT_OPEN` `ALREADY_SEATED`
`SEAT_LOCKED` `NOT_YOUR_SEAT` `WRONG_ROLE` `NOT_IN_COMBAT` `PAUSED` `NO_TARGET` `TARGET_LOST` `TARGET_ARRIVING` `CHARGING`
`COOLDOWN` `NO_ENERGY` `WEAPON_BROKEN` `BAD_DIRECTION` `ROUND_CLOSED` `STALE_VERSION` `BAD_DISTRIBUTION` `CIRCUIT_OK`
`ROUTE_INCOMPLETE` `PART_OK` `NOT_YOUR_PART` `NO_JOB` `JOB_EXPIRED` `WRONG_ORDER` `OVERDRIVE_NOT_READY` `NETWORK`（端末側のみ）。
日本語/英語の文言は `REASON_TEXT`（`packages/shared/src/actions.ts`）。

## 確定イベント（大画面の VFX/音の鍵）

`phase_changed` `match_paused` `match_resumed` `auto_support_changed` `seat_assigned` `seat_released` `seat_ready`
`seat_connection` `enemy_spawned` `target_locked` `weapon_charged` `weapon_fired` `enemy_destroyed` `threat_warning`
`shield_deployed` `threat_blocked` `threat_intercepted` `incoming_hit` `city_damaged` `city_lost` `part_damaged`
`part_repaired` `team_combo` `match_result` `power_routed` `circuit_overload` `circuit_restored` `repair_started`
`overdrive_ready` `overdrive_window` `overdrive_sync` `overdrive_fired` `overdrive_failed` `sats_pulse_settled`。
`crisis_started` `crisis_resolved { by: PULSE | ROUTE | AUTO }` `crisis_failed` も配信。`weapon_fired` は `perfect` と `link`、
`team_combo` は `link`（2〜4）を持つ。公開状態に `link`（現在の LINK）・`crisis`（炉心パズル含む）・`overchargeUntil`。
`sats_pulse_settled` は `{ seatId, gain, virtual, settleMs, crisis, overchargeUntil }`（金額・支払者の情報は載せない。
`settleMs` は実決済だけの「請求→着金」実測）。

## HTTP

| method | path                                  | 用途                                                        |
| ------ | ------------------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                             | 稼働確認（mode, matchId, phase, uptime）                    |
| GET    | `/api/public/match`                   | 公開スナップショット                                        |
| GET    | `/api/public/join`(.svg)              | 参加 URL と QR（サーバー生成）                              |
| GET    | `/api/session`                        | 自分のパイロット情報（仮名のみ）                            |
| POST   | `/api/auth/demo-guest`                | DEMO GUEST（sandbox のみ既定有効、Origin 検査・レート制限） |
| POST   | `/api/auth/logout`                    | セッション破棄・席を降りる                                  |
| POST   | `/api/operator/login`                 | 運営ログイン（定数時間比較・10回/分・監査ログ）             |
| POST   | `/api/operator/logout`                |                                                             |
| GET    | `/api/operator/session`               |                                                             |
| POST   | `/api/auth/attempt`                   | LNURL-auth 試行開始（`sw_auth` Cookie、lnurl・QR・期限）    |
| GET    | `/api/auth/lnurl`                     | LUD-04 ウォレットコールバック（`tag=login&k1&sig&key`）     |
| GET    | `/api/auth/attempt/:id/status`        | 自分の試行の状態。`AUTHORIZED` で `sw_pilot` を発行         |
| POST   | `/api/pilot/callsign`                 | コールサインと大画面表示の可否（任意）                      |
| GET    | `/api/payments/quote`                 | パルスの金額・受取先・種類・残り回数（本人）                |
| POST   | `/api/payments/intent`                | パルスの請求書作成（409＋理由コードで拒否）                 |
| GET    | `/api/payments/intent/:id`            | 自分の intent の状態のみ                                    |
| POST   | `/api/payments/webhook/lnbits?token=` | LNbits Webhook（きっかけのみ。必ず再照会）                  |

運営コマンド（`operator:command`）：`ATTRACT` `OPEN_LOBBY` `START` `SKIP_DEPLOY` `PAUSE` `RESUME` `END` `NEXT_ROUND` `RESET`
`SET_AUTO_SUPPORT` `SET_PRESET` `KICK_SEAT` `SET_DISPLAY` `SET_DEMO_BOTS` `SET_HIDE_CALLSIGNS` `SANDBOX_SETTLE` `PAYMENTS_CHECK`
`PAYMENTS_ENABLE_LIVE { confirm: 'LIVE' }` `PAYMENTS_DISABLE`。すべて監査ログに残る。

認証と決済の詳細は [`03_auth_and_payment.md`](03_auth_and_payment.md)。

## 再接続

- ソケットが切れても席は `seatHoldMs`（60秒）保持（`SEAT_CONNECTION` が `disconnectedAt` を記録し、エンジンが時間で解放）。
- 復帰したソケットには `pilot:sessionStatus` と最新スナップショットを即送信。取りこぼしたイベントには依存しない。
- スマホは `visibilitychange` でセッションを再確認（ウォレットアプリから戻ったときに認証完了を拾う）。
