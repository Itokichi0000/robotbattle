# 02 — Network protocol / 通信仕様

型の正本：[`packages/shared/src/protocol.ts`](../packages/shared/src/protocol.ts)（イベント・状態）、
入力検証：[`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts)（Zod、サーバー専用）。

## 原則

- **サーバー権威**。クライアントは「意図」だけを送る（`LOCK` / `FIRE` / `DEPLOY_SHIELD`、Phase 2 で電力・整備が増える）。
  HP・ダメージ・チャージ量・成否はエンジンが決め、クライアント由来の数値は受け付けない（`payload` は `.strict()`、余計な欄は `INVALID`）。
- 1つのオリジンに `/display` `/pilot` `/operator` `/api` `/socket.io` `/health`。Cookie と CSRF 検査が単純になる。
- シミュレーション 20 Hz（50 ms 固定グリッド）、公開スナップショット 10 Hz（コマンド直後は次の tick で即送信）、確定イベントは即時。
  スナップショットは perMessageDeflate で圧縮。クライアントは `serverTime + 経過` で時計を補間し、一時停止中は止める。
- 複数の大画面を開いても試合は1つ（全員が同じランタイムを見る）。

## 名前空間

| namespace   | 認証                          | クライアント → サーバー                                                 | サーバー → クライアント                                                                  |
| ----------- | ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/display`  | なし（公開・読み取り専用）    | `display:stats`（FPS・画質・WebGL 喪失・解像度）                        | `match:snapshot` `match:event` `seat:changed` `display:settings`                         |
| `/pilot`    | `sw_pilot` Cookie（HttpOnly） | `pilot:joinSeat` `pilot:ready` `pilot:action` `pilot:leave`（ack 付き） | `match:snapshot` `match:event` `seat:changed` `pilot:actionResult` `pilot:sessionStatus` |
| `/operator` | `sw_operator` Cookie          | `operator:command`（ack 付き）                                          | `match:snapshot` `match:event` `operator:status`（1秒ごと）                              |

ハンドシェイクは `Origin` を検査（同一ホスト・`PUBLIC_BASE_URL`・`ALLOWED_ORIGINS` のみ）。`Origin` のない非ブラウザ接続は Cookie を
持ち得ないため許可（パイロット/運営は Cookie がなければ `NOT_AUTHENTICATED` で拒否）。

## メッセージ

```ts
'match:snapshot': { matchId, phase, version, serverTime, state: PublicMatchState }
'match:event':    { eventId: `${matchId}:${seq}`, matchId, seq, serverTime, type, payload: MatchEvent }
'seat:changed':   { seatId, pilotDisplayName, connected, isAutoSupport }
'pilot:action':   { matchId, seatId, clientActionId, action: { actionType, payload } }  → ack ActionResult
'pilot:actionResult': { clientActionId, accepted, reasonCode?, resultingStateVersion? }
'pilot:sessionStatus': { authenticated, pilot: { publicName, kind }, matchId, assignedSeat }
```

- `PublicMatchState` に内部 `pilotId`・乱数状態・冪等ログは含めない（エンジンのテストとサーバー統合テストで検査）。
- `seq` は試合ごとに単調増加。クライアントの `MatchStore` は同じ `seq` を二度配らない。
- `clientActionId` は端末で生成（`crypto.getRandomValues`。http の LAN でも動く）。サーバーは `pilotId:clientActionId` で名前空間化して
  冪等にする（他人のキーを再送しても他人の結果は返らない）。ack が来なければ同じ ID で1回だけ再送。
- レート制限：パイロット 1 ソケットあたりトークンバケット（容量10・毎秒6）。超過は `RATE_LIMITED`。

## 理由コード（`reasonCode`）

`NOT_AUTHENTICATED` `INVALID` `RATE_LIMITED` `STALE_MATCH` `UNKNOWN_SEAT` `SEAT_TAKEN` `SEAT_NOT_OPEN` `ALREADY_SEATED`
`SEAT_LOCKED` `NOT_YOUR_SEAT` `WRONG_ROLE` `NOT_IN_COMBAT` `PAUSED` `NO_TARGET` `TARGET_LOST` `TARGET_ARRIVING` `CHARGING`
`COOLDOWN` `NO_ENERGY` `WEAPON_BROKEN` `BAD_DIRECTION` `ROUND_CLOSED` `NETWORK`（端末側のみ）。
日本語/英語の文言は `REASON_TEXT`（`packages/shared/src/actions.ts`）。

## 確定イベント（大画面の VFX/音の鍵）

`phase_changed` `match_paused` `match_resumed` `auto_support_changed` `seat_assigned` `seat_released` `seat_ready`
`seat_connection` `enemy_spawned` `target_locked` `weapon_charged` `weapon_fired` `enemy_destroyed` `threat_warning`
`shield_deployed` `threat_blocked` `threat_intercepted` `incoming_hit` `city_damaged` `city_lost` `part_damaged`
`part_repaired` `team_combo` `match_result`（Phase 2/4 で `power_routed` `overdrive_fired` `sats_pulse_settled` を追加）。

## HTTP

| method | path                     | 用途                                                        |
| ------ | ------------------------ | ----------------------------------------------------------- |
| GET    | `/health`                | 稼働確認（mode, matchId, phase, uptime）                    |
| GET    | `/api/public/match`      | 公開スナップショット                                        |
| GET    | `/api/public/join`(.svg) | 参加 URL と QR（サーバー生成）                              |
| GET    | `/api/session`           | 自分のパイロット情報（仮名のみ）                            |
| POST   | `/api/auth/demo-guest`   | DEMO GUEST（sandbox のみ既定有効、Origin 検査・レート制限） |
| POST   | `/api/auth/logout`       | セッション破棄・席を降りる                                  |
| POST   | `/api/operator/login`    | 運営ログイン（定数時間比較・10回/分・監査ログ）             |
| POST   | `/api/operator/logout`   |                                                             |
| GET    | `/api/operator/session`  |                                                             |

Phase 3 で `/api/auth/attempt`・`/api/auth/lnurl`（LUD-04 コールバック）、Phase 4 で `/api/payments/*` を追加する（`03_auth_and_payment.md`）。

## 再接続

- ソケットが切れても席は `seatHoldMs`（60秒）保持（`SEAT_CONNECTION` が `disconnectedAt` を記録し、エンジンが時間で解放）。
- 復帰したソケットには `pilot:sessionStatus` と最新スナップショットを即送信。取りこぼしたイベントには依存しない。
- スマホは `visibilitychange` でセッションを再確認（Phase 3 のウォレット往復に備える）。
