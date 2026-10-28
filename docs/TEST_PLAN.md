# TEST_PLAN と実行結果

## 自動テスト一覧

| 種別 | 場所 | 件数 | 内容 |
|---|---|---|---|
| ルール（unit） | `packages/game-engine/src/engine.test.ts` | 40 | 中立占領、シールド破壊、争奪開始/25秒内占領/失効、防御で争奪解除、無効操作でAP非消費、AP不足、開始前/PAUSED/終了後、冪等、同時行動の直列化、ボーナス停止/再開、対称ダメージ、clamp、エネルギー上限、必殺技、同時KO、時間切れ判定、MVP、リプレイ一致、tick粒度非依存、入力非破壊、seq連番、ミラー公平性 |
| 共有（unit） | `packages/shared/src/*.test.ts` | 8 | ニックネーム正規化/モデレーション、MatchStore（重複・欠番・別試合・古いスナップショット） |
| 3D（unit） | `packages/three-game/src/director.test.ts` | 5 | 演出タイムライン（命中時にサーバーHP反映）、必殺技、短縮/点滅抑制、KO→勝利、両リグ全クリップ |
| サーバー統合 | `apps/server/test/flow.test.ts` | 25 | mock決済→3AP→3行動→4回目NO_AP、冪等再送、未認証/未払い拒否、クライアント申告無視、チーム均等、端末重複、予約TTL、受付締切、決済停止中のパス、パス（1回限り・大小文字・推測・期限）、Webhook（未払い・偽秘密・未知hash・重複+ポーラー同時・欠損をポーラーで補完・プロバイダ障害）、期限切れ、遅延入金→繰越コード→次試合で利用、mock-pay非登録(lnbits)、管理認証/Origin、PAUSE/RESUME/緊急停止、全試合完走→次試合（設定凍結）、旧トークン拒否、ニックネーム非表示、再起動復元（PAUSED） |
| リアルタイム統合 | `apps/server/test/realtime.test.ts` | 6 | 4クライアント収束、欠番→スナップショット再同期、再接続、本人限定ack、不正トークン、timeSync |
| LNbits | `apps/server/test/lnbits.test.ts` | 6 | 模擬LNbits HTTP：invoice key・out:false・webhook URL、401/404、偽Webhook→付与なし、実払い→1回だけ付与、5xx→再試行、承認なし起動拒否 |
| シミュレーター | `tools/simulations` + `tools/blender/test` | 4 | 決定性、ミラー対称、GLB検査ツール |
| E2E | `tests/e2e/game.spec.ts` | 3 | 管理UIログイン→ロビー→スタート、スマホ3台（mock×2・スポンサーパス×1）、会場画面への反映と遅延計測、AP3消費後のUI無効化とAPI 4回目拒否、シールド破壊、リロード復帰、PAUSE/RESUME表示、中止→次試合、英語切替、320px幅、観戦、WebGL起動、トップページ |

## 実行結果（2026-10-28, 開発コンテナ: 4 vCPU, GPUなし）

- `pnpm test`：**90 + 4 件 すべて成功**
- `pnpm lint`：エラー0・警告0 / `pnpm typecheck`：成功 / `pnpm build`：成功（server esbuild, web next build）
- `pnpm e2e`：3/3 成功（約40秒）
- 負荷（`tools/simulations/src/loadtest.ts`, devサーバー, 100人 + 観戦ソケット300）：
  - 全員の予約→請求書→mock支払い：0.9秒
  - アクションHTTP：p50 10ms / p95 17ms / max 30ms
  - アクション→観戦300ソケット全員に到達：p50 12ms / p95 16ms / max 29ms
- 会場画面への反映（単独ブラウザ、`/arena?mode=2d`）：16–48ms。E2E（6ブラウザ同時＋シミュレーション並行のCPU飽和下）では 1.1–2.6秒。
- 3D描画：SwiftShader（ソフトウェアGL）で約4fps・3D反映約0.5秒。**会場GPUでのFPS・遅延は未計測**（受け入れ基準2の実機確認が必要）。

## 未実施・要実機

- 実スマホ（iOS Safari / Android Chrome）2〜3台での操作と、会場Wi-Fiでの遅延実測。
- 会場PC（GPU）での 1080p 60fps / 最低30fps の確認、長時間（数時間）連続稼働、WebGLコンテキストロスト実発生時の挙動。
- 実ウォレット・実LNbits での決済（オーナー承認待ち）。
- 大音量/無音環境での音量、プロジェクター上のQR読み取り距離。
- スクリーンリーダーでの /play 操作確認。

## 実行方法

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
pnpm e2e                                   # dev サーバーを止めてから
pnpm simulate                              # 数分。docs/BALANCE_REPORT.md を更新
ADMIN_PASSWORD=xxx pnpm dev &              # 別端末で
pnpm --filter @sats-wars/simulations exec tsx src/loadtest.ts --password xxx --players 100 --spectators 300
```
