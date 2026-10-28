# TEST_PLAN と実行結果（ZAP BATTLE）

## 自動テスト一覧

| 種別 | 場所 | 件数 | 内容 |
|---|---|---|---|
| ルール（unit） | `packages/game-engine/src/engine.test.ts` | 22 | シーズン進行（開幕→8ラウンド→全国制覇→FINISHED）、ラウンド外/一時停止中のパンチ拒否、通常10・必殺（チーム10発目）・ピンチ×1.5、KOで即終了と地方の塗り、時間切れ判定・引き分け、全国制覇の判定、適応HP（目標秒数・×3上限・cap・下限）、シーズン間HP引継ぎ、`punchesToKo`/`punchesToSpecial`、リプレイ一致、tick粒度非依存、ミラー公平性 |
| 共有（unit） | `packages/shared/src/*.test.ts` | 8 | ニックネーム正規化/モデレーション、MatchStore（重複・欠番・別シーズン・古いスナップショット） |
| 3D（unit） | `packages/three-game/src/director.test.ts` | 9 | ラウンド開始演出、パンチ時のHP即時反映と攻撃/被弾、群衆連打の間引き（50発/秒でも雷エフェクト≤4・効果音≤13）、必殺技バナー（名前）と短縮版、ピンチ告知1回、KO→地方の塗り、引き分け・全国制覇バナー、両リグ全クリップ |
| サーバー統合 | `apps/server/test/flow.test.ts` | 19 | 自動開始、無料のチーム選択、残高なしのパンチ拒否（402・状態不変）、チャージ額の検証・同額請求書の再利用・二重mock-payでも1回だけ加算・他人の請求書404、パンチ21 sats・HP−10・名前付きイベント、同じclientActionIdの再送は無課金、連打429、ラウンド外/一時停止中は無料、15発でKO→地方・KO数・とどめの名前、BOTでシーズン完走→凍結スナップショット→自動で次シーズン（HP引継ぎ）、端末で同一プレイヤー・残高引継ぎ・旧トークン無効、チーム変更、遅延入金の加算、期限切れ、プロバイダ障害→回復後に加算、配布コード（1回限り・大小文字・チャージ停止中も可）、応援（無料・1秒制限・不正絵文字拒否）、ニックネーム非表示、管理認証/Origin・緊急停止（一時停止＋チャージ停止＋自動ループ停止）、残高調整（監査・負不可）、再起動→PAUSED→10秒後に自動再開、health/ready/Webhook秘密 |
| リアルタイム統合 | `apps/server/test/realtime.test.ts` | 6 | 4クライアント収束、欠番→スナップショット再同期、再接続、残高pushは本人のみ・応援/presenceは全員、不正トークン、timeSync |
| LNbits | `apps/server/test/lnbits.test.ts` | 6 | 模擬LNbits HTTP：invoice key・out:false・webhook URL・mock-pay非登録、401/404、偽Webhook→加算なし、実払い→1回だけ加算、5xx→再試行、承認なし起動拒否 |
| シミュレーター | `tools/simulations` + `tools/blender/test` | 5 | 決定性・8ラウンド完走・課金は着弾分のみ、同数の群衆で勝率が対称、適応HP（大人数ほどHPが高い）、GLB検査ツール |
| ソロ | `apps/solo/src/localMatch.test.ts` | 4 | BOTでシーズン完走→自動で次シーズン、着弾時のみ課金・連打制限、残高切れ→チャージ、一時停止で時計停止 |
| E2E | `tests/e2e/game.spec.ts` | 3 | 管理UIログイン、会場画面（2D）にQRと遊び方、スマホ3台：チャージ（mock）・配布コード・ラウンド開始待ち→パンチ→**大画面に名前**（遅延計測）・残高189・残高なしでチャージシート・無料応援が大画面に出る・一時停止で無効化/再開、英語切替と320px幅で横スクロールなし、WebGL起動とトップページ |

## 実行結果（2026-10-28, 開発コンテナ: 4 vCPU, GPUなし）

- `pnpm test`：**79件すべて成功**（+ tools/blender の検査ツール）
- `pnpm lint`：エラー0・警告0 / `pnpm typecheck`：成功 / `pnpm build`：成功（server esbuild, web next build）
- `pnpm e2e`：3/3 成功（約50秒）。スマホのパンチ→大画面に名前が出るまで 0.68〜0.77秒（devサーバー、6ブラウザ同時＋シミュレーター並行実行中、Playwrightのポーリング込み）
- `pnpm simulate`：docs/BALANCE_REPORT.md（群衆モデル、各行60シーズン）
- `pnpm start`（本番ビルド）起動確認：シーズンが `zap-2` 設定で自動開始。
- 負荷（`loadtest.ts`, 本番ビルド, 100人が0.4〜1.5秒間隔で30秒連打 + 観戦ソケット300、**シミュレーター並行実行中でCPU競合あり**）：
  - 100人のプレイヤー作成→チャージ→mock支払い：0.54秒、エラー0
  - パンチHTTP：p50 3ms / p95 92ms / max 248ms
  - パンチ→観戦300ソケット全員に到達：p50 49ms / p95 169ms / max 247ms（625件）
  - 3,142タップ中 2,517件はラウンドの合間（無料の空振り）。突然100人が来るとHP200のロボットが数秒でKOされ、
    HPが追いつく（×3/ラウンド）まで休憩時間の比率が高い。実際のスマホでは合間はボタンが無効になる。
- 3D描画：SwiftShader（ソフトウェアGL）で約4fps。HPバーのCSSアニメーションが描画負荷で遅れることを確認（数値は常に正しい）。**会場GPUでのFPS・遅延は未計測**。

## 目視確認（スクリーンショット、2026-10-28）

- /play 390px・320px（日本語/英語）：チーム選択、パンチ画面、チャージシート、横スクロールなし（320px英語でヘッダーが3px はみ出すバグを修正）
- /arena 1920×1080（2D・3D）：名前ポップアップ、必殺技バナー、KO→地方の塗り、遊び方＋QR。音声ONボタンとポップアップの重なり、3D地図ラベルがHUDの上に出る問題を修正
- ソロ 1440px・390px：スマホ幅でのはみ出し（16px）を修正、狭い画面ではポップアップ等を間引き

## 未実施・要実機

- 実スマホ（iOS Safari / Android Chrome）2〜3台での操作と、会場Wi-Fiでの遅延実測。連打時の誤タップ・ダブルタップズーム。
- 会場PC（GPU）での 1080p 60fps / 最低30fps の確認、群衆の連打（毎秒数十発）時のフレーム落ち、長時間（数時間）連続稼働、WebGLコンテキストロスト実発生時の挙動。
- 実ウォレット・実LNbits での決済（オーナー承認待ち）。
- 大音量/無音環境での音量、プロジェクター上のQR読み取り距離。
- 通りがかりの人による初見プレイテスト（説明なしで遊べるか）。
- スクリーンリーダーでの /play 操作確認。

## 実行方法

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
pnpm e2e                                   # dev サーバーを止めてから
pnpm simulate                              # 数分。docs/BALANCE_REPORT.md を更新
ADMIN_PASSWORD=xxx pnpm dev &              # 別端末で
pnpm --filter @sats-wars/simulations exec tsx src/loadtest.ts --password xxx --players 100 --spectators 300 --duration 30000
```
