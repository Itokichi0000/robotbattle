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

## メッセージ（D-033 群衆レイド）

```ts
'match:snapshot': { matchId, phase, version, serverTime, state: PublicMatchState }
'match:event':    { eventId: `${matchId}:${seq}`, matchId, seq, serverTime, type, payload: MatchEvent }
'pilot:action':   { matchId, clientActionId, action: { kind: 'ATTACK' | 'DEFEND' | 'REPAIR' } }  → ack ActionResult
'pilot:actionResult': { clientActionId, accepted, reasonCode?, readyAt? }
'pilot:sessionStatus': { authenticated, pilot: { publicName, kind, callsign, showCallsign }, matchId, joined }
'payment:status':     PaymentIntentView           // 支払った本人のソケットにだけ
'pilot:notice':       { code: 'SESSION_REPLACED' | 'KICKED' }
```

- 席はない。パイロット名前空間に接続した認証済みの端末は、そのまま試合の参加者になる（`PLAYER_JOIN`）。切断後 45 秒は人数に数え、
  その間に戻れば同じ参加者。接続中の参加者は次の試合にもそのまま持ち越す。
- スマホから送るのは **`pilot:action` の1種類だけ**（無料タップ）。1人 0.7 秒に1回（`free.cooldownMs`）。早すぎると `COOLDOWN` と
  次に押せる時刻 `readyAt`。21 sats の大きい行動は HTTP の `POST /api/payments/intent { matchId, action }` で作り、着金確認後に
  サーバーがエンジンへ `PAID_ACTION` を入れる（クライアントからは送れない）。
- 群衆の連打は、エンジンが行動ごとに 200 ms でまとめて1つの `action` イベント（`count` 付き）にする。スナップショットは 10 Hz。
- `PublicMatchState` に内部 `pilotId`・乱数状態・冪等ログは含めない（エンジンのテストとサーバー統合テストで検査）。
- `seq` は試合ごとに単調増加。クライアントの `MatchStore` は同じ `seq` を二度配らない。
- `clientActionId` は端末で生成（`crypto.getRandomValues`。http の LAN でも動く）。サーバーは `pilotId:clientActionId` で名前空間化して
  冪等にする（他人のキーを再送しても他人の結果は返らない）。`COOLDOWN` の拒否は記録しないので、同じ ID で押し直せる。
- レート制限：パイロット 1 ソケットあたりトークンバケット（容量8・毎秒4）。超過は `RATE_LIMITED`。

## 理由コード（`reasonCode`）

`INVALID` `STALE_MATCH` `NOT_JOINED` `NOT_IN_COMBAT` `PAUSED` `COOLDOWN` `RATE_LIMITED` `DUPLICATE` `NETWORK`（端末側のみ）。
日本語/英語の文言は `REASON_TEXT`（`packages/shared/src/actions.ts`）。

## 確定イベント（大画面の VFX/音の鍵）

`phase_changed` `match_paused` `match_resumed` `player_joined { players, bot }` `player_left` `boss_spawned`
`action { kind, paid, virtual, bot, value, count, settleMs }` `threat_warning { threatId, target: CITY | MECH, cityId, dir, impactAt, amount }`
`strike_blocked` `strike_hit` `mech_hit { damage, hp }` `boss_destroyed` `match_result`。
`action` は無料タップのまとまり（`paid=false`、`count` 回分）か、21 sats の大きい行動1回（`paid=true`）。金額・支払者は載せない。
`settleMs` は実決済だけの「請求→着金」実測（VIRTUAL と BOT は null）。

## HTTP

| method | path                                  | 用途                                                           |
| ------ | ------------------------------------- | -------------------------------------------------------------- |
| GET    | `/health`                             | 稼働確認（mode, matchId, phase, uptime）                       |
| GET    | `/api/public/match`                   | 公開スナップショット                                           |
| GET    | `/api/public/join`(.svg)              | 参加 URL と QR（サーバー生成）                                 |
| GET    | `/api/session`                        | 自分のパイロット情報（仮名のみ）                               |
| POST   | `/api/auth/demo-guest`                | DEMO GUEST（sandbox のみ既定有効、Origin 検査・レート制限）    |
| POST   | `/api/auth/logout`                    | セッション破棄・試合から抜ける                                 |
| POST   | `/api/operator/login`                 | 運営ログイン（定数時間比較・10回/分・監査ログ）                |
| POST   | `/api/operator/logout`                |                                                                |
| GET    | `/api/operator/session`               |                                                                |
| POST   | `/api/auth/attempt`                   | LNURL-auth 試行開始（`sw_auth` Cookie、lnurl・QR・期限）       |
| GET    | `/api/auth/lnurl`                     | LUD-04 ウォレットコールバック（`tag=login&k1&sig&key`）        |
| GET    | `/api/auth/attempt/:id/status`        | 自分の試行の状態。`AUTHORIZED` で `sw_pilot` を発行            |
| POST   | `/api/pilot/callsign`                 | コールサインと大画面表示の可否（任意）                         |
| GET    | `/api/payments/quote`                 | 21 sats の金額・受取先・種類・行動ごとの効果・残り回数（本人） |
| POST   | `/api/payments/intent`                | `{ matchId, action }` の請求書作成（409＋理由コードで拒否）    |
| GET    | `/api/payments/intent/:id`            | 自分の intent の状態のみ                                       |
| POST   | `/api/payments/webhook/lnbits?token=` | LNbits Webhook（きっかけのみ。必ず再照会）                     |

運営コマンド（`operator:command`）：`START` `SKIP_DEPLOY` `PAUSE` `RESUME` `END` `NEXT_ROUND` `RESET`
`SET_AUTO_START { enabled }` `SET_PRESET` `SET_DISPLAY` `SET_DEMO_BOTS` `SET_HIDE_CALLSIGNS` `SANDBOX_SETTLE` `PAYMENTS_CHECK`
`PAYMENTS_ENABLE_LIVE { confirm: 'LIVE' }` `PAYMENTS_DISABLE` `SET_AUTO_SETTLE_VIRTUAL { enabled }`（sandbox のみ）。すべて監査ログに残る。
21 sats の請求書は戦闘中だけ作る（それ以外は 409 `NOT_IN_COMBAT`）。ほかの拒否：`PAYMENTS_DISABLED` `STALE_MATCH`
`PULSE_PENDING`（未払いが1件ある）`PULSE_LIMIT`（1人1試合3回）`PULSE_COOLDOWN`（15秒、`retryAfterMs` 付き）`PULSE_MATCH_LIMIT`（1試合15回）。

認証と決済の詳細は [`03_auth_and_payment.md`](03_auth_and_payment.md)。

## 再接続

- ソケットが切れても参加者は `playerHoldMs`（45秒）人数に数える（`PLAYER_CONNECTION` が `disconnectedAt` を記録し、エンジンが時間で外す）。
- 復帰したソケットには `pilot:sessionStatus` と最新スナップショットを即送信。取りこぼしたイベントには依存しない。
- スマホは `visibilitychange` でセッションを再確認（ウォレットアプリから戻ったときに認証完了を拾う）。
