# ARCHITECTURE

```
 スマホ /play (2D)  ─┐  REST (Bearer token)         ┌─ SQLite (node:sqlite, WAL)
 会場PC /arena (3D) ─┼─▶ apps/server (Fastify :4000) ┤   matches / match_commands / game_events / ...
 運営 /admin        ─┤  Socket.IO (snapshot + seq)   └─ PaymentAdapter: mock | LNbits (invoice key)
 観戦 /             ─┘          ▲
                                │ reduce(state, command)
                       packages/game-engine (純粋・決定的)
```

## 責務

| レイヤ | 場所 | 責務 |
|---|---|---|
| ルール | `packages/game-engine` | `reduce(state, cmd) → {state, events, outcome}`。タイマー処理、激突、勝敗、MVP。I/Oなし |
| 契約 | `packages/shared` | 型・Zodスキーマ・GameConfig・地域/地図・i18n・`MatchStore`（クライアント側のスナップショット+イベント適用、欠番検知） |
| 試合実行 | `apps/server/src/match/runtime.ts` | 単調時計（pause補正）、コマンド直列化、永続化（コマンドログ＋イベント＋射影）、購読者通知、ニックネーム非表示の適用 |
| 試合管理 | `match/manager.ts` | 現在の試合・次の試合の作成（設定凍結）・運営コマンド・監査 |
| 参加/決済 | `payments/join.ts` | 予約（TTL）、請求書、検証、冪等な付与、遅延入金、スポンサーパス、ポーリング |
| アクション | `match/actions.ts` | 認可・レート制限・エンジンへのACTION・actions表 |
| リアルタイム | `realtime/socket.ts` | ルーム（public/arena/admin/p:{id}）、snapshot・event・clockTick配信、時刻同期、会場FPS集計 |
| 3D | `packages/three-game` | `ArenaDirector`（イベント→演出タイムライン）、RobotActor、MapOverlay、Effects、CameraRig、LightingRig、PerformanceProbe |
| UI | `apps/web` | /play（2D）、/arena（3D/2D+HUD+音）、/admin、/、/results |

## 同期モデル

1. 接続時 `joinRoom` → サーバーが `matchSnapshot`（完全な公開状態、`lastSeq` 付き）を送信。
2. 以後 `matchEvent`（`seq` 連番、`patch` に事後状態）を適用。`seq <= lastSeq` は無視（重複安全）、欠番・別試合は `requestSnapshot`。
3. 2秒ごとの `clockTick` で時計を再アンカー。`lastSeq` が進んでいれば欠落検知。15秒ごとに snapshot で整合。
4. タイマー表示は `timeSync`（NTP方式、RTT最小サンプル）で得たサーバー時刻オフセットから推定。端末時計を信用しない。

## 演出と勝敗の分離

`ArenaDirector` は `CLASH_RESOLVED`（サーバー確定値）を受けて、カメラ→攻撃→命中（ここで HUD の HP を確定値に更新）→引き、の順で再生。
演出が遅れても最大4秒先までしかキューしない。アイドル時に表示HPとサーバーHPがずれていれば即同期。描画の有無は計算に影響しない。

## 永続化と復旧

- すべての非TICKコマンドを `match_commands` に追記。タイマー処理は時刻で決まるため TICK は保存不要（再生一致をテストで保証）。
- `game_events`, `clashes`, `teams`, `region_states`, `matches` は照会用の射影。
- 再起動：未終了試合をリプレイ → 最後の時計まで進める → 走行中なら `PAUSE(SERVER_RESTART)`。

## スケール前提

単一ノード・単一試合。Node のイベントループで全コマンドが直列化される（同期SQLite）。
複数ノードが必要になったら：試合ごとのシャーディング＋Redis Streams 等を評価（ROADMAP）。
