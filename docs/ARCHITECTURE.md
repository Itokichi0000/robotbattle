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
| ルール | `packages/game-engine` | `reduce(state, cmd) → {state, events, outcome}`。フェーズ進行（開幕→ラウンド→結果→…→全国制覇）、パンチ・必殺・ピンチ・KO、適応HP、地方の塗り分け。`punchesToKo` 等の表示用ヒント関数。I/Oなし |
| 契約 | `packages/shared` | 型・Zodスキーマ・GameConfig・地域/地図・i18n・`MatchStore`（クライアント側のスナップショット+イベント適用、欠番検知） |
| 試合実行 | `apps/server/src/match/runtime.ts` | 単調時計（pause補正）、コマンド直列化、永続化（コマンドログ＋イベント＋射影）、購読者通知、ニックネーム非表示の適用 |
| シーズン管理 | `match/manager.ts` | 現在のシーズン・次のシーズンの作成（設定凍結）・自動ループ・再起動後の自動再開・応援人数・運営コマンド・監査 |
| プレイヤー/決済 | `payments/players.ts` | プレイヤー作成（端末で同一人物に戻す）、チーム変更、チャージ請求書、再照会・冪等な残高加算、配布コード、残高調整、ポーリング |
| パンチ/応援 | `match/zaps.ts` | 残高確認→エンジン ZAP→着弾時のみ課金（1トランザクション）、再送の冪等、連打制限、無料の応援 |
| デモBOT | `demo/bots.ts` | 両チーム同じ速さで殴るBOT（決済なし、名前に BOT） |
| リアルタイム | `realtime/socket.ts` | ルーム（public/arena/admin/p:{id}）、snapshot・event・clockTick・presence・cheer・credit配信、時刻同期、会場FPS集計 |
| 3D | `packages/three-game` | `ArenaDirector`（イベント→演出：パンチごとの反応を間引き、必殺技、ラウンド開始、KO、全国制覇）、RobotActor、MapOverlay（争う地方を強調）、Effects、CameraRig |
| UI | `apps/web` | /play（2D）、/arena（3D/2D+HUD+音）、/admin、/、/results |

## 同期モデル

1. 接続時 `joinRoom` → サーバーが `matchSnapshot`（完全な公開状態、`lastSeq` 付き）を送信。
2. 以後 `matchEvent`（`seq` 連番、`patch` に事後状態）を適用。`seq <= lastSeq` は無視（重複安全）、欠番・別試合は `requestSnapshot`。
3. 2秒ごとの `clockTick` で時計を再アンカー。`lastSeq` が進んでいれば欠落検知。15秒ごとに snapshot で整合。
4. タイマー表示は `timeSync`（NTP方式、RTT最小サンプル）で得たサーバー時刻オフセットから推定。端末時計を信用しない。

## 演出と勝敗の分離

`ArenaDirector` は `ZAP`（サーバー確定値）を受けた瞬間に HUD の HP を確定値に更新し、攻撃・被弾の動き・エフェクト・音を再生する。
群衆の連打に備え、着弾フラッシュ以外（雷/風エフェクト・効果音・画面揺れ・必殺技カメラ）は間引く。ラウンド開始・KO・全国制覇は
最大3秒先までしかキューしない。アイドル時に表示HPとサーバーHPがずれていれば即同期。描画の有無は計算に影響しない。

## 永続化と復旧

- すべての非TICKコマンドを `match_commands` に追記。タイマー処理は時刻で決まるため TICK は保存不要（再生一致をテストで保証）。
- `game_events`, `rounds`, `matches` は照会用の射影。残高は `players.credit_sats` と `credit_ledger` が正。
- 再起動：未終了シーズンをリプレイ → 最後の時計まで進める → 走行中なら `PAUSE(SERVER_RESTART)` → 自動ループONなら10秒後に自動再開。

## スケール前提

単一ノード・単一シーズン。Node のイベントループで全コマンドが直列化される（同期SQLite）。
複数ノードが必要になったら：試合ごとのシャーディング＋Redis Streams 等を評価（ROADMAP）。
